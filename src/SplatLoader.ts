import { unzipSync } from "fflate";
import { FileLoader, Loader, type LoadingManager } from "three";
import { ExtSplats, type ExtSplatsOptions } from "./ExtSplats";
import { workerPool } from "./NewSplatWorker";
import {
  PackedSplats,
  type PackedSplatsOptions,
  type SplatEncoding,
} from "./PackedSplats";
import { SplatMesh } from "./SplatMesh";
import { PlyReader } from "./ply";
import { withWorker } from "./splatWorker";
import { decompressPartialGzip, getTextureSize } from "./utils";

// SplatLoader implements the THREE.Loader interface and supports loading a variety
// of different Gsplat file formats. Formats .PLY and .SPZ can be auto-detected
// from the file contents, while .SPLAT and .KSPLAT require either having the
// appropriate file extension as part of the path, or it can be explicitly set
// in the loader using the fileType property.

export class SplatLoader extends Loader {
  fileLoader: FileLoader;

  static lod = false;
  static nonLod: boolean | "wait" = false;

  constructor(manager?: LoadingManager) {
    super(manager);
    this.fileLoader = new FileLoader(manager);
  }

  load(
    url: string,
    onLoad?: (decoded: PackedSplats | ExtSplats) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    return this.loadInternal({
      url,
      onLoad,
      onProgress,
      onError,
    });
  }

  async loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PackedSplats | ExtSplats> {
    return new Promise((resolve, reject) => {
      this.load(
        url,
        (decoded) => {
          resolve(decoded);
        },
        onProgress,
        reject,
      );
    });
  }

  parse(packedSplats: PackedSplats): SplatMesh {
    return new SplatMesh({ packedSplats });
  }

