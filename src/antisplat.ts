import type { SplatEncoding } from "./PackedSplats";
import { computeMaxSplats, setPackedSplat } from "./utils";

export function decodeAntiSplat(
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
  const numSplats = Math.floor(fileBytes.length / 32); // 32 bytes per splat
  if (numSplats * 32 !== fileBytes.length) {
    throw new Error("Invalid .splat file size");
  }
  initNumSplats(numSplats);

  const f32 = new Float32Array(fileBytes.buffer);
  for (let i = 0; i < numSplats; ++i) {
    const i32 = i * 32;
    const i8 = i * 8;
    const x = f32[i8 + 0];
    const y = f32[i8 + 1];
    const z = f32[i8 + 2];
    const scaleX = f32[i8 + 3];
    const scaleY = f32[i8 + 4];
    const scaleZ = f32[i8 + 5];
    const r = fileBytes[i32 + 24] / 255;
    const g = fileBytes[i32 + 25] / 255;
    const b = fileBytes[i32 + 26] / 255;
    const opacity = fileBytes[i32 + 27] / 255;
    const quatW = (fileBytes[i32 + 28] - 128) / 128;
    const quatX = (fileBytes[i32 + 29] - 128) / 128;
    const quatY = (fileBytes[i32 + 30] - 128) / 128;
    const quatZ = (fileBytes[i32 + 31] - 128) / 128;
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

export function unpackAntiSplat(
  fileBytes: Uint8Array,
  splatEncoding: SplatEncoding,
): {
  packedArray: Uint32Array;
  numSplats: number;
} {
  let numSplats = 0;
  let maxSplats = 0;
  let packedArray = new Uint32Array(0);
  decodeAntiSplat(
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
