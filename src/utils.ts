import { Gunzip } from "fflate";
import * as THREE from "three";

import {
  SPLAT_TEX_HEIGHT,
  SPLAT_TEX_MIN_HEIGHT,
  SPLAT_TEX_WIDTH,
} from "./defines.js";

const f32buffer = new Float32Array(1);
const u32buffer = new Uint32Array(f32buffer.buffer);
const supportsFloat16Array = "Float16Array" in globalThis;
const f16buffer = supportsFloat16Array
  ? new globalThis["Float16Array" as keyof typeof globalThis](1)
  : null;
const u16buffer = new Uint16Array(f16buffer?.buffer);

/**
 * Reinterpret the bits of a float32 as a uint32
 * @param f The float32 to reinterpret
 * @returns The resulting uint32
 */
export function floatBitsToUint(f: number): number {
  f32buffer[0] = f;
  return u32buffer[0];
}

/**
 * Reinterpret the bits of a uint32 as a float32
 * @param u The uint32 to reinterpret
 * @returns The resulting float32
 */
export function uintBitsToFloat(u: number): number {
  u32buffer[0] = u;
  return f32buffer[0];
}

/**
 * Reinterpret the bits of a float16 as a uint16
 * @param f The float16 to reinterpret
 * @returns The resulting uint16
 */
export const toHalf = supportsFloat16Array ? toHalfNative : toHalfJS;
/**
 * Reinterpret the bits of a uint16 as a float16
 * @param u The uint16 to reinterpret
 * @returns The resulting float16
 */
export const fromHalf = supportsFloat16Array ? fromHalfNative : fromHalfJS;

function toHalfNative(f: number): number {
  f16buffer[0] = f;
  return u16buffer[0];
}

function toHalfJS(f: number): number {
  // Store the value into the shared Float32 array.
  f32buffer[0] = f;
  const bits = u32buffer[0];

  // Extract sign (1 bit), exponent (8 bits), and fraction (23 bits)
  const sign = (bits >> 31) & 0x1;
  const exp = (bits >> 23) & 0xff;
  const frac = bits & 0x7fffff;
  const halfSign = sign << 15;

  // Handle special cases: NaN and Infinity
  if (exp === 0xff) {
    // NaN: set all exponent bits to 1 and some nonzero fraction bits.
    if (frac !== 0) {
      return halfSign | 0x7fff;
    }
    // Infinity
    return halfSign | 0x7c00;
  }

  // Adjust the exponent from float32 bias (127) to float16 bias (15)
  const newExp = exp - 127 + 15;

  // Handle overflow: too large to represent in half precision.
  if (newExp >= 0x1f) {
    return halfSign | 0x7c00; // Infinity
  }
  if (newExp <= 0) {
    // Handle subnormals and underflow.
    if (newExp < -10) {
      // Too small: underflows to zero.
      return halfSign;
    }
    // Convert to subnormal: add the implicit leading 1 to the fraction,
    // then shift to align with the half-precision's 10 fraction bits.
    const subFrac = (frac | 0x800000) >> (1 - newExp + 13);
    return halfSign | subFrac;
  }

  // Normalized half-precision number: shift fraction to fit into 10 bits.
  const halfFrac = frac >> 13;
  return halfSign | (newExp << 10) | halfFrac;
}

function fromHalfNative(u: number): number {
  u16buffer[0] = u;
  return f16buffer[0];
}