  loadInternal({
    packedSplats,
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    onLoad,
    onProgress,
    onError,
    lod,
    nonLod,
    lodBase,
  }: {
    packedSplats?: PackedSplats;
    extSplats?: ExtSplats;
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    onLoad?: (decoded: PackedSplats | ExtSplats) => void;
    onProgress?: (event: ProgressEvent) => void;
    onError?: (error: unknown) => void;
    lod?: boolean;
    nonLod?: boolean | "wait";
    lodBase?: number;
  }) {
    const resolvedURL = fileBytes
      ? undefined
      : this.manager.resolveURL((this.path ?? "") + (url ?? ""));

    this.manager.itemStart(resolvedURL ?? "");
    let calledOnLoad = false;

    workerPool
      .withWorker(async (worker) => {
        // If LoD is set and not falsey
        const splatsLod = packedSplats?.lod ?? extSplats?.lod;
        if (splatsLod) {
          lod = true;
          if (typeof splatsLod === "number") {
            // Limit LoD base to 1.1-2.0
            lodBase = Math.max(1.1, Math.min(2.0, splatsLod));
          }
        }
        const splatsNonLod = packedSplats?.nonLod ?? extSplats?.nonLod;
        if (splatsNonLod !== undefined) {
          nonLod = splatsNonLod;
        }
        const maxBoneSplats = packedSplats?.maxBoneSplats;
        const computeBoneWeights = packedSplats?.computeBoneWeights;
        const minBoneOpacity = packedSplats?.minBoneOpacity;

        let init: {
          numSplats: number;
          packedArray: Uint32Array;
          extra: Record<string, unknown>;
          splatEncoding: SplatEncoding;
        } | null = null;
        let initExt: {
          numSplats: number;
          ext0: Uint32Array;
          ext1: Uint32Array;
          extra: Record<string, unknown>;
        } | null = null;

        const onStatus = (data: unknown) => {
          const { loaded, total } = data as { loaded: number; total: number };
          if (loaded !== undefined && onProgress) {
            onProgress(
              new ProgressEvent("progress", {
                lengthComputable: total !== 0,
                loaded,
                total,
              }),
            );
          }
          if ((data as { orig?: unknown }).orig) {
            if (extSplats) {
              initExt = (data as { orig?: unknown }).orig as {
                numSplats: number;
                ext0: Uint32Array;
                ext1: Uint32Array;
                extra: Record<string, unknown>;
              };
              extSplats.initialize({
                numSplats: initExt?.numSplats,
                extArrays: [initExt?.ext0, initExt?.ext1],
                extra: initExt?.extra,
              });
              calledOnLoad = true;
              onLoad?.(extSplats);
            } else if (packedSplats) {
              init = (data as { orig?: unknown }).orig as {
                numSplats: number;
                packedArray: Uint32Array;
                extra: Record<string, unknown>;
                splatEncoding: SplatEncoding;
              };
              packedSplats.initialize({
                numSplats: init?.numSplats,
                packedArray: init?.packedArray,
                extra: init?.extra,
                splatEncoding: init?.splatEncoding,
              });
              calledOnLoad = true;
              onLoad?.(packedSplats);
            } else {
              console.warn("No splats to initialize");
            }
          }
        };

        const basedUrl = resolvedURL
          ? new URL(resolvedURL, window.location.href).toString()
          : undefined;
        const decoded = (await worker.call(
          extSplats ? "loadExtSplats" : "loadPackedSplats",
          {
            url: basedUrl,
            requestHeader: this.requestHeader,
            withCredentials: this.withCredentials,
            fileBytes: fileBytes?.slice(),
            fileType,
            pathName: resolvedURL ?? fileName,
            lod,
            lodBase,
            nonLod,
            maxBoneSplats,
            computeBoneWeights,
            minBoneOpacity,
          },
          { onStatus },
        )) as {
          numSplats: number;
          packedArray?: Uint32Array;
          ext0?: Uint32Array;
          ext1?: Uint32Array;
          extra: Record<string, unknown>;
          splatEncoding?: SplatEncoding;
          lodSplats?:
            | {
                numSplats: number;
                packedArray?: Uint32Array;
                ext0?: Uint32Array;
                ext1?: Uint32Array;
                extra: Record<string, unknown>;
                splatEncoding?: SplatEncoding;
              }
            | PackedSplats
            | ExtSplats;
          boneSplats?:
            | {
                numSplats: number;
                packedArray: Uint32Array;
                extra: Record<string, unknown>;
                splatEncoding: SplatEncoding;
                childCounts: Uint32Array;
                childStarts: Uint32Array;
              }
            | PackedSplats;
        };

        if (decoded.lodSplats) {
          if (extSplats) {
            decoded.lodSplats = new ExtSplats({
              ...(decoded.lodSplats as {
                numSplats: number;
                extArrays: [Uint32Array, Uint32Array];
                extra: Record<string, unknown>;
              }),
            });
          } else {
            decoded.lodSplats = new PackedSplats({
              ...(decoded.lodSplats as {
                numSplats: number;
                packedArray: Uint32Array;
                extra: Record<string, unknown>;
                splatEncoding: SplatEncoding;
              }),
              maxSplats: packedSplats?.maxSplats,
            });
          }
        }

        if (decoded.boneSplats) {
          const { childCounts, childStarts } = decoded.boneSplats as {
            childCounts: Uint32Array;
            childStarts: Uint32Array;
          };
          decoded.boneSplats = new PackedSplats({
            ...(decoded.boneSplats as {
              numSplats: number;
              packedArray: Uint32Array;
              extra: Record<string, unknown>;
              splatEncoding: SplatEncoding;
            }),
            extra: {
              childCounts: childCounts,
              childStarts: childStarts,
            },
          });
        }

        if (extSplats) {
          const initExtSplats = {
            ...(initExt ?? {}),
            ...decoded,
          };
          extSplats.initialize(initExtSplats as ExtSplatsOptions);
          if (!calledOnLoad) {
            onLoad?.(extSplats);
          }
        } else {
          const initSplats = {
            ...(init ?? {}),
            ...decoded,
          };
          if (packedSplats) {
            packedSplats.initialize(initSplats as PackedSplatsOptions);
            if (!calledOnLoad) {
              onLoad?.(packedSplats);
            }
          } else {
            if (!calledOnLoad) {
              onLoad?.(new PackedSplats(initSplats as PackedSplatsOptions));
            }
          }
        }
      })
      .catch((error) => {
        this.manager.itemError(resolvedURL ?? "");
        onError?.(error);
      })
      .finally(() => {
        this.manager.itemEnd(resolvedURL ?? "");
      });
  }

