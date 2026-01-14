import type { SplatEncoding } from "./PackedSplats";
import { computeMaxSplats, setPackedSplat } from "./utils";

class CustomFloat16Array {
  constructor(bufferOrLength: ArrayBuffer, byteOffset = 0, length: number | undefined = undefined) {
    if (typeof bufferOrLength === "number") {
      this._data = new Uint16Array(bufferOrLength);
    } else if (bufferOrLength instanceof ArrayBuffer) {
      const view = new Uint16Array(
        bufferOrLength,
        byteOffset,
        length ?? ((bufferOrLength.byteLength - byteOffset) / 2)
      );
      this._data = view;
    } else {
      throw new TypeError("First argument must be a length or ArrayBuffer");
    }
    this.length = this._data.length;

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (!isNaN(prop)) {
          return uint16ToFloat32(target._data[prop]);
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (!isNaN(prop)) {
          target._data[prop] = float32ToUint16(value);
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      }
    });
  }

  get buffer() {
    return this._data.buffer;
  }

  get byteOffset() {
    return this._data.byteOffset;
  }

  get byteLength() {
    return this._data.byteLength;
  }

  get BYTES_PER_ELEMENT() {
    return 2;
  }
}

function float32ToUint16(value: number): number {
  const floatView = new Float32Array(1);
  const int32View = new Uint32Array(floatView.buffer);

  floatView[0] = value;
  const x = int32View[0];

  const sign = (x >> 16) & 0x8000;
  const mantissa = x & 0x7fffff;
  const exp = (x >> 23) & 0xff;

  if (exp === 0xff) {
    // NaN or Inf
    return sign | 0x7c00 | (mantissa ? 1 : 0);
  }

  const halfExp = exp - 127 + 15;
  if (halfExp >= 0x1f) {
    return sign | 0x7c00; // overflow to Inf
  } else if (halfExp <= 0) {
    if (halfExp < -10) return sign; // underflow to zero
    const m = (mantissa | 0x800000) >> (1 - halfExp);
    return sign | ((m + 0x1000) >> 13);
  }

  return sign | (halfExp << 10) | ((mantissa + 0x1000) >> 13);
}

export function decodeCSplat(
  fileBytes: Uint8Array,
  initNumSplats: (numSplats: number) => void,
  splatCallback: (
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
  ) => void,
) {
  const numSplats = Math.floor(fileBytes.length / 20); // 20 bytes per splat
  if (numSplats * 20 !== fileBytes.length) {
    throw new Error("Invalid .splat file size");
  }
  initNumSplats(numSplats);

  const Float16 = typeof Float16Array !== 'undefined' ? Float16Array : CustomFloat16Array;  
  const f16 = new Float16(fileBytes.buffer);
  for (let i = 0; i < numSplats; ++i) {
    const i16 = i * 16;
    const i8 = i * 8;
    const scaleX = f16[i8 + 3];
    const scaleY = f16[i8 + 4];
    const scaleZ = f16[i8 + 5];
    const x = f16[i8 + 0];
    const y = f16[i8 + 1];
    const z = f16[i8 + 2];
    const r = fileBytes[i16 + 24] / 255;
    const g = fileBytes[i16 + 25] / 255;
    const b = fileBytes[i16 + 26] / 255;
    const opacity = fileBytes[i16 + 27] / 255;
    const quatW = (fileBytes[i16 + 28] - 128) / 128;
    const quatX = (fileBytes[i16 + 29] - 128) / 128;
    const quatY = (fileBytes[i16 + 30] - 128) / 128;
    const quatZ = (fileBytes[i16 + 31] - 128) / 128;
    splatCallback(
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
    );
  }
}

export function unpackCSplat(
  fileBytes: Uint8Array,
  splatEncoding: SplatEncoding,
): {
  packedArray: Uint32Array;
  numSplats: number;
} {
  let numSplats = 0;
  let maxSplats = 0;
  let packedArray = new Uint32Array(0);
  decodeCSplat(
    fileBytes,
    (cbNumSplats) => {
      numSplats = cbNumSplats;
      maxSplats = computeMaxSplats(numSplats);
      packedArray = new Uint32Array(maxSplats * 4);
    },
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
        splatEncoding,
      );
    },
  );
  return { packedArray, numSplats };
}
