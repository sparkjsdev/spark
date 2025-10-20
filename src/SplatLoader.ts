import { unzipSync } from "fflate";
import * as THREE from "three";
import { Splat } from "./Splat";
import { withWorkerCall } from "./SplatWorker";
import {
  DefaultSplatEncoding,
  type SplatEncodingClass,
  type UnpackResult,
} from "./encoding/encoder";
import type { PcSogsJson, PcSogsV2Json } from "./formats/pcsogs";
import { decompressPartialGzip } from "./utils";

export type SplatLoaderOptions = {
  loadingManager: THREE.LoadingManager;
  fileType: SplatFileType;
  splatEncoding: SplatEncodingClass;
};

/**
 * SplatLoader implements the THREE.Loader interface and supports loading a variety
 * of different Gsplat file formats. Formats .PLY and .SPZ can be auto-detected
 * from the file contents, while .SPLAT and .KSPLAT require either having the
 * appropriate file extension as part of the path, or it can be explicitly set
 * in the loader using the fileType property.
 */
export class SplatLoader extends THREE.Loader {
  fileType?: SplatFileType;
  splatEncoding: SplatEncodingClass;

  constructor(options?: SplatLoaderOptions) {
    super(options?.loadingManager);
    this.fileType = options?.fileType;
    this.splatEncoding = options?.splatEncoding ?? DefaultSplatEncoding;
  }

  load(
    url: string,
    onLoad?: (decoded: Splat) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    const resolvedURL = this.manager.resolveURL(
      (this.path ?? "") + (url ?? ""),
    );

    const headers = new Headers(this.requestHeader);
    const credentials = this.withCredentials ? "include" : "same-origin";
    const request = new Request(resolvedURL, { headers, credentials });
    let fileType = this.fileType;

    this.manager.itemStart(resolvedURL);

    fetchWithProgress(request, onProgress)
      .then(async (input) => {
        const progresses = [
          new ProgressEvent("progress", {
            lengthComputable: true,
            loaded: input.byteLength,
            total: input.byteLength,
          }),
        ];

        function updateProgresses() {
          if (onProgress) {
            const lengthComputable = progresses.every((p) => {
              // Either it's computable or no progress yet
              return p.lengthComputable || (p.loaded === 0 && p.total === 0);
            });
            const loaded = progresses.reduce((sum, p) => sum + p.loaded, 0);
            const total = progresses.reduce((sum, p) => sum + p.total, 0);
            onProgress(
              new ProgressEvent("progress", {
                lengthComputable,
                loaded,
                total,
              }),
            );
          }
        }

        const extraFiles: Record<string, ArrayBuffer> = {};
        const promises = [];

        const pcSogsJson = tryPcSogs(input);
        if (fileType === SplatFileType.PCSOGS) {
          if (pcSogsJson === undefined) {
            throw new Error("Invalid PC SOGS file");
          }
        }
        if (pcSogsJson !== undefined) {
          fileType = SplatFileType.PCSOGS;
          for (const key of ["means", "scales", "quats", "sh0", "shN"]) {
            const prop = pcSogsJson[key as keyof PcSogsJson];
            if (prop) {
              for (const file of prop.files) {
                const fileUrl = new URL(file, resolvedURL).toString();
                const progressIndex = progresses.length;
                progresses.push(new ProgressEvent("progress"));

                this.manager.itemStart(fileUrl);
                const request = new Request(fileUrl, { headers, credentials });
                const promise = fetchWithProgress(request, (progress) => {
                  progresses[progressIndex] = progress;
                  updateProgresses();
                })
                  .then((data) => {
                    extraFiles[file] = data;
                  })
                  .catch((error) => {
                    this.manager.itemError(fileUrl);
                    throw error;
                  })
                  .finally(() => {
                    this.manager.itemEnd(fileUrl);
                  });
                promises.push(promise);
              }
            }
          }
        }

        await Promise.all(promises);
        if (onLoad) {
          const splat = await this.parseAsync(input, {
            extraFiles,
            fileType,
            fileName: resolvedURL,
          });
          onLoad(splat);
        }
      })
      .catch((error) => {
        this.manager.itemError(resolvedURL);
        onError?.(error);
      })
      .finally(() => {
        this.manager.itemEnd(resolvedURL);
      });
  }

  async loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Splat> {
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

  async parseAsync(
    input: ArrayBuffer,
    options?: {
      extraFiles?: Record<string, ArrayBuffer>;
      fileType?: SplatFileType;
      fileName?: string;
    },
  ): Promise<Splat> {
    const decoded = await unpackSplats(
      input,
      this.splatEncoding.encodingName,
      options?.extraFiles,
      options?.fileType,
      options?.fileName,
    );

    return new Splat(this.splatEncoding.fromTransferable(decoded.unpacked));
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
  const contentLength = Number.parseInt(
    response.headers.get("Content-Length") || "0",
  );
  const total = Number.isNaN(contentLength) ? 0 : contentLength;
  let loaded = 0;
  const chunks: Uint8Array[] = [];

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

const SPLAT_FILE_TYPE_TO_RPC = {
  [SplatFileType.PLY]: "decodePly",
  [SplatFileType.SPZ]: "decodeSpz",
  [SplatFileType.SPLAT]: "decodeAntiSplat",
  [SplatFileType.KSPLAT]: "decodeKsplat",
  [SplatFileType.PCSOGS]: "decodePcSogs",
  [SplatFileType.PCSOGSZIP]: "decodePcSogsZip",
} as const satisfies Partial<Record<SplatFileType, string>>;

export async function unpackSplats(
  input: Uint8Array<ArrayBuffer> | ArrayBuffer,
  encodingName: string,
  extraFiles?: Record<string, ArrayBuffer>,
  fileType?: SplatFileType,
  pathOrUrl?: string,
): Promise<UnpackResult> {
  const fileBytes =
    input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  let splatFileType = fileType;
  if (!fileType) {
    splatFileType = getSplatFileType(fileBytes);
    if (!splatFileType && pathOrUrl) {
      splatFileType = getSplatFileTypeFromPath(pathOrUrl);
    }
  }

  if (!splatFileType) {
    throw new Error(`Unknown splat file type: ${splatFileType}`);
  }

  const decodeRpc = SPLAT_FILE_TYPE_TO_RPC[splatFileType];
  return await withWorkerCall(decodeRpc, {
    fileBytes,
    extraFiles,
    encoder: encodingName,
    encoderOptions: {},
  });
}
