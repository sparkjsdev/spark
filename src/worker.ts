import init_wasm, { sort_splats, sort32_splats } from "spark-internal-rs";
import type { PcSogsJson, TranscodeSpzInput } from "./SplatLoader";
import { unpackAntiSplat } from "./antisplat";
import { WASM_SPLAT_SORT } from "./defines";
import { unpackKsplat } from "./ksplat";
import { unpackPcSogs, unpackPcSogsZip } from "./pcsogs";
import { PlyReader } from "./ply";
import { SpzReader, transcodeSpz } from "./spz";
import {
  computeMaxSplats,
  encodeSh1Rgb,
  encodeSh2Rgb,
  encodeSh3Rgb,
  getArrayBuffers,
  setPackedSplat,
  setPackedSplatCenter,
  setPackedSplatOpacity,
  setPackedSplatQuat,
  setPackedSplatRgb,
  setPackedSplatScales,
  toHalf,
} from "./utils";

// WebWorker for Spark's background CPU tasks, such as Gsplat file decoding
// and sorting.

async function onMessage(event: MessageEvent) {
  // Unpack RPC function name, arguments, and ID from the main thread.
  const { name, args, id }: { name: string; args: unknown; id: number } =
    event.data;
  // console.log(`worker.onMessage(${id}, ${name}):`, args);

  // Initialize return result/error, to be filled out below.
  let result = undefined;
  let error = undefined;

  try {
    switch (name) {
      case "unpackPly": {
        const { packedArray, fileBytes } = args as {
          packedArray: Uint32Array;
          fileBytes: Uint8Array;
        };
        const decoded = await unpackPly({ packedArray, fileBytes });
        result = {
          id,
          numSplats: decoded.numSplats,
          packedArray: decoded.packedArray,
          extra: decoded.extra,
        };
        break;
      }
      case "decodeSpz": {
        const { fileBytes } = args as { fileBytes: Uint8Array };
        const decoded = unpackSpz(fileBytes);
        result = {
          id,
          numSplats: decoded.numSplats,
          packedArray: decoded.packedArray,
          extra: decoded.extra,
        };
        break;
      }
      case "decodeAntiSplat": {
        const { fileBytes } = args as { fileBytes: Uint8Array };
        const decoded = unpackAntiSplat(fileBytes);
        result = {
          id,
          numSplats: decoded.numSplats,
          packedArray: decoded.packedArray,
        };
        break;
      }
      case "decodeKsplat": {
        const { fileBytes } = args as { fileBytes: Uint8Array };
        const decoded = unpackKsplat(fileBytes);
        result = {
          id,
          numSplats: decoded.numSplats,
          packedArray: decoded.packedArray,
          extra: decoded.extra,
        };
        break;
      }
      case "decodePcSogs": {
        const { fileBytes, extraFiles } = args as {
          fileBytes: Uint8Array;
          extraFiles: Record<string, ArrayBuffer>;
        };
        const json = JSON.parse(
          new TextDecoder().decode(fileBytes),
        ) as PcSogsJson;
        const decoded = await unpackPcSogs(json, extraFiles);
        result = {
          id,
          numSplats: decoded.numSplats,
          packedArray: decoded.packedArray,
          extra: decoded.extra,
        };
        break;
      }
      case "decodePcSogsZip": {
        const { fileBytes } = args as { fileBytes: Uint8Array };
        const decoded = await unpackPcSogsZip(fileBytes);
        result = {
          id,
          numSplats: decoded.numSplats,
          packedArray: decoded.packedArray,
          extra: decoded.extra,
        };
        break;
      }
      case "sortSplats": {
        // Sort maxSplats splats using readback data, which encodes one uint32 per
        // Gsplats, with the low bytes encoding a float16 distance sort metric.
        const { maxSplats, totalSplats, readback, ordering } = args as {
          maxSplats: number;
          totalSplats: number;
          readback: Uint8Array[];
          ordering: Uint32Array;
        };
        // Sort totalSplats splats each with 4 bytes of readback, and outputs Uint32Array ordering of splat indices
        result = {
          id,
          readback,
          ...sortSplats({ totalSplats, readback, ordering }),
        };
        break;
      }
      case "sortDoubleSplats": {
        // Sort numSplats splats using the readback distance metric, which encodes
        // one float16 per splat (no unused high bytes like for sortSplats).
        const { numSplats, readback, ordering } = args as {
          numSplats: number;
          readback: Uint16Array;
          ordering: Uint32Array;
        };
        if (WASM_SPLAT_SORT) {
          result = {
            id,
            readback,
            ordering,
            activeSplats: sort_splats(numSplats, readback, ordering),
          };
        } else {
          result = {
            id,
            readback,
            ...sortDoubleSplats({ numSplats, readback, ordering }),
          };
        }
        break;
      }
      case "sort32Splats": {
        const { maxSplats, numSplats, readback, ordering } = args as {
          maxSplats: number;
          numSplats: number;
          readback: Uint32Array;
          ordering: Uint32Array;
        };
        // Benchmark sort
        // benchmarkSort(numSplats, readback, ordering);
        if (WASM_SPLAT_SORT) {
          result = {
            id,
            readback,
            ordering,
            activeSplats: sort32_splats(numSplats, readback, ordering),
          };
        } else {
          result = {
            id,
            readback,
            ...sort32Splats({ maxSplats, numSplats, readback, ordering }),
          };
        }
        break;
      }
      case "transcodeSpz": {
        const input = args as TranscodeSpzInput;
        const spzBytes = await transcodeSpz(input);
        result = {
          id,
          fileBytes: spzBytes,
          input,
        };
        break;
      }
      default: {
        throw new Error(`Unknown name: ${name}`);
      }
    }
  } catch (e) {
    error = e;
    console.error(error);
  }

  // Send the result or error back to the main thread, making sure to transfer any ArrayBuffers
  self.postMessage(
    { id, result, error },
    { transfer: getArrayBuffers(result) },
  );
}

