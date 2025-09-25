import { Gunzip } from "fflate";
import * as THREE from "three";

// Miscellaneous utility functions for Spark

import {
  LN_SCALE_MAX,
  LN_SCALE_MIN,
  SCALE_ZERO,
  SPLAT_TEX_HEIGHT,
  SPLAT_TEX_MIN_HEIGHT,
  SPLAT_TEX_WIDTH,
} from "./defines.js";
import { unindent } from "./dyno/base.js";

const f32buffer = new Float32Array(1);
const u32buffer = new Uint32Array(f32buffer.buffer);
const supportsFloat16Array = "Float16Array" in globalThis;
const f16buffer = supportsFloat16Array
  ? new globalThis["Float16Array" as keyof typeof globalThis](1)
  : null;
const u16buffer = new Uint16Array(f16buffer?.buffer);

// Returns a normalized array of numbers
export function normalize(vec: number[]) {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  return vec.map((v) => v / norm);
}

// Reinterpret the bits of a float32 as a uint32
export function floatBitsToUint(f: number): number {
  f32buffer[0] = f;
  return u32buffer[0];
}

// Reinterpret the bits of a uint32 as a float32
export function uintBitsToFloat(u: number): number {
  u32buffer[0] = u;
  return f32buffer[0];
}

export const toHalf = supportsFloat16Array ? toHalfNative : toHalfJS;
export const fromHalf = supportsFloat16Array ? fromHalfNative : fromHalfJS;

// Encode a number as a float16, stored as a uint16 number.
function toHalfNative(f: number): number {
  f16buffer[0] = f;
  return u16buffer[0];
}

// Encode a number as a float16, stored as a uint16 number.
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

// Convert a float16 stored as a uint16 number back to a float32.
function fromHalfNative(u: number): number {
  u16buffer[0] = u;
  return f16buffer[0];
}

// Convert a float16 stored as a uint16 number back to a float32.
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

