import * as THREE from "three";
import { RgbaArray } from "./RgbaArray";
import { GsplatGenerator } from "./SplatGenerator";
import { type SplatFileType, SplatLoader } from "./SplatLoader";
import type { SplatSource } from "./SplatMesh";
import { SPLAT_TEX_WIDTH } from "./defines";
import {
  Dyno,
  DynoInt,
  DynoUniform,
  DynoUsampler2DArray,
  type DynoVal,
  type Gsplat,
  TExtSplats,
  add,
  combineGsplat,
  defineExtSplats,
  dynoConst,
  normalize,
  readExtSplat,
  splitGsplat,
  sub,
  unindent,
  unindentLines,
} from "./dyno";
import { decodeExtSplat, encodeExtSplat, getTextureSize } from "./utils";

export type ExtSplatsOptions = {
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
  // Use provided pair of uint32 arrays, where blocks of 4 uint32s in each,
  // encode an "extended packed" Gsplat. (default: undefined)
  extArrays?: [Uint32Array, Uint32Array];
  // Override number of splats in packed arrays to use only a subset.
  // (default: length of packed array / 4)
  numSplats?: number;
  // Callback function to programmatically create splats at initialization.
  // (default: undefined)
  construct?: (splats: ExtSplats) => Promise<void> | void;
  // Callback function called while downloading and initializing (default: undefined)
  onProgress?: (event: ProgressEvent) => void;
  // Additional splat data, such as spherical harmonics components (sh1, sh2, sh3). (default: {})
  extra?: Record<string, unknown>;
  // Enable LOD. If a number is provided, it will be used as LoD level base,
  // otherwise the default 1.5 is used. When loading a file without pre-computed
  // LoD it will use the "quick lod" algorithm to generate one on-the-fly with
  // the selected LoD level base. (default: undefined=false)
  lod?: boolean | number;
  // Keep the original PackedSplats data before creating LoD version. (default: false)
  nonLod?: boolean | "wait";
  // The LoD version of the ExtSplats
  lodSplats?: ExtSplats;
};

export class ExtSplats implements SplatSource {
  maxSplats = 0;
  numSplats = 0;
  extArrays: [Uint32Array, Uint32Array];
  extra: Record<string, unknown> = {};
  maxSh = 3;
  lod?: boolean | number;
  nonLod?: boolean | "wait";
  lodSplats?: ExtSplats;

  initialized: Promise<ExtSplats>;
  isInitialized = false;

  textures: [THREE.DataArrayTexture, THREE.DataArrayTexture];

  // A PackedSplats can be used in a dyno graph using the below property dyno:
  // const gsplat = dyno.readPackedSplats(this.dyno, dynoIndex);
  dyno: DynoUniform<typeof TExtSplats, "extSplats">;
  dynoNumSh: DynoInt<"numSh">;

  constructor(options: ExtSplatsOptions = {}) {
    this.extArrays = [new Uint32Array(0), new Uint32Array(0)];
    this.textures = [ExtSplats.emptyTexture, ExtSplats.emptyTexture];

    this.extra = {};
    this.dyno = new DynoExtSplats({ extSplats: this });
    this.dynoNumSh = new DynoInt({
      key: "numSh",
      value: 0,
      update: () => {
        return Math.min(this.getNumSh(), this.maxSh);
      },
    });

    // The following line will be overridden by reinitialize()
    this.initialized = Promise.resolve(this);
    this.reinitialize(options);
  }