function benchmarkSort(
  numSplats: number,
  readback32: Uint32Array,
  ordering: Uint32Array,
) {
  if (numSplats > 0) {
    console.log("Running sort benchmark");
    const readbackF32 = new Float32Array(readback32.buffer);
    const readback16 = new Uint16Array(readback32.length);
    for (let i = 0; i < numSplats; ++i) {
      readback16[i] = toHalf(readbackF32[i]);
    }

    const WARMUP = 10;
    for (let i = 0; i < WARMUP; ++i) {
      const activeSplats = sort_splats(numSplats, readback16, ordering);
      const activeSplats32 = sort32_splats(numSplats, readback32, ordering);
      const results = sortDoubleSplats({
        numSplats,
        readback: readback16,
        ordering,
      });
      const results32 = sort32Splats({
        maxSplats: numSplats,
        numSplats,
        readback: readback32,
        ordering,
      });
    }

    const TIMING_SAMPLES = 1000;
    let start: number;

    start = performance.now();
    for (let i = 0; i < TIMING_SAMPLES; ++i) {
      const activeSplats = sort_splats(numSplats, readback16, ordering);
    }
    const wasmTime = (performance.now() - start) / TIMING_SAMPLES;

    start = performance.now();
    for (let i = 0; i < TIMING_SAMPLES; ++i) {
      const results = sortDoubleSplats({
        numSplats,
        readback: readback16,
        ordering,
      });
    }
    const jsTime = (performance.now() - start) / TIMING_SAMPLES;

    console.log(
      `JS: ${jsTime} ms, WASM: ${wasmTime} ms, numSplats: ${numSplats}`,
    );

    start = performance.now();
    for (let i = 0; i < TIMING_SAMPLES; ++i) {
      const activeSplats32 = sort32_splats(numSplats, readback32, ordering);
    }
    const wasm32Time = (performance.now() - start) / TIMING_SAMPLES;

    start = performance.now();
    for (let i = 0; i < TIMING_SAMPLES; ++i) {
      const results = sort32Splats({
        maxSplats: numSplats,
        numSplats,
        readback: readback32,
        ordering,
      });
    }
    const js32Time = (performance.now() - start) / TIMING_SAMPLES;

    console.log(
      `JS32: ${js32Time} ms, WASM32: ${wasm32Time} ms, numSplats: ${numSplats}`,
    );
  }
}