function fromHalfJS(h: number): number {
  // Extract the sign (1 bit), exponent (5 bits), and fraction (10 bits)
  const sign = (h >> 15) & 0x1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;

  let f32bits: number;

  if (exp === 0) {
    if (frac === 0) {
      // Zero (positive or negative)
      f32bits = sign << 31;
    } else {
      // Subnormal half-precision number.
      // Normalize the subnormal number:
      let mant = frac;
      let e = -14; // For half, the exponent for subnormals is fixed at -14.
      // Shift left until the implicit leading 1 is in place.
      while ((mant & 0x400) === 0) {
        // 0x400 === 1 << 10
        mant <<= 1;
        e--;
      }
      // Remove the leading 1 (which is now implicit)
      mant &= 0x3ff;
      // Convert the half exponent (e) to the 32-bit float exponent:
      const newExp = e + 127; // 32-bit float bias is 127.
      const newFrac = mant << 13; // Align to 23-bit fraction (23 - 10 = 13)
      f32bits = (sign << 31) | (newExp << 23) | newFrac;
    }
  } else if (exp === 0x1f) {
    // Handle special cases for Infinity and NaN.
    if (frac === 0) {
      // Infinity
      f32bits = (sign << 31) | 0x7f800000;
    } else {
      // NaN (we choose a quiet NaN)
      f32bits = (sign << 31) | 0x7fc00000;
    }
  } else {
    // Normalized half-precision number.
    // Adjust exponent from half (bias 15) to float32 (bias 127)
    const newExp = exp - 15 + 127;
    const newFrac = frac << 13;
    f32bits = (sign << 31) | (newExp << 23) | newFrac;
  }

  // Write the 32-bit bit pattern to the shared buffer,
  // then read it as a float32 to return a JavaScript number.
  u32buffer[0] = f32bits;
  return f32buffer[0];
}

/**
 * Convert a float from 0..1 to a 0..255 uint
 * @param v The number to convert
 * @returns Uint8 representation
 */
export function floatToUint8(v: number): number {
  // Converts from 0..1 float to 0..255 uint8
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

// Recursively finds all ArrayBuffers in an object and returns them as an array
// to use as transferable objects to send between workers.
export function getArrayBuffers(ctx: unknown): Transferable[] {
  const buffers: ArrayBuffer[] = [];
  const seen = new Set();

  function traverse(obj: unknown) {
    if (obj && typeof obj === "object" && !seen.has(obj)) {
      seen.add(obj);

      if (obj instanceof ArrayBuffer) {
        buffers.push(obj);
      } else if (ArrayBuffer.isView(obj)) {
        // Handles TypedArrays and DataView
        buffers.push(obj.buffer as ArrayBuffer);
      } else if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        Object.values(obj).forEach(traverse);
      }
    }
  }

  traverse(ctx);
  return buffers;
}

// Compute a texture array size that is large enough to fit numSplats. The most
// common 2D texture size in WebGL2 is 4096x4096 which only allows for 16M splats,
// so Spark stores Gsplat data in a 2D texture array, which most platforms support
// up to 2048x2048x2048 = 8G splats. Allocations that fit within a single 2D texture
// array layer will be rounded up to fill an entire texture row. Once a texture
// array layer is filled, the allocation will be rounded up to fill an entire layer.
// This is done so the entire set of splats can be covered by min/max coords across
// each dimension.
export function getTextureSize(numSplats: number): {
  width: number;
  height: number;
  depth: number;
  maxSplats: number;
} {
  // Compute a texture array size that is large enough to fit numSplats.
  // The width is always 2048, the height sized to fit the splats but no larger than 2048.
  // The depth is the number of layers needed to fit the splats.
  // maxSplats is computed as the new total available splats that can be stored.
  const width = SPLAT_TEX_WIDTH;
  const height = Math.max(
    SPLAT_TEX_MIN_HEIGHT,
    Math.min(SPLAT_TEX_HEIGHT, Math.ceil(numSplats / width)),
  );
  const depth = Math.ceil(numSplats / (width * height));
  const maxSplats = width * height * depth;
  return { width, height, depth, maxSplats };
}

export function computeMaxSplats(numSplats: number): number {
  // Compute the size of a Gsplat array texture (2048x2048xD) that can fit
  // numSplats splats, and return the total number of splats that can be stored
  // in such a texture.
  const width = SPLAT_TEX_WIDTH;
  const height = Math.max(
    SPLAT_TEX_MIN_HEIGHT,
    Math.min(SPLAT_TEX_HEIGHT, Math.ceil(numSplats / width)),
  );
  const depth = Math.ceil(numSplats / (width * height));
  return width * height * depth;
}

const tempTRS1 = {
  position: new THREE.Vector3(),
  rotation: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};
const tempTRS2 = {
  position: new THREE.Vector3(),
  rotation: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};

