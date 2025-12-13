import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import { workerPool } from "./NewSplatWorker";
import type { RgbaArray } from "./RgbaArray";
import type { GsplatGenerator } from "./SplatGenerator";
import { type SplatFileType, SplatLoader, unpackSplats } from "./SplatLoader";
import type { SplatSource } from "./SplatMesh";
import {
  LN_SCALE_MAX,
  LN_SCALE_MIN,
  SPLAT_TEX_HEIGHT,
  SPLAT_TEX_WIDTH,
} from "./defines";
import {
  Dyno,
  DynoInt,
  DynoProgram,
  DynoProgramTemplate,
  DynoUniform,
  DynoUsampler2DArray,
  type DynoVal,
  DynoVec2,
  DynoVec4,
  add,
  dynoBlock,
  dynoConst,
  normalize,
  outputPackedSplat,
  sub,
  unindent,
  unindentLines,
} from "./dyno";
import {
  type Gsplat,
  TPackedSplats,
  combineGsplat,
  definePackedSplats,
  readPackedSplat,
  splitGsplat,
} from "./dyno/splats";
import computeUvec4Template from "./shaders/computeUvec4.glsl";
import { getTextureSize, setPackedSplat, unpackSplat } from "./utils";

export type SplatEncoding = {
  rgbMin?: number;
  rgbMax?: number;
  lnScaleMin?: number;
  lnScaleMax?: number;
  sh1Min?: number;
  sh1Max?: number;
  sh2Min?: number;
  sh2Max?: number;
  sh3Min?: number;
  sh3Max?: number;
  lodOpacity?: boolean;
};

export const DEFAULT_SPLAT_ENCODING: SplatEncoding = {
  rgbMin: 0,
  rgbMax: 1,
  lnScaleMin: LN_SCALE_MIN,
  lnScaleMax: LN_SCALE_MAX,
  sh1Min: -1,
  sh1Max: 1,
  sh2Min: -1,
  sh2Max: 1,
  sh3Min: -1,
  sh3Max: 1,
  lodOpacity: false,
};

// Initialize a PackedSplats collection from source data via
// url, fileBytes, or packedArray. Creates an empty array if none are set,
// and splat data can be constructed using pushSplat()/setSplat(). The maximum
// splat size allocation will grow automatically, starting from maxSplats.
export type PackedSplatsOptions = {
  // URL to fetch a Gaussian splat file from (supports .ply, .splat, .ksplat,
  // .spz formats). (default: undefined)
  url?: string;
  // Raw bytes of a Gaussian splat file to decode directly instead of fetching
  // from URL. (default: undefined)
  fileBytes?: Uint8Array | ArrayBuffer;
  // Override the file type detection for formats that can't be reliably
  // auto-detected (.splat, .ksplat). (default: undefined auto-detects other
  // formats from file contents)
  fileType?: SplatFileType;
  // File name to use for type detection. (default: undefined)
  fileName?: string;
  // Reserve space for at least this many splats when constructing the collection
  // initially. The array will automatically resize past maxSplats so setting it is
  // an optional optimization. (default: 0)
  maxSplats?: number;
  // Use provided packed data array, where each 4 consecutive uint32 values
  // encode one "packed" Gsplat. (default: undefined)
  packedArray?: Uint32Array;
  // Override number of splats in packed array to use only a subset.
  // (default: length of packed array / 4)
  numSplats?: number;
  // Callback function to programmatically create splats at initialization.
  // (default: undefined)
  construct?: (splats: PackedSplats) => Promise<void> | void;
  // Callback function called while downloading and initializing (default: undefined)
  onProgress?: (event: ProgressEvent) => void;
  // Additional splat data, such as spherical harmonics components (sh1, sh2, sh3). (default: {})
  extra?: Record<string, unknown>;
  // Override the default splat encoding ranges for the PackedSplats.
  // (default: undefined)
  splatEncoding?: SplatEncoding;
  // Enable LOD. If a number is provided, it will be used as LoD level base,
  // otherwise the default 1.5 is used. When loading a file without pre-computed
  // LoD it will use the "quick lod" algorithm to generate one on-the-fly with
  // the selected LoD level base. (default: undefined=false)
  lod?: boolean | number;
  // Keep the original PackedSplats data before creating LoD version. (default: false)
  nonLod?: boolean | "wait";
  // The LoD version of the PackedSplats
  lodSplats?: PackedSplats;
  maxBoneSplats?: number;
  computeBoneWeights?: boolean;
  minBoneOpacity?: number;
  boneSplats?: PackedSplats;
  paged?: {
    url: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
  };
};

// A PackedSplats is a collection of Gaussian splats, packed into a format that
// takes exactly 16 bytes per Gsplat to maximize memory and cache efficiency.
// The center xyz coordinates are encoded as float16 (3 x 2 bytes), scale xyz
// as 3 x uint8 that encode a log scale from e^-12 to e^9, rgba as 4 x uint8,
// and quaternion encoded via axis+angle using 2 x uint8 for octahedral encoding
// of the axis direction and a uint8 to encode rotation amount from 0..Pi.

export class PackedSplats implements SplatSource {
  maxSplats = 0;
  numSplats = 0;
  packedArray: Uint32Array | null = null;
  extra: Record<string, unknown>;
  maxSh = 3;
  splatEncoding?: SplatEncoding;
  lod?: boolean | number;
  nonLod?: boolean | "wait";
  lodSplats?: PackedSplats;
  maxBoneSplats?: number;
  computeBoneWeights?: boolean;
  minBoneOpacity?: number;
  boneSplats?: PackedSplats;
  paged?: {
    url: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
  };
  pageCache: THREE.DataArrayTexture | null = null;
  chunkToPage: Map<number, number | null> = new Map();
  chunkEvict: number[] = [];
  pageFreelist: number[] = [];
  pageMax = 0;
  pageTop = 0;

  initialized: Promise<PackedSplats>;
  isInitialized = false;

  // Either target or source will be non-null, depending on whether the PackedSplats
  // is being used as a data source or generated to.
  target: THREE.WebGLArrayRenderTarget | null = null;
  source: THREE.DataArrayTexture | null = null;
  // Set to true if source packedArray is updated to have it upload to GPU
  needsUpdate = true;