// Convert a number 0..1 to a 0..255 uint
export function floatToUint8(v: number): number {
  // Converts from 0..1 float to 0..255 uint8
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

// Convert a number -1..1 to a -127..127 int
export function floatToSint8(v: number): number {
  // Converts from -1..1 float to -127..127 int8
  return Math.max(-127, Math.min(127, Math.round(v * 127)));
}

// Convert a 0..255 uint to a 0..1 float
export function Uint8ToFloat(v: number): number {
  // Converts from 0..255 uint8 to 0..1 float
  return v / 255;
}

// Convert a -127..127 int to a -1..1 float
export function Sint8ToFloat(v: number): number {
  // Converts from -127..127 int8 to -1..1 float
  return v / 127;
}

// A simple utility class for caching a fixed number of items
export class DataCache {
  // Maximum number of items to cache
  maxItems: number;

  // Function to fetch data for a key
  asyncFetch: (key: string) => Promise<unknown>;

  // Array of cached items
  items: { key: string; data: unknown }[];

  // Create a DataCache with a given function that fetches data not in the cache.
  constructor({
    asyncFetch,
    maxItems = 5,
  }: { asyncFetch: (key: string) => Promise<unknown>; maxItems?: number }) {
    this.asyncFetch = asyncFetch;
    this.maxItems = maxItems;
    this.items = [];
  }

  // Fetch data for the key, returning cached data if available.
  async getFetch(key: string): Promise<unknown> {
    // Fetches data for a key and caches it, returns cached data if available.
    const index = this.items.findIndex((item) => item.key === key);
    if (index >= 0) {
      // Data exists in our cache, move it to the end of the array
      const item = this.items.splice(index, 1)[0];
      this.items.push(item);
      // Return the cached data
      return item.data;
    }

    // Fetch the data from the asyncFetch function
    const data = await this.asyncFetch(key);
    // Add the data to the cache
    this.items.push({ key, data });
    // If the cache is too large, remove the oldest accessed item
    while (this.items.length > this.maxItems) {
      this.items.shift();
    }
    // Return the fetched data
    return data;
  }
}

// Like Array.map but for objects
export function mapObject(
  obj: Record<string, unknown>,
  fn: (value: unknown, key: string) => unknown,
): Record<string, unknown> {
  // Maps over an object, applying a function to each value and key
  const entries = Object.entries(obj).map(([key, value]) => [
    key,
    fn(value, key),
  ]);
  // Returns a new object with the mapped values
  return Object.fromEntries(entries);
}

// Like Array.map().filter() but for objects.
// The callback fn() should return undefined to filter out the key.
export function mapFilterObject(
  obj: Record<string, unknown>,
  fn: (value: unknown, key: string) => unknown,
): Record<string, unknown> {
  // Maps over an object, applying a function to each value and key
  // If no return (or return undefined), the key is not included in the result
  const entries = Object.entries(obj)
    .map(([key, value]) => [key, fn(value, key)])
    .filter(([_, value]) => value !== undefined);
  // Returns a new object with the filtered values
  return Object.fromEntries(entries);
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
        buffers.push(obj.buffer);
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

// Create an array of the given size and initialize element with initFunction()
export function newArray<T>(
  n: number,
  initFunction: (index: number) => T,
): T[] {
  // Creates a new array and calls a constructor function for each element with index
  return new Array(n).fill(null).map((_, i) => initFunction(i));
}

// A free list that has a pool of items of type T, with callbacks
// for constructing, disposing, and checking if an item is valid for the given args.
export class FreeList<T, Args> {
  items: T[];
  allocate: (args: Args) => T;
  dispose?: (item: T) => void;
  valid: (item: T, args: Args) => boolean;

  constructor({
    // Allocate a new item with the given args
    allocate,
    // Dispose of an item (optional, if GC is enough)
    dispose,
    // Check if an existing item in the list is valid for the given args,
    // allowing you to store heterogeneous items in the list.
    valid,
  }: {
    allocate: (args: Args) => T;
    dispose?: (item: T) => void;
    valid: (item: T, args: Args) => boolean;
  }) {
    this.items = [];
    this.allocate = allocate;
    this.dispose = dispose;
    this.valid = valid;
  }

  // Allocate a new item from the free list, first checking if a existing item
  // on the freelist is valid for the given args.
  alloc(args: Args): T {
    while (true) {
      const item = this.items.pop();
      if (!item) {
        // No items in the free list, allocate a new one
        break;
      }
      if (this.valid(item, args)) {
        // Found a valid item, return it
        // console.log(`FreeList.alloc(${JSON.stringify(args)}): found valid item. Reusing...`);
        return item;
      }
      // Item isn't valid for our args, dispose of it and try again
      if (this.dispose) {
        // console.log(`FreeList.alloc(${JSON.stringify(args)}): disposing invalid item.`);
        this.dispose(item);
      }
    }
    // console.log(`FreeList.alloc(${JSON.stringify(args)}): allocating new item`);
    return this.allocate(args);
  }

  free(item: T) {
    // Return item to the free list
    this.items.push(item);
  }

  disposeAll() {
    // Disposes of all items in the free list
    let item: T | undefined;
    item = this.items.pop();
    while (item) {
      if (this.dispose) {
        this.dispose(item);
      }
      item = this.items.pop();
    }
  }
}

// Encode a PackedSplat as 4 consecutive Uint32 elements in the packedSplats array.
// The center coordinates x,y,z are encoded as float16, the scales x,y,z as a
// logarithmic uint8, rotation as three uint8s representing rotation axis and angle,
// and RGBA as 4xuint8.
export function setPackedSplat(
  packedSplats: Uint32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  quatX: number,
  quatY: number,
  quatZ: number,
  quatW: number,
  opacity: number,
  r: number,
  g: number,
  b: number,
  encoding?: {
    rgbMin?: number;
    rgbMax?: number;
    lnScaleMin?: number;
    lnScaleMax?: number;
  },
) {
  const rgbMin = encoding?.rgbMin ?? 0.0;
  const rgbMax = encoding?.rgbMax ?? 1.0;
  const rgbRange = rgbMax - rgbMin;
  const uR = floatToUint8((r - rgbMin) / rgbRange);
  const uG = floatToUint8((g - rgbMin) / rgbRange);
  const uB = floatToUint8((b - rgbMin) / rgbRange);
  const uA = floatToUint8(opacity);

  // Alternate internal encodings commented out below.
  const uQuat = encodeQuatOctXy88R8(
    tempQuaternion.set(quatX, quatY, quatZ, quatW),
  );
  // const uQuat = encodeQuatXyz888(new THREE.Quaternion(quatX, quatY, quatZ, quatW));
  // const uQuat = encodeQuatEulerXyz888(new THREE.Quaternion(quatX, quatY, quatZ, quatW));
  const uQuatX = uQuat & 0xff;
  const uQuatY = (uQuat >>> 8) & 0xff;
  const uQuatZ = (uQuat >>> 16) & 0xff;

  // Allow scales below LN_SCALE_MIN to be encoded as 0, which signifies a 2DGS
  const lnScaleMin = encoding?.lnScaleMin ?? LN_SCALE_MIN;
  const lnScaleMax = encoding?.lnScaleMax ?? LN_SCALE_MAX;
  const lnScaleScale = 254.0 / (lnScaleMax - lnScaleMin);
  const uScaleX =
    scaleX < SCALE_ZERO
      ? 0
      : Math.min(
          255,
          Math.max(
            1,
            Math.round((Math.log(scaleX) - lnScaleMin) * lnScaleScale) + 1,
          ),
        );
  const uScaleY =
    scaleY < SCALE_ZERO
      ? 0
      : Math.min(
          255,
          Math.max(
            1,
            Math.round((Math.log(scaleY) - lnScaleMin) * lnScaleScale) + 1,
          ),
        );
  const uScaleZ =
    scaleZ < SCALE_ZERO
      ? 0
      : Math.min(
          255,
          Math.max(
            1,
            Math.round((Math.log(scaleZ) - lnScaleMin) * lnScaleScale) + 1,
          ),
        );

  const uCenterX = toHalf(x);
  const uCenterY = toHalf(y);
  const uCenterZ = toHalf(z);

  // Encode the splat as 4 consecutive Uint32 elements
  const i4 = index * 4;
  packedSplats[i4] = uR | (uG << 8) | (uB << 16) | (uA << 24);
  packedSplats[i4 + 1] = uCenterX | (uCenterY << 16);
  packedSplats[i4 + 2] = uCenterZ | (uQuatX << 16) | (uQuatY << 24);
  packedSplats[i4 + 3] =
    uScaleX | (uScaleY << 8) | (uScaleZ << 16) | (uQuatZ << 24);
}

// Encode the center coordinates x,y,z in the packedSplats Uint32Array,
// leaving all other fields as is.
export function setPackedSplatCenter(
  packedSplats: Uint32Array,
  index: number,
  x: number,
  y: number,
  z: number,
) {
  const uCenterX = toHalf(x);
  const uCenterY = toHalf(y);
  const uCenterZ = toHalf(z);

  const i4 = index * 4;
  packedSplats[i4 + 1] = uCenterX | (uCenterY << 16);
  packedSplats[i4 + 2] = uCenterZ | (packedSplats[i4 + 2] & 0xffff0000);
}

// Encode the scales x,y,z in the packedSplats Uint32Array, leaving all other fields as is.
export function setPackedSplatScales(
  packedSplats: Uint32Array,
  index: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  encoding?: {
    lnScaleMin?: number;
    lnScaleMax?: number;
  },
) {
  // Allow scales below LN_SCALE_MIN to be encoded as 0, which signifies a 2DGS
  const lnScaleMin = encoding?.lnScaleMin ?? LN_SCALE_MIN;
  const lnScaleMax = encoding?.lnScaleMax ?? LN_SCALE_MAX;
  const lnScaleScale = 254.0 / (lnScaleMax - lnScaleMin);
  const uScaleX =
    scaleX < SCALE_ZERO
      ? 0
      : Math.min(
          255,
          Math.max(
            1,
            Math.round((Math.log(scaleX) - lnScaleMin) * lnScaleScale) + 1,
          ),
        );
  const uScaleY =
    scaleY < SCALE_ZERO
      ? 0
      : Math.min(
          255,
          Math.max(
            1,
            Math.round((Math.log(scaleY) - lnScaleMin) * lnScaleScale) + 1,
          ),
        );
  const uScaleZ =
    scaleZ < SCALE_ZERO
      ? 0
      : Math.min(
          255,
          Math.max(
            1,
            Math.round((Math.log(scaleZ) - lnScaleMin) * lnScaleScale) + 1,
          ),
        );

  const i4 = index * 4;
  packedSplats[i4 + 3] =
    uScaleX |
    (uScaleY << 8) |
    (uScaleZ << 16) |
    (packedSplats[i4 + 3] & 0xff000000);
}

// Temporary storage used in `encodeQuatOCtXy88R8` and `decodeQuatOctXy88R8` to
// avoid allocation new Quaternions and Vector3 instances.
const tempQuaternion = new THREE.Quaternion();

// Encode the rotation quatX, quatY, quatZ, quatW in the packedSplats Uint32Array,
// leaving all other fields as is.
export function setPackedSplatQuat(
  packedSplats: Uint32Array,
  index: number,
  quatX: number,
  quatY: number,
  quatZ: number,
  quatW: number,
) {
  const uQuat = encodeQuatOctXy88R8(
    tempQuaternion.set(quatX, quatY, quatZ, quatW),
  );
  // const uQuat = encodeQuatXyz888(new THREE.Quaternion(quatX, quatY, quatZ, quatW));
  // const uQuat = encodeQuatEulerXyz888(new THREE.Quaternion(quatX, quatY, quatZ, quatW));
  const uQuatX = uQuat & 0xff;
  const uQuatY = (uQuat >>> 8) & 0xff;
  const uQuatZ = (uQuat >>> 16) & 0xff;

  const i4 = index * 4;
  packedSplats[i4 + 2] =
    (packedSplats[i4 + 2] & 0x0000ffff) | (uQuatX << 16) | (uQuatY << 24);
  packedSplats[i4 + 3] = (packedSplats[i4 + 3] & 0x00ffffff) | (uQuatZ << 24);
}

// Encode the RGBA color in the packedSplats Uint32Array, leaving other fields alone.
export function setPackedSplatRgba(
  packedSplats: Uint32Array,
  index: number,
  r: number,
  g: number,
  b: number,
  a: number,
  encoding?: {
    rgbMin?: number;
    rgbMax?: number;
  },
) {
  const rgbMin = encoding?.rgbMin ?? 0.0;
  const rgbMax = encoding?.rgbMax ?? 1.0;
  const rgbRange = rgbMax - rgbMin;
  const uR = floatToUint8((r - rgbMin) / rgbRange);
  const uG = floatToUint8((g - rgbMin) / rgbRange);
  const uB = floatToUint8((b - rgbMin) / rgbRange);
  const uA = floatToUint8(a);
  const i4 = index * 4;
  packedSplats[i4] = uR | (uG << 8) | (uB << 16) | (uA << 24);
}

// Encode the RGB color in the packedSplats Uint32Array, leaving other fields alone.
export function setPackedSplatRgb(
  packedSplats: Uint32Array,
  index: number,
  r: number,
  g: number,
  b: number,
  encoding?: {
    rgbMin?: number;
    rgbMax?: number;
  },
) {
  const rgbMin = encoding?.rgbMin ?? 0.0;
  const rgbMax = encoding?.rgbMax ?? 1.0;
  const rgbRange = rgbMax - rgbMin;
  const uR = floatToUint8((r - rgbMin) / rgbRange);
  const uG = floatToUint8((g - rgbMin) / rgbRange);
  const uB = floatToUint8((b - rgbMin) / rgbRange);

  const i4 = index * 4;
  packedSplats[i4] =
    uR | (uG << 8) | (uB << 16) | (packedSplats[i4] & 0xff000000);
}

// Encode the opacity in the packedSplats Uint32Array, leaving other fields alone.
export function setPackedSplatOpacity(
  packedSplats: Uint32Array,
  index: number,
  opacity: number,
) {
  const uA = floatToUint8(opacity);

  const i4 = index * 4;
  packedSplats[i4] = (packedSplats[i4] & 0x00ffffff) | (uA << 24);
}

const packedCenter = new THREE.Vector3();
const packedScales = new THREE.Vector3();
const packedQuaternion = new THREE.Quaternion();
const packedColor = new THREE.Color();
const packedFields = {
  center: packedCenter,
  scales: packedScales,
  quaternion: packedQuaternion,
  color: packedColor,
  opacity: 0.0,
};

// Unpack all components of a PackedSplat from the packedSplats Uint32Array into
// THREE.js vector objects. The returned objects will be reused each call.
export function unpackSplat(
  packedSplats: Uint32Array,
  index: number,
  encoding?: {
    rgbMin?: number;
    rgbMax?: number;
    lnScaleMin?: number;
    lnScaleMax?: number;
  },
): {
  center: THREE.Vector3;
  scales: THREE.Vector3;
  quaternion: THREE.Quaternion;
  color: THREE.Color;
  opacity: number;
} {
  // Returns a static object which is reused each time
  const result = packedFields;

  const i4 = index * 4;
  const word0 = packedSplats[i4];
  const word1 = packedSplats[i4 + 1];
  const word2 = packedSplats[i4 + 2];
  const word3 = packedSplats[i4 + 3];

  const rgbMin = encoding?.rgbMin ?? 0.0;
  const rgbMax = encoding?.rgbMax ?? 1.0;
  const rgbRange = rgbMax - rgbMin;
  result.color.set(
    rgbMin + ((word0 & 0xff) / 255) * rgbRange,
    rgbMin + (((word0 >>> 8) & 0xff) / 255) * rgbRange,
    rgbMin + (((word0 >>> 16) & 0xff) / 255) * rgbRange,
  );
  result.opacity = ((word0 >>> 24) & 0xff) / 255;
  result.center.set(
    fromHalf(word1 & 0xffff),
    fromHalf((word1 >>> 16) & 0xffff),
    fromHalf(word2 & 0xffff),
  );

  const lnScaleMin = encoding?.lnScaleMin ?? LN_SCALE_MIN;
  const lnScaleMax = encoding?.lnScaleMax ?? LN_SCALE_MAX;
  const lnScaleScale = (lnScaleMax - lnScaleMin) / 254.0;
  const uScalesX = word3 & 0xff;
  result.scales.x =
    uScalesX === 0 ? 0.0 : Math.exp(lnScaleMin + (uScalesX - 1) * lnScaleScale);
  const uScalesY = (word3 >>> 8) & 0xff;
  result.scales.y =
    uScalesY === 0 ? 0.0 : Math.exp(lnScaleMin + (uScalesY - 1) * lnScaleScale);
  const uScalesZ = (word3 >>> 16) & 0xff;
  result.scales.z =
    uScalesZ === 0 ? 0.0 : Math.exp(lnScaleMin + (uScalesZ - 1) * lnScaleScale);

  const uQuat = ((word2 >>> 16) & 0xffff) | ((word3 >>> 8) & 0xff0000);
  decodeQuatOctXy88R8(uQuat, result.quaternion);
  // decodeQuatXyz888(uQuat, result.quaternion);
  // decodeQuatEulerXyz888(uQuat, result.quaternion);

  return result;
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

// Heuristic function to determine if we are running on a mobile device.
export function isMobile(): boolean {
  if (navigator.maxTouchPoints > 0) {
    // Touch-enabled device, assume it's mobile
    return true;
  }
  return /Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/.test(
    navigator.userAgent,
  );
}

// Heuristic function to determine if we are running on an Android device.
// (does not include Oculus Quest)
export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

// Heuristic function to determine if we are running on an Oculus Quest device.
export function isOculus(): boolean {
  return /Oculus/.test(navigator.userAgent);
}

// Take an array of RGBA8 encoded pixels and flip them vertically in-place.
// This is useful for converting between top-left and bottom-left coordinate systems
// in standard 2D images vs WebGL2.
export function flipPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  // Flips pixels vertically in-place, returns original array.
  const tempLine = new Uint8Array(width * 4);

  // Only need to process half the height since we're swapping
  for (let y = 0; y < height / 2; y++) {
    const topOffset = y * width * 4;
    const bottomOffset = (height - 1 - y) * width * 4;

    // Save top line to temp buffer
    tempLine.set(pixels.subarray(topOffset, topOffset + width * 4));
    // Move bottom line to top
    pixels.set(
      pixels.subarray(bottomOffset, bottomOffset + width * 4),
      topOffset,
    );
    // Move saved top line to bottom
    pixels.set(tempLine, bottomOffset);
  }
  return pixels;
}

// Utility to take an array of RGBA8 encoded pixels and convert them to a
// PNG-encoded image data URL that can be downloaded to the client.
export function pixelsToPngUrl(
  pixels: Uint8Array,
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Can't get 2d context");
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// Manually clone a THREE.Clock object.
export function cloneClock(clock: THREE.Clock): THREE.Clock {
  const newClock = new THREE.Clock(clock.autoStart);
  newClock.startTime = clock.startTime;
  newClock.oldTime = clock.oldTime;
  newClock.elapsedTime = clock.elapsedTime;
  newClock.running = clock.running;
  return newClock;
}

// Utility to filter out an undefined values from an object.
export function omitUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== undefined),
  ) as Partial<T>;
}

