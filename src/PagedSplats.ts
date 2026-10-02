import * as THREE from "three";

import { decode_rad_header } from "spark-rs";
import { getSplatFileType, getSplatFileTypeFromPath } from "./SplatLoader";
import type { SplatSource } from "./SplatMesh";
import type { SplatPager } from "./SplatPager";
import { workerPool } from "./SplatWorker";
import {
  DEFAULT_SPLAT_ENCODING,
  LN_SCALE_MAX,
  LN_SCALE_MIN,
  type RadMeta,
  type SplatEncoding,
  SplatFileType,
} from "./defines";
import * as dyno from "./dyno";
import { decodeExtSplat, unpackSplat, uploadU32DataTextureRows } from "./utils";
import * as wasm from "./wasm";

export interface PagedSplatsOptions {
  pager?: SplatPager;
  rootUrl?: string;
  requestHeader?: Record<string, string>;
  withCredentials?: boolean;
  fileBytes?: Uint8Array;
  fetchSource?: FetchSource;
  fileType?: SplatFileType;
  maxSh?: number;
}

export interface FetchSource {
  fetchRange(
    abortSignal: AbortSignal,
    offset: number,
    bytes: number,
  ): Promise<Uint8Array>;
  fetchChunkFile(abortSignal: AbortSignal, chunk: string): Promise<Uint8Array>;
  fetchChunkById(abortSignal: AbortSignal, chunk: number): Promise<Uint8Array>;
}

export class PagedSplats implements SplatSource {
  pager?: SplatPager;
  readonly fileType: SplatFileType;
  readonly fetchSource: FetchSource;

  numSh: number;
  maxSh: number;
  sh1Codes?: Uint32Array;
  sh2Codes?: Uint32Array;
  sh3Codes?: Uint32Array | [Uint32Array, Uint32Array];

  numSplats: number;
  splatEncoding?: SplatEncoding;
  radMetaPromise?: Promise<{ meta: RadMeta; chunksStart: number }>;

  readonly dynoNumSplats: dyno.DynoInt<"numSplats">;
  readonly dynoIndices: dyno.DynoUsampler2D<"indices", THREE.DataTexture>;
  readonly rgbMinMaxLnScaleMinMax: dyno.DynoVec4<
    THREE.Vector4,
    "rgbMinMaxLnScaleMinMax"
  >;
  readonly lodOpacity: dyno.DynoBool<"lodOpacity">;
  readonly dynoNumSh: dyno.DynoInt<"numSh">;
  readonly shMax: dyno.DynoVec3<THREE.Vector3, "shMax">;

  readonly abortController: AbortController = new AbortController();

  constructor(options: PagedSplatsOptions) {
    this.pager = options.pager;
    this.numSh = 0;
    this.maxSh = options.maxSh ?? 3;

    this.numSplats = 0;

    this.dynoNumSplats = new dyno.DynoInt({ value: 0 });
    this.dynoIndices = new dyno.DynoUsampler2D({
      value: PagedSplats.emptyIndicesTexture,
    });

    this.rgbMinMaxLnScaleMinMax = new dyno.DynoVec4({
      value: new THREE.Vector4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX),
    });
    this.lodOpacity = new dyno.DynoBool({
      value: false,
    });

    this.dynoNumSh = new dyno.DynoInt({ value: 0 });
    this.shMax = new dyno.DynoVec3({ value: new THREE.Vector3() });

    let fileType = options.fileType;
    if (options.fileBytes) {
      fileType ??= getSplatFileType(options.fileBytes);
      this.fetchSource = new FileBytesFetchSource(options.fileBytes);
    } else if (options.rootUrl) {
      fileType ??= getSplatFileTypeFromPath(options.rootUrl);
      this.fetchSource = new UrlFetchSource(
        options.rootUrl,
        options.requestHeader,
        options.withCredentials,
      );
    } else if (options.fetchSource) {
      this.fetchSource = options.fetchSource;
    } else {
      throw new Error("No url, fileBytes or fetchSource provided");
    }

    if (!fileType) {
      throw new Error("Unable to determine file type");
    }
    this.fileType = fileType;