  async loadInternalAsync({
    packedSplats,
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    onProgress,
    lod,
    nonLod,
    lodBase,
  }: {
    packedSplats?: PackedSplats;
    extSplats?: ExtSplats;
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    onProgress?: (event: ProgressEvent) => void;
    lod?: boolean;
    nonLod?: boolean | "wait";
    lodBase?: number;
  }) {
    return new Promise((resolve, reject) => {
      this.loadInternal({
        packedSplats,
        extSplats,
        url,
        fileBytes,
        fileType,
        fileName,
        onLoad: resolve,
        onProgress,
        onError: reject,
      });
    });
  }
}

async function fetchWithProgress(
  request: Request,
  onProgress?: (event: ProgressEvent) => void,
) {
  const response = await fetch(request);
  if (!response.ok) {
    throw new Error(
      `${response.status} "${response.statusText}" fetching URL: ${request.url}`,
    );
  }
  if (!response.body) {
    throw new Error(`Response body is null for URL: ${request.url}`);
  }

  const reader = response.body.getReader();
  let loaded = 0;
  const chunks: Uint8Array[] = [];
  try {
    const contentLength = Number.parseInt(
      response.headers.get("Content-Length") || "0",
    );
    const total = Number.isNaN(contentLength) ? 0 : contentLength;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      loaded += value.length;

      if (onProgress) {
        onProgress(
          new ProgressEvent("progress", {
            lengthComputable: total !== 0,
            loaded,
            total,
          }),
        );
      }
    }
  } catch (err) {
    try {
      const reason = err instanceof Error ? err.message : "Unknown error";
      await reader.cancel(reason);
    } catch {}
    throw err;
  }

  // Combine chunks into a single buffer
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

export enum SplatFileType {
  PLY = "ply",
  SPZ = "spz",
  SPLAT = "splat",
  KSPLAT = "ksplat",
  PCSOGS = "pcsogs",
  PCSOGSZIP = "pcsogszip",
}

export function getSplatFileType(
  fileBytes: Uint8Array,
): SplatFileType | undefined {
  const view = new DataView(fileBytes.buffer);
  if ((view.getUint32(0, true) & 0x00ffffff) === 0x00796c70) {
    return SplatFileType.PLY;
  }
  if ((view.getUint32(0, true) & 0x00ffffff) === 0x00088b1f) {
    // Gzipped file, unpack beginning to check magic number
    const header = decompressPartialGzip(fileBytes, 4);
    const gView = new DataView(header.buffer);
    if (gView.getUint32(0, true) === 0x5053474e) {
      return SplatFileType.SPZ;
    }
    // Unknown Gzipped file type
    return undefined;
  }
  if (view.getUint32(0, true) === 0x04034b50) {
    // PKZip file
    if (tryPcSogsZip(fileBytes)) {
      return SplatFileType.PCSOGSZIP;
    }
    // Unknown PKZip file type
    return undefined;
  }
  // Unknown file type
  return undefined;
}

