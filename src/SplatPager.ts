import * as THREE from "three";
import { LN_SCALE_MAX, LN_SCALE_MIN, dyno } from ".";
import { evaluateExtSH } from "./ExtSplats";
import { workerPool } from "./NewSplatWorker";
import {
  DEFAULT_SPLAT_ENCODING,
  type SplatEncoding,
  evaluatePackedSH,
} from "./PackedSplats";
import type { SplatSource } from "./SplatMesh";
import { getTextureSize } from "./utils";

export interface PagedSplatsOptions {
  pager?: SplatPager;
  rootUrl: string;
  requestHeader?: Record<string, string>;
  withCredentials?: boolean;
  maxSh?: number;
}

export class PagedSplats implements SplatSource {
  pager?: SplatPager;
  rootUrl: string;
  requestHeader?: Record<string, string>;
  withCredentials?: boolean;
  numSh: number;
  maxSh: number;

  numSplats: number;
  splatEncoding?: SplatEncoding;

  dynoNumSplats: dyno.DynoInt<"numSplats">;
  dynoIndices: dyno.DynoUsampler2D<"indices", THREE.DataTexture>;
  rgbMinMaxLnScaleMinMax: dyno.DynoVec4<
    THREE.Vector4,
    "rgbMinMaxLnScaleMinMax"
  >;
  lodOpacity: dyno.DynoBool<"lodOpacity">;
  dynoNumSh: dyno.DynoInt<"numSh">;
  sh1MidScale: dyno.DynoUniform<"vec2", "sh1MidScale", THREE.Vector2>;
  sh2MidScale: dyno.DynoUniform<"vec2", "sh2MidScale", THREE.Vector2>;
  sh3MidScale: dyno.DynoUniform<"vec2", "sh3MidScale", THREE.Vector2>;

  constructor(options: PagedSplatsOptions) {
    this.pager = options.pager;
    this.rootUrl = options.rootUrl;
    this.requestHeader = options.requestHeader;
    this.withCredentials = options.withCredentials;
    this.numSh = 0;
    this.maxSh = options.pager?.maxSh ?? 3;

    this.numSplats = 0;

    this.dynoNumSplats = new dyno.DynoInt({ value: 0 });
    this.dynoIndices = new dyno.DynoUsampler2D({
      value: SplatPager.emptyIndicesTexture,
    });

    this.rgbMinMaxLnScaleMinMax = new dyno.DynoVec4({
      value: new THREE.Vector4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX),
    });
    this.lodOpacity = new dyno.DynoBool({
      value: false,
    });

