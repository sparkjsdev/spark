import { decode as decodeWebp } from "@jsquash/webp";
import type { PcSogsJson } from "./SplatLoader";
import {
  computeMaxSplats,
  encodeSh1Rgb,
  encodeSh2Rgb,
  encodeSh3Rgb,
  setPackedSplatCenter,
  setPackedSplatQuat,
  setPackedSplatRgba,
  setPackedSplatScales,
} from "./utils";

export async function unpackPcSogs(
  fileBytes: Uint8Array,
  extraFiles: Record<string, ArrayBuffer>,
): Promise<{
  packedArray: Uint32Array;
  numSplats: number;
  extra: Record<string, unknown>;
}> {
  const json = JSON.parse(new TextDecoder().decode(fileBytes)) as PcSogsJson;
  if (json.quats.encoding !== "quaternion_packed") {
    throw new Error("Unsupported quaternion encoding");
  }

  const numSplats = json.means.shape[0];
  const maxSplats = computeMaxSplats(numSplats);
  const packedArray = new Uint32Array(maxSplats * 4);
  const extra: Record<string, unknown> = {};

  const means = await Promise.all([
    decodeImageRgba(extraFiles[json.means.files[0]]),
    decodeImageRgba(extraFiles[json.means.files[1]]),
  ]);
  for (let i = 0; i < numSplats; ++i) {
    const i4 = i * 4;
    const fx = (means[0][i4 + 0] + (means[1][i4 + 0] << 8)) / 65535;
    const fy = (means[0][i4 + 1] + (means[1][i4 + 1] << 8)) / 65535;
    const fz = (means[0][i4 + 2] + (means[1][i4 + 2] << 8)) / 65535;
    let x = json.means.mins[0] + (json.means.maxs[0] - json.means.mins[0]) * fx;
    let y = json.means.mins[1] + (json.means.maxs[1] - json.means.mins[1]) * fy;
    let z = json.means.mins[2] + (json.means.maxs[2] - json.means.mins[2]) * fz;
    x = Math.sign(x) * (Math.exp(Math.abs(x)) - 1);
    y = Math.sign(y) * (Math.exp(Math.abs(y)) - 1);
    z = Math.sign(z) * (Math.exp(Math.abs(z)) - 1);
    setPackedSplatCenter(packedArray, i, x, y, z);
  }

  const scales = await decodeImageRgba(extraFiles[json.scales.files[0]]);
  for (let i = 0; i < numSplats; ++i) {
    const i4 = i * 4;
    const fx = scales[i4 + 0] / 255;
    const fy = scales[i4 + 1] / 255;
    const fz = scales[i4 + 2] / 255;
    const x =
      json.scales.mins[0] + (json.scales.maxs[0] - json.scales.mins[0]) * fx;
    const y =
      json.scales.mins[1] + (json.scales.maxs[1] - json.scales.mins[1]) * fy;
    const z =
      json.scales.mins[2] + (json.scales.maxs[2] - json.scales.mins[2]) * fz;
    setPackedSplatScales(packedArray, i, Math.exp(x), Math.exp(y), Math.exp(z));
  }

  const quats = await decodeImageRgba(extraFiles[json.quats.files[0]]);
  const SQRT2 = Math.sqrt(2);
  for (let i = 0; i < numSplats; ++i) {
    const i4 = i * 4;
    const r0 = (quats[i4 + 0] / 255 - 0.5) * SQRT2;
    const r1 = (quats[i4 + 1] / 255 - 0.5) * SQRT2;
    const r2 = (quats[i4 + 2] / 255 - 0.5) * SQRT2;
    const rr = Math.sqrt(Math.max(0, 1.0 - r0 * r0 - r1 * r1 - r2 * r2));
    const rOrder = quats[i4 + 3] - 252;
    const quatX = rOrder === 0 ? r0 : rOrder === 1 ? rr : r1;
    const quatY = rOrder <= 1 ? r1 : rOrder === 2 ? rr : r2;
    const quatZ = rOrder <= 2 ? r2 : rr;
    const quatW = rOrder === 0 ? rr : r0;
    setPackedSplatQuat(packedArray, i, quatX, quatY, quatZ, quatW);
  }

  const sh0 = await decodeImageRgba(extraFiles[json.sh0.files[0]]);
  const SH_C0 = 0.28209479177387814;
  for (let i = 0; i < numSplats; ++i) {
    const i4 = i * 4;
    const f0 = sh0[i4 + 0] / 255;
    const f1 = sh0[i4 + 1] / 255;
    const f2 = sh0[i4 + 2] / 255;
    const f3 = sh0[i4 + 3] / 255;
    const dc0 = json.sh0.mins[0] + (json.sh0.maxs[0] - json.sh0.mins[0]) * f0;
    const dc1 = json.sh0.mins[1] + (json.sh0.maxs[1] - json.sh0.mins[1]) * f1;
    const dc2 = json.sh0.mins[2] + (json.sh0.maxs[2] - json.sh0.mins[2]) * f2;
    const opa = json.sh0.mins[3] + (json.sh0.maxs[3] - json.sh0.mins[3]) * f3;
    const r = SH_C0 * dc0 + 0.5;
    const g = SH_C0 * dc1 + 0.5;
    const b = SH_C0 * dc2 + 0.5;
    const a = 1.0 / (1.0 + Math.exp(-opa));
    setPackedSplatRgba(packedArray, i, r, g, b, a);
  }

  if (json.shN) {
    extra.sh1 = new Uint32Array(numSplats * 2);
    extra.sh2 = new Uint32Array(numSplats * 4);
    extra.sh3 = new Uint32Array(numSplats * 4);
    const sh1 = new Float32Array(9);
    const sh2 = new Float32Array(15);
    const sh3 = new Float32Array(21);

    const [centroids, labels] = await Promise.all([
      decodeImage(extraFiles[json.shN.files[0]]),
      decodeImage(extraFiles[json.shN.files[1]]),
    ]);
    for (let i = 0; i < numSplats; ++i) {
      const i4 = i * 4;
      const label = labels.rgba[i4 + 0] + (labels.rgba[i4 + 1] << 8);
      const col = (label & 63) * 15;
      const row = label >>> 6;
      const offset = row * centroids.width + col;

      for (let d = 0; d < 3; ++d) {
        for (let k = 0; k < 3; ++k) {
          sh1[k * 3 + d] =
            json.shN.mins +
            ((json.shN.maxs - json.shN.mins) *
              centroids.rgba[(offset + k) * 4 + d]) /
              255;
        }
        for (let k = 0; k < 5; ++k) {
          sh2[k * 3 + d] =
            json.shN.mins +
            ((json.shN.maxs - json.shN.mins) *
              centroids.rgba[(offset + 3 + k) * 4 + d]) /
              255;
        }
        for (let k = 0; k < 7; ++k) {
          sh3[k * 3 + d] =
            json.shN.mins +
            ((json.shN.maxs - json.shN.mins) *
              centroids.rgba[(offset + 8 + k) * 4 + d]) /
              255;
        }
      }

      encodeSh1Rgb(extra.sh1 as Uint32Array, i, sh1);
      encodeSh2Rgb(extra.sh2 as Uint32Array, i, sh2);
      encodeSh3Rgb(extra.sh3 as Uint32Array, i, sh3);
    }
  }

  return { packedArray, numSplats, extra };
}

async function decodeImage(fileBytes: ArrayBuffer) {
  const { data: rgba, width, height } = await decodeWebp(fileBytes);
  return { rgba, width, height };
}

async function decodeImageRgba(fileBytes: ArrayBuffer) {
  const { rgba } = await decodeImage(fileBytes);
  return rgba;
}