// Returns the lowercased file extension from a path or URL
export function getFileExtension(pathOrUrl: string): string {
  const noTrailing = pathOrUrl.split(/[?#]/, 1)[0];
  const lastSlash = Math.max(
    noTrailing.lastIndexOf("/"),
    noTrailing.lastIndexOf("\\"),
  );
  const filename = noTrailing.slice(lastSlash + 1);
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return ""; // No extension
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

export function getSplatFileTypeFromPath(
  pathOrUrl: string,
): SplatFileType | undefined {
  const extension = getFileExtension(pathOrUrl);
  if (extension === "ply") {
    return SplatFileType.PLY;
  }
  if (extension === "spz") {
    return SplatFileType.SPZ;
  }
  if (extension === "splat") {
    return SplatFileType.SPLAT;
  }
  if (extension === "ksplat") {
    return SplatFileType.KSPLAT;
  }
  if (extension === "sog") {
    return SplatFileType.PCSOGSZIP;
  }
  return undefined;
}

export type PcSogsJson = {
  means: {
    shape: number[];
    dtype: string;
    mins: number[];
    maxs: number[];
    files: string[];
  };
  scales: {
    shape: number[];
    dtype: string;
    mins: number[];
    maxs: number[];
    files: string[];
  };
  quats: { shape: number[]; dtype: string; encoding?: string; files: string[] };
  sh0: {
    shape: number[];
    dtype: string;
    mins: number[];
    maxs: number[];
    files: string[];
  };
  shN?: {
    shape: number[];
    dtype: string;
    mins: number;
    maxs: number;
    quantization: number;
    files: string[];
  };
};

export type PcSogsV2Json = {
  version: 2;
  count: number;
  antialias?: boolean;
  means: {
    mins: number[];
    maxs: number[];
    files: string[];
  };
  scales: {
    codebook: number[];
    files: string[];
  };
  quats: { files: string[] };
  sh0: {
    codebook: number[];
    files: string[];
  };
  shN?: {
    count: number;
    bands: number;
    codebook: number[];
    files: string[];
  };
};

export function isPcSogs(input: ArrayBuffer | Uint8Array | string): boolean {
  // Returns true if the input seems to be a valid PC SOGS file
  return tryPcSogs(input) !== undefined;
}

export function tryPcSogs(
  input: ArrayBuffer | Uint8Array | string,
): PcSogsJson | PcSogsV2Json | undefined {
  // Try to parse input as SOGS JSON and see if it's valid
  try {
    let text: string;
    if (typeof input === "string") {
      text = input;
    } else {
      const fileBytes =
        input instanceof ArrayBuffer ? new Uint8Array(input) : input;
      if (fileBytes.length > 65536) {
        // Should be only a few KB, definitely not a SOGS JSON file
        return undefined;
      }
      text = new TextDecoder().decode(fileBytes);
    }

    const json = JSON.parse(text);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return undefined;
    }
    const isVersion2 = json.version === 2;

    for (const key of ["means", "scales", "quats", "sh0"]) {
      if (
        !json[key] ||
        typeof json[key] !== "object" ||
        Array.isArray(json[key])
      ) {
        return undefined;
      }
      if (isVersion2) {
        // Expect files
        if (!json[key].files) {
          return undefined;
        }

        // Scales and sh0 should have codebooks
        if ((key === "scales" || key === "sh0") && !json[key].codebook) {
          return undefined;
        }
        // Means should have mins and maxs defined
        if (key === "means" && (!json[key].mins || !json[key].maxs)) {
          return undefined;
        }
      } else {
        // Expect shape and files
        if (!json[key].shape || !json[key].files) {
          return undefined;
        }
        // Besides 'quats' all other properties have mins and maxs
        if (key !== "quats" && (!json[key].mins || !json[key].maxs)) {
          return undefined;
        }
      }
    }
    // This is probably a PC SOGS file
    return json as PcSogsJson | PcSogsV2Json;
  } catch {
    return undefined;
  }
}

export function tryPcSogsZip(
  input: ArrayBuffer | Uint8Array,
): { name: string; json: PcSogsJson | PcSogsV2Json } | undefined {
  try {
    const fileBytes =
      input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    let metaFilename: string | null = null;

    const unzipped = unzipSync(fileBytes, {
      filter: ({ name }) => {
        const filename = name.split(/[\\/]/).pop() as string;
        if (filename === "meta.json") {
          metaFilename = name;
          return true;
        }
        return false;
      },
    });
    if (!metaFilename) {
      return undefined;
    }

    // Check for PC SOGS V1 and V2 (aka SOG)
    const json = tryPcSogs(unzipped[metaFilename]);
    if (!json) {
      return undefined;
    }
    return { name: metaFilename, json };
  } catch {
    return undefined;
  }
}

export async function unpackSplats({
  input,
  extraFiles,
  fileType,
  pathOrUrl,
  splatEncoding,
}: {
  input: Uint8Array | ArrayBuffer;
  extraFiles?: Record<string, ArrayBuffer>;
  fileType?: SplatFileType;
  pathOrUrl?: string;
  splatEncoding?: SplatEncoding;
}): Promise<{
  packedArray: Uint32Array;
  numSplats: number;
  extra?: Record<string, unknown>;
}> {
  const fileBytes =
    input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  let splatFileType = fileType;
  if (!fileType) {
    splatFileType = getSplatFileType(fileBytes);
    if (!splatFileType && pathOrUrl) {
      splatFileType = getSplatFileTypeFromPath(pathOrUrl);
    }
  }

  switch (splatFileType) {
    case SplatFileType.PLY: {
      const ply = new PlyReader({ fileBytes });
      await ply.parseHeader();
      const numSplats = ply.numSplats;
      const maxSplats = getTextureSize(numSplats).maxSplats;
      const args = {
        fileBytes,
        packedArray: new Uint32Array(maxSplats * 4),
        splatEncoding,
      };
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "unpackPly",
          args,
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.SPZ: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodeSpz",
          {
            fileBytes,
            splatEncoding,
          },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.SPLAT: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats } = (await worker.call(
          "decodeAntiSplat",
          {
            fileBytes,
            splatEncoding,
          },
        )) as { packedArray: Uint32Array; numSplats: number };
        return { packedArray, numSplats };
      });
    }
    case SplatFileType.KSPLAT: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodeKsplat",
          { fileBytes, splatEncoding },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.PCSOGS: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodePcSogs",
          { fileBytes, extraFiles, splatEncoding },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.PCSOGSZIP: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodePcSogsZip",
          { fileBytes, splatEncoding },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    default: {
      throw new Error(`Unknown splat file type: ${splatFileType}`);
    }
  }
}

