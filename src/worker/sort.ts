import * as THREE from "three";
import type { TransformRange } from "../defines";
import { toHalf } from "../utils";

// Array of buckets for sorting float16 distances with range [0, DEPTH_INFINITY].
const DEPTH_INFINITY_F16 = 0x7c00;
const DEPTH_SIZE_16 = DEPTH_INFINITY_F16 + 1;
let depthArray16: Uint32Array | null = null;

// Sort numSplats splats, each with 2 bytes of float16 readback for distance metric,
// using one bucket sort pass, outputting Uint32Array of indices.
export function sortDoubleSplats({
  numSplats,
  readback,
  ordering,
}: { numSplats: number; readback: Uint16Array; ordering: Uint32Array }): {
  activeSplats: number;
  ordering: Uint32Array;
} {
  // Ensure depthArray is allocated and zeroed out for our buckets.
  if (!depthArray16) {
    depthArray16 = new Uint32Array(DEPTH_SIZE_16);
  }
  depthArray16.fill(0);

  // Count the number of splats in each bucket (cull Gsplats at infinity).
  for (let i = 0; i < numSplats; ++i) {
    const pri = readback[i];
    if (pri < DEPTH_INFINITY_F16) {
      depthArray16[pri] += 1;
    }
  }

  // Compute the beginning index of each bucket in the output array and the
  // total number of active (non-infinity) splats, going in reverse order
  // because we want most distant Gsplats to be first in the output array.
  let activeSplats = 0;
  for (let j = DEPTH_INFINITY_F16 - 1; j >= 0; --j) {
    const nextIndex = activeSplats + depthArray16[j];
    depthArray16[j] = activeSplats;
    activeSplats = nextIndex;
  }

  // Write out the sorted indices into the output array according
  // bucket order.
  for (let i = 0; i < numSplats; ++i) {
    const pri = readback[i];
    if (pri < DEPTH_INFINITY_F16) {
      ordering[depthArray16[pri]] = i;
      depthArray16[pri] += 1;
    }
  }
  // Sanity check that the end of the closest bucket is the same as
  // our total count of active splats (not at infinity).
  if (depthArray16[0] !== activeSplats) {
    throw new Error(
      `Expected ${activeSplats} active splats but got ${depthArray16[0]}`,
    );
  }

  return { activeSplats, ordering };
}

const DEPTH_INFINITY_F32 = 0x7f800000;
let bucket16lo: Uint32Array | null = null;
let bucket16hi: Uint32Array | null = null;
let scratchSplats: Uint32Array | null = null;

// two-pass radix sort (base 65536) of 32-bit keys in readback,
// but placing largest values first.
export function sort32Splats({
  maxSplats,
  numSplats,
  readback, // Uint32Array of bit‑patterns
  ordering, // Uint32Array to fill with sorted indices
}: {
  maxSplats: number;
  numSplats: number;
  readback: Uint32Array;
  ordering: Uint32Array;
}): { activeSplats: number; ordering: Uint32Array } {
  const BASE = 1 << 16; // 65536

  // allocate once
  if (!bucket16lo) {
    bucket16lo = new Uint32Array(BASE);
  }
  if (!bucket16hi) {
    bucket16hi = new Uint32Array(BASE);
  }
  if (!scratchSplats || scratchSplats.length < maxSplats) {
    scratchSplats = new Uint32Array(maxSplats);
  }

  // tally low and high buckets
  bucket16lo.fill(0);
  bucket16hi.fill(0);
  for (let i = 0; i < numSplats; ++i) {
    const key = readback[i];
    if (key < DEPTH_INFINITY_F32) {
      const inv = ~key >>> 0;
      bucket16lo[inv & 0xffff] += 1;
      bucket16hi[inv >>> 16] += 1;
    }
  }

  //
  // ——— Pass #1: bucket by inv(lo 16 bits) ———
  //
  // exclusive prefix‑sum → starting offsets
  let total = 0;
  for (let b = 0; b < BASE; ++b) {
    const c = bucket16lo[b];
    bucket16lo[b] = total;
    total += c;
  }
  const activeSplats = total;

  // scatter into scratch by low bits of inv
  for (let i = 0; i < numSplats; ++i) {
    const key = readback[i];
    if (key < DEPTH_INFINITY_F32) {
      const inv = ~key >>> 0;
      scratchSplats[bucket16lo[inv & 0xffff]++] = i;
    }
  }

  //
  // ——— Pass #2: bucket by inv(hi 16 bits) ———
  //
  // exclusive prefix‑sum again
  let sum = 0;
  for (let b = 0; b < BASE; ++b) {
    const c = bucket16hi[b];
    bucket16hi[b] = sum;
    sum += c;
  }

  // scatter into final ordering by high bits of inv
  for (let k = 0; k < activeSplats; ++k) {
    const idx = scratchSplats[k];
    const inv = ~readback[idx] >>> 0;
    ordering[bucket16hi[inv >>> 16]++] = idx;
  }

  // sanity‑check: the last bucket should have eaten all entries
  if (bucket16hi[BASE - 1] !== activeSplats) {
    throw new Error(
      `Expected ${activeSplats} active splats but got ${bucket16hi[BASE - 1]}`,
    );
  }

  return { activeSplats, ordering };
}