async function unpackPly({
  packedArray,
  fileBytes,
}: { packedArray: Uint32Array; fileBytes: Uint8Array }): Promise<{
  packedArray: Uint32Array;
  numSplats: number;
  extra: Record<string, unknown>;
}> {
  const ply = new PlyReader({ fileBytes });
  await ply.parseHeader();
  const numSplats = ply.numSplats;

  const extra: Record<string, unknown> = {};

  ply.parseSplats(
    (
      index,
      x,
      y,
      z,
      scaleX,
      scaleY,
      scaleZ,
      quatX,
      quatY,
      quatZ,
      quatW,
      opacity,
      r,
      g,
      b,
    ) => {
      setPackedSplat(
        packedArray,
        index,
        x,
        y,
        z,
        scaleX,
        scaleY,
        scaleZ,
        quatX,
        quatY,
        quatZ,
        quatW,
        opacity,
        r,
        g,
        b,
      );
    },
    (index, sh1, sh2, sh3) => {
      if (sh1) {
        if (!extra.sh1) {
          extra.sh1 = new Uint32Array(numSplats * 2);
        }
        encodeSh1Rgb(extra.sh1 as Uint32Array, index, sh1);
      }
      if (sh2) {
        if (!extra.sh2) {
          extra.sh2 = new Uint32Array(numSplats * 4);
        }
        encodeSh2Rgb(extra.sh2 as Uint32Array, index, sh2);
      }
      if (sh3) {
        if (!extra.sh3) {
          extra.sh3 = new Uint32Array(numSplats * 4);
        }
        encodeSh3Rgb(extra.sh3 as Uint32Array, index, sh3);
      }
    },
  );

  return { packedArray, numSplats, extra };
}

function unpackSpz(fileBytes: Uint8Array): {
  packedArray: Uint32Array;
  numSplats: number;
  extra: Record<string, unknown>;
} {
  const spz = new SpzReader({ fileBytes });
  const numSplats = spz.numSplats;
  const maxSplats = computeMaxSplats(numSplats);
  const packedArray = new Uint32Array(maxSplats * 4);
  const extra: Record<string, unknown> = {};

  spz.parseSplats(
    (index, x, y, z) => {
      setPackedSplatCenter(packedArray, index, x, y, z);
    },
    (index, alpha) => {
      setPackedSplatOpacity(packedArray, index, alpha);
    },
    (index, r, g, b) => {
      setPackedSplatRgb(packedArray, index, r, g, b);
    },
    (index, scaleX, scaleY, scaleZ) => {
      setPackedSplatScales(packedArray, index, scaleX, scaleY, scaleZ);
    },
    (index, quatX, quatY, quatZ, quatW) => {
      setPackedSplatQuat(packedArray, index, quatX, quatY, quatZ, quatW);
    },
    (index, sh1, sh2, sh3) => {
      if (sh1) {
        if (!extra.sh1) {
          extra.sh1 = new Uint32Array(numSplats * 2);
        }
        encodeSh1Rgb(extra.sh1 as Uint32Array, index, sh1);
      }
      if (sh2) {
        if (!extra.sh2) {
          extra.sh2 = new Uint32Array(numSplats * 4);
        }
        encodeSh2Rgb(extra.sh2 as Uint32Array, index, sh2);
      }
      if (sh3) {
        if (!extra.sh3) {
          extra.sh3 = new Uint32Array(numSplats * 4);
        }
        encodeSh3Rgb(extra.sh3 as Uint32Array, index, sh3);
      }
    },
  );
  return { packedArray, numSplats, extra };
}

// Array of buckets for sorting float16 distances with range [0, DEPTH_INFINITY].
const DEPTH_INFINITY_F16 = 0x7c00;
const DEPTH_SIZE_16 = DEPTH_INFINITY_F16 + 1;
let depthArray16: Uint32Array | null = null;