// Compare two coordinate systems given by matrix1 and matrix2, returning the
// distance between their origins and the "coorientation" of their orientations,
// define as the dot product of their quaternion transforms (flipping their
// orientation to be on the same hemisphere if necessary).
function coorientDist(matrix1: THREE.Matrix4, matrix2: THREE.Matrix4) {
  matrix1.decompose(tempTRS1.position, tempTRS1.rotation, tempTRS1.scale);
  matrix2.decompose(tempTRS2.position, tempTRS2.rotation, tempTRS2.scale);

  const distance = tempTRS1.position.distanceTo(tempTRS2.position);
  const coorient = Math.abs(tempTRS1.rotation.dot(tempTRS2.rotation));
  return { distance, coorient };
}

// Utility function that returns whether two coordinate systems are "close"
// to each other, defined a maxDistance and a minCoorient.
export function withinCoorientDist({
  matrix1,
  matrix2,
  maxDistance,
  minCoorient,
}: {
  matrix1: THREE.Matrix4;
  matrix2: THREE.Matrix4;
  maxDistance: number;
  minCoorient?: number;
}): boolean {
  const { distance, coorient } = coorientDist(matrix1, matrix2);
  return (
    distance <= maxDistance && (minCoorient == null || coorient >= minCoorient)
  );
}

// Temporary storage used in `encodeQuatOCtXy88R8` and `decodeQuatOctXy88R8` to
// avoid allocation new Quaternions and Vector3 instances.
const tempNormalizedQuaternion = new THREE.Quaternion();
const tempAxis = new THREE.Vector3();

/**
 * Encodes a THREE.Quaternion into a 24‐bit integer.
 *
 * Bit layout (LSB → MSB):
 *   - Bits  0–7:  quantized U (8 bits)
 *   - Bits  8–15: quantized V (8 bits)
 *   - Bits 16–23: quantized angle θ (8 bits) from [0,π]
 *
 * This version uses folded octahedral mapping (all inline).
 */
export function encodeQuatOctXy88R8(q: THREE.Quaternion): number {
  // Force the minimal representation (q.w >= 0)
  const qnorm = tempNormalizedQuaternion.copy(q).normalize();
  if (qnorm.w < 0) {
    qnorm.set(-qnorm.x, -qnorm.y, -qnorm.z, -qnorm.w);
  }
  // Compute the rotation angle θ in [0, π]
  const theta = 2 * Math.acos(qnorm.w);
  // Recover the rotation axis (default to (1,0,0) for near-zero rotation)
  const xyz_norm = Math.sqrt(
    qnorm.x * qnorm.x + qnorm.y * qnorm.y + qnorm.z * qnorm.z,
  );
  const axis =
    xyz_norm < 1e-6
      ? tempAxis.set(1, 0, 0)
      : tempAxis.set(qnorm.x, qnorm.y, qnorm.z).divideScalar(xyz_norm);
  // const foldAxis = (axis.z < 0);

  // --- Folded Octahedral Mapping (inline) ---
  // Compute p = (axis.x, axis.y) / (|axis.x|+|axis.y|+|axis.z|)
  const sum = Math.abs(axis.x) + Math.abs(axis.y) + Math.abs(axis.z);
  let p_x = axis.x / sum;
  let p_y = axis.y / sum;
  // Fold the lower hemisphere.
  if (axis.z < 0) {
    const tmp = p_x;
    p_x = (1 - Math.abs(p_y)) * (p_x >= 0 ? 1 : -1);
    p_y = (1 - Math.abs(tmp)) * (p_y >= 0 ? 1 : -1);
  }
  // Remap from [-1,1] to [0,1]
  const u_f = p_x * 0.5 + 0.5;
  const v_f = p_y * 0.5 + 0.5;
  // Quantize to 7 bits (0..127)
  const quantU = Math.round(u_f * 255);
  const quantV = Math.round(v_f * 255);
  // --- Angle Quantization: Quantize θ ∈ [0,π] to 10 bits (0..1023) ---
  const angleInt = Math.round(theta * (255 / Math.PI));

  // Pack into 24 bits: bits [0–7]: quantU, [8–15]: quantV, [16–23]: angleInt.
  return (angleInt << 16) | (quantV << 8) | quantU;
}