  // A PackedSplats can be used in a dyno graph using the below property dyno:
  // const gsplat = dyno.readPackedSplats(this.dyno, dynoIndex);
  dyno: DynoUniform<typeof TPackedSplats, "packedSplats">;
  dynoRgbMinMaxLnScaleMinMax: DynoUniform<"vec4", "rgbMinMaxLnScaleMinMax">;
  dynoNumSh: DynoInt<"numSh">;
  dynoSh1MidScale: DynoUniform<"vec2", "sh1MidScale">;
  dynoSh2MidScale: DynoUniform<"vec2", "sh2MidScale">;
  dynoSh3MidScale: DynoUniform<"vec2", "sh3MidScale">;
  // dynoSh1MinMax: DynoUniform<"vec2", "sh1MinMax">;
  // dynoSh2MinMax: DynoUniform<"vec2", "sh2MinMax">;
  // dynoSh3MinMax: DynoUniform<"vec2", "sh3MinMax">;

  constructor(options: PackedSplatsOptions = {}) {
    this.extra = {};
    this.dyno = new DynoPackedSplats({ packedSplats: this });
    this.dynoRgbMinMaxLnScaleMinMax = new DynoVec4({
      key: "rgbMinMaxLnScaleMinMax",
      value: new THREE.Vector4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX),
      update: (value) => {
        value.set(
          this.splatEncoding?.rgbMin ?? 0.0,
          this.splatEncoding?.rgbMax ?? 1.0,
          this.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN,
          this.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX,
        );
        return value;
      },
    });
    this.dynoNumSh = new DynoInt({
      key: "numSh",
      value: 0,
      update: () => {
        return Math.min(this.getNumSh(), this.maxSh);
      },
    });
    this.dynoSh1MidScale = new DynoVec2({
      key: "sh1MidScale",
      value: new THREE.Vector2(),
      update: (value) => {
        value.set(
          0.5 *
            ((this.splatEncoding?.sh1Max ?? 1.0) +
              (this.splatEncoding?.sh1Min ?? -1.0)),
          0.5 *
            ((this.splatEncoding?.sh1Max ?? 1.0) -
              (this.splatEncoding?.sh1Min ?? -1.0)),
        );
        return value;
      },
    });
    this.dynoSh2MidScale = new DynoVec2({
      key: "sh2MidScale",
      value: new THREE.Vector2(),
      update: (value) => {
        value.set(
          0.5 *
            ((this.splatEncoding?.sh2Max ?? 1.0) +
              (this.splatEncoding?.sh2Min ?? -1.0)),
          0.5 *
            ((this.splatEncoding?.sh2Max ?? 1.0) -
              (this.splatEncoding?.sh2Min ?? -1.0)),
        );
        return value;
      },
    });
    this.dynoSh3MidScale = new DynoVec2({
      key: "sh3MidScale",
      value: new THREE.Vector2(),
      update: (value) => {
        value.set(
          0.5 *
            ((this.splatEncoding?.sh3Max ?? 1.0) +
              (this.splatEncoding?.sh3Min ?? -1.0)),
          0.5 *
            ((this.splatEncoding?.sh3Max ?? 1.0) -
              (this.splatEncoding?.sh3Min ?? -1.0)),
        );
        return value;
      },
    });