  reinitialize(options: ExtSplatsOptions) {
    this.isInitialized = false;

    this.extra = {};
    this.maxSplats = options.maxSplats ?? 0;
    this.lod = options.lod;
    this.nonLod = options.nonLod;

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

  initialize(options: ExtSplatsOptions) {
    this.extra = options.extra ?? {};
    this.lodSplats = options.lodSplats;

    if (options.extArrays) {
      this.extArrays = options.extArrays;
      this.maxSplats = Math.floor(
        Math.min(this.extArrays[0].length / 4, this.extArrays[1].length / 4),
      );
      this.numSplats = options.numSplats ?? this.maxSplats;

      // Calculate number of horizontal texture rows that could fit in array.
      // A properly initialized packedArray should already take into account the
      // width and height of the texture and be rounded up with padding.
      this.maxSplats =
        Math.floor(this.maxSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
      this.numSplats = Math.min(
        this.maxSplats,
        options.numSplats ?? Number.POSITIVE_INFINITY,
      );
      this.updateTextures();
    } else {
      this.maxSplats = options.maxSplats ?? 0;
      this.numSplats = 0;
      this.extArrays = [new Uint32Array(0), new Uint32Array(0)];
    }
  }

  async asyncInitialize(options: ExtSplatsOptions) {
    const { url, fileBytes, construct, lod, nonLod } = options;
    this.lod = lod;
    this.nonLod = nonLod;

    const loader = new SplatLoader();
    loader.extSplats = this;
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
    if (this.textures[0] !== ExtSplats.emptyTexture) {
      this.textures[0].dispose();
      this.textures[0] = ExtSplats.emptyTexture;
    }
    if (this.textures[1] !== ExtSplats.emptyTexture) {
      this.textures[1].dispose();
      this.textures[1] = ExtSplats.emptyTexture;
    }
    this.disposeLodSplats();
  }

  prepareFetchSplat() {
    // console.info("ExtSplats.prepareFetchSplat");
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
    let gsplat = readExtSplat(this.dyno, index);

    if (this.hasRgbDir() && viewOrigin) {
      const splatCenter = splitGsplat(gsplat).outputs.center;
      const viewDir = normalize(sub(splatCenter, viewOrigin));
      const { sh1Texture, sh2Texture, sh3TextureA, sh3TextureB } =
        this.ensureShTextures();
      let { rgb } = evaluateSH({
        index,
        viewDir,
        numSh: this.dynoNumSh,
        sh1Texture,
        sh2Texture,
        sh3TextureA,
        sh3TextureB,
      });
      rgb = add(rgb, splitGsplat(gsplat).outputs.rgb);
      gsplat = combineGsplat({ gsplat, rgb });
    }
    return gsplat;
  }

  private ensureShTextures(): {
    sh1Texture?: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
    sh2Texture?: DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
    sh3TextureA?: DynoUsampler2DArray<"sh3a", THREE.DataArrayTexture>;
    sh3TextureB?: DynoUsampler2DArray<"sh3b", THREE.DataArrayTexture>;
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
        sh1.length / 4,
      );
      if (sh1.length < maxSplats * 4) {
        const newSh1 = new Uint32Array(maxSplats * 4);
        newSh1.set(sh1);
        this.extra.sh1 = newSh1;
        sh1 = newSh1;
      }
      const texture = newUint32ArrayTexture(
        sh1,
        width,
        height,
        depth,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      );
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

      const texture = newUint32ArrayTexture(
        sh2,
        width,
        height,
        depth,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      );
      sh2Texture = new DynoUsampler2DArray({
        value: texture,
        key: "sh2",
      });
      this.extra.sh2Texture = sh2Texture;
    }

    if (!this.extra.sh3a || !this.extra.sh3b) {
      return { sh1Texture, sh2Texture };
    }

    let sh3TextureA = this.extra.sh3TextureA as
      | DynoUsampler2DArray<"sh3a", THREE.DataArrayTexture>
      | undefined;
    if (!sh3TextureA) {
      let sh3a = this.extra.sh3a as Uint32Array<ArrayBuffer>;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh3a.length / 4,
      );
      if (sh3a.length < maxSplats * 4) {
        const newSh3 = new Uint32Array(maxSplats * 4);
        newSh3.set(sh3a);
        this.extra.sh3a = newSh3;
        sh3a = newSh3;
      }

      const texture = newUint32ArrayTexture(
        sh3a,
        width,
        height,
        depth,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      );
      sh3TextureA = new DynoUsampler2DArray({
        value: texture,
        key: "sh3a",
      });
      this.extra.sh3TextureA = sh3TextureA;
    }

    let sh3TextureB = this.extra.sh3TextureB as
      | DynoUsampler2DArray<"sh3b", THREE.DataArrayTexture>
      | undefined;
    if (!sh3TextureB) {
      let sh3b = this.extra.sh3b as Uint32Array<ArrayBuffer>;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh3b.length / 4,
      );
      if (sh3b.length < maxSplats * 4) {
        const newSh3b = new Uint32Array(maxSplats * 4);
        newSh3b.set(sh3b);
        this.extra.sh3b = newSh3b;
        sh3b = newSh3b;
      }

