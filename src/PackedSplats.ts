import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import type { GsplatGenerator } from "./SplatGenerator";
import { type SplatFileType, SplatLoader, unpackSplats } from "./SplatLoader";
import {
  LN_SCALE_MAX,
  LN_SCALE_MIN,
  SPLAT_TEX_HEIGHT,
  SPLAT_TEX_WIDTH,
} from "./defines";
import {
  DynoProgram,
  DynoProgramTemplate,
  DynoUniform,
  DynoVec2,
  DynoVec4,
  dynoBlock,
  outputPackedSplat,
} from "./dyno";
import { TPackedSplats, definePackedSplats } from "./dyno/splats";
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
  // Additional splat data, such as spherical harmonics components (sh1, sh2, sh3). (default: {})
  extra?: Record<string, unknown>;
  // Override the default splat encoding ranges for the PackedSplats.
  // (default: undefined)
  splatEncoding?: SplatEncoding;
};

// A PackedSplats is a collection of Gaussian splats, packed into a format that
// takes exactly 16 bytes per Gsplat to maximize memory and cache efficiency.
// The center xyz coordinates are encoded as float16 (3 x 2 bytes), scale xyz
// as 3 x uint8 that encode a log scale from e^-12 to e^9, rgba as 4 x uint8,
// and quaternion encoded via axis+angle using 2 x uint8 for octahedral encoding
// of the axis direction and a uint8 to encode rotation amount from 0..Pi.

export class PackedSplats {
  maxSplats = 0;
  numSplats = 0;
  packedArray: Uint32Array | null = null;
  extra: Record<string, unknown>;
  splatEncoding?: SplatEncoding;

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
  dynoSh1MinMax: DynoUniform<"vec2", "sh1MinMax">;
  dynoSh2MinMax: DynoUniform<"vec2", "sh2MinMax">;
  dynoSh3MinMax: DynoUniform<"vec2", "sh3MinMax">;

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
    this.dynoSh1MinMax = new DynoVec2({
      key: "sh1MinMax",
      value: new THREE.Vector2(-1, 1),
      update: (value) => {
        value.set(
          this.splatEncoding?.sh1Min ?? -1,
          this.splatEncoding?.sh1Max ?? 1,
        );
        return value;
      },
    });
    this.dynoSh2MinMax = new DynoVec2({
      key: "sh2MinMax",
      value: new THREE.Vector2(-1, 1),
      update: (value) => {
        value.set(
          this.splatEncoding?.sh2Min ?? -1,
          this.splatEncoding?.sh2Max ?? 1,
        );
        return value;
      },
    });
    this.dynoSh3MinMax = new DynoVec2({
      key: "sh3MinMax",
      value: new THREE.Vector2(-1, 1),
      update: (value) => {
        value.set(
          this.splatEncoding?.sh3Min ?? -1,
          this.splatEncoding?.sh3Max ?? 1,
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
    this.splatEncoding = options.splatEncoding;

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
    if (options.packedArray) {
      this.packedArray = options.packedArray;
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
    } else {
      this.maxSplats = options.maxSplats ?? 0;
      this.numSplats = 0;
    }
    this.extra = options.extra ?? {};
  }

  async asyncInitialize(options: PackedSplatsOptions) {
    const { url, fileBytes, construct } = options;
    if (url) {
      const loader = new SplatLoader();
      loader.packedSplats = this;
      await loader.loadAsync(url);
    } else if (fileBytes) {
      const unpacked = await unpackSplats({
        input: fileBytes,
        fileType: options.fileType,
        pathOrUrl: options.fileName ?? url,
        splatEncoding: options.splatEncoding ?? DEFAULT_SPLAT_ENCODING,
      });
      this.initialize(unpacked);
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
      // Generation happens in horizontal row chunks, so round up to full width
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

    return PackedSplats.getEmpty();
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
          this.packedArray,
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

  private static emptySource: THREE.DataArrayTexture | null = null;

  // Can be used where you need an uninitialized THREE.DataArrayTexture like
  // a uniform you will update with the result of this.getTexture() later.
  static getEmpty(): THREE.DataArrayTexture {
    if (!PackedSplats.emptySource) {
      const { width, height, depth, maxSplats } = getTextureSize(1);
      const emptyArray = new Uint32Array(maxSplats * 4);
      PackedSplats.emptySource = new THREE.DataArrayTexture(
        emptyArray,
        width,
        height,
        depth,
      );
      PackedSplats.emptySource.format = THREE.RGBAIntegerFormat;
      PackedSplats.emptySource.type = THREE.UnsignedIntType;
      PackedSplats.emptySource.internalFormat = "RGBA32UI";
      PackedSplats.emptySource.needsUpdate = true;
    }
    return PackedSplats.emptySource;
  }

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
        { output: "uvec4" },
        ({ index }) => {
          generator.inputs.index = index;
          const gsplat = generator.outputs.gsplat;
          const output = outputPackedSplat(
            gsplat,
            this.dynoRgbMinMaxLnScaleMinMax,
          );
          return { output };
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
      xrEnabled: renderer.xr.enabled,
      autoClear: renderer.autoClear,
    };
  }

  private resetRenderState(
    renderer: THREE.WebGLRenderer,
    state: {
      xrEnabled: boolean;
      autoClear: boolean;
    },
  ) {
    renderer.setRenderTarget(null);
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

  static programTemplate: DynoProgramTemplate | null = null;

  // Cache for GsplatGenerator programs
  static generatorProgram = new Map<GsplatGenerator, DynoProgram>();

  // Static full-screen quad for pseudo-compute shader rendering
  static fullScreenQuad = new FullScreenQuad(
    new THREE.RawShaderMaterial({ visible: false }),
  );
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
    texture: THREE.DataArrayTexture;
    numSplats: number;
    rgbMinMaxLnScaleMinMax: THREE.Vector4;
  }
> {
  packedSplats?: PackedSplats;

  constructor({ packedSplats }: { packedSplats?: PackedSplats } = {}) {
    super({
      key: "packedSplats",
      type: TPackedSplats,
      globals: () => [definePackedSplats],
      value: {
        texture: PackedSplats.getEmpty(),
        numSplats: 0,
        rgbMinMaxLnScaleMinMax: new THREE.Vector4(
          0,
          1,
          LN_SCALE_MIN,
          LN_SCALE_MAX,
        ),
      },
      update: (value) => {
        value.texture =
          this.packedSplats?.getTexture() ?? PackedSplats.getEmpty();
        value.numSplats = this.packedSplats?.numSplats ?? 0;
        value.rgbMinMaxLnScaleMinMax.set(
          this.packedSplats?.splatEncoding?.rgbMin ?? 0,
          this.packedSplats?.splatEncoding?.rgbMax ?? 1,
          this.packedSplats?.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN,
          this.packedSplats?.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX,
        );
        return value;
      },
    });
    this.packedSplats = packedSplats;
  }
}