    this.dynoNumSh = new dyno.DynoInt({ value: 0 });
    this.sh1MidScale = new dyno.DynoVec2({
      value: new THREE.Vector2(0, 1),
    });
    this.sh2MidScale = new dyno.DynoVec2({
      value: new THREE.Vector2(0, 1),
    });
    this.sh3MidScale = new dyno.DynoVec2({
      value: new THREE.Vector2(0, 1),
    });
  }

  dispose() {
    this.dynoIndices.value.dispose();
    this.dynoIndices.value = SplatPager.emptyIndicesTexture;
  }

  setMaxSh(maxSh: number) {
    this.maxSh = maxSh;
  }

  chunkUrl(chunk: number): string {
    return this.rootUrl.replace(/-lod-0\./, `-lod-${chunk}.`);
  }

  async fetchDecodeChunk(chunk: number) {
    const url = this.chunkUrl(chunk);
    const request = new Request(url, {
      headers: this.requestHeader ? new Headers(this.requestHeader) : undefined,
      credentials: this.withCredentials ? "include" : "same-origin",
    });
    const response = await fetch(request);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch "${url}": ${response.status} ${response.statusText}`,
      );
    }
    const fileBytes = new Uint8Array(await response.arrayBuffer());

    return await workerPool.withWorker(async (worker) => {
      if (!this.pager) {
        throw new Error("PagedSplats.pager not set");
      }
      if (!this.pager.extSplats) {
        const result = (await worker.call("loadPackedSplats", {
          fileBytes,
          pathName: url,
        })) as { lodSplats: PackedResult };
        const lodSplats = result.lodSplats;
        if (!this.splatEncoding) {
          this.splatEncoding = lodSplats.splatEncoding;

          this.numSh = lodSplats.extra.sh3
            ? 3
            : lodSplats.extra.sh2
              ? 2
              : lodSplats.extra.sh1
                ? 1
                : 0;

          this.rgbMinMaxLnScaleMinMax.value.set(
            this.splatEncoding.rgbMin ?? 0.0,
            this.splatEncoding.rgbMax ?? 1.0,
            this.splatEncoding.lnScaleMin ?? LN_SCALE_MIN,
            this.splatEncoding.lnScaleMax ?? LN_SCALE_MAX,
          );

          this.lodOpacity.value = this.splatEncoding.lodOpacity ?? false;

          this.sh1MidScale.value.set(
            0.5 *
              ((this.splatEncoding.sh1Max ?? 1.0) +
                (this.splatEncoding.sh1Min ?? -1.0)),
            0.5 *
              ((this.splatEncoding.sh1Max ?? 1.0) -
                (this.splatEncoding.sh1Min ?? -1.0)),
          );
          this.sh2MidScale.value.set(
            0.5 *
              ((this.splatEncoding.sh2Max ?? 1.0) +
                (this.splatEncoding.sh2Min ?? -1.0)),
            0.5 *
              ((this.splatEncoding.sh2Max ?? 1.0) -
                (this.splatEncoding.sh2Min ?? -1.0)),
          );
          this.sh3MidScale.value.set(
            0.5 *
              ((this.splatEncoding.sh3Max ?? 1.0) +
                (this.splatEncoding.sh3Min ?? -1.0)),
            0.5 *
              ((this.splatEncoding.sh3Max ?? 1.0) -
                (this.splatEncoding.sh3Min ?? -1.0)),
          );
        }
        return lodSplats;
      }

      const result = (await worker.call("loadExtSplats", {
        fileBytes,
        pathName: url,
      })) as { lodSplats: ExtResult };
      const lodSplats = result.lodSplats;
      if (!this.splatEncoding) {
        this.splatEncoding = DEFAULT_SPLAT_ENCODING;
        this.numSh =
          lodSplats.extra.sh3a && lodSplats.extra.sh3b
            ? 3
            : lodSplats.extra.sh2
              ? 2
              : lodSplats.extra.sh1
                ? 1
                : 0;
      }
      return lodSplats;
    });
  }

  update(numSplats: number, indices: Uint32Array) {
    if (!this.pager) {
      throw new Error("PagedSplats.pager not set");
    }

    const renderer = this.pager.renderer;
    this.numSplats = numSplats;
    this.dynoNumSplats.value = this.numSplats;
    const rows = Math.ceil(numSplats / 16384);

    let indicesTexture =
      this.dynoIndices.value === SplatPager.emptyIndicesTexture
        ? undefined
        : this.dynoIndices.value;
    if (indicesTexture && rows > indicesTexture.image.height) {
      indicesTexture.dispose();
      indicesTexture = undefined;
    }

    if (!indicesTexture) {
      indicesTexture = new THREE.DataTexture(
        indices,
        4096,
        rows,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
      );
      indicesTexture.internalFormat = "RGBA32UI";
      indicesTexture.needsUpdate = true;
      renderer.initTexture(indicesTexture);
      this.dynoIndices.value = indicesTexture;
    } else {
      const gl = renderer.getContext() as WebGL2RenderingContext;

      renderer.state.activeTexture(gl.TEXTURE0);
      renderer.state.bindTexture(
        gl.TEXTURE_2D,
        getGlTexture(renderer, indicesTexture),
      );
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        4096,
        rows,
        gl.RGBA_INTEGER,
        gl.UNSIGNED_INT,
        indices,
      );
      renderer.state.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  prepareFetchSplat() {}

  getNumSplats(): number {
    return this.numSplats;
  }

  hasRgbDir(): boolean {
    if (!this.pager) {
      return false;
    }
    return Math.min(this.numSh, this.pager.maxSh) > 0;
  }

  getNumSh(): number {
    return this.numSh;
  }

  fetchSplat({
    index,
    viewOrigin,
  }: {
    index: dyno.DynoVal<"int">;
    viewOrigin?: dyno.DynoVal<"vec3">;
  }): dyno.DynoVal<typeof dyno.Gsplat> {
    if (!this.pager) {
      throw new Error("PagedSplats.pager not set");
    }

    const splatIndex = this.pager.readIndex.apply({
      index,
      numSplats: this.dynoNumSplats,
      indices: this.dynoIndices,
    }).index;

    if (!this.pager.extSplats) {
      if (this.hasRgbDir() && viewOrigin) {
        this.dynoNumSh.value = Math.min(
          this.numSh,
          this.maxSh,
          this.pager.maxSh,
        );
        return this.pager.readSplatDir.apply({
          index: splatIndex,
          rgbMinMaxLnScaleMinMax: this.rgbMinMaxLnScaleMinMax,
          lodOpacity: this.lodOpacity,
          viewOrigin,
          numSh: this.dynoNumSh,
          sh1MidScale: this.sh1MidScale,
          sh2MidScale: this.sh2MidScale,
          sh3MidScale: this.sh3MidScale,
        }).gsplat;
      }
      return this.pager.readSplat.apply({
        index: splatIndex,
        rgbMinMaxLnScaleMinMax: this.rgbMinMaxLnScaleMinMax,
        lodOpacity: this.lodOpacity,
      }).gsplat;
    }

    if (this.hasRgbDir() && viewOrigin) {
      this.dynoNumSh.value = Math.min(this.numSh, this.maxSh, this.pager.maxSh);
      return this.pager.readSplatExtDir.apply({
        index: splatIndex,
        viewOrigin,
        numSh: this.dynoNumSh,
      }).gsplat;
    }
    return this.pager.readSplatExt.apply({ index: splatIndex }).gsplat;
  }
}

export type PackedResult = {
  numSplats: number;
  packedArray: Uint32Array;
  extra: Record<string, unknown>;
  splatEncoding: SplatEncoding;
};

export type ExtResult = {
  numSplats: number;
  extArrays: [Uint32Array, Uint32Array];
  extra: Record<string, unknown>;
};

export interface SplatPagerOptions {
  /**
   * THREE.WebGLRenderer instance to upload texture data
   */
  renderer: THREE.WebGLRenderer;
  /**
   * Whether to use extended Gsplat encoding for paged splats.
   * @default false
   */
  extSplats?: boolean;
  /**
   * Maximum size of splat page pool
   * @default 65536 * 256 = 16777216
   */
  maxSplats?: number;
  /**
   * Maximum number of spherical harmonics to keep
   * @default 3
   */
  maxSh?: number;
  /**
   * Automatically drive page fetching, or poll via drive()
   * @default true
   */
  autoDrive?: boolean;
  /**
   * Number of parallel chunk fetchers
   * @default 3
   */
  numFetchers?: number;
}

export class SplatPager {
  renderer: THREE.WebGLRenderer;

  extSplats: boolean;
  maxPages: number;
  maxSplats: number;
  pageSplats: number;

  maxSh: number;
  curSh: number;

  autoDrive: boolean;
  numFetchers: number;

  splatsChunkToPage: Map<
    PagedSplats,
    ({ page: number; lru: number } | undefined)[]
  > = new Map();
  pageToSplatsChunk: ({ splats: PagedSplats; chunk: number } | undefined)[] =
    [];
  pageFreelist: number[];
  pageLru: Set<{ page: number; lru: number }>;
  freeablePages: number[];
  newUploads: {
    page: number;
    numSplats: number;
    packedArray: Uint32Array;
    extArray?: Uint32Array;
    extra: Record<string, unknown>;
  }[];
  readyUploads: {
    page: number;
    numSplats: number;
    packedArray: Uint32Array;
    extArray?: Uint32Array;
    extra: Record<string, unknown>;
  }[];
  lodTreeUpdates: {
    splats: PagedSplats;
    page: number;
    chunk: number;
    numSplats: number;
    lodTree?: Uint32Array;
  }[];

  fetchers: { splats: PagedSplats; chunk: number; promise: Promise<void> }[];
  fetched: {
    splats: PagedSplats;
    chunk: number;
    data: PackedResult | ExtResult;
  }[];
  fetchPriority: { splats: PagedSplats; chunk: number }[];

  packedTexture: dyno.DynoUsampler2DArray<
    "packedTexture",
    THREE.DataArrayTexture
  >;
  extTexture: dyno.DynoUsampler2DArray<"extTexture", THREE.DataArrayTexture>;

  sh1Texture: dyno.DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
  sh2Texture: dyno.DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
  sh3Texture: dyno.DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>;
  sh3TextureB: dyno.DynoUsampler2DArray<"sh3b", THREE.DataArrayTexture>;

  readIndex: dyno.DynoBlock<
    { index: "int"; numSplats: "int"; indices: "usampler2D" },
    { index: "int" }
  >;
  readSplat: dyno.DynoBlock<
    { index: "int"; rgbMinMaxLnScaleMinMax: "vec4"; lodOpacity: "bool" },
    { gsplat: typeof dyno.Gsplat }
  >;
  readSplatExt: dyno.DynoBlock<
    { index: "int" },
    { gsplat: typeof dyno.Gsplat }
  >;
  readSplatDir: dyno.DynoBlock<
    {
      index: "int";
      rgbMinMaxLnScaleMinMax: "vec4";
      lodOpacity: "bool";
      viewOrigin: "vec3";
      numSh: "int";
      sh1MidScale: "vec2";
      sh2MidScale: "vec2";
      sh3MidScale: "vec2";
    },
    { gsplat: typeof dyno.Gsplat }
  >;
  readSplatExtDir: dyno.DynoBlock<
    { index: "int"; viewOrigin: "vec3"; numSh: "int" },
    { gsplat: typeof dyno.Gsplat }
  >;

  constructor(options: SplatPagerOptions) {
    this.renderer = options.renderer;
    this.extSplats = options.extSplats ?? false;

    this.pageSplats = 65536;
    this.maxSplats = options.maxSplats ?? 16777216;
    this.maxPages = Math.ceil(this.maxSplats / this.pageSplats);
    this.maxSplats = this.maxPages * this.pageSplats;

    this.maxSh = options.maxSh ?? 3;
    this.curSh = 0;

    this.autoDrive = options.autoDrive ?? true;
    this.numFetchers = options.numFetchers ?? 3;

    this.splatsChunkToPage = new Map();
    this.pageToSplatsChunk = new Array(this.maxPages);
    this.pageFreelist = Array.from({ length: this.maxPages }, (_, i) => i);
    this.pageLru = new Set();
    this.freeablePages = [];
    this.newUploads = [];
    this.readyUploads = [];
    this.lodTreeUpdates = [];

    this.fetchers = [];
    this.fetched = [];
    this.fetchPriority = [];

    this.packedTexture = new dyno.DynoUsampler2DArray({
      value: this.newUint32ArrayTexture(
        new Uint32Array(this.maxPages * 256 * 256 * 4),
        256,
        256,
        this.maxPages,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      ),
    });
    this.extTexture = new dyno.DynoUsampler2DArray({
      value: this.extSplats
        ? this.newUint32ArrayTexture(
            new Uint32Array(this.maxPages * 256 * 256 * 4),
            256,
            256,
            this.maxPages,
            THREE.RGBAIntegerFormat,
            THREE.UnsignedIntType,
            "RGBA32UI",
          )
        : SplatPager.emptyExtTexture,
    });
    this.sh1Texture = new dyno.DynoUsampler2DArray({
      value: this.extSplats
        ? SplatPager.emptyExtSh1Texture
        : SplatPager.emptySh1Texture,
    });
    this.sh2Texture = new dyno.DynoUsampler2DArray({
      value: this.extSplats
        ? SplatPager.emptyExtSh2Texture
        : SplatPager.emptySh2Texture,
    });
    this.sh3Texture = new dyno.DynoUsampler2DArray({
      value: this.extSplats
        ? SplatPager.emptyExtSh3Texture
        : SplatPager.emptySh3Texture,
    });
    this.sh3TextureB = new dyno.DynoUsampler2DArray({
      value: SplatPager.emptyExtSh3BTexture,
    });

    this.readIndex = dyno.dynoBlock(
      { index: "int", numSplats: "int", indices: "usampler2D" },
      { index: "int" },
      ({ index, numSplats, indices }) => {
        return new dyno.Dyno({
          inTypes: {
            index: "int",
            numSplats: "int",
            indices: "usampler2D",
          },
          outTypes: { index: "int" },
          inputs: {
            index,
            numSplats,
            indices,
          },
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
            if (${inputs.index} >= ${inputs.numSplats}) {
              return;
            }

            ivec2 indexCoord = ivec2((${inputs.index} >> 2) & 4095, ${inputs.index} >> 14);
            uint index = texelFetch(${inputs.indices}, indexCoord, 0)[${inputs.index} & 3];
            ${outputs.index} = int(index);
          `),
        }).outputs;
      },
    );

    this.readSplat = dyno.dynoBlock(
      { index: "int", rgbMinMaxLnScaleMinMax: "vec4", lodOpacity: "bool" },
      { gsplat: dyno.Gsplat },
      ({ index, rgbMinMaxLnScaleMinMax, lodOpacity }) => {
        return new dyno.Dyno({
          inTypes: {
            index: "int",
            packedTexture: "usampler2DArray",
            rgbMinMaxLnScaleMinMax: "vec4",
            lodOpacity: "bool",
          },
          outTypes: { gsplat: dyno.Gsplat },
          inputs: {
            index,
            packedTexture: this.packedTexture,
            rgbMinMaxLnScaleMinMax,
            lodOpacity,
          },
          globals: () => [dyno.defineGsplat],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
            int index = ${inputs.index};
            ivec3 splatCoord = ivec3(index & 255, (index >> 8) & 255, index >> 16);
            uvec4 packed = texelFetch(${inputs.packedTexture}, splatCoord, 0);

            unpackSplatEncoding(packed, ${outputs.gsplat}.center, ${outputs.gsplat}.scales, ${outputs.gsplat}.quaternion, ${outputs.gsplat}.rgba, ${inputs.rgbMinMaxLnScaleMinMax});
            if ((${outputs.gsplat}.rgba.a == 0.0) || all(equal(${outputs.gsplat}.scales, vec3(0.0, 0.0, 0.0)))) {
              return;
            }
            
            ${outputs.gsplat}.flags = GSPLAT_FLAG_ACTIVE;
            if (${inputs.lodOpacity}) {
              ${outputs.gsplat}.rgba.a *= 2.0;
            }
          `),
        }).outputs;
      },
    );

    this.readSplatDir = dyno.dynoBlock(
      {
        index: "int",
        rgbMinMaxLnScaleMinMax: "vec4",
        lodOpacity: "bool",
        viewOrigin: "vec3",
        numSh: "int",
        sh1MidScale: "vec2",
        sh2MidScale: "vec2",
        sh3MidScale: "vec2",
      },
      { gsplat: dyno.Gsplat },
      ({
        index,
        rgbMinMaxLnScaleMinMax,
        lodOpacity,
        viewOrigin,
        numSh,
        sh1MidScale,
        sh2MidScale,
        sh3MidScale,
      }) => {
        if (
          !index ||
          !rgbMinMaxLnScaleMinMax ||
          !lodOpacity ||
          !viewOrigin ||
          !numSh ||
          !sh1MidScale ||
          !sh2MidScale ||
          !sh3MidScale
        ) {
          throw new Error("index and viewOrigin are required");
        }
        let gsplat = this.readSplat.apply({
          index,
          rgbMinMaxLnScaleMinMax,
          lodOpacity,
        }).gsplat;

        const splatCenter = dyno.splitGsplat(gsplat).outputs.center;
        const viewDir = dyno.normalize(dyno.sub(splatCenter, viewOrigin));
        let rgb = evaluatePackedSH({
          index,
          viewDir,
          numSh,
          sh1Texture: this.sh1Texture,
          sh2Texture: this.sh2Texture,
          sh3Texture: this.sh3Texture,
          sh1MidScale,
          sh2MidScale,
          sh3MidScale,
        }).rgb;
        rgb = dyno.add(rgb, dyno.splitGsplat(gsplat).outputs.rgb);
        gsplat = dyno.combineGsplat({ gsplat, rgb });
        return { gsplat };
      },
    );

    this.readSplatExt = dyno.dynoBlock(
      { index: "int" },
      { gsplat: dyno.Gsplat },
      ({ index }) => {
        return new dyno.Dyno({
          inTypes: {
            index: "int",
            extTexture1: "usampler2DArray",
            extTexture2: "usampler2DArray",
          },
          outTypes: { gsplat: dyno.Gsplat },
          inputs: {
            index,
            extTexture1: this.packedTexture,
            extTexture2: this.extTexture,
          },
          globals: () => [dyno.defineGsplat],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
            int index = ${inputs.index};
            ivec3 splatCoord = ivec3(index & 255, (index >> 8) & 255, index >> 16);
            uvec4 ext1 = texelFetch(${inputs.extTexture1}, splatCoord, 0);
            float alpha = unpackSplatExtAlpha(ext1);
            if (alpha == 0.0) {
              return;
            }

            uvec4 ext2 = texelFetch(${inputs.extTexture2}, splatCoord, 0);
            unpackSplatExt(ext1, ext2, ${outputs.gsplat}.center, ${outputs.gsplat}.scales, ${outputs.gsplat}.quaternion, ${outputs.gsplat}.rgba);
            if (all(equal(${outputs.gsplat}.scales, vec3(0.0, 0.0, 0.0)))) {
              return;
            }
            
            ${outputs.gsplat}.flags = GSPLAT_FLAG_ACTIVE;
          `),
        }).outputs;
      },
    );

    this.readSplatExtDir = dyno.dynoBlock(
      {
        index: "int",
        viewOrigin: "vec3",
        numSh: "int",
      },
      { gsplat: dyno.Gsplat },
      ({ index, viewOrigin, numSh }) => {
        if (!index || !viewOrigin || !numSh) {
          throw new Error("index and viewOrigin are required");
        }
        let gsplat = this.readSplatExt.apply({ index }).gsplat;

        const splatCenter = dyno.splitGsplat(gsplat).outputs.center;
        const viewDir = dyno.normalize(dyno.sub(splatCenter, viewOrigin));
        let rgb = evaluateExtSH({
          index,
          viewDir,
          numSh,
          sh1Texture: this.sh1Texture,
          sh2Texture: this.sh2Texture,
          sh3TextureA: this.sh3Texture,
          sh3TextureB: this.sh3TextureB,
        }).rgb;
        rgb = dyno.add(rgb, dyno.splitGsplat(gsplat).outputs.rgb);
        gsplat = dyno.combineGsplat({ gsplat, rgb });
        return { gsplat };
      },
    );
  }

  dispose() {
    this.autoDrive = false;
    this.numFetchers = 0;

    this.packedTexture.value.dispose();
    if (this.extTexture.value !== SplatPager.emptyExtTexture) {
      this.extTexture.value.dispose();
    }

    if (!this.extSplats) {
      if (this.sh1Texture.value !== SplatPager.emptySh1Texture) {
        this.sh1Texture.value.dispose();
      }
      if (this.sh2Texture.value !== SplatPager.emptySh2Texture) {
        this.sh2Texture.value.dispose();
      }
      if (this.sh3Texture.value !== SplatPager.emptySh3Texture) {
        this.sh3Texture.value.dispose();
      }
    } else {
      if (this.sh1Texture.value !== SplatPager.emptyExtSh1Texture) {
        this.sh1Texture.value.dispose();
      }
      if (this.sh2Texture.value !== SplatPager.emptyExtSh2Texture) {
        this.sh2Texture.value.dispose();
      }
      if (this.sh3Texture.value !== SplatPager.emptyExtSh3Texture) {
        this.sh3Texture.value.dispose();
      }
      if (this.sh3TextureB.value !== SplatPager.emptyExtSh3BTexture) {
        this.sh3TextureB.value.dispose();
      }
    }
  }

  private ensureShTextures(numSh: number) {
    this.curSh = Math.max(this.curSh, numSh);
    if (!this.extSplats) {
      if (
        this.curSh >= 1 &&
        this.sh1Texture.value === SplatPager.emptySh1Texture
      ) {
        this.sh1Texture.value = this.newUint32ArrayTexture(
          new Uint32Array(this.maxPages * 256 * 256 * 2),
          256,
          256,
          this.maxPages,
          THREE.RGIntegerFormat,
          THREE.UnsignedIntType,
          "RG32UI",
        );
      }
    } else {
      if (
        this.curSh >= 1 &&
        this.sh1Texture.value === SplatPager.emptyExtSh1Texture
      ) {
        this.sh1Texture.value = this.newUint32ArrayTexture(
          new Uint32Array(this.maxPages * 256 * 256 * 4),
          256,
          256,
          this.maxPages,
          THREE.RGBAIntegerFormat,
          THREE.UnsignedIntType,
          "RGBA32UI",
        );
      }
    }
    if (
      this.curSh >= 2 &&
      this.sh2Texture.value ===
        (!this.extSplats
          ? SplatPager.emptySh2Texture
          : SplatPager.emptyExtSh2Texture)
    ) {
      this.sh2Texture.value = this.newUint32ArrayTexture(
        new Uint32Array(this.maxPages * 256 * 256 * 4),
        256,
        256,
        this.maxPages,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
        "RGBA32UI",
      );
    }
    if (!this.extSplats) {
      if (
        this.curSh >= 3 &&
        this.sh3Texture.value === SplatPager.emptySh3Texture
      ) {
        this.sh3Texture.value = this.newUint32ArrayTexture(
          new Uint32Array(this.maxPages * 256 * 256 * 4),
          256,
          256,
          this.maxPages,
          THREE.RGBAIntegerFormat,
          THREE.UnsignedIntType,
          "RGBA32UI",
        );
      }
    } else {
      if (this.curSh >= 3) {
        if (this.sh3Texture.value === SplatPager.emptyExtSh3Texture) {
          this.sh3Texture.value = this.newUint32ArrayTexture(
            new Uint32Array(this.maxPages * 256 * 256 * 4),
            256,
            256,
            this.maxPages,
            THREE.RGBAIntegerFormat,
            THREE.UnsignedIntType,
            "RGBA32UI",
          );
        }
        if (this.sh3TextureB.value === SplatPager.emptyExtSh3BTexture) {
          this.sh3TextureB.value = this.newUint32ArrayTexture(
            new Uint32Array(this.maxPages * 256 * 256 * 4),
            256,
            256,
            this.maxPages,
            THREE.RGBAIntegerFormat,
            THREE.UnsignedIntType,
            "RGBA32UI",
          );
        }
      }
    }
  }

  private allocatePage(): number | undefined {
    return this.pageFreelist.shift();
  }

  private freePage(page: number) {
    this.pageFreelist.push(page);
  }

  getSplatsChunk(splats: PagedSplats, chunk: number) {
    const chunks = this.splatsChunkToPage.get(splats);
    if (!chunks) {
      return undefined;
    }
    return chunks[chunk];
  }

  private insertSplatsChunkPage(
    splats: PagedSplats,
    chunk: number,
    page: number,
    now: number,
  ) {
    if (!this.splatsChunkToPage.has(splats)) {
      this.splatsChunkToPage.set(splats, []);
    }
    const chunks = this.splatsChunkToPage.get(splats);
    if (!chunks) {
      throw new Error("impossible");
    }
    if (chunk >= chunks.length) {
      chunks.length = chunk + 1;
    }
    const pageLru = { page, lru: now };
    chunks[chunk] = pageLru;
    this.pageLru.add(pageLru);

    this.pageToSplatsChunk[page] = { splats, chunk };
    return this.pageToSplatsChunk[page];
  }

  private removeSplatsChunkPage(
    splats: PagedSplats,
    chunk: number,
    page: number,
  ) {
    const chunks = this.splatsChunkToPage.get(splats);
    if (!chunks) {
      throw new Error("impossible");
    }

    const pageLru = chunks[chunk];
    if (!pageLru) {
      throw new Error(
        `pageLru not found for splats: ${splats}, chunk: ${chunk}, page: ${page}`,
      );
    }
    this.pageLru.delete(pageLru);

    chunks[chunk] = undefined;

    while (chunks.length > 0 && chunks[chunks.length - 1] === undefined) {
      chunks.pop();
    }
    if (chunks.length === 0) {
      this.splatsChunkToPage.delete(splats);
    }

    this.pageToSplatsChunk[page] = undefined;
    while (
      this.pageToSplatsChunk.length > 0 &&
      this.pageToSplatsChunk[this.pageToSplatsChunk.length - 1] === undefined
    ) {
      this.pageToSplatsChunk.pop();
    }
  }

  private uploadPage(
    page: number,
    packedArray: Uint32Array,
    extra: Record<string, unknown>,
    extArray?: Uint32Array,
  ) {
    const pageBase = page * this.pageSplats;

    // const gl = this.renderer.getContext() as WebGL2RenderingContext;

    // this.renderer.state.activeTexture(gl.TEXTURE0);
    // this.renderer.state.bindTexture(
    //   gl.TEXTURE_2D_ARRAY,
    //   this.getGlTexture(this.packedTexture.value),
    // );
    // gl.texSubImage3D(
    //   gl.TEXTURE_2D_ARRAY,
    //   0,
    //   0,
    //   0,
    //   page,
    //   256,
    //   256,
    //   1,
    //   gl.RGBA_INTEGER,
    //   gl.UNSIGNED_INT,
    //   packedArray,
    // );

    const array = this.packedTexture.value.image.data;
    array
      .subarray(pageBase * 4, pageBase * 4 + packedArray.length)
      .set(packedArray);
    this.packedTexture.value.addLayerUpdate(page);
    this.packedTexture.value.needsUpdate = true;

    if (extArray) {
      const array = this.extTexture.value.image.data;
      array
        .subarray(pageBase * 4, pageBase * 4 + extArray.length)
        .set(extArray);
      this.extTexture.value.addLayerUpdate(page);
      this.extTexture.value.needsUpdate = true;
    }

    const numSh = extra.sh3 ? 3 : extra.sh2 ? 2 : extra.sh1 ? 1 : 0;
    this.ensureShTextures(numSh);

    if (!this.extSplats) {
      if (this.sh1Texture.value !== SplatPager.emptySh1Texture && extra.sh1) {
        // this.renderer.state.bindTexture(
        //   gl.TEXTURE_2D_ARRAY,
        //   this.getGlTexture(this.sh1Texture.value),
        // );
        // gl.texSubImage3D(
        //   gl.TEXTURE_2D_ARRAY,
        //   0,
        //   0,
        //   0,
        //   page,
        //   256,
        //   256,
        //   1,
        //   gl.RG_INTEGER,
        //   gl.UNSIGNED_INT,
        //   extra.sh1 as Uint32Array<ArrayBuffer>,
        // );
        const sh1 = extra.sh1 as Uint32Array<ArrayBuffer>;
        const array = this.sh1Texture.value.image.data;
        array.subarray(pageBase * 2, pageBase * 2 + sh1.length).set(sh1);
        this.sh1Texture.value.addLayerUpdate(page);
        this.sh1Texture.value.needsUpdate = true;
      }
    } else {
      if (
        this.sh1Texture.value !== SplatPager.emptyExtSh1Texture &&
        extra.sh1
      ) {
        const sh1 = extra.sh1 as Uint32Array<ArrayBuffer>;
        const array = this.sh1Texture.value.image.data;
        array.subarray(pageBase * 4, pageBase * 4 + sh1.length).set(sh1);
        this.sh1Texture.value.addLayerUpdate(page);
        this.sh1Texture.value.needsUpdate = true;
      }
    }

    if (this.sh2Texture.value !== SplatPager.emptySh2Texture && extra.sh2) {
      // this.renderer.state.bindTexture(
      //   gl.TEXTURE_2D_ARRAY,
      //   this.getGlTexture(this.sh2Texture.value),
      // );
      // gl.texSubImage3D(
      //   gl.TEXTURE_2D_ARRAY,
      //   0,
      //   0,
      //   0,
      //   page,
      //   256,
      //   256,
      //   1,
      //   gl.RGBA_INTEGER,
      //   gl.UNSIGNED_INT,
      //   extra.sh2 as Uint32Array<ArrayBuffer>,
      // );
      const sh2 = extra.sh2 as Uint32Array<ArrayBuffer>;
      const array = this.sh2Texture.value.image.data;
      array.subarray(pageBase * 4, pageBase * 4 + sh2.length).set(sh2);
      this.sh2Texture.value.addLayerUpdate(page);
      this.sh2Texture.value.needsUpdate = true;
    }

    if (!this.extSplats) {
      if (this.sh3Texture.value !== SplatPager.emptySh3Texture && extra.sh3) {
        // this.renderer.state.bindTexture(
        //   gl.TEXTURE_2D_ARRAY,
        //   this.getGlTexture(this.sh3Texture.value),
        // );
        // gl.texSubImage3D(
        //   gl.TEXTURE_2D_ARRAY,
        //   0,
        //   0,
        //   0,
        //   page,
        //   256,
        //   256,
        //   1,
        //   gl.RGBA_INTEGER,
        //   gl.UNSIGNED_INT,
        //   extra.sh3 as Uint32Array<ArrayBuffer>,
        // );
        const sh3 = extra.sh3 as Uint32Array<ArrayBuffer>;
        const array = this.sh3Texture.value.image.data;
        array.subarray(pageBase * 4, pageBase * 4 + sh3.length).set(sh3);
        this.sh3Texture.value.addLayerUpdate(page);
        this.sh3Texture.value.needsUpdate = true;
        // console.log("*** uploaded sh3Texture", sh3.length, pageBase);
      }
    } else {
      if (
        this.sh3Texture.value !== SplatPager.emptyExtSh3Texture &&
        extra.sh3a
      ) {
        const sh3a = extra.sh3a as Uint32Array<ArrayBuffer>;
        const array = this.sh3Texture.value.image.data;
        array.subarray(pageBase * 4, pageBase * 4 + sh3a.length).set(sh3a);
        this.sh3Texture.value.addLayerUpdate(page);
        this.sh3Texture.value.needsUpdate = true;
      }
      if (
        this.sh3TextureB.value !== SplatPager.emptyExtSh3BTexture &&
        extra.sh3b
      ) {
        const sh3b = extra.sh3b as Uint32Array<ArrayBuffer>;
        const array = this.sh3TextureB.value.image.data;
        array.subarray(pageBase * 4, pageBase * 4 + sh3b.length).set(sh3b);
        this.sh3TextureB.value.addLayerUpdate(page);
        this.sh3TextureB.value.needsUpdate = true;
      }
    }

    // this.renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }

  private getGlTexture(texture: THREE.Texture): WebGLTexture {
    return getGlTexture(this.renderer, texture);
  }

  private newUint32ArrayTexture(
    data: Uint32Array<ArrayBuffer> | null,
    width: number,
    height: number,
    depth: number,
    format: THREE.AnyPixelFormat,
    type: THREE.TextureDataType,
    internalFormat: THREE.PixelFormatGPU,
  ): THREE.DataArrayTexture {
    const texture = new THREE.DataArrayTexture(data, width, height, depth);
    texture.format = format;
    texture.type = type;
    texture.internalFormat = internalFormat;
    texture.needsUpdate = true;
    this.renderer.initTexture(texture);
    return texture;
  }

  driveFetchers() {
    const needed = [];
    const overflow = [];
    let numPages = 0;

    for (const { splats, chunk } of this.fetchPriority) {
      const pageLru = this.getSplatsChunk(splats, chunk);
      if (pageLru) {
        if (numPages >= this.maxPages) {
          overflow.push(pageLru);
        } else {
          needed.push(pageLru);
        }
        numPages += 1;
        continue;
      }

      if (
        this.fetched.some(
          ({ splats: s, chunk: c }) => splats === s && chunk === c,
        ) ||
        this.fetchers.some(
          ({ splats: s, chunk: c }) => splats === s && chunk === c,
        )
      ) {
        numPages += 1;
        continue;
      }

      if (numPages < this.maxPages && this.fetchers.length < this.numFetchers) {
        numPages += 1;
        const promise = splats.fetchDecodeChunk(chunk).then((data) => {
          // Place data in ready queue and remove self from active fetchers list
          this.fetched.push({ splats, chunk, data });
          this.fetchers = this.fetchers.filter(
            ({ splats: s, chunk: c }) => splats !== s || chunk !== c,
          );
          this.processFetched();
        });
        // Add self to active fetchers list
        this.fetchers.push({ splats, chunk, promise });

        promise.then((data) => {
          if (this.autoDrive) {
            this.driveFetchers();
          }
        });
      }
    }

    // Update LRU ordering in reverse priority order
    const now = performance.now();

    for (const pageLru of overflow.reverse()) {
      pageLru.lru = now;
      this.pageLru.delete(pageLru);
      this.pageLru.add(pageLru);
    }

    // Create set of pages not needed
    const extraPages = new Set(this.pageLru);
    for (const pageLru of needed.reverse()) {
      extraPages.delete(pageLru);

      pageLru.lru = now;
      this.pageLru.delete(pageLru);
      this.pageLru.add(pageLru);
    }
    this.freeablePages = Array.from(extraPages).map(({ page }) => page);
  }

  private allocateFreeable(): number | undefined {
    const page = this.freeablePages.shift();
    if (page === undefined) {
      // No freeable pages available
      return undefined;
    }

    const splatsChunk = this.pageToSplatsChunk[page];
    if (!splatsChunk) {
      throw new Error(`splatsChunk not found for page: ${page}`);
    }

    const { splats, chunk } = splatsChunk;
    this.removeSplatsChunkPage(splats, chunk, page);
    this.lodTreeUpdates.push({
      splats,
      page,
      chunk,
      numSplats: this.pageSplats,
    });
    return page;
  }

  private processFetched() {
    const now = performance.now();
    while (true) {
      const fetched = this.fetched.shift();
      if (!fetched) {
        break;
      }
      const { splats, chunk, data } = fetched;

      let page = this.allocatePage();
      if (page === undefined) {
        page = this.allocateFreeable();
        if (page === undefined) {
          // No pages available, stop for now
          return;
        }
      }

      this.insertSplatsChunkPage(splats, chunk, page, now);
      const { numSplats, extra } = data;
      this.lodTreeUpdates.push({
        splats,
        page,
        chunk,
        numSplats,
        lodTree: extra.lodTree as Uint32Array,
      });

      if (!this.extSplats) {
        const packedArray = (data as PackedResult).packedArray;
        this.newUploads.push({ page, numSplats, packedArray, extra });
      } else {
        const extArrays = (data as ExtResult).extArrays;
        const packedArray = extArrays[0];
        const extArray = extArrays[1];
        this.newUploads.push({ page, numSplats, packedArray, extArray, extra });
      }
    }
  }

  processUploads() {
    while (true) {
      const upload = this.readyUploads.shift();
      if (!upload) {
        break;
      }
      const { page, numSplats, packedArray, extArray, extra } = upload;
      this.uploadPage(page, packedArray, extra, extArray);
    }
  }

  consumeLodTreeUpdates() {
    const updates = this.lodTreeUpdates;
    this.lodTreeUpdates = [];

    this.readyUploads.push(...this.newUploads);
    this.newUploads = [];
    return updates;
  }

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

  static emptyIndicesTexture = (() => {
    const emptyArray = new Uint32Array(4096 * 4);
    const texture = new THREE.DataTexture(emptyArray, 4096, 1);
    texture.format = THREE.RGBAIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "RGBA32UI";
    texture.needsUpdate = true;
    return texture;
  })();

  static emptyPackedTexture = this.emptyUint32x4;
  static emptyExtTexture = this.emptyUint32x4;
  static emptySh1Texture = this.emptyUint32x2;
  static emptySh2Texture = this.emptyUint32x4;
  static emptySh3Texture = this.emptyUint32x4;
  static emptyExtSh1Texture = this.emptyUint32x4;
  static emptyExtSh2Texture = this.emptyUint32x4;
  static emptyExtSh3Texture = this.emptyUint32x4;
  static emptyExtSh3BTexture = this.emptyUint32x4;
}

function getGlTexture(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Texture,
): WebGLTexture {
  if (!renderer.properties.has(texture)) {
    throw new Error("texture not found");
  }
  const props = renderer.properties.get(texture) as {
    __webglTexture: WebGLTexture;
  };
  const glTexture = props.__webglTexture;
  if (!glTexture) {
    throw new Error("texture not found");
  }
  return glTexture;
}