// "Identity" vertex shader that just passes through the position.
export const IDENT_VERTEX_SHADER = unindent(`
  precision highp float;

  in vec3 position;

  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`);

// Returns the average position of an array of THREE.Vector3.
export function averagePositions(positions: THREE.Vector3[]): THREE.Vector3 {
  const sum = new THREE.Vector3();
  for (const position of positions) {
    sum.add(position);
  }
  return sum.divideScalar(positions.length);
}

// Returns an "average" of an array of THREE.Quaternion objects.
// Note that this is not a spherical lerp between quaternions but
// rather an arithmetic mean that is normalized to unit length.
export function averageQuaternions(
  quaternions: THREE.Quaternion[],
): THREE.Quaternion {
  if (quaternions.length === 0) {
    return new THREE.Quaternion();
  }
  const sum = quaternions[0].clone();
  for (let i = 1; i < quaternions.length; i++) {
    if (quaternions[i].dot(quaternions[0]) < 0.0) {
      sum.x -= quaternions[i].x;
      sum.y -= quaternions[i].y;
      sum.z -= quaternions[i].z;
      sum.w -= quaternions[i].w;
    } else {
      sum.x += quaternions[i].x;
      sum.y += quaternions[i].y;
      sum.z += quaternions[i].z;
      sum.w += quaternions[i].w;
    }
  }
  return sum.normalize();
}