export class SplatData {
  numSplats: number;
  maxSplats: number;
  centers: Float32Array;
  scales: Float32Array;
  quaternions: Float32Array;
  opacities: Float32Array;
  colors: Float32Array;
  sh1?: Float32Array;
  sh2?: Float32Array;
  sh3?: Float32Array;

  constructor({ maxSplats = 1 }: { maxSplats?: number } = {}) {
    this.numSplats = 0;
    this.maxSplats = getTextureSize(maxSplats).maxSplats;
    this.centers = new Float32Array(this.maxSplats * 3);
    this.scales = new Float32Array(this.maxSplats * 3);
    this.quaternions = new Float32Array(this.maxSplats * 4);
    this.opacities = new Float32Array(this.maxSplats);
    this.colors = new Float32Array(this.maxSplats * 3);
  }

  pushSplat(): number {
    const index = this.numSplats;
    this.ensureIndex(index);
    this.numSplats += 1;
    return index;
  }

  unpushSplat(index: number) {
    if (index === this.numSplats - 1) {
      this.numSplats -= 1;
    } else {
      throw new Error("Cannot unpush splat from non-last position");
    }
  }

  ensureCapacity(numSplats: number) {
    if (numSplats > this.maxSplats) {
      const targetSplats = Math.max(numSplats, this.maxSplats * 2);
      const newCenters = new Float32Array(targetSplats * 3);
      const newScales = new Float32Array(targetSplats * 3);
      const newQuaternions = new Float32Array(targetSplats * 4);
      const newOpacities = new Float32Array(targetSplats);
      const newColors = new Float32Array(targetSplats * 3);
      newCenters.set(this.centers);
      newScales.set(this.scales);
      newQuaternions.set(this.quaternions);
      newOpacities.set(this.opacities);
      newColors.set(this.colors);
      this.centers = newCenters;
      this.scales = newScales;
      this.quaternions = newQuaternions;
      this.opacities = newOpacities;
      this.colors = newColors;

      if (this.sh1) {
        const newSh1 = new Float32Array(targetSplats * 9);
        newSh1.set(this.sh1);
        this.sh1 = newSh1;
      }
      if (this.sh2) {
        const newSh2 = new Float32Array(targetSplats * 15);
        newSh2.set(this.sh2);
        this.sh2 = newSh2;
      }
      if (this.sh3) {
        const newSh3 = new Float32Array(targetSplats * 21);
        newSh3.set(this.sh3);
        this.sh3 = newSh3;
      }

      this.maxSplats = targetSplats;
    }
  }