// FIXME: Avoid importing THREE classes into worker
let distances = new Uint16Array();

const centerVector = new THREE.Vector3();
const transformMatrix = new THREE.Matrix4();
const viewOriginVector = new THREE.Vector3();
const viewDirVector = new THREE.Vector3();

export function sortSplatsCpu(
  splatCenters: Float32Array<ArrayBuffer>,
  transforms: Array<TransformRange>,
  viewOrigin: [number, number, number],
  viewDir: [number, number, number],
  ordering: Uint32Array<ArrayBufferLike>,
): { activeSplats: number; ordering: Uint32Array } {
  const numSplats = splatCenters.length / 3;
  if (distances.length < numSplats) {
    distances = new Uint16Array(numSplats);
  }
  distances.fill(DEPTH_INFINITY_F16);

  viewOriginVector.fromArray(viewOrigin);
  viewDirVector.fromArray(viewDir);

  // Ensure depthArray is allocated and zeroed out for our buckets.
  if (!depthArray16) {
    depthArray16 = new Uint32Array(DEPTH_SIZE_16);
  }
  depthArray16.fill(0);

  // Compute distance for each splat and count buckets
  let transformIndex = 0;
  while (transformIndex < transforms.length) {
    const transform = transforms[transformIndex];
    transformMatrix.fromArray(transform.matrix);

    for (
      let splatIndex = transform.start;
      splatIndex < transform.end;
      ++splatIndex
    ) {
      // Apply transform to center
      centerVector.fromArray(splatCenters, splatIndex * 3);
      centerVector.applyMatrix4(transformMatrix);
      const distance = centerVector.sub(viewOriginVector).dot(viewDirVector);

      if (distance >= 0) {
        const distanceU16 = toHalf(distance);
        distances[splatIndex] = distanceU16;
        depthArray16[distanceU16] += 1;
      } else {
        distances[splatIndex] = DEPTH_INFINITY_F16;
      }
    }

    transformIndex++;
  }

  // Compute the beginning index of each bucket in the output array and the
  // total number of active (non-infinity) splats, going in reverse order
  // because we want most distant Gsplats to be first in the output array.
  let activeSplats = 0;
  for (let j = DEPTH_INFINITY_F16 - 1; j >= 0; --j) {
    const nextIndex = activeSplats + depthArray16[j];
    depthArray16[j] = activeSplats;
    activeSplats = nextIndex;
  }

  // Write out the sorted indices into the output array according
  // bucket order.
  for (let i = 0; i < numSplats; ++i) {
    const pri = distances[i];
    if (pri < DEPTH_INFINITY_F16) {
      ordering[depthArray16[pri]] = i;
      depthArray16[pri] += 1;
    }
  }
  // Sanity check that the end of the closest bucket is the same as
  // our total count of active splats (not at infinity).
  if (depthArray16[0] !== activeSplats) {
    throw new Error(
      `Expected ${activeSplats} active splats but got ${depthArray16[0]}`,
    );
  }

  return { activeSplats, ordering };
}
