import * as THREE from "three";
import { SplatFileType } from "./SplatLoader";
import { getSplatFileType, getSplatFileTypeFromPath } from "./SplatLoader";
import { SH_DEGREE_TO_NUM_COEFF } from "./defines";
import type { SplatEncoder } from "./encoding/encoder";
import { unpackAntiSplat } from "./formats/antisplat";
import { unpackKsplat } from "./formats/ksplat";
import { unpackPcSogsZip } from "./formats/pcsogs";
import { unpackPly } from "./formats/ply";
import { SpzWriter, unpackSpz } from "./formats/spz";

export type FileInput = {
  fileBytes: Uint8Array<ArrayBuffer>;
  fileType?: SplatFileType;
  pathOrUrl?: string;
  transform?: { translate?: number[]; quaternion?: number[]; scale?: number };
};

export type TranscodeSpzInput = {
  /**
   * Collection of input files to transcode.
   * Each file can have an optional transform to apply.
   */
  inputs: FileInput[];
  /**
   * The maximum number of spherical harmonics.
   */
  maxSh?: number;
  /**
   * Optional clip box. Any splats outside of this box after
   * apply transformations will be omitted from the output.
   */
  clipXyz?: { min: number[]; max: number[] };
  /**
   * Number of fractional bits to use.
   */
  fractionalBits?: number;
  /**
   * Optional threshold to filter out splats with opacities below
   * this value.
   */
  opacityThreshold?: number;
};

const MAX_SPLATS = 50_000_000;
const tempV3 = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();