// Compare two coordinates given by matrix1 and matrix2, returning the distance
// between their origins and the "coincidence" of their orientations, defined
// as the dot product of their "-z" axes.
export function coinciDist(matrix1: THREE.Matrix4, matrix2: THREE.Matrix4) {
  const origin1 = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix1);
  const origin2 = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix2);
  const direction1 = new THREE.Vector3(0, 0, -1)
    .applyMatrix4(matrix1)
    .sub(origin1)
    .normalize();
  const direction2 = new THREE.Vector3(0, 0, -1)
    .applyMatrix4(matrix2)
    .sub(origin2)
    .normalize();

  const distance = origin1.distanceTo(origin2);
  const coincidence = direction1.dot(direction2);
  return { distance, coincidence };
}

// Utility function that returns whether two coordinate system origins
// given by matrix1 and matrix2 are within a certain maxDistance of each other.
export function withinDist({
  matrix1,
  matrix2,
  maxDistance,
}: {
  matrix1: THREE.Matrix4;
  matrix2: THREE.Matrix4;
  maxDistance: number;
}): boolean {
  const origin1 = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix1);
  const origin2 = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix2);
  return origin1.distanceTo(origin2) <= maxDistance;
}

// Utility function that returns whether two coordinate systems are "close"
// to each other, defined by a maxDistance and a minCoincidence.
export function withinCoinciDist({
  matrix1,
  matrix2,
  maxDistance,
  minCoincidence,
}: {
  matrix1: THREE.Matrix4;
  matrix2: THREE.Matrix4;
  maxDistance: number;
  minCoincidence?: number;
}): boolean {
  const { distance, coincidence } = coinciDist(matrix1, matrix2);
  return (
    distance <= maxDistance &&
    (minCoincidence == null || coincidence >= minCoincidence)
  );
}

