import type { PackedSplats } from "./PackedSplats";
import {
  type TranscodeSpzInput,
  getSplatFileType,
  getSplatFileTypeFromPath,
} from "./SplatLoader";

import { decode_to_gsplatarray, packedsplats_to_gsplatarray } from "spark-rs";
import * as wasm from "./wasm";

export type SpzWriteVersion = 2 | 3;

export async function transcodeSpz(input: TranscodeSpzInput) {
  await wasm.initialization;

  const splatArrays = [];
  const {
    inputs,
    clipXyz,
    maxSh,
    fractionalBits = 12,
    opacityThreshold,
    version,
  } = input;
  for (const input of inputs) {
    const scale = input.transform?.scale ?? 1;
    const quaternion = input.transform?.quaternion ?? [0, 0, 0, 1];
    const translate = input.transform?.translate ?? [0, 0, 0];
    const clip = clipXyz ? [...clipXyz.min, ...clipXyz.max] : undefined;

    let fileType = input.fileType;
    if (!fileType) {
      fileType = getSplatFileType(input.fileBytes);
      if (!fileType && input.pathOrUrl) {
        fileType = getSplatFileTypeFromPath(input.pathOrUrl);
      }
    }
    const decoder = decode_to_gsplatarray(fileType, input.pathOrUrl);
    const fileBytes = input.fileBytes;
    const CHUNK_SIZE = 1048576; // 1 MB
    for (let i = 0; i < fileBytes.length; i += CHUNK_SIZE) {
      decoder.push(
        fileBytes.subarray(i, Math.min(i + CHUNK_SIZE, fileBytes.length)),
      );
    }
    const decoded = decoder.finish();

    decoded.transform({
      translation: translate,
      rotation: quaternion,
      scale,
      clip,
      opacityThreshold: opacityThreshold ?? 0,
    });

    splatArrays.push(decoded);
  }

  // Combine decoded splat arrays
  const finalSplats = splatArrays[0];
  for (let i = 1; i < splatArrays.length; i++) {
    finalSplats.concat(splatArrays[i]);
  }

  const spzBytes = finalSplats.encode_to_spz(
    maxSh ?? 3,
    fractionalBits,
    version,
  );

  return { fileBytes: spzBytes, clippedCount: 0 };
}

export type WriteSpzOptions = {
  maxSh?: number;
  fractionalBits?: number;
  version?: SpzWriteVersion;
};

export function writeSpz(
  packedSplats: PackedSplats,
  maxSh?: number,
  fractionalBits?: number,
): { fileBytes: Uint8Array };
export function writeSpz(
  packedSplats: PackedSplats,
  options?: WriteSpzOptions,
): { fileBytes: Uint8Array };
export function writeSpz(
  packedSplats: PackedSplats,
  maxShOrOptions?: number | WriteSpzOptions,
  fractionalBits?: number,
) {
  if (!packedSplats.packedArray) {
    throw new Error("");
  }
  const options: WriteSpzOptions =
    typeof maxShOrOptions === "number"
      ? { maxSh: maxShOrOptions, fractionalBits }
      : (maxShOrOptions ?? {});
  const gsplats = packedsplats_to_gsplatarray(
    packedSplats.numSplats,
    packedSplats.packedArray,
    packedSplats.extra,
    packedSplats.splatEncoding,
  );
  const spzBytes = gsplats.encode_to_spz(
    options.maxSh ?? 3,
    options.fractionalBits ?? 12,
    options.version,
  );
  return { fileBytes: spzBytes };
}