export async function transcodeSpz(input: TranscodeSpzInput) {
  const {
    inputs,
    clipXyz,
    maxSh = 3,
    fractionalBits = 12,
    opacityThreshold,
  } = input;

  const numShCoefficients = SH_DEGREE_TO_NUM_COEFF[maxSh];
  const context = {
    centers: new Float32Array(
      new ArrayBuffer(0, { maxByteLength: MAX_SPLATS * 3 * 4 }),
    ),
    scales: new Float32Array(
      new ArrayBuffer(0, { maxByteLength: MAX_SPLATS * 3 * 4 }),
    ),
    quats: new Float32Array(
      new ArrayBuffer(0, { maxByteLength: MAX_SPLATS * 4 * 4 }),
    ),
    rgb: new Float32Array(
      new ArrayBuffer(0, { maxByteLength: MAX_SPLATS * 3 * 4 }),
    ),
    opacities: new Float32Array(
      new ArrayBuffer(0, { maxByteLength: MAX_SPLATS * 1 * 4 }),
    ),
    sh: new Float32Array(
      new ArrayBuffer(0, { maxByteLength: MAX_SPLATS * numShCoefficients * 4 }),
    ),

    head: 0,
    indexMapping: {} as Record<number, number>,
    clippedIndices: new Set<number>(),
    capacity: 0,

    currentShBands: 0,
    translate: new THREE.Vector3(),
    rotate: new THREE.Quaternion(),
    scale: 1,
    clipBox: null as THREE.Box3 | null,

    getSplatIndex(index: number) {
      if (!(index in context.indexMapping)) {
        context.indexMapping[index] = this.head++;
      }
      return context.indexMapping[index];
    },

    transformPos(pos: THREE.Vector3) {
      pos.multiplyScalar(this.scale);
      pos.applyQuaternion(this.rotate);
      pos.add(this.translate);
      return pos;
    },

    transformScales(scales: THREE.Vector3) {
      scales.multiplyScalar(this.scale);
      return scales;
    },

    transformQuaternion(quat: THREE.Quaternion) {
      quat.premultiply(this.rotate);
      return quat;
    },

    withinClip(p: THREE.Vector3) {
      return !this.clipBox || this.clipBox.containsPoint(p);
    },

    withinOpacity(opacity: number) {
      return opacityThreshold !== undefined
        ? opacity >= opacityThreshold
        : true;
    },
  };

  const splatEncoder: SplatEncoder<void> = {
    allocate(numSplats, numShBands) {
      // Start of a new input, expand the buffers to accommodate at least numSplats
      const remainingCapacity = context.capacity - context.head;
      if (remainingCapacity < numSplats) {
        const newCapacity = numSplats - remainingCapacity;
        context.centers.buffer.resize(newCapacity * 3 * 4);
        context.scales.buffer.resize(newCapacity * 3 * 4);
        context.quats.buffer.resize(newCapacity * 4 * 4);
        context.rgb.buffer.resize(newCapacity * 3 * 4);
        context.opacities.buffer.resize(newCapacity * 1 * 4);
        if (maxSh > 0) {
          context.sh.buffer.resize(newCapacity * numShCoefficients * 4);
        }

        context.capacity = newCapacity;

        // Keep track of the number of sh bands in the current input
        context.currentShBands = numShBands;
      }
    },

    setSplat(
      i,
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
    ) {
      this.setSplatCenter(i, x, y, z);
      this.setSplatScales(i, scaleX, scaleY, scaleZ);
      this.setSplatQuat(i, quatX, quatY, quatZ, quatW);
      this.setSplatRgba(i, r, g, b, opacity);
    },

    setSplatAlpha(i, a) {
      const index = context.getSplatIndex(i);
      if (!context.withinOpacity(a)) {
        context.clippedIndices.add(index);
      }
      context.opacities[index] = a;
    },

    setSplatCenter(i, x, y, z) {
      const index = context.getSplatIndex(i);
      const center = context.transformPos(tempV3.set(x, y, z));
      if (!context.withinClip(center)) {
        context.clippedIndices.add(index);
      }
      context.centers[index * 3 + 0] = center.x;
      context.centers[index * 3 + 1] = center.y;
      context.centers[index * 3 + 2] = center.z;
    },

    setSplatQuat(i, quatX, quatY, quatZ, quatW) {
      const index = context.getSplatIndex(i);
      const quat = context.transformQuaternion(
        tempQuat.set(quatX, quatY, quatZ, quatW),
      );
      context.quats[index * 4 + 0] = quat.x;
      context.quats[index * 4 + 1] = quat.y;
      context.quats[index * 4 + 2] = quat.z;
      context.quats[index * 4 + 3] = quat.w;
    },

    setSplatRgb(i, r, g, b) {
      const index = context.getSplatIndex(i);
      context.rgb[index * 3 + 0] = r;
      context.rgb[index * 3 + 1] = g;
      context.rgb[index * 3 + 2] = b;
    },

    setSplatRgba(i, r, g, b, a) {
      this.setSplatRgb(i, r, g, b);
      this.setSplatAlpha(i, a);
    },

    setSplatScales(i, scaleX, scaleY, scaleZ) {
      const index = context.getSplatIndex(i);
      const scales = context.transformScales(
        tempV3.set(scaleX, scaleY, scaleZ),
      );
      context.scales[index * 3 + 0] = scales.x;
      context.scales[index * 3 + 1] = scales.y;
      context.scales[index * 3 + 2] = scales.z;
    },

    setSplatSh(i, sh) {
      const index = context.getSplatIndex(i);
      const shStride = numShCoefficients;
      const effectiveShBands = Math.min(context.currentShBands, maxSh);
      const shCoefficients = SH_DEGREE_TO_NUM_COEFF[effectiveShBands];

      for (let j = 0; j < shCoefficients; j++) {
        context.sh[index * shStride + j] = sh[j];
      }
    },

    closeTransferable() {},

    close() {
      throw new Error("Not supported");
    },
  };

  context.clipBox = clipXyz
    ? new THREE.Box3(
        new THREE.Vector3().fromArray(clipXyz.min),
        new THREE.Vector3().fromArray(clipXyz.max),
      )
    : null;
  for (const input of inputs) {
    context.translate.fromArray(input.transform?.translate ?? [0, 0, 0]);
    context.rotate.fromArray(input.transform?.quaternion ?? [0, 0, 0, 1]);
    context.scale = input.transform?.scale ?? 1;

    let fileType = input.fileType;
    if (!fileType) {
      fileType = getSplatFileType(input.fileBytes);
      if (!fileType && input.pathOrUrl) {
        fileType = getSplatFileTypeFromPath(input.pathOrUrl);
      }
    }

    const fileBytes = input.fileBytes;
    switch (fileType) {
      case SplatFileType.PLY:
        await unpackPly(fileBytes, splatEncoder);
        break;
      case SplatFileType.SPZ:
        await unpackSpz(fileBytes, splatEncoder);
        break;
      case SplatFileType.SPLAT:
        unpackAntiSplat(fileBytes, splatEncoder);
        break;
      case SplatFileType.KSPLAT:
        unpackKsplat(fileBytes, splatEncoder);
        break;
      case SplatFileType.PCSOGSZIP:
        await unpackPcSogsZip(fileBytes, splatEncoder);
        break;
      default:
        throw new Error(`transcodeSpz not implemented for: ${fileType}`);
    }
  }

  const numSplats = context.head - context.clippedIndices.size;
  const spz = new SpzWriter({
    numSplats,
    shDegree: maxSh,
    fractionalBits,
    flagAntiAlias: true,
  });
  let i = 0;
  // Go over all collected splats
  for (let splat = 0; splat < context.head; splat++) {
    // Skip splats that have been clipped
    if (context.clippedIndices.has(splat)) {
      continue;
    }

    // Write splat properties to the SpzWriter
    const i3 = i * 3;
    const i4 = i * 4;
    spz.setCenter(
      i,
      context.centers[i3],
      context.centers[i3 + 1],
      context.centers[i3 + 2],
    );
    spz.setScale(
      i,
      context.scales[i3],
      context.scales[i3 + 1],
      context.scales[i3 + 2],
    );
    spz.setQuat(
      i,
      context.quats[i4],
      context.quats[i4 + 1],
      context.quats[i4 + 2],
      context.quats[i4 + 3],
    );
    spz.setRgb(i, context.rgb[i3], context.rgb[i3 + 1], context.rgb[i3 + 2]);
    spz.setAlpha(i, context.opacities[i]);

    if (numShCoefficients > 0) {
      const shStride = numShCoefficients;
      spz.setSh(i, context.sh.slice(shStride * i, shStride * (i + 1)));
    }

    i++;
  }

  const spzBytes = await spz.finalize();
  return { fileBytes: spzBytes, clippedCount: spz.clippedCount };
}