    // The following line will be overridden by reinitialize()
    this.initialized = Promise.resolve(this);
    this.reinitialize(options);
  }

  reinitialize(options: PackedSplatsOptions) {
    this.isInitialized = false;

    this.extra = {};
    this.maxSplats = options.maxSplats ?? 0;
    this.splatEncoding = options.splatEncoding;
    this.lod = options.lod;
    this.nonLod = options.nonLod;
    this.maxBoneSplats = options.maxBoneSplats;
    this.computeBoneWeights = options.computeBoneWeights;
    this.minBoneOpacity = options.minBoneOpacity;

    if (options.url || options.fileBytes || options.construct) {
      // We need to initialize asynchronously given the options
      this.initialized = this.asyncInitialize(options).then(() => {
        this.isInitialized = true;
        return this;
      });
    } else {
      this.initialize(options);
      this.isInitialized = true;
      this.initialized = Promise.resolve(this);
    }
  }

  initialize(options: PackedSplatsOptions) {
    this.extra = options.extra ?? {};
    this.lodSplats = options.lodSplats;
    this.boneSplats = options.boneSplats;
    this.paged = options.paged;

    if (options.packedArray) {
      this.packedArray = options.packedArray;
      this.numSplats = options.numSplats ?? this.packedArray.length / 4;

      if (options.paged) {
        // Allocate 16M splats worth of paged texture by default
        this.maxSplats = options.maxSplats ?? (this.maxSplats || 65536 * 256);
        this.ensurePagedTexture();

        const numPages = Math.ceil(this.numSplats / 65536);
        for (let page = 0; page < numPages; ++page) {
          this.chunkToPage.set(page, page);
        }
        this.pageMax = Math.ceil(this.maxSplats / 65536);
        this.pageTop = numPages;
      } else {
        // Calculate number of horizontal texture rows that could fit in array.
        // A properly initialized packedArray should already take into account the
        // width and height of the texture and be rounded up with padding.
        this.maxSplats = Math.floor(this.packedArray.length / 4);
        this.maxSplats =
          Math.floor(this.maxSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
        this.numSplats = Math.min(
          this.maxSplats,
          options.numSplats ?? Number.POSITIVE_INFINITY,
        );
      }
    } else {
      this.maxSplats = options.maxSplats ?? 0;
      this.numSplats = 0;
    }
  }

  async asyncInitialize(options: PackedSplatsOptions) {
    const {
      url,
      fileBytes,
      construct,
      lod,
      nonLod,
      maxBoneSplats,
      computeBoneWeights,
      minBoneOpacity,
    } = options;
    this.lod = lod;
    this.nonLod = nonLod;
    this.maxBoneSplats = maxBoneSplats;
    this.computeBoneWeights = computeBoneWeights;
    this.minBoneOpacity = minBoneOpacity;

    const loader = new SplatLoader();
    loader.packedSplats = this;
    if (fileBytes) {
      await loader.loadAsync(
        fileBytes as unknown as string,
        options.onProgress,
      );
    } else if (url) {
      await loader.loadAsync(url, options.onProgress);
    }

    if (construct) {
      const maybePromise = construct(this);
      // If construct returns a promise, wait for it to complete
      if (maybePromise instanceof Promise) {
        await maybePromise;
      }
    }
  }

  // Call this when you are finished with the PackedSplats and want to free
  // any buffers it holds.
  dispose() {
    if (this.target) {
      this.target.dispose();
      this.target = null;
    }
    if (this.source) {
      this.source.dispose();
      this.source = null;
    }
    this.disposeLodSplats();
    this.disposeBoneSplats();
    if (this.pageCache) {
      this.pageCache.dispose();
      this.pageCache = null;
    }
  }

  prepareFetchSplat() {
    // console.info("PackedSplats.prepareFetchSplat");
  }

  getNumSplats(): number {
    return this.numSplats;
  }

  hasRgbDir(): boolean {
    return Math.min(this.getNumSh(), this.maxSh) > 0;
  }

  getNumSh(): number {
    return !this.extra.sh1 ? 0 : !this.extra.sh2 ? 1 : !this.extra.sh3 ? 2 : 3;
  }

  setMaxSh(maxSh: number) {
    this.maxSh = maxSh;
  }

  fetchSplat({
    index,
    viewOrigin,
  }: { index: DynoVal<"int">; viewOrigin?: DynoVal<"vec3"> }): DynoVal<
    typeof Gsplat
  > {
    // return dynoBlock(
    //   { index: "int", viewOrigin: "vec3" },
    //   { gsplat: Gsplat },
    //   ({ index, viewOrigin }) => {
    //     if (!index) {
    //       throw new Error("index is required");
    //     }
    let gsplat = readPackedSplat(this.dyno, index);

    if (this.hasRgbDir() && viewOrigin) {
      const splatCenter = splitGsplat(gsplat).outputs.center;
      const viewDir = normalize(sub(splatCenter, viewOrigin));
      const { sh1Texture, sh2Texture, sh3Texture } = this.ensureShTextures();
      let { rgb } = evaluateSH({
        index,
        viewDir,
        numSh: this.dynoNumSh,
        sh1Texture,
        sh2Texture,
        sh3Texture,
        sh1MidScale: this.dynoSh1MidScale,
        sh2MidScale: this.dynoSh2MidScale,
        sh3MidScale: this.dynoSh3MidScale,
      });
      rgb = add(rgb, splitGsplat(gsplat).outputs.rgb);
      gsplat = combineGsplat({ gsplat, rgb });
    }
    return gsplat;
    //   },
    // ).outputs.gsplat;
  }

  private ensureShTextures(): {
    sh1Texture?: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
    sh2Texture?: DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
    sh3Texture?: DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>;
  } {
    // Ensure we have textures for SH1..SH3 if we have data
    if (!this.extra.sh1) {
      return {};
    }

    let sh1Texture = this.extra.sh1Texture as
      | DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>
      | undefined;
    if (!sh1Texture) {
      let sh1 = this.extra.sh1 as Uint32Array<ArrayBuffer>;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh1.length / 2,
      );
      if (sh1.length < maxSplats * 2) {
        const newSh1 = new Uint32Array(maxSplats * 2);
        newSh1.set(sh1);
        this.extra.sh1 = newSh1;
        sh1 = newSh1;
      }

      const texture = new THREE.DataArrayTexture(sh1, width, height, depth);
      texture.format = THREE.RGIntegerFormat;
      texture.type = THREE.UnsignedIntType;
      texture.internalFormat = "RG32UI";
      texture.needsUpdate = true;

      sh1Texture = new DynoUsampler2DArray({
        value: texture,
        key: "sh1",
      });
      this.extra.sh1Texture = sh1Texture;
    }

    if (!this.extra.sh2) {
      return { sh1Texture };
    }

    let sh2Texture = this.extra.sh2Texture as
      | DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>
      | undefined;
    if (!sh2Texture) {
      let sh2 = this.extra.sh2 as Uint32Array<ArrayBuffer>;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh2.length / 4,
      );
      if (sh2.length < maxSplats * 4) {
        const newSh2 = new Uint32Array(maxSplats * 4);
        newSh2.set(sh2);
        this.extra.sh2 = newSh2;
        sh2 = newSh2;
      }

      const texture = new THREE.DataArrayTexture(sh2, width, height, depth);
      texture.format = THREE.RGBAIntegerFormat;
      texture.type = THREE.UnsignedIntType;
      texture.internalFormat = "RGBA32UI";
      texture.needsUpdate = true;

      sh2Texture = new DynoUsampler2DArray({
        value: texture,
        key: "sh2",
      });
      this.extra.sh2Texture = sh2Texture;
    }

    if (!this.extra.sh3) {
      return { sh1Texture, sh2Texture };
    }

    let sh3Texture = this.extra.sh3Texture as
      | DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>
      | undefined;
    if (!sh3Texture) {
      let sh3 = this.extra.sh3 as Uint32Array<ArrayBuffer>;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh3.length / 4,
      );
      if (sh3.length < maxSplats * 4) {
        const newSh3 = new Uint32Array(maxSplats * 4);
        newSh3.set(sh3);
        this.extra.sh3 = newSh3;
        sh3 = newSh3;
      }

      const texture = new THREE.DataArrayTexture(sh3, width, height, depth);
      texture.format = THREE.RGBAIntegerFormat;
      texture.type = THREE.UnsignedIntType;
      texture.internalFormat = "RGBA32UI";
      texture.needsUpdate = true;

      sh3Texture = new DynoUsampler2DArray({
        value: texture,
        key: "sh3",
      });
      this.extra.sh3Texture = sh3Texture;
    }

    return { sh1Texture, sh2Texture, sh3Texture };
  }

  // Ensures that this.packedArray can fit numSplats Gsplats. If it's too small,
  // resize exponentially and copy over the original data.
  //
  // Typically you don't need to call this, because calling this.setSplat(index, ...)
  // and this.pushSplat(...) will automatically call ensureSplats() so we have
  // enough splats.
  ensureSplats(numSplats: number): Uint32Array {
    const targetSize =
      numSplats <= this.maxSplats
        ? this.maxSplats
        : // Grow exponentially to avoid frequent reallocations
          Math.max(numSplats, 2 * this.maxSplats);
    const currentSize = !this.packedArray ? 0 : this.packedArray.length / 4;

    if (!this.packedArray || targetSize > currentSize) {
      this.maxSplats = getTextureSize(targetSize).maxSplats;
      const newArray = new Uint32Array(this.maxSplats * 4);
      if (this.packedArray) {
        // Copy over existing data
        newArray.set(this.packedArray);
      }
      this.packedArray = newArray;
    }
    return this.packedArray;
  }

  // Ensure the extra array for the given level is large enough to hold numSplats
  ensureSplatsSh(level: number, numSplats: number): Uint32Array {
    let wordsPerSplat: number;
    let key: string;
    if (level === 0) {
      return this.ensureSplats(numSplats);
    }
    if (level === 1) {
      // 3 x 3 uint7 = 63 bits = 2 uint32
      wordsPerSplat = 2;
      key = "sh1";
    } else if (level === 2) {
      // 5 x 3 uint8 = 120 bits = 4 uint32
      wordsPerSplat = 4;
      key = "sh2";
    } else if (level === 3) {
      // 7 x 3 uint6 = 126 bits = 4 uint32
      wordsPerSplat = 4;
      key = "sh3";
    } else {
      throw new Error(`Invalid level: ${level}`);
    }

    // Figure out our current and desired maxSplats
    let maxSplats: number = !this.extra[key]
      ? 0
      : (this.extra[key] as Uint32Array).length / wordsPerSplat;
    const targetSize =
      numSplats <= maxSplats ? maxSplats : Math.max(numSplats, 2 * maxSplats);

    if (!this.extra[key] || targetSize > maxSplats) {
      // Reallocate the array
      maxSplats = getTextureSize(targetSize).maxSplats;
      const newArray = new Uint32Array(maxSplats * wordsPerSplat);
      if (this.extra[key]) {
        // Copy over existing data
        newArray.set(this.extra[key] as Uint32Array);
      }
      this.extra[key] = newArray;
    }
    return this.extra[key] as Uint32Array;
  }

  // Unpack the 16-byte Gsplat data at index into the Three.js components
  // center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion,
  // opacity: number 0..1, color: THREE.Color 0..1.
  getSplat(index: number): {
    center: THREE.Vector3;
    scales: THREE.Vector3;
    quaternion: THREE.Quaternion;
    opacity: number;
    color: THREE.Color;
  } {
    if (!this.packedArray || index >= this.numSplats) {
      throw new Error("Invalid index");
    }
    return unpackSplat(this.packedArray, index, this.splatEncoding);
  }

  // Set all PackedSplat components at index with the provided Gsplat attributes
  // (can be the same objects returned by getSplat). Ensures there is capacity
  // for at least index+1 Gsplats.
  setSplat(
    index: number,
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) {
    const packedSplats = this.ensureSplats(index + 1);
    setPackedSplat(
      packedSplats,
      index,
      center.x,
      center.y,
      center.z,
      scales.x,
      scales.y,
      scales.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
      opacity,
      color.r,
      color.g,
      color.b,
    );
    this.numSplats = Math.max(this.numSplats, index + 1);
  }

  // Effectively calls this.setSplat(this.numSplats++, center, ...), useful on
  // construction where you just want to iterate and create a collection of Gsplats.
  pushSplat(
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) {
    const packedSplats = this.ensureSplats(this.numSplats + 1);
    setPackedSplat(
      packedSplats,
      this.numSplats,
      center.x,
      center.y,
      center.z,
      scales.x,
      scales.y,
      scales.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
      opacity,
      color.r,
      color.g,
      color.b,
    );
    ++this.numSplats;
  }

  // Iterate over Gsplats index 0..=(this.numSplats-1), unpack each Gsplat
  // and invoke the callback function with the Gsplat attributes.
  forEachSplat(
    callback: (
      index: number,
      center: THREE.Vector3,
      scales: THREE.Vector3,
      quaternion: THREE.Quaternion,
      opacity: number,
      color: THREE.Color,
    ) => void,
  ) {
    if (!this.packedArray || !this.numSplats) {
      return;
    }
    for (let i = 0; i < this.numSplats; ++i) {
      const unpacked = unpackSplat(this.packedArray, i, this.splatEncoding);
      callback(
        i,
        unpacked.center,
        unpacked.scales,
        unpacked.quaternion,
        unpacked.opacity,
        unpacked.color,
      );
    }
  }

  // Ensures our PackedSplats.target render target has enough space to generate
  // maxSplats total Gsplats, and reallocate if not large enough.
  ensureGenerate(maxSplats: number): boolean {
    if (this.target && (maxSplats ?? 1) <= this.maxSplats) {
      return false;
    }
    this.dispose();

    const textureSize = getTextureSize(maxSplats ?? 1);
    const { width, height, depth } = textureSize;
    this.maxSplats = textureSize.maxSplats;

    // The packed Gsplats are stored in a 2D array texture of max size
    // 2048 x 2048 x 2048, one RGBA32UI pixel = 4 uint32 = one Gsplat
    this.target = new THREE.WebGLArrayRenderTarget(width, height, depth, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
    });
    this.target.texture.format = THREE.RGBAIntegerFormat;
    this.target.texture.type = THREE.UnsignedIntType;
    this.target.texture.internalFormat = "RGBA32UI";
    this.target.scissorTest = true;
    return true;
  }

  // Given an array of splatCounts (.numSplats for each
  // SplatGenerator/SplatMesh in the scene), compute a
  // "mapping layout" in the composite array of generated outputs.
  generateMapping(splatCounts: number[]): {
    maxSplats: number;
    mapping: { base: number; count: number }[];
  } {
    let maxSplats = 0;
    const mapping = splatCounts.map((numSplats) => {
      const base = maxSplats;
      // Generation happens in horizonal row chunks, so round up to full width
      const rounded = Math.ceil(numSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
      maxSplats += rounded;
      return { base, count: numSplats };
    });
    return { maxSplats, mapping };
  }

  // Returns a THREE.DataArrayTexture representing the PackedSplats content as
  // a Uint32x4 data array texture (2048 x 2048 x depth in size)
  getTexture(): THREE.DataArrayTexture {
    if (this.target) {
      // Return the render target's texture
      return this.target.texture;
    }
    if (this.source || this.packedArray) {
      // Update source texture if needed and return
      const source = this.maybeUpdateSource();
      return source;
    }

    return PackedSplats.getEmptyArray;
  }

  ensurePagedTexture() {
    if (this.pageCache) {
      const { width, height, depth } = this.pageCache.image;
      if (this.maxSplats !== width * height * depth) {
        this.pageCache.dispose();
        this.pageCache = null;
      }
    }
    if (!this.pageCache) {
      const maxSplats = Math.max(this.maxSplats, 65536 * 2);
      const width = 256;
      const height = 256;
      const depth = Math.ceil(maxSplats / (width * height));

      if (
        !this.packedArray ||
        this.packedArray.length < width * height * depth * 4
      ) {
        const newArray = new Uint32Array(width * height * depth * 4);
        if (this.packedArray) {
          newArray.set(this.packedArray);
        }
        this.packedArray = newArray;
      }

      this.pageCache = new THREE.DataArrayTexture(
        this.packedArray as Uint32Array<ArrayBuffer>,
        width,
        height,
        depth,
      );
      this.pageCache.format = THREE.RGBAIntegerFormat;
      this.pageCache.type = THREE.UnsignedIntType;
      this.pageCache.internalFormat = "RGBA32UI";
      this.pageCache.needsUpdate = true;
      this.maxSplats = width * height * depth;
    }
  }

  allocTexturePage() {
    let page = this.pageFreelist.shift();
    if (page != null) {
      return page;
    }

    if (this.pageTop >= this.pageMax) {
      return undefined;
    }
    page = this.pageTop;
    this.pageTop += 1;
    this.numSplats = this.pageTop * 65536;
    return page;
  }

  freeTexturePage(page: number) {
    this.pageFreelist.push(page);
  }

  uploadTexturePage(
    renderer: THREE.WebGLRenderer,
    packedArray: Uint32Array,
    page: number,
  ) {
    if (!this.packedArray || !this.pageCache) {
      throw new Error("No packed array or page cache");
    }
    this.packedArray
      .subarray(page * 65536 * 4, (page + 1) * 65536 * 4)
      .set(packedArray);
    this.pageCache.addLayerUpdate(page);
    this.pageCache.needsUpdate = true;

    // console.log("Uploading page", page, packedArray, this.pageCache?.image.data);
    // new Uint32Array(this.packedArray.buffer, 4 * 4 * 65536 * page).set(packedArray);
    // this.pageCache.needsUpdate = true;

    // const gl = renderer.getContext() as WebGL2RenderingContext;
    // if (!renderer.properties.has(this.pageCache)) {
    //   throw new Error("Page cache not found");
    // }
    // const props = renderer.properties.get(this.pageCache) as {
    //   __webglTexture: WebGLTexture;
    // };
    // const glTexture = props.__webglTexture;
    // if (!glTexture) {
    //   throw new Error("Page cache texture not found");
    // }
    // renderer.state.activeTexture(gl.TEXTURE0);
    // renderer.state.bindTexture(gl.TEXTURE_2D, glTexture);
    // const pageRows = 65536 / 4096;
    // gl.texSubImage2D(
    //   gl.TEXTURE_2D,
    //   0,
    //   0,
    //   page * pageRows,
    //   SPLAT_PAGED_WIDTH,
    //   pageRows,
    //   gl.RGBA_INTEGER,
    //   gl.UNSIGNED_INT,
    //   packedArray,
    // );
    // renderer.state.bindTexture(gl.TEXTURE_2D, null);
  }

  getPagedTexture(): THREE.DataArrayTexture {
    if (!this.paged) {
      throw new Error("PackedSplats is not paged");
    }
    this.ensurePagedTexture();
    return this.pageCache as THREE.DataArrayTexture;
  }

  // Check if source texture needs to be created/updated
  private maybeUpdateSource(): THREE.DataArrayTexture {
    if (!this.packedArray) {
      throw new Error("No packed splats");
    }

    if (this.needsUpdate || !this.source) {
      this.needsUpdate = false;

      if (this.source) {
        const { width, height, depth } = this.source.image;
        if (this.maxSplats !== width * height * depth) {
          // The existing source texture isn't the right size, so dispose it
          this.source.dispose();
          this.source = null;
        }
      }
      if (!this.source) {
        // Allocate a new source texture of the right size
        const { width, height, depth } = getTextureSize(this.maxSplats);
        this.source = new THREE.DataArrayTexture(
          this.packedArray as Uint32Array<ArrayBuffer>,
          width,
          height,
          depth,
        );
        this.source.format = THREE.RGBAIntegerFormat;
        this.source.type = THREE.UnsignedIntType;
        this.source.internalFormat = "RGBA32UI";
        this.source.needsUpdate = true;
      } else if (this.packedArray.buffer !== this.source.image.data.buffer) {
        // The source texture is the right size, update the data
        this.source.image.data = new Uint8Array(this.packedArray.buffer);
      }
      // Indicate to Three.js that the source texture needs to be uploaded to the GPU
      this.source.needsUpdate = true;
    }
    return this.source;
  }

  static getEmptyArray = (() => {
    const { width, height, depth, maxSplats } = getTextureSize(1);
    const emptyArray = new Uint32Array(maxSplats * 4);
    const texture = new THREE.DataArrayTexture(
      emptyArray,
      width,
      height,
      depth,
    );
    texture.format = THREE.RGBAIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "RGBA32UI";
    texture.needsUpdate = true;
    return texture;
  })();

  // Get a program and THREE.RawShaderMaterial for a given GsplatGenerator,
  // generating it if necessary and caching the result.
  prepareProgramMaterial(generator: GsplatGenerator): {
    program: DynoProgram;
    material: THREE.RawShaderMaterial;
  } {
    let program = PackedSplats.generatorProgram.get(generator);
    if (!program) {
      // A Gsplat needs to be turned into a packed uvec4 for the dyno graph
      const graph = dynoBlock(
        { index: "int" },
        {},
        ({ index }, _outputs, { roots }) => {
          generator.inputs.index = index;
          const gsplat = generator.outputs.gsplat;
          const output = outputPackedSplat(
            gsplat,
            this.dynoRgbMinMaxLnScaleMinMax,
          );
          roots.push(output);
          return undefined;
        },
      );
      if (!PackedSplats.programTemplate) {
        PackedSplats.programTemplate = new DynoProgramTemplate(
          computeUvec4Template,
        );
      }
      // Create a program from the template and graph
      program = new DynoProgram({
        graph,
        inputs: { index: "index" },
        outputs: { output: "target" },
        template: PackedSplats.programTemplate,
      });
      Object.assign(program.uniforms, {
        targetLayer: { value: 0 },
        targetBase: { value: 0 },
        targetCount: { value: 0 },
      });
      PackedSplats.generatorProgram.set(generator, program);
    }

    // Prepare and update our material we'll use to render the Gsplats
    const material = program.prepareMaterial();
    PackedSplats.fullScreenQuad.material = material;
    return { program, material };
  }

  private saveRenderState(renderer: THREE.WebGLRenderer) {
    return {
      target: renderer.getRenderTarget(),
      xrEnabled: renderer.xr.enabled,
      autoClear: renderer.autoClear,
    };
  }

  private resetRenderState(
    renderer: THREE.WebGLRenderer,
    state: {
      target: THREE.WebGLRenderTarget | null;
      xrEnabled: boolean;
      autoClear: boolean;
    },
  ) {
    renderer.setRenderTarget(state.target);
    renderer.xr.enabled = state.xrEnabled;
    renderer.autoClear = state.autoClear;
  }

  // Executes a dyno program specified by generator which is any DynoBlock that
  // maps { index: "int" } to { gsplat: Gsplat }. This is called in
  // SparkRenderer.updateInternal() to re-generate Gsplats in the scene for
  // SplatGenerator instances whose version is newer than what was generated
  // for it last time.
  generate({
    generator,
    base,
    count,
    renderer,
  }: {
    generator: GsplatGenerator;
    base: number;
    count: number;
    renderer: THREE.WebGLRenderer;
  }): { nextBase: number } {
    if (!this.target) {
      throw new Error("Target must be initialized with ensureSplats");
    }
    if (base + count > this.maxSplats) {
      throw new Error("Base + count exceeds maxSplats");
    }

    const { program, material } = this.prepareProgramMaterial(generator);
    program.update();

    const renderState = this.saveRenderState(renderer);

    // Generate the Gsplats in "layer" chunks, in horizontal row ranges,
    // that cover the total count of Gsplats.
    const nextBase =
      Math.ceil((base + count) / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    const layerSize = SPLAT_TEX_WIDTH * SPLAT_TEX_HEIGHT;
    material.uniforms.targetBase.value = base;
    material.uniforms.targetCount.value = count;

    // Keep generating layers until we've reached the next generation's base
    while (base < nextBase) {
      const layer = Math.floor(base / layerSize);
      material.uniforms.targetLayer.value = layer;

      const layerBase = layer * layerSize;
      const layerYStart = Math.floor((base - layerBase) / SPLAT_TEX_WIDTH);
      const layerYEnd = Math.min(
        SPLAT_TEX_HEIGHT,
        Math.ceil((nextBase - layerBase) / SPLAT_TEX_WIDTH),
      );

      // Render the desired portion of the layer
      this.target.scissor.set(
        0,
        layerYStart,
        SPLAT_TEX_WIDTH,
        layerYEnd - layerYStart,
      );
      renderer.setRenderTarget(this.target, layer);
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      PackedSplats.fullScreenQuad.render(renderer);

      base += SPLAT_TEX_WIDTH * (layerYEnd - layerYStart);
    }

    this.resetRenderState(renderer, renderState);
    return { nextBase };
  }

  disposeLodSplats() {
    if (this.lodSplats) {
      this.lodSplats.dispose();
      this.lodSplats = undefined;
    }
  }

  disposeBoneSplats() {
    if (this.boneSplats) {
      this.boneSplats.dispose();
      this.boneSplats = undefined;
    }
  }

  async createLodSplats({ rgbaArray }: { rgbaArray?: RgbaArray } = {}) {
    const lodBase =
      typeof this.lod === "number"
        ? Math.max(1.1, Math.min(2.0, this.lod))
        : 1.5;
    const packedArray = (this.packedArray as Uint32Array).slice();
    const rgba = rgbaArray ? (await rgbaArray.read()).slice() : undefined;
    const extra = {
      sh1: this.extra.sh1 ? (this.extra.sh1 as Uint32Array).slice() : undefined,
      sh2: this.extra.sh2 ? (this.extra.sh2 as Uint32Array).slice() : undefined,
      sh3: this.extra.sh3 ? (this.extra.sh3 as Uint32Array).slice() : undefined,
    };
    const decoded = await workerPool.withWorker(async (worker) => {
      return (await worker.call("quickLod", {
        numSplats: this.numSplats,
        packedArray,
        extra,
        lodBase,
        rgba,
      })) as {
        numSplats: number;
        packedArray: Uint32Array;
        extra: Record<string, unknown>;
        splatEncoding: SplatEncoding;
      };
    });

    const lodSplats = new PackedSplats(decoded);
    if (this.lodSplats) {
      this.lodSplats.dispose();
    }

    this.lodSplats = lodSplats;
    this.nonLod = true;
    if (!this.lod) {
      this.lod = lodBase;
    }
  }

  static programTemplate: DynoProgramTemplate | null = null;

  // Cache for GsplatGenerator programs
  static generatorProgram = new Map<GsplatGenerator, DynoProgram>();

  // Static full-screen quad for pseudo-compute shader rendering
  static fullScreenQuad = new FullScreenQuad(
    new THREE.RawShaderMaterial({ visible: false }),
  );

  static emptyUint32x4 = (() => {
    const { width, height, depth, maxSplats } = getTextureSize(1);
    const emptyArray = new Uint32Array(maxSplats * 4);
    const texture = new THREE.DataArrayTexture(
      emptyArray,
      width,
      height,
      depth,
    );
    texture.format = THREE.RGBAIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "RGBA32UI";
    texture.needsUpdate = true;
    return texture;
  })();

  static emptyUint32x2 = (() => {
    const { width, height, depth, maxSplats } = getTextureSize(1);
    const emptyArray = new Uint32Array(maxSplats * 2);
    const texture = new THREE.DataArrayTexture(
      emptyArray,
      width,
      height,
      depth,
    );
    texture.format = THREE.RGIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "RG32UI";
    texture.needsUpdate = true;
    return texture;
  })();
}

// You can use a PackedSplats as a dyno block using the function
// dyno.readPackedSplats(packedSplats.dyno, dynoIndex) where
// dynoIndex is of type DynoVal<"int">. If you need to be able to change
// the input PackedSplats dynamically, however, you should create a
// DynoPackedSplats, whose property packedSplats you can change to any
// PackedSplats and that will be used in the dyno shader program.

export const dynoPackedSplats = (packedSplats?: PackedSplats) =>
  new DynoPackedSplats({ packedSplats });

export class DynoPackedSplats extends DynoUniform<
  typeof TPackedSplats,
  "packedSplats",
  {
    textureArray: THREE.DataArrayTexture;
    numSplats: number;
    rgbMinMaxLnScaleMinMax: THREE.Vector4;
    flagsPagedLodOpacity: number;
  }
> {
  packedSplats?: PackedSplats;

  constructor({ packedSplats }: { packedSplats?: PackedSplats } = {}) {
    super({
      key: "packedSplats",
      type: TPackedSplats,
      globals: () => [definePackedSplats],
      value: {
        textureArray: PackedSplats.getEmptyArray,
        numSplats: 0,
        rgbMinMaxLnScaleMinMax: new THREE.Vector4(
          0,
          1,
          LN_SCALE_MIN,
          LN_SCALE_MAX,
        ),
        flagsPagedLodOpacity: 0,
      },
      update: (value) => {
        if (this.packedSplats?.paged) {
          value.textureArray =
            this.packedSplats?.getPagedTexture() ?? PackedSplats.getEmptyArray;
          value.flagsPagedLodOpacity = 0x1;
        } else {
          value.textureArray =
            this.packedSplats?.getTexture() ?? PackedSplats.getEmptyArray;
          value.flagsPagedLodOpacity = 0x0;
        }
        value.numSplats = this.packedSplats?.numSplats ?? 0;
        value.rgbMinMaxLnScaleMinMax.set(
          this.packedSplats?.splatEncoding?.rgbMin ?? 0,
          this.packedSplats?.splatEncoding?.rgbMax ?? 1,
          this.packedSplats?.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN,
          this.packedSplats?.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX,
        );
        value.flagsPagedLodOpacity =
          value.flagsPagedLodOpacity |
          (this.packedSplats?.splatEncoding?.lodOpacity ? 0x2 : 0x0);
        return value;
      },
    });
    this.packedSplats = packedSplats;
  }
}

export const defineEvaluateSH1 = unindent(`
  vec3 evaluateSH1(int index, usampler2DArray sh1, vec3 viewDir) {
    // Extract sint7 values packed into 2 x uint32
    uvec2 packed = texelFetch(sh1, splatTexCoord(index), 0).rg;
    vec3 sh1_0 = vec3(ivec3(
      int(packed.x << 25u) >> 25,
      int(packed.x << 18u) >> 25,
      int(packed.x << 11u) >> 25
    )) / 63.0;
    vec3 sh1_1 = vec3(ivec3(
      int(packed.x << 4u) >> 25,
      int((packed.x >> 3u) | (packed.y << 29u)) >> 25,
      int(packed.y << 22u) >> 25
    )) / 63.0;
    vec3 sh1_2 = vec3(ivec3(
      int(packed.y << 15u) >> 25,
      int(packed.y << 8u) >> 25,
      int(packed.y << 1u) >> 25
    )) / 63.0;

    return sh1_0 * (-0.4886025 * viewDir.y)
      + sh1_1 * (0.4886025 * viewDir.z)
      + sh1_2 * (-0.4886025 * viewDir.x);
  }
`);

export const defineEvaluateSH2 = unindent(`
  vec3 evaluateSH2(int index, usampler2DArray sh2, vec3 viewDir) {
    // Extract sint8 values packed into 4 x uint32
    uvec4 packed = texelFetch(sh2, splatTexCoord(index), 0);
    vec3 sh2_0 = vec3(ivec3(
      int(packed.x << 24u) >> 24,
      int(packed.x << 16u) >> 24,
      int(packed.x << 8u) >> 24
    )) / 127.0;
    vec3 sh2_1 = vec3(ivec3(
      int(packed.x) >> 24,
      int(packed.y << 24u) >> 24,
      int(packed.y << 16u) >> 24
    )) / 127.0;
    vec3 sh2_2 = vec3(ivec3(
      int(packed.y << 8u) >> 24,
      int(packed.y) >> 24,
      int(packed.z << 24u) >> 24
    )) / 127.0;
    vec3 sh2_3 = vec3(ivec3(
      int(packed.z << 16u) >> 24,
      int(packed.z << 8u) >> 24,
      int(packed.z) >> 24
    )) / 127.0;
    vec3 sh2_4 = vec3(ivec3(
      int(packed.w << 24u) >> 24,
      int(packed.w << 16u) >> 24,
      int(packed.w << 8u) >> 24
    )) / 127.0;

    return sh2_0 * (1.0925484 * viewDir.x * viewDir.y)
      + sh2_1 * (-1.0925484 * viewDir.y * viewDir.z)
      + sh2_2 * (0.3153915 * (2.0 * viewDir.z * viewDir.z - viewDir.x * viewDir.x - viewDir.y * viewDir.y))
      + sh2_3 * (-1.0925484 * viewDir.x * viewDir.z)
      + sh2_4 * (0.5462742 * (viewDir.x * viewDir.x - viewDir.y * viewDir.y));
  }
`);

export const defineEvaluateSH3 = unindent(`
  vec3 evaluateSH3(int index, usampler2DArray sh3, vec3 viewDir) {
    // Extract sint6 values packed into 4 x uint32
    uvec4 packed = texelFetch(sh3, splatTexCoord(index), 0);
    vec3 sh3_0 = vec3(ivec3(
      int(packed.x << 26u) >> 26,
      int(packed.x << 20u) >> 26,
      int(packed.x << 14u) >> 26
    )) / 31.0;
    vec3 sh3_1 = vec3(ivec3(
      int(packed.x << 8u) >> 26,
      int(packed.x << 2u) >> 26,
      int((packed.x >> 4u) | (packed.y << 28u)) >> 26
    )) / 31.0;
    vec3 sh3_2 = vec3(ivec3(
      int(packed.y << 22u) >> 26,
      int(packed.y << 16u) >> 26,
      int(packed.y << 10u) >> 26
    )) / 31.0;
    vec3 sh3_3 = vec3(ivec3(
      int(packed.y << 4u) >> 26,
      int((packed.y >> 2u) | (packed.z << 30u)) >> 26,
      int(packed.z << 24u) >> 26
    )) / 31.0;
    vec3 sh3_4 = vec3(ivec3(
      int(packed.z << 18u) >> 26,
      int(packed.z << 12u) >> 26,
      int(packed.z << 6u) >> 26
    )) / 31.0;
    vec3 sh3_5 = vec3(ivec3(
      int(packed.z) >> 26,
      int(packed.w << 26u) >> 26,
      int(packed.w << 20u) >> 26
    )) / 31.0;
    vec3 sh3_6 = vec3(ivec3(
      int(packed.w << 14u) >> 26,
      int(packed.w << 8u) >> 26,
      int(packed.w << 2u) >> 26
    )) / 31.0;

    float xx = viewDir.x * viewDir.x;
    float yy = viewDir.y * viewDir.y;
    float zz = viewDir.z * viewDir.z;
    float xy = viewDir.x * viewDir.y;
    float yz = viewDir.y * viewDir.z;
    float zx = viewDir.z * viewDir.x;

    return sh3_0 * (-0.5900436 * viewDir.y * (3.0 * xx - yy))
      + sh3_1 * (2.8906114 * xy * viewDir.z) +
      + sh3_2 * (-0.4570458 * viewDir.y * (4.0 * zz - xx - yy))
      + sh3_3 * (0.3731763 * viewDir.z * (2.0 * zz - 3.0 * xx - 3.0 * yy))
      + sh3_4 * (-0.4570458 * viewDir.x * (4.0 * zz - xx - yy))
      + sh3_5 * (1.4453057 * viewDir.z * (xx - yy))
      + sh3_6 * (-0.5900436 * viewDir.x * (xx - 3.0 * yy));
  }
`);

export function evaluateSH({
  index,
  viewDir,
  numSh,
  sh1Texture,
  sh2Texture,
  sh3Texture,
  sh1MidScale,
  sh2MidScale,
  sh3MidScale,
}: {
  index: DynoVal<"int">;
  viewDir: DynoVal<"vec3">;
  numSh: DynoVal<"int">;
  sh1Texture?: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
  sh2Texture?: DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
  sh3Texture?: DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>;
  sh1MidScale: DynoVal<"vec2">;
  sh2MidScale: DynoVal<"vec2">;
  sh3MidScale: DynoVal<"vec2">;
}) {
  return new Dyno({
    inTypes: {
      index: "int",
      viewDir: "vec3",
      numSh: "int",
      sh1Texture: "usampler2DArray",
      sh2Texture: "usampler2DArray",
      sh3Texture: "usampler2DArray",
      sh1MidScale: "vec2",
      sh2MidScale: "vec2",
      sh3MidScale: "vec2",
    },
    outTypes: { rgb: "vec3" },
    inputs: {
      index,
      viewDir,
      numSh,
      sh1Texture:
        sh1Texture ?? dynoConst("usampler2DArray", PackedSplats.emptyUint32x2),
      sh2Texture:
        sh2Texture ?? dynoConst("usampler2DArray", PackedSplats.emptyUint32x4),
      sh3Texture:
        sh3Texture ?? dynoConst("usampler2DArray", PackedSplats.emptyUint32x4),
      sh1MidScale,
      sh2MidScale,
      sh3MidScale,
    },
    globals: () => [defineEvaluateSH1, defineEvaluateSH2, defineEvaluateSH3],
    statements: ({ inputs, outputs }) =>
      unindentLines(`
      vec3 rgb = vec3(0.0);
      if (${inputs.numSh} >= 1) {
        vec3 sh1Rgb = evaluateSH1(${inputs.index}, ${inputs.sh1Texture}, ${inputs.viewDir});
        rgb += sh1Rgb * ${inputs.sh1MidScale}.y + ${inputs.sh1MidScale}.x;

        if (${inputs.numSh} >= 2) {
          vec3 sh2Rgb = evaluateSH2(${inputs.index}, ${inputs.sh2Texture}, ${inputs.viewDir});
          rgb += sh2Rgb * ${inputs.sh2MidScale}.y + ${inputs.sh2MidScale}.x;

          if (${inputs.numSh} >= 3) {
            vec3 sh3Rgb = evaluateSH3(${inputs.index}, ${inputs.sh3Texture}, ${inputs.viewDir});
            rgb += sh3Rgb * ${inputs.sh3MidScale}.y + ${inputs.sh3MidScale}.x;
          }
        }
      }
      ${outputs.rgb} = rgb;
    `),
  }).outputs;
}