// Compare two coordinate systems given by matrix1 and matrix2, returning the
// distance between their origins and the "coorientation" of their orientations,
// define as the dot product of their quaternion transforms (flipping their
// orientation to be on the same hemisphere if necessary).
export function coorientDist(matrix1: THREE.Matrix4, matrix2: THREE.Matrix4) {
  const [origin1, rotate1] = [new THREE.Vector3(), new THREE.Quaternion()];
  const [origin2, rotate2] = [new THREE.Vector3(), new THREE.Quaternion()];
  matrix1.decompose(origin1, rotate1, new THREE.Vector3());
  matrix2.decompose(origin2, rotate2, new THREE.Vector3());

  const distance = origin1.distanceTo(origin2);
  const coorient = Math.abs(rotate1.dot(rotate2));
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

// Like Math.sign but with a custom epsilon value.
export function epsilonSign(value: number, epsilon = 0.001): number {
  if (Math.abs(value) < epsilon) {
    return 0;
  }
  return Math.sign(value);
}

// Encode a THREE.Quaternion into a 24-bit integer, converting the xyz coordinates
// to signed 8-bit integers (w can be derived from xyz), and flipping the sign
// of the quaternion if necessary to make this possible (q == -q for quaternions).
export function encodeQuatXyz888(q: THREE.Quaternion): number {
  const negQuat = q.w < 0.0;
  const iQuatX = floatToSint8(negQuat ? -q.x : q.x);
  const iQuatY = floatToSint8(negQuat ? -q.y : q.y);
  const iQuatZ = floatToSint8(negQuat ? -q.z : q.z);
  const uQuatX = iQuatX & 0xff;
  const uQuatY = iQuatY & 0xff;
  const uQuatZ = iQuatZ & 0xff;
  return uQuatX | (uQuatY << 8) | (uQuatZ << 16);
}

// Decode a 24-bit integer of the quaternion's xyz coordinates into a THREE.Quaternion.
export function decodeQuatXyz888(
  encoded: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const iQuatX = (encoded << 24) >> 24;
  const iQuatY = (encoded << 16) >> 24;
  const iQuatZ = (encoded << 8) >> 24;
  out.set(iQuatX / 127.0, iQuatY / 127.0, iQuatZ / 127.0, 0.0);
  const dotSelf = out.x * out.x + out.y * out.y + out.z * out.z;
  out.w = Math.sqrt(Math.max(0.0, 1.0 - dotSelf));
  return out;
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

/**
 * Encodes a THREE.Quaternion into a 24‑bit unsigned integer
 * by converting it to Euler angles (roll, pitch, yaw).
 * The Euler angles are assumed to be in radians in the range [-π, π].
 * Each angle is normalized to [0,1] and quantized to 8 bits.
 * Bit layout (LSB→MSB):
 *   - Bits 0–7:   roll (quantized)
 *   - Bits 8–15:  pitch (quantized)
 *   - Bits 16–23: yaw (quantized)
 */
export function encodeQuatEulerXyz888(q: THREE.Quaternion): number {
  // Normalize quaternion to ensure a proper rotation.
  const qNorm = q.clone().normalize();

  // Tait–Bryan angles (roll, pitch, yaw)
  const sinr_cosp = 2.0 * (qNorm.w * qNorm.x + qNorm.y * qNorm.z);
  const cosr_cosp = 1.0 - 2.0 * (qNorm.x * qNorm.x + qNorm.y * qNorm.y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);

  const sinp = 2.0 * (qNorm.w * qNorm.y - qNorm.z * qNorm.x);
  const pitch =
    Math.abs(sinp) >= 1.0 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  const siny_cosp = 2.0 * (qNorm.w * qNorm.z + qNorm.x * qNorm.y);
  const cosy_cosp = 1.0 - 2.0 * (qNorm.y * qNorm.y + qNorm.z * qNorm.z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);

  // Map each angle from [-π, π] to [0, 1]
  const normRoll = (roll + Math.PI) / (2 * Math.PI);
  const normPitch = (pitch + Math.PI) / (2 * Math.PI);
  const normYaw = (yaw + Math.PI) / (2 * Math.PI);

  // Quantize to 8 bits (0 to 255)
  const rollQ = Math.round(normRoll * 255);
  const pitchQ = Math.round(normPitch * 255);
  const yawQ = Math.round(normYaw * 255);

  // Pack into a 24-bit unsigned integer:
  //   Bits 0–7:   rollQ, Bits 8–15: pitchQ, Bits 16–23: yawQ.
  return (yawQ << 16) | (pitchQ << 8) | rollQ;
}

/**
 * Decodes a 24‑bit unsigned integer into a THREE.Quaternion
 * by unpacking three 8‑bit values (roll, pitch, yaw) in the range [0,255]
 * and then converting them back to Euler angles in [-π, π] and to a quaternion.
 */
export function decodeQuatEulerXyz888(
  encoded: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  // Unpack 8‑bit values.
  const rollQ = encoded & 0xff;
  const pitchQ = (encoded >>> 8) & 0xff;
  const yawQ = (encoded >>> 16) & 0xff;

  // Convert quantized values back to normalized [0,1] values.
  const normRoll = rollQ / 255;
  const normPitch = pitchQ / 255;
  const normYaw = yawQ / 255;

  // Map from [0,1] to [-π, π]
  const roll = normRoll * (2 * Math.PI) - Math.PI;
  const pitch = normPitch * (2 * Math.PI) - Math.PI;
  const yaw = normYaw * (2 * Math.PI) - Math.PI;

  // Convert Euler angles to quaternion (Tait–Bryan: roll, pitch, yaw).
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);

  out.w = cr * cp * cy + sr * sp * sy;
  out.x = sr * cp * cy - cr * sp * sy;
  out.y = cr * sp * cy + sr * cp * sy;
  out.z = cr * cp * sy - sr * sp * cy;
  out.normalize();
  return out;
}

// Pack four signed 8-bit values into a single uint32.
function packSint8Bytes(
  b0: number,
  b1: number,
  b2: number,
  b3: number,
): number {
  const clampedB0 = Math.max(-127, Math.min(127, b0 * 127));
  const clampedB1 = Math.max(-127, Math.min(127, b1 * 127));
  const clampedB2 = Math.max(-127, Math.min(127, b2 * 127));
  const clampedB3 = Math.max(-127, Math.min(127, b3 * 127));
  return (
    (clampedB0 & 0xff) |
    ((clampedB1 & 0xff) << 8) |
    ((clampedB2 & 0xff) << 16) |
    ((clampedB3 & 0xff) << 24)
  );
}

// Encode an array of 9 signed RGB SH1 coefficients (clamped to [-1,1]) into
// a pair of uint32 values, where each coefficient is stored as a sint7
export function encodeSh1Rgb(
  sh1Array: Uint32Array,
  index: number,
  sh1Rgb: Float32Array,
  encoding?: {
    sh1Min?: number;
    sh1Max?: number;
  },
) {
  const sh1Min = encoding?.sh1Min ?? -1;
  const sh1Max = encoding?.sh1Max ?? 1;
  const sh1Mid = 0.5 * (sh1Min + sh1Max);
  const sh1Scale = 126 / (sh1Max - sh1Min);

  // Pack sint7 values into 2 x uint32
  const base = index * 2;
  for (let i = 0; i < 9; ++i) {
    const s = (sh1Rgb[i] - sh1Mid) * sh1Scale;
    const value = Math.round(Math.max(-63, Math.min(63, s))) & 0x7f;
    const bitStart = i * 7;
    const bitEnd = bitStart + 7;

    const wordStart = Math.floor(bitStart / 32);
    const bitOffset = bitStart - wordStart * 32;
    const firstWord = (value << bitOffset) & 0xffffffff;
    sh1Array[base + wordStart] |= firstWord;

    if (bitEnd > wordStart * 32 + 32) {
      const secondWord = (value >>> (32 - bitOffset)) & 0xffffffff;
      sh1Array[base + wordStart + 1] |= secondWord;
    }
  }
}

// Encode an array of 15 signed RGB SH2 coefficients (clamped to [-1,1]) into
// an array of 4 uint32 values, where each coefficient is stored as a sint8.
export function encodeSh2Rgb(
  sh2Array: Uint32Array,
  index: number,
  sh2Rgb: Float32Array,
  encoding?: {
    sh2Min?: number;
    sh2Max?: number;
  },
) {
  const sh2Min = encoding?.sh2Min ?? -1;
  const sh2Max = encoding?.sh2Max ?? 1;
  const sh2Mid = 0.5 * (sh2Min + sh2Max);
  const sh2Scale = 2 / (sh2Max - sh2Min);

  // Pack sint8 values into 4 x uint32
  sh2Array[index * 4 + 0] = packSint8Bytes(
    (sh2Rgb[0] - sh2Mid) * sh2Scale,
    (sh2Rgb[1] - sh2Mid) * sh2Scale,
    (sh2Rgb[2] - sh2Mid) * sh2Scale,
    (sh2Rgb[3] - sh2Mid) * sh2Scale,
  );
  sh2Array[index * 4 + 1] = packSint8Bytes(
    (sh2Rgb[4] - sh2Mid) * sh2Scale,
    (sh2Rgb[5] - sh2Mid) * sh2Scale,
    (sh2Rgb[6] - sh2Mid) * sh2Scale,
    (sh2Rgb[7] - sh2Mid) * sh2Scale,
  );
  sh2Array[index * 4 + 2] = packSint8Bytes(
    (sh2Rgb[8] - sh2Mid) * sh2Scale,
    (sh2Rgb[9] - sh2Mid) * sh2Scale,
    (sh2Rgb[10] - sh2Mid) * sh2Scale,
    (sh2Rgb[11] - sh2Mid) * sh2Scale,
  );
  sh2Array[index * 4 + 3] = packSint8Bytes(
    (sh2Rgb[12] - sh2Mid) * sh2Scale,
    (sh2Rgb[13] - sh2Mid) * sh2Scale,
    (sh2Rgb[14] - sh2Mid) * sh2Scale,
    0,
  );
}

// Encode an array of 21 signed RGB SH3 coefficients (clamped to [-1,1]) into
// an array of 4 uint32 values, where each coefficient is stored as a sint6.
export function encodeSh3Rgb(
  sh3Array: Uint32Array,
  index: number,
  sh3Rgb: Float32Array,
  encoding?: {
    sh3Min?: number;
    sh3Max?: number;
  },
) {
  const sh3Min = encoding?.sh3Min ?? -1;
  const sh3Max = encoding?.sh3Max ?? 1;
  const sh3Mid = 0.5 * (sh3Min + sh3Max);
  const sh3Scale = 62 / (sh3Max - sh3Min);

  // Pack sint6 values into 4 x uint32
  const base = index * 4;
  for (let i = 0; i < 21; ++i) {
    const s = (sh3Rgb[i] - sh3Mid) * sh3Scale;
    const value = Math.round(Math.max(-31, Math.min(31, s))) & 0x3f;
    const bitStart = i * 6;
    const bitEnd = bitStart + 6;

    const wordStart = Math.floor(bitStart / 32);
    const bitOffset = bitStart - wordStart * 32;
    const firstWord = (value << bitOffset) & 0xffffffff;
    sh3Array[base + wordStart] |= firstWord;

    if (bitEnd > wordStart * 32 + 32) {
      const secondWord = (value >>> (32 - bitOffset)) & 0xffffffff;
      sh3Array[base + wordStart + 1] |= secondWord;
    }
  }
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
  fileBytes: Uint8Array;
  chunkBytes: number;

  chunks: Uint8Array[];
  totalBytes: number;
  reader: ReadableStreamDefaultReader;

  constructor({
    fileBytes,
    chunkBytes = 64 * 1024,
  }: { fileBytes: Uint8Array; chunkBytes?: number }) {
    this.fileBytes = fileBytes;
    this.chunkBytes = chunkBytes;
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
