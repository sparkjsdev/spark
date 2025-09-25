import { unzip } from "fflate";
import type { SplatEncoding } from "./PackedSplats";
import {
  type PcSogsJson,
  type PcSogsV2Json,
  tryPcSogsZip,
} from "./SplatLoader";
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
  json: PcSogsJson | PcSogsV2Json,
  extraFiles: Record<string, ArrayBuffer>,
  splatEncoding: SplatEncoding,
): Promise<{
  packedArray: Uint32Array;
  numSplats: number;
  extra: Record<string, unknown>;
}> {
  const isVersion2 = "version" in json;

  if (!isVersion2 && json.quats.encoding !== "quaternion_packed") {
    throw new Error("Unsupported quaternion encoding");
  }

  const numSplats = isVersion2 ? json.count : json.means.shape[0];
  const maxSplats = computeMaxSplats(numSplats);
  const packedArray = new Uint32Array(maxSplats * 4);
  const extra: Record<string, unknown> = {};

  const meansPromise = Promise.all([
    decodeImageRgba(extraFiles[json.means.files[0]]),
    decodeImageRgba(extraFiles[json.means.files[1]]),
  ]).then((means) => {
    for (let i = 0; i < numSplats; ++i) {
      const i4 = i * 4;
      const fx = (means[0][i4 + 0] + (means[1][i4 + 0] << 8)) / 65535;
      const fy = (means[0][i4 + 1] + (means[1][i4 + 1] << 8)) / 65535;
      const fz = (means[0][i4 + 2] + (means[1][i4 + 2] << 8)) / 65535;
      let x =
        json.means.mins[0] + (json.means.maxs[0] - json.means.mins[0]) * fx;
      let y =
        json.means.mins[1] + (json.means.maxs[1] - json.means.mins[1]) * fy;
      let z =
        json.means.mins[2] + (json.means.maxs[2] - json.means.mins[2]) * fz;
      x = Math.sign(x) * (Math.exp(Math.abs(x)) - 1);
      y = Math.sign(y) * (Math.exp(Math.abs(y)) - 1);
      z = Math.sign(z) * (Math.exp(Math.abs(z)) - 1);
      setPackedSplatCenter(packedArray, i, x, y, z);
    }
  });

  const scalesPromise = decodeImageRgba(extraFiles[json.scales.files[0]]).then(
    (scales) => {
      let xLookup: number[];
      let yLookup: number[];
      let zLookup: number[];

      if (isVersion2) {
        xLookup =
          yLookup =
          zLookup =
            json.scales.codebook.map((x) => Math.exp(x));
      } else {
        xLookup = new Array(256)
          .fill(0)
          .map(
            (_, i) =>
              json.scales.mins[0] +
              (json.scales.maxs[0] - json.scales.mins[0]) * (i / 255),
          )
          .map((x) => Math.exp(x));
        yLookup = new Array(256)
          .fill(0)
          .map(
            (_, i) =>
              json.scales.mins[1] +
              (json.scales.maxs[1] - json.scales.mins[1]) * (i / 255),
          )
          .map((x) => Math.exp(x));
        zLookup = new Array(256)
          .fill(0)
          .map(
            (_, i) =>
              json.scales.mins[2] +
              (json.scales.maxs[2] - json.scales.mins[2]) * (i / 255),
          )
          .map((x) => Math.exp(x));
      }

      for (let i = 0; i < numSplats; ++i) {
        const i4 = i * 4;
        setPackedSplatScales(
          packedArray,
          i,
          xLookup[scales[i4 + 0]],
          yLookup[scales[i4 + 1]],
          zLookup[scales[i4 + 2]],
          splatEncoding,
        );
      }
    },
  );

  const quatsPromise = decodeImageRgba(extraFiles[json.quats.files[0]]).then(
    (quats) => {
      const SQRT2 = Math.sqrt(2);
      const lookup = new Array(256)
        .fill(0)
        .map((_, i) => (i / 255 - 0.5) * SQRT2);

      for (let i = 0; i < numSplats; ++i) {
        const i4 = i * 4;
        const r0 = lookup[quats[i4 + 0]];
        const r1 = lookup[quats[i4 + 1]];
        const r2 = lookup[quats[i4 + 2]];
        const rr = Math.sqrt(Math.max(0, 1.0 - r0 * r0 - r1 * r1 - r2 * r2));
        const rOrder = quats[i4 + 3] - 252;
        const quatX = rOrder === 0 ? r0 : rOrder === 1 ? rr : r1;
        const quatY = rOrder <= 1 ? r1 : rOrder === 2 ? rr : r2;
        const quatZ = rOrder <= 2 ? r2 : rr;
        const quatW = rOrder === 0 ? rr : r0;
        setPackedSplatQuat(packedArray, i, quatX, quatY, quatZ, quatW);
      }
    },
  );
  const sh0Promise = decodeImageRgba(extraFiles[json.sh0.files[0]]).then(
    (sh0) => {
      const SH_C0 = 0.28209479177387814;
      let rLookup: number[];
      let gLookup: number[];
      let bLookup: number[];
      let aLookup: number[];

      if (isVersion2) {
        rLookup =
          gLookup =
          bLookup =
            json.sh0.codebook.map((x) => SH_C0 * x + 0.5);
        aLookup = new Array(256).fill(0).map((_, i) => i / 255);
      } else {
        rLookup = new Array(256)
          .fill(0)
          .map(
            (_, i) =>
              json.sh0.mins[0] +
              (json.sh0.maxs[0] - json.sh0.mins[0]) * (i / 255),
          )
          .map((x) => SH_C0 * x + 0.5);
        gLookup = new Array(256)
          .fill(0)
          .map(
            (_, i) =>
              json.sh0.mins[1] +
              (json.sh0.maxs[1] - json.sh0.mins[1]) * (i / 255),
          )
          .map((x) => SH_C0 * x + 0.5);
        bLookup = new Array(256)
          .fill(0)
          .map(
            (_, i) =>
              json.sh0.mins[2] +
              (json.sh0.maxs[2] - json.sh0.mins[2]) * (i / 255),
          )
          .map((x) => SH_C0 * x + 0.5);
        aLookup = new Array(256)
          .fill(0)
          .map(
            (_, i) =>
              json.sh0.mins[3] +
              (json.sh0.maxs[3] - json.sh0.mins[3]) * (i / 255),
          )
          .map((x) => 1.0 / (1.0 + Math.exp(-x)));
      }

      for (let i = 0; i < numSplats; ++i) {
        const i4 = i * 4;
        setPackedSplatRgba(
          packedArray,
          i,
          rLookup[sh0[i4 + 0]],
          gLookup[sh0[i4 + 1]],
          bLookup[sh0[i4 + 2]],
          aLookup[sh0[i4 + 3]],
          splatEncoding,
        );
      }
    },
  );

  const promises = [meansPromise, scalesPromise, quatsPromise, sh0Promise];
  if (json.shN) {
    const useSH3 = isVersion2
      ? json.shN.bands >= 3
      : json.shN.shape[1] >= 48 - 3;
    const useSH2 = isVersion2
      ? json.shN.bands >= 2
      : json.shN.shape[1] >= 27 - 3;
    const useSH1 = isVersion2
      ? json.shN.bands >= 1
      : json.shN.shape[1] >= 12 - 3;

    if (useSH1) extra.sh1 = new Uint32Array(numSplats * 2);
    if (useSH2) extra.sh2 = new Uint32Array(numSplats * 4);
    if (useSH3) extra.sh3 = new Uint32Array(numSplats * 4);

    const sh1 = new Float32Array(9);
    const sh2 = new Float32Array(15);
    const sh3 = new Float32Array(21);

    const shN = json.shN;
    const shNPromise = Promise.all([
      decodeImage(extraFiles[json.shN.files[0]]),
      decodeImage(extraFiles[json.shN.files[1]]),
    ]).then(([centroids, labels]) => {
      const lookup =
        "codebook" in shN
          ? shN.codebook
          : new Array(256)
              .fill(0)
              .map((_, i) => shN.mins + (shN.maxs - shN.mins) * (i / 255));

      for (let i = 0; i < numSplats; ++i) {
        const i4 = i * 4;
        const label = labels.rgba[i4 + 0] + (labels.rgba[i4 + 1] << 8);
        const col = (label & 63) * 15;
        const row = label >>> 6;
        const offset = row * centroids.width + col;

        for (let d = 0; d < 3; ++d) {
          if (useSH1) {
            for (let k = 0; k < 3; ++k) {
              sh1[k * 3 + d] = lookup[centroids.rgba[(offset + k) * 4 + d]];
            }
          }

          if (useSH2) {
            for (let k = 0; k < 5; ++k) {
              sh2[k * 3 + d] = lookup[centroids.rgba[(offset + 3 + k) * 4 + d]];
            }
          }

          if (useSH3) {
            for (let k = 0; k < 7; ++k) {
              sh3[k * 3 + d] = lookup[centroids.rgba[(offset + 8 + k) * 4 + d]];
            }
          }
        }

        if (useSH1)
          encodeSh1Rgb(extra.sh1 as Uint32Array, i, sh1, splatEncoding);
        if (useSH2)
          encodeSh2Rgb(extra.sh2 as Uint32Array, i, sh2, splatEncoding);
        if (useSH3)
          encodeSh3Rgb(extra.sh3 as Uint32Array, i, sh3, splatEncoding);
      }
    });
    promises.push(shNPromise);
  }

  await Promise.all(promises);

  return { packedArray, numSplats, extra };
}