      const texture = newUint32ArrayTexture(
        sh3b,
        width,
        height,
        depth,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      );
      sh3TextureB = new DynoUsampler2DArray({
        value: texture,
        key: "sh3b",
      });
      this.extra.sh3TextureB = sh3TextureB;
    }

    return { sh1Texture, sh2Texture, sh3TextureA, sh3TextureB };
  }

  // Ensures that this.extArrays can fit numSplats Gsplats. If it's too small,
  // resize exponentially and copy over the original data.
  //
  // Typically you don't need to call this, because calling this.setSplat(index, ...)
  // and this.pushSplat(...) will automatically call ensureSplats() so we have
  // enough splats.
  ensureSplats(numSplats: number): [Uint32Array, Uint32Array] {
    const targetSize =
      numSplats <= this.maxSplats
        ? this.maxSplats
        : // Grow exponentially to avoid frequent reallocations
          Math.max(numSplats, 2 * this.maxSplats);
    const currentSize = !this.extArrays[0] ? 0 : this.extArrays[0].length / 4;

    if (!this.extArrays[0] || targetSize > currentSize) {
      this.maxSplats = getTextureSize(targetSize).maxSplats;
      const newArray0 = new Uint32Array(this.maxSplats * 4);
      const newArray1 = new Uint32Array(this.maxSplats * 4);
      if (this.extArrays[0]) {
        // Copy over existing data
        newArray0.set(this.extArrays[0]);
        newArray1.set(this.extArrays[1]);
      }
      this.extArrays[0] = newArray0;
      this.extArrays[1] = newArray1;
    }
    return this.extArrays;
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
    if (index >= this.numSplats) {
      throw new Error("Invalid index");
    }
    return decodeExtSplat(this.extArrays, index);
  }

  // Set all ExtSplat components at index with the provided Gsplat attributes
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
    const extArrays = this.ensureSplats(index + 1);
    encodeExtSplat(
      extArrays,
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
    const extArrays = this.ensureSplats(this.numSplats + 1);
    encodeExtSplat(
      extArrays,
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
    if (!this.numSplats) {
      return;
    }
    for (let i = 0; i < this.numSplats; ++i) {
      const unpacked = decodeExtSplat(this.extArrays, i);
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

  // Check if source texture needs to be created/updated
  private updateTextures() {
    if (this.textures[0] !== ExtSplats.emptyTexture) {
      const { width, height, depth } = this.textures[0].image;
      if (this.maxSplats !== width * height * depth) {
        // The existing source texture isn't the right size, so dispose it
        this.textures[0].dispose();
        this.textures[0] = ExtSplats.emptyTexture;
        this.textures[1].dispose();
        this.textures[1] = ExtSplats.emptyTexture;
      }
    }
    if (this.textures[0] === ExtSplats.emptyTexture) {
      // Allocate a new source texture of the right size
      const { width, height, depth } = getTextureSize(this.maxSplats);
      this.textures[0] = newUint32ArrayTexture(
        this.extArrays[0],
        width,
        height,
        depth,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      );
      this.textures[1] = newUint32ArrayTexture(
        this.extArrays[1],
        width,
        height,
        depth,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      );
    } else if (
      this.extArrays[0].buffer !== this.textures[0].image.data.buffer
    ) {
      this.textures[0].image.data = new Uint8Array(this.extArrays[0].buffer);
      this.textures[1].image.data = new Uint8Array(this.extArrays[1].buffer);
      // Indicate to Three.js that the source textures needs to be uploaded to the GPU
      this.textures[0].needsUpdate = true;
      this.textures[1].needsUpdate = true;
    }
  }

  static emptyArray = (() => {
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

  static emptyTexture = newUint32ArrayTexture(
    null,
    1,
    1,
    1,
    THREE.RGBAIntegerFormat,
    THREE.UnsignedIntType,
    "RGBA32UI",
  );

  disposeLodSplats() {
    if (this.lodSplats) {
      this.lodSplats.dispose();
      this.lodSplats = undefined;
    }
  }

  // async createLodSplats({ rgbaArray }: { rgbaArray?: RgbaArray } = {}) {
  //   const lodBase =
  //     typeof this.lod === "number"
  //       ? Math.max(1.1, Math.min(2.0, this.lod))
  //       : 1.5;
  //   const packedArray = (this.packedArray as Uint32Array).slice();
  //   const rgba = rgbaArray ? (await rgbaArray.read()).slice() : undefined;
  //   const extra = {
  //     sh1: this.extra.sh1 ? (this.extra.sh1 as Uint32Array).slice() : undefined,
  //     sh2: this.extra.sh2 ? (this.extra.sh2 as Uint32Array).slice() : undefined,
  //     sh3: this.extra.sh3 ? (this.extra.sh3 as Uint32Array).slice() : undefined,
  //   };
  //   const decoded = await workerPool.withWorker(async (worker) => {
  //     return (await worker.call("quickLod", {
  //       numSplats: this.numSplats,
  //       packedArray,
  //       extra,
  //       lodBase,
  //       rgba,
  //     })) as {
  //       numSplats: number;
  //       packedArray: Uint32Array;
  //       extra: Record<string, unknown>;
  //       splatEncoding: SplatEncoding;
  //     };
  //   });
  //   // console.log("=> createLodSplats: decoded =", decoded);

  //   const lodSplats = new PackedSplats(decoded);
  //   if (this.lodSplats) {
  //     this.lodSplats.dispose();
  //   }

  //   this.lodSplats = lodSplats;
  //   this.nonLod = true;
  //   if (!this.lod) {
  //     this.lod = lodBase;
  //   }
  //   // console.log("=> createLodSplats: this =", this);
  // }

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
}

export const dynoExtSplats = (extSplats?: ExtSplats) =>
  new DynoExtSplats({ extSplats });

export class DynoExtSplats extends DynoUniform<
  typeof TExtSplats,
  "extSplats",
  {
    textureArray1: THREE.DataArrayTexture;
    textureArray2: THREE.DataArrayTexture;
    numSplats: number;
  }
> {
  extSplats?: ExtSplats;

  constructor({ extSplats }: { extSplats?: ExtSplats } = {}) {
    super({
      key: "extSplats",
      type: TExtSplats,
      globals: () => [defineExtSplats],
      value: {
        textureArray1: ExtSplats.emptyTexture,
        textureArray2: ExtSplats.emptyTexture,
        numSplats: 0,
      },
      update: (value) => {
        value.textureArray1 =
          this.extSplats?.textures[0] ?? ExtSplats.emptyTexture;
        value.textureArray2 =
          this.extSplats?.textures[1] ?? ExtSplats.emptyTexture;
        value.numSplats = this.extSplats?.numSplats ?? 0;
        return value;
      },
    });
    this.extSplats = extSplats;
  }
}

export const defineEvaluateSH1 = unindent(`
  vec3 evaluateSH1(ivec3 coord, usampler2DArray sh1, vec3 viewDir) {
    uvec4 packed = texelFetch(sh1, coord, 0);
    vec3 sh1_0 = decodeExtRgb(packed.x);
    vec3 sh1_1 = decodeExtRgb(packed.y);
    vec3 sh1_2 = decodeExtRgb(packed.z);

    return sh1_0 * (-0.4886025 * viewDir.y)
      + sh1_1 * (0.4886025 * viewDir.z)
      + sh1_2 * (-0.4886025 * viewDir.x);
  }
`);

export const defineEvaluateSH12 = unindent(`
  vec3 evaluateSH12(ivec3 coord, usampler2DArray sh1, usampler2DArray sh2, vec3 viewDir) {
    uvec4 packed1 = texelFetch(sh1, coord, 0);
    uvec4 packed2 = texelFetch(sh2, coord, 0);

    vec3 sh1_0 = decodeExtRgb(packed1.x);
    vec3 sh1_1 = decodeExtRgb(packed1.y);
    vec3 sh1_2 = decodeExtRgb(packed1.z);

    vec3 sh2_0 = decodeExtRgb(packed1.w);
    vec3 sh2_1 = decodeExtRgb(packed2.x);
    vec3 sh2_2 = decodeExtRgb(packed2.y);
    vec3 sh2_3 = decodeExtRgb(packed2.z);
    vec3 sh2_4 = decodeExtRgb(packed2.w);

    vec3 sh1Rgb = sh1_0 * (-0.4886025 * viewDir.y)
      + sh1_1 * (0.4886025 * viewDir.z)
      + sh1_2 * (-0.4886025 * viewDir.x);

    vec3 sh2Rgb = sh2_0 * (1.0925484 * viewDir.x * viewDir.y)
      + sh2_1 * (-1.0925484 * viewDir.y * viewDir.z)
      + sh2_2 * (0.3153915 * (2.0 * viewDir.z * viewDir.z - viewDir.x * viewDir.x - viewDir.y * viewDir.y))
      + sh2_3 * (-1.0925484 * viewDir.x * viewDir.z)
      + sh2_4 * (0.5462742 * (viewDir.x * viewDir.x - viewDir.y * viewDir.y));

    return sh1Rgb + sh2Rgb;
  }
`);

export const defineEvaluateSH3 = unindent(`
  vec3 evaluateSH3(ivec3 coord, usampler2DArray sh3A, usampler2DArray sh3B, vec3 viewDir) {
    uvec4 packedA = texelFetch(sh3A, coord, 0);
    uvec4 packedB = texelFetch(sh3B, coord, 0);

    vec3 sh3_0 = decodeExtRgb(packedA.x);
    vec3 sh3_1 = decodeExtRgb(packedA.y);
    vec3 sh3_2 = decodeExtRgb(packedA.z);
    vec3 sh3_3 = decodeExtRgb(packedA.w);
    vec3 sh3_4 = decodeExtRgb(packedB.x);
    vec3 sh3_5 = decodeExtRgb(packedB.y);
    vec3 sh3_6 = decodeExtRgb(packedB.z);

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
  sh3TextureA,
  sh3TextureB,
}: {
  index: DynoVal<"int">;
  viewDir: DynoVal<"vec3">;
  numSh: DynoVal<"int">;
  sh1Texture?: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
  sh2Texture?: DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
  sh3TextureA?: DynoUsampler2DArray<"sh3a", THREE.DataArrayTexture>;
  sh3TextureB?: DynoUsampler2DArray<"sh3b", THREE.DataArrayTexture>;
}) {
  return new Dyno({
    inTypes: {
      index: "int",
      viewDir: "vec3",
      numSh: "int",
      sh1Texture: "usampler2DArray",
      sh2Texture: "usampler2DArray",
      sh3TextureA: "usampler2DArray",
      sh3TextureB: "usampler2DArray",
    },
    outTypes: { rgb: "vec3" },
    inputs: {
      index,
      viewDir,
      numSh,
      sh1Texture:
        sh1Texture ?? dynoConst("usampler2DArray", ExtSplats.emptyUint32x4),
      sh2Texture:
        sh2Texture ?? dynoConst("usampler2DArray", ExtSplats.emptyUint32x4),
      sh3TextureA:
        sh3TextureA ?? dynoConst("usampler2DArray", ExtSplats.emptyUint32x4),
      sh3TextureB:
        sh3TextureB ?? dynoConst("usampler2DArray", ExtSplats.emptyUint32x4),
    },
    globals: () => [defineEvaluateSH1, defineEvaluateSH12, defineEvaluateSH3],
    statements: ({ inputs, outputs }) =>
      unindentLines(`
      vec3 rgb = vec3(0.0);
      ivec3 coord = splatTexCoord(${inputs.index});
      if (${inputs.numSh} >= 2) {
        rgb = evaluateSH12(coord, ${inputs.sh1Texture}, ${inputs.sh2Texture}, ${inputs.viewDir});

        if (${inputs.numSh} >= 3) {
          rgb += evaluateSH3(coord, ${inputs.sh3TextureA}, ${inputs.sh3TextureB}, ${inputs.viewDir});
        }
      } else if (${inputs.numSh} == 1) {
        rgb = evaluateSH1(coord, ${inputs.sh1Texture}, ${inputs.viewDir});
      }
      ${outputs.rgb} = rgb;
    `),
  }).outputs;
}

function newUint32ArrayTexture(
  data: Uint32Array | null,
  width: number,
  height: number,
  depth: number,
  format: THREE.AnyPixelFormat,
  type: THREE.TextureDataType,
  internalFormat: THREE.PixelFormatGPU,
): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(
    data as Uint32Array<ArrayBuffer>,
    width,
    height,
    depth,
  );
  texture.format = format;
  texture.type = type;
  texture.internalFormat = internalFormat;
  texture.needsUpdate = true;
  return texture;
}