  ensureIndex(index: number) {
    this.ensureCapacity(index + 1);
  }

  setCenter(index: number, x: number, y: number, z: number) {
    this.centers[index * 3] = x;
    this.centers[index * 3 + 1] = y;
    this.centers[index * 3 + 2] = z;
  }

  setScale(index: number, scaleX: number, scaleY: number, scaleZ: number) {
    this.scales[index * 3] = scaleX;
    this.scales[index * 3 + 1] = scaleY;
    this.scales[index * 3 + 2] = scaleZ;
  }

  setQuaternion(index: number, x: number, y: number, z: number, w: number) {
    this.quaternions[index * 4] = x;
    this.quaternions[index * 4 + 1] = y;
    this.quaternions[index * 4 + 2] = z;
    this.quaternions[index * 4 + 3] = w;
  }

  setOpacity(index: number, opacity: number) {
    this.opacities[index] = opacity;
  }

  setColor(index: number, r: number, g: number, b: number) {
    this.colors[index * 3] = r;
    this.colors[index * 3 + 1] = g;
    this.colors[index * 3 + 2] = b;
  }

  setSh1(index: number, sh1: Float32Array) {
    if (!this.sh1) {
      this.sh1 = new Float32Array(this.maxSplats * 9);
    }
    for (let j = 0; j < 9; ++j) {
      this.sh1[index * 9 + j] = sh1[j];
    }
  }

  setSh2(index: number, sh2: Float32Array) {
    if (!this.sh2) {
      this.sh2 = new Float32Array(this.maxSplats * 15);
    }
    for (let j = 0; j < 15; ++j) {
      this.sh2[index * 15 + j] = sh2[j];
    }
  }

  setSh3(index: number, sh3: Float32Array) {
    if (!this.sh3) {
      this.sh3 = new Float32Array(this.maxSplats * 21);
    }
    for (let j = 0; j < 21; ++j) {
      this.sh3[index * 21 + j] = sh3[j];
    }
  }
}

export async function transcodeSpz(
  input: TranscodeSpzInput,
): Promise<{ input: TranscodeSpzInput; fileBytes: Uint8Array }> {
  return await withWorker(async (worker) => {
    const result = (await worker.call("transcodeSpz", input)) as {
      input: TranscodeSpzInput;
      fileBytes: Uint8Array;
    };
    return result;
  });
}

export type FileInput = {
  fileBytes: Uint8Array;
  fileType?: SplatFileType;
  pathOrUrl?: string;
  transform?: { translate?: number[]; quaternion?: number[]; scale?: number };
};

export type TranscodeSpzInput = {
  inputs: FileInput[];
  maxSh?: number;
  clipXyz?: { min: number[]; max: number[] };
  fractionalBits?: number;
  opacityThreshold?: number;
};