// WebGL context for reading raw pixel data of WebP images
let offscreenGlContext: WebGL2RenderingContext | null = null;

async function decodeImage(fileBytes: ArrayBuffer) {
  if (!offscreenGlContext) {
    const canvas = new OffscreenCanvas(1, 1);
    offscreenGlContext = canvas.getContext("webgl2");
    if (!offscreenGlContext) {
      throw new Error("Failed to create WebGL2 context");
    }
  }

  const imageBlob = new Blob([fileBytes]);
  const bitmap = await createImageBitmap(imageBlob, {
    premultiplyAlpha: "none",
  });

  const gl = offscreenGlContext;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );

  const data = new Uint8Array(bitmap.width * bitmap.height * 4);
  gl.readPixels(
    0,
    0,
    bitmap.width,
    bitmap.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  );

  gl.deleteTexture(texture);
  gl.deleteFramebuffer(framebuffer);

  return { rgba: data, width: bitmap.width, height: bitmap.height };
}

async function decodeImageRgba(fileBytes: ArrayBuffer) {
  const { rgba } = await decodeImage(fileBytes);
  return rgba;
}

export async function unpackPcSogsZip(
  fileBytes: Uint8Array,
  splatEncoding: SplatEncoding,
): Promise<{
  packedArray: Uint32Array;
  numSplats: number;
  extra: Record<string, unknown>;
}> {
  const nameJson = tryPcSogsZip(fileBytes);
  if (!nameJson) {
    throw new Error("Invalid PC SOGS zip file");
  }
  const { name, json } = nameJson;
  // Find path prefix, will be -1 if no / or \
  const lastSlash = name.lastIndexOf("/");
  const lastBackslash = name.lastIndexOf("\\");
  const prefix = name.slice(0, Math.max(lastSlash, lastBackslash) + 1);

  const fileMap = new Map<string, string>();
  const refFiles = [
    ...json.means.files,
    ...json.scales.files,
    ...json.quats.files,
    ...json.sh0.files,
    ...(json.shN?.files ?? []),
  ];
  for (const file of refFiles) {
    fileMap.set(prefix + file, file);
  }

  const unzipped = await new Promise<Record<string, ArrayBuffer>>(
    (resolve, reject) => {
      unzip(
        fileBytes,
        {
          filter: ({ name }) => {
            return fileMap.has(name);
          },
        },
        (err, files) => {
          if (err) {
            reject(err);
          } else {
            resolve(files);
          }
        },
      );
    },
  );

  const extraFiles: Record<string, ArrayBuffer> = {};
  for (const [full, name] of fileMap.entries()) {
    extraFiles[name] = unzipped[full];
  }

  return await unpackPcSogs(json, extraFiles, splatEncoding);
}