/**
 * Decodes a 24‐bit encoded quaternion (packed in a number) back to a THREE.Quaternion.
 *
 * Assumes the same bit layout as in encodeQuatOctXy88R8.
 */
export function decodeQuatOctXy88R8(
  encoded: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  // Extract 8‐bit quantU and quantV, and 8‐bit angleInt.
  const quantU = encoded & 0xff; // bits 0–7
  const quantV = (encoded >>> 8) & 0xff; // bits 8–15
  const angleInt = (encoded >>> 16) & 0xff; // bits 16–23

  // Recover u and v in [0,1] then map to [-1,1]
  const u_f = quantU / 255;
  const v_f = quantV / 255;
  let f_x = (u_f - 0.5) * 2;
  let f_y = (v_f - 0.5) * 2;
  // Inverse folded mapping: recover z from the constraint |p_x|+|p_y|+z = 1.
  const f_z = 1 - (Math.abs(f_x) + Math.abs(f_y));
  const t = Math.max(-f_z, 0);
  f_x += f_x >= 0 ? -t : t;
  f_y += f_y >= 0 ? -t : t;
  const axis = tempAxis.set(f_x, f_y, f_z).normalize();

  // Decode the angle: θ ∈ [0,π]
  const theta = (angleInt / 255) * Math.PI;
  const halfTheta = theta * 0.5;
  const s = Math.sin(halfTheta);
  const w = Math.cos(halfTheta);
  // Reconstruct the quaternion from axis-angle: (axis * sin(θ/2), cos(θ/2))
  out.set(axis.x * s, axis.y * s, axis.z * s, w);
  return out;
}

// Partially decompress a gzip-encoded Uint8Array, returning a Uint8Array of
// the specified numBytes from the start of the file.
export function decompressPartialGzip(
  fileBytes: Uint8Array,
  numBytes: number,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let result: Uint8Array | null = null;

  const gunzip = new Gunzip((data, final) => {
    chunks.push(data);
    totalBytes += data.length;
    if (final || totalBytes >= numBytes) {
      const allBytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        allBytes.set(chunk, offset);
        offset += chunk.length;
      }
      result = allBytes.slice(0, numBytes);
    }
  });

  const CHUNK_SIZE = 1024;
  let offset = 0;
  while (result == null && offset < fileBytes.length) {
    const chunk = fileBytes.slice(offset, offset + CHUNK_SIZE);
    gunzip.push(chunk, false);
    offset += CHUNK_SIZE;
  }

  if (result == null) {
    gunzip.push(new Uint8Array(), true);
    if (result == null) {
      throw new Error("Failed to decompress partial gzip");
    }
  }
  return result;
}

export class GunzipReader {
  private chunks: Uint8Array[];
  private totalBytes: number;
  private reader: ReadableStreamDefaultReader;

  constructor(fileBytes: Uint8Array<ArrayBuffer>) {
    this.chunks = [];
    this.totalBytes = 0;

    const ds = new DecompressionStream("gzip");
    const decompressionStream = new Blob([fileBytes]).stream().pipeThrough(ds);
    this.reader = decompressionStream.getReader();
  }

  async read(numBytes: number): Promise<Uint8Array> {
    while (this.totalBytes < numBytes) {
      const { value: chunk, done: readerDone } = await this.reader.read();
      if (readerDone) {
        break;
      }

      this.chunks.push(chunk);
      this.totalBytes += chunk.length;
    }

    if (this.totalBytes < numBytes) {
      throw new Error(
        `Unexpected EOF: needed ${numBytes}, got ${this.totalBytes}`,
      );
    }

    const allBytes = new Uint8Array(this.totalBytes);
    let outOffset = 0;
    for (const chunk of this.chunks) {
      allBytes.set(chunk, outOffset);
      outOffset += chunk.length;
    }

    const result = allBytes.subarray(0, numBytes);
    this.chunks = [allBytes.subarray(numBytes)];
    this.totalBytes -= numBytes;
    return result;
  }
}
