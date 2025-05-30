import { FileLoader, Loader, type LoadingManager } from "three";
import { PackedSplats } from "./PackedSplats";
import { SplatMesh } from "./SplatMesh";
import { PlyReader } from "./ply";
import { withWorker } from "./splatWorker";
import { decompressPartialGzip, getTextureSize } from "./utils";

// SplatLoader implements the THREE.Loader interface and supports loading a variety
// of differeng Gsplat file formats. Formats .PLY and .SPZ can be auto-detected
// from the file contents, while .SPLAT and .KSPLAT require either having the
// appropriate file extension as part of the path, or it can be explicitly set
// in the loader using the fileType property.

export class SplatLoader extends Loader {
  fileLoader: FileLoader;
  fileType?: SplatFileType;

  constructor(manager?: LoadingManager) {
    super(manager);
    this.fileLoader = new FileLoader(manager);
  }

  load(
    url: string,
    onLoad?: (decoded: PackedSplats) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    this.fileLoader.setResponseType("arraybuffer");
    this.fileLoader.setCrossOrigin(this.crossOrigin);
    this.fileLoader.setWithCredentials(this.withCredentials);
    this.fileLoader.setPath(this.path);
    this.fileLoader.setResourcePath(this.resourcePath);
    this.fileLoader.setRequestHeader(this.requestHeader);
    this.fileLoader.load(
      url,
      async (response) => {
        if (onLoad) {
          const input = response as ArrayBuffer;
          const decoded = await unpackSplats({
            input,
            fileType: this.fileType,
            pathOrUrl: url,
          });
          onLoad(new PackedSplats(decoded));
        }
      },
      onProgress,
      onError,
    );
  }

  async loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PackedSplats> {
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
}

export enum SplatFileType {
  PLY = "ply",
  SPZ = "spz",
  SPLAT = "splat",
  KSPLAT = "ksplat",
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
  return undefined;
}

export async function unpackSplats({
  input,
  fileType,
  pathOrUrl,
}: {
  input: Uint8Array | ArrayBuffer;
  fileType?: SplatFileType;
  pathOrUrl?: string;
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
      const args = { fileBytes, packedArray: new Uint32Array(maxSplats * 4) };
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
          },
        )) as { packedArray: Uint32Array; numSplats: number };
        return { packedArray, numSplats };
      });
    }
    case SplatFileType.KSPLAT:
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodeKsplat",
          { fileBytes },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
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
      // console.log("Reallocated capacity", this.maxSplats);
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
      // console.log("setSh1 creating sh1", this.sh1.length);
    }
    for (let j = 0; j < 9; ++j) {
      this.sh1[index * 9 + j] = sh1[j];
    }
  }

  setSh2(index: number, sh2: Float32Array) {
    if (!this.sh2) {
      this.sh2 = new Float32Array(this.maxSplats * 15);
      // console.log("setSh2 creating sh2", this.sh2.length);
    }
    for (let j = 0; j < 15; ++j) {
      this.sh2[index * 15 + j] = sh2[j];
    }
  }

  setSh3(index: number, sh3: Float32Array) {
    if (!this.sh3) {
      this.sh3 = new Float32Array(this.maxSplats * 21);
      // console.log("setSh3 creating sh3", this.sh3.length);
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
    // console.log("withWorker calling transcodeSpz", input);
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