function sortSplats({
  totalSplats,
  readback,
  ordering,
}: { totalSplats: number; readback: Uint8Array[]; ordering: Uint32Array }): {
  activeSplats: number;
  ordering: Uint32Array;
} {
  // Sort totalSplats Gsplats, each with 4 bytes of readback, and outputs Uint32Array
  // of indices from most distant to nearest. Each 4 bytes encode a float16 distance
  // and unused high bytes.
  if (!depthArray16) {
    depthArray16 = new Uint32Array(DEPTH_SIZE_16);
  }
  depthArray16.fill(0);

  const readbackUint32 = readback.map((layer) => new Uint32Array(layer.buffer));
  const layerSize = readbackUint32[0].length;
  const numLayers = Math.ceil(totalSplats / layerSize);

  let layerBase = 0;
  for (let layer = 0; layer < numLayers; ++layer) {
    const readbackLayer = readbackUint32[layer];
    const layerSplats = Math.min(readbackLayer.length, totalSplats - layerBase);
    for (let i = 0; i < layerSplats; ++i) {
      const pri = readbackLayer[i] & 0x7fff;
      if (pri < DEPTH_INFINITY_F16) {
        depthArray16[pri] += 1;
      }
    }
    layerBase += layerSplats;
  }

  let activeSplats = 0;
  for (let j = 0; j < DEPTH_SIZE_16; ++j) {
    const nextIndex = activeSplats + depthArray16[j];
    depthArray16[j] = activeSplats;
    activeSplats = nextIndex;
  }

  layerBase = 0;
  for (let layer = 0; layer < numLayers; ++layer) {
    const readbackLayer = readbackUint32[layer];
    const layerSplats = Math.min(readbackLayer.length, totalSplats - layerBase);
    for (let i = 0; i < layerSplats; ++i) {
      const pri = readbackLayer[i] & 0x7fff;
      if (pri < DEPTH_INFINITY_F16) {
        ordering[depthArray16[pri]] = layerBase + i;
        depthArray16[pri] += 1;
      }
    }
    layerBase += layerSplats;
  }
  if (depthArray16[DEPTH_SIZE_16 - 1] !== activeSplats) {
    throw new Error(
      `Expected ${activeSplats} active splats but got ${depthArray16[DEPTH_SIZE_16 - 1]}`,
    );
  }

  return { activeSplats, ordering };
}

// Sort numSplats splats, each with 2 bytes of float16 readback for distance metric,
// using one bucket sort pass, outputting Uint32Array of indices.
function sortDoubleSplats({
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
let bucket16: Uint32Array | null = null;
let scratchSplats: Uint32Array | null = null;

// two-pass radix sort (base 65536) of 32-bit keys in readback,
// but placing largest values first.
function sort32Splats({
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
  if (!bucket16) {
    bucket16 = new Uint32Array(BASE);
  }
  if (!scratchSplats || scratchSplats.length < maxSplats) {
    scratchSplats = new Uint32Array(maxSplats);
  }

  //
  // ——— Pass #1: bucket by inv(lo 16 bits) ———
  //
  bucket16.fill(0);
  for (let i = 0; i < numSplats; ++i) {
    const key = readback[i];
    if (key < DEPTH_INFINITY_F32) {
      const inv = ~key >>> 0;
      bucket16[inv & 0xffff] += 1;
    }
  }
  // exclusive prefix‑sum → starting offsets
  let total = 0;
  for (let b = 0; b < BASE; ++b) {
    const c = bucket16[b];
    bucket16[b] = total;
    total += c;
  }
  const activeSplats = total;

  // scatter into scratch by low bits of inv
  for (let i = 0; i < numSplats; ++i) {
    const key = readback[i];
    if (key < DEPTH_INFINITY_F32) {
      const inv = ~key >>> 0;
      scratchSplats[bucket16[inv & 0xffff]++] = i;
    }
  }

  //
  // ——— Pass #2: bucket by inv(hi 16 bits) ———
  //
  bucket16.fill(0);
  for (let k = 0; k < activeSplats; ++k) {
    const idx = scratchSplats[k];
    const inv = ~readback[idx] >>> 0;
    bucket16[inv >>> 16] += 1;
  }
  // exclusive prefix‑sum again
  let sum = 0;
  for (let b = 0; b < BASE; ++b) {
    const c = bucket16[b];
    bucket16[b] = sum;
    sum += c;
  }

  // scatter into final ordering by high bits of inv
  for (let k = 0; k < activeSplats; ++k) {
    const idx = scratchSplats[k];
    const inv = ~readback[idx] >>> 0;
    ordering[bucket16[inv >>> 16]++] = idx;
  }

  // sanity‑check: the last bucket should have eaten all entries
  if (bucket16[BASE - 1] !== activeSplats) {
    throw new Error(
      `Expected ${activeSplats} active splats but got ${bucket16[BASE - 1]}`,
    );
  }

  return { activeSplats, ordering };
}

// Buffer to queue any messages received while initializing, for example
// early messages to unpack a Gsplat file while still initializing the WASM code.
const messageBuffer: MessageEvent[] = [];

function bufferMessage(event: MessageEvent) {
  messageBuffer.push(event);
}

async function initialize() {
  // Hold any messages received while initializing
  self.addEventListener("message", bufferMessage);

  await init_wasm();

  self.removeEventListener("message", bufferMessage);
  self.addEventListener("message", onMessage);

  // Process any buffered messages
  for (const event of messageBuffer) {
    onMessage(event);
  }
  messageBuffer.length = 0;
}

initialize().catch(console.error);