    if (this.fileType === SplatFileType.RAD) {
      this.radMetaPromise = this.getRadMeta();
    }
  }

  dispose() {
    if (this.dynoIndices.value !== PagedSplats.emptyIndicesTexture) {
      this.dynoIndices.value.dispose();
      this.dynoIndices.value = PagedSplats.emptyIndicesTexture;
    }

    this.abortController.abort();
  }

  setMaxSh(maxSh: number) {
    this.maxSh = maxSh;
  }

  getRadMeta(): Promise<{ meta: RadMeta; chunksStart: number }> {
    if (this.radMetaPromise) {
      return this.radMetaPromise;
    }

    this.radMetaPromise = (async () => {
      await wasm.initialization;

      // We don't know how big the header will be. Most likely 64KB will be enough,
      // but try larger blocks in backoff if it wasn't enough.
      for (const tryBytes of [65536, 256 * 1024, 1024 * 1024]) {
        const bytes = await this.fetchSource.fetchRange(
          this.abortController.signal,
          0,
          tryBytes,
        );
        const metaStart = decode_rad_header(bytes);
        if (metaStart) {
          return metaStart;
        }
        // Skip larger attempts when the current one already returned fewer bytes.
        if (bytes.length < tryBytes) {
          break;
        }
      }
      throw new Error("Failed to decode RAD header");
    })().then((metaStart) => {
      // console.log("RAD meta: ", metaStart.meta);
      return metaStart;
    });

    this.radMetaPromise.catch((error) => {
      console.error(error);
      // Allow it to be tried again
      // this.radMetaPromise = undefined;
    });

    return this.radMetaPromise;
  }

  async fetchDecodeChunk(chunk: number) {
    let decodeBytes = undefined;

    if (this.fileType === SplatFileType.RAD) {
      const { meta, chunksStart } = await this.getRadMeta();
      if (chunk < 0 || chunk >= meta.chunks.length) {
        throw new Error(
          `Chunk index out of range: ${chunk} (max: ${meta.chunks.length - 1})`,
        );
      }
      let { offset, bytes, filename } = meta.chunks[chunk];

      if (filename) {
        decodeBytes = await this.fetchSource.fetchChunkFile(
          this.abortController.signal,
          filename,
        );
      } else {
        offset += chunksStart;
        // console.log(`Fetching chunk ${chunk} at offset ${offset} with bytes ${bytes}`);
        decodeBytes = await this.fetchSource.fetchRange(
          this.abortController.signal,
          offset,
          bytes,
        );
      }
    } else {
      decodeBytes = await this.fetchSource.fetchChunkById(
        this.abortController.signal,
        chunk,
      );
    }

    return await workerPool.withWorker(async (worker) => {
      if (!this.pager) {
        throw new Error("PagedSplats.pager not set");
      }
      if (!this.pager.extSplats) {
        const result = await worker.call("loadPackedSplats", {
          fileBytes: decodeBytes,
          fileType: this.fileType,
          sh1Codes: this.sh1Codes?.slice(),
          sh2Codes: this.sh2Codes?.slice(),
          sh3Codes: (this.sh3Codes as Uint32Array | undefined)?.slice(),
        });
        if (!("lodSplats" in result)) {
          throw new Error("Loaded chunk does not contain LoD splats");
        }

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
            this.splatEncoding.rgbMin,
            this.splatEncoding.rgbMax,
            this.splatEncoding.lnScaleMin,
            this.splatEncoding.lnScaleMax,
          );

          this.lodOpacity.value = this.splatEncoding.lodOpacity;

          this.shMax.value.set(
            this.splatEncoding.sh1Max,
            this.splatEncoding.sh2Max,
            this.splatEncoding.sh3Max,
          );
        }
        this.sh1Codes = lodSplats.extra.sh1Codes ?? this.sh1Codes;
        this.sh2Codes = lodSplats.extra.sh2Codes ?? this.sh2Codes;
        this.sh3Codes = lodSplats.extra.sh3Codes ?? this.sh3Codes;
        return lodSplats;
      }

      const sh3Codes = this.sh3Codes as [Uint32Array, Uint32Array] | undefined;
      const result = await worker.call("loadExtSplats", {
        fileBytes: decodeBytes,
        fileType: this.fileType,
        sh1Codes: this.sh1Codes?.slice(),
        sh2Codes: this.sh2Codes?.slice(),
        sh3Codes: sh3Codes
          ? [sh3Codes[0].slice(), sh3Codes[1].slice()]
          : undefined,
      });
      if (!("lodSplats" in result)) {
        throw new Error("Loaded chunk does not contain LoD splats");
      }
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
      this.sh1Codes = lodSplats.extra.sh1Codes ?? this.sh1Codes;
      this.sh2Codes = lodSplats.extra.sh2Codes ?? this.sh2Codes;
      this.sh3Codes = lodSplats.extra.sh3Codes ?? this.sh3Codes;
      return lodSplats;
    });
  }

  /** Draw nothing until the next update(), keeping the indices texture allocated. */
  clear() {
    this.numSplats = 0;
    this.dynoNumSplats.value = 0;
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
      this.dynoIndices.value === PagedSplats.emptyIndicesTexture
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
      const textureIndices = indicesTexture.image.data as Uint32Array;
      textureIndices.set(indices.subarray(0, numSplats));

      uploadU32DataTextureRows(
        renderer,
        indicesTexture,
        4096,
        rows,
        textureIndices,
      );
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
    return Math.min(this.numSh, this.maxSh, this.pager.maxSh) > 0;
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
          shMax: this.shMax,
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
    if (!this.pager || !this.numSplats) {
      return;
    }
    const extSplats = this.pager.extSplats;
    const indices = this.dynoIndices.value.image.data as Uint32Array;
    const packedSplatArray = this.pager.packedTexture.value.image
      .data as Uint32Array;
    const extPackedSplatArray = this.pager.extTexture.value.image
      .data as Uint32Array;
    const extArrays: [Uint32Array, Uint32Array] = [
      packedSplatArray,
      extPackedSplatArray,
    ];

    for (let i = 0; i < this.numSplats; ++i) {
      const splatIndex = indices[i];
      const unpacked = extSplats
        ? decodeExtSplat(extArrays, splatIndex)
        : unpackSplat(packedSplatArray, splatIndex, this.splatEncoding);
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

  static emptyIndicesTexture = (() => {
    const emptyArray = new Uint32Array(4096 * 4);
    const texture = new THREE.DataTexture(emptyArray, 4096, 1);
    texture.format = THREE.RGBAIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "RGBA32UI";
    texture.needsUpdate = true;
    return texture;
  })();
}

export class FileBytesFetchSource implements FetchSource {
  private readonly fileBytes: Uint8Array;

  constructor(fileBytes: Uint8Array) {
    this.fileBytes = fileBytes;
  }

  async fetchRange(abortSignal: AbortSignal, offset: number, bytes: number) {
    if (offset < 0 || (offset > 0 && offset + bytes > this.fileBytes.length)) {
      throw new Error(
        `Invalid chunk offset or bytes: ${offset} + ${bytes} > ${this.fileBytes.length}`,
      );
    }

    return this.fileBytes.slice(offset, offset + bytes);
  }

  async fetchChunkFile(
    abortSignal: AbortSignal,
    chunk: string,
  ): Promise<Uint8Array> {
    throw new Error("Chunked RAD file not supported with fileBytes");
  }

  async fetchChunkById(
    abortSignal: AbortSignal,
    chunk: number,
  ): Promise<Uint8Array> {
    throw new Error("Chunked RAD file not supported with fileBytes");
  }
}

export class UrlFetchSource implements FetchSource {
  readonly rootUrl: string;
  readonly requestHeader: Record<string, string> | undefined;
  readonly withCredentials: boolean | undefined;

  constructor(
    rootUrl: string,
    requestHeader: Record<string, string> | undefined,
    withCredentials: boolean | undefined,
  ) {
    this.rootUrl = rootUrl;
    this.requestHeader = requestHeader;
    this.withCredentials = withCredentials;
  }

  async fetchRange(abortSignal: AbortSignal, offset: number, bytes: number) {
    return await this.fetchRangeImpl({
      url: this.rootUrl,
      requestHeader: this.requestHeader,
      withCredentials: this.withCredentials,
      signal: abortSignal,
      offset,
      bytes,
    });
  }

  async fetchChunkFile(
    abortSignal: AbortSignal,
    chunk: string,
  ): Promise<Uint8Array> {
    const resolvedRoot = new URL(this.rootUrl, window.location.href).toString();
    const chunkUrl = new URL(chunk, resolvedRoot).toString();
    return await this.fetchRangeImpl({
      url: chunkUrl,
      requestHeader: this.requestHeader,
      withCredentials: this.withCredentials,
      signal: abortSignal,
    });
  }

  async fetchChunkById(
    abortSignal: AbortSignal,
    chunk: number,
  ): Promise<Uint8Array> {
    const chunkUrl = this.rootUrl.replace(/-lod-0\./, `-lod-${chunk}.`);
    return await this.fetchRangeImpl({
      url: chunkUrl,
      requestHeader: this.requestHeader,
      withCredentials: this.withCredentials,
      signal: abortSignal,
    });
  }

  async fetchRangeImpl({
    url,
    requestHeader,
    withCredentials,
    offset,
    bytes,
    signal,
  }: {
    url: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    offset?: number;
    bytes?: number;
    signal?: AbortSignal;
  }): Promise<Uint8Array> {
    const request = new Request(url, {
      headers: requestHeader ? new Headers(requestHeader) : undefined,
      credentials: withCredentials ? "include" : "same-origin",
      signal,
    });
    if (offset !== undefined && bytes !== undefined) {
      request.headers.set("Range", `bytes=${offset}-${offset + bytes - 1}`);
    }
    const response = await fetch(request);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch "${url}": ${response.status} ${response.statusText}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
