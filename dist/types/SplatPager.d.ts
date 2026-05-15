import { dyno } from '.';
import { SplatSource } from './SplatMesh';
import { ExtResult, PackedResult, RadMeta, SplatEncoding, SplatFileType } from './defines';
import * as THREE from "three";
export interface PagedSplatsOptions {
    pager?: SplatPager;
    rootUrl?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    fileBytes?: Uint8Array;
    fileType?: SplatFileType;
    maxSh?: number;
}
export declare class PagedSplats implements SplatSource {
    pager?: SplatPager;
    rootUrl: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    fileBytes?: Uint8Array;
    fileType?: SplatFileType;
    numSh: number;
    maxSh: number;
    sh1Codes?: Uint32Array;
    sh2Codes?: Uint32Array;
    sh3Codes?: Uint32Array | [Uint32Array, Uint32Array];
    numSplats: number;
    splatEncoding?: SplatEncoding;
    radMetaPromise?: Promise<{
        meta: RadMeta;
        chunksStart: number;
    }>;
    dynoNumSplats: dyno.DynoInt<"numSplats">;
    dynoIndices: dyno.DynoUsampler2D<"indices", THREE.DataTexture>;
    rgbMinMaxLnScaleMinMax: dyno.DynoVec4<THREE.Vector4, "rgbMinMaxLnScaleMinMax">;
    lodOpacity: dyno.DynoBool<"lodOpacity">;
    dynoNumSh: dyno.DynoInt<"numSh">;
    shMax: dyno.DynoVec3<THREE.Vector3, "shMax">;
    constructor(options: PagedSplatsOptions);
    dispose(): void;
    setMaxSh(maxSh: number): void;
    getRadMeta(): Promise<{
        meta: RadMeta;
        chunksStart: number;
    }>;
    chunkUrl(chunk: number): string;
    fetchDecodeChunk(chunk: number): Promise<PackedResult | ExtResult>;
    update(numSplats: number, indices: Uint32Array): void;
    prepareFetchSplat(): void;
    getNumSplats(): number;
    hasRgbDir(): boolean;
    getNumSh(): number;
    fetchSplat({ index, viewOrigin, }: {
        index: dyno.DynoVal<"int">;
        viewOrigin?: dyno.DynoVal<"vec3">;
    }): dyno.DynoVal<typeof dyno.Gsplat>;
    forEachSplat(callback: (index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => void): void;
}
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
export declare class SplatPager {
    renderer: THREE.WebGLRenderer;
    extSplats: boolean;
    maxPages: number;
    maxSplats: number;
    pageSplats: number;
    maxSh: number;
    curSh: number;
    autoDrive: boolean;
    numFetchers: number;
    fetchPause: number;
    splatsChunkToPage: Map<PagedSplats, ({
        page: number;
        lru: number;
    } | undefined)[]>;
    pageToSplatsChunk: ({
        splats: PagedSplats;
        chunk: number;
        time: number;
    } | undefined)[];
    pageFreelist: number[];
    pageLru: Set<{
        page: number;
        lru: number;
    }>;
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
    fetchers: {
        splats: PagedSplats;
        chunk: number;
        promise: Promise<void>;
    }[];
    fetched: {
        splats: PagedSplats;
        chunk: number;
        data: PackedResult | ExtResult;
    }[];
    fetchPriority: {
        splats: PagedSplats;
        chunk: number;
    }[];
    packedTexture: dyno.DynoUsampler2DArray<"packedTexture", THREE.DataArrayTexture>;
    extTexture: dyno.DynoUsampler2DArray<"extTexture", THREE.DataArrayTexture>;
    sh1Texture: dyno.DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
    sh2Texture: dyno.DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
    sh3Texture: dyno.DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>;
    sh3TextureB: dyno.DynoUsampler2DArray<"sh3b", THREE.DataArrayTexture>;
    readIndex: dyno.DynoBlock<{
        index: "int";
        numSplats: "int";
        indices: "usampler2D";
    }, {
        index: "int";
    }>;
    readSplat: dyno.DynoBlock<{
        index: "int";
        rgbMinMaxLnScaleMinMax: "vec4";
        lodOpacity: "bool";
    }, {
        gsplat: typeof dyno.Gsplat;
    }>;
    readSplatExt: dyno.DynoBlock<{
        index: "int";
    }, {
        gsplat: typeof dyno.Gsplat;
    }>;
    readSplatDir: dyno.DynoBlock<{
        index: "int";
        rgbMinMaxLnScaleMinMax: "vec4";
        lodOpacity: "bool";
        viewOrigin: "vec3";
        numSh: "int";
        shMax: "vec3";
    }, {
        gsplat: typeof dyno.Gsplat;
    }>;
    readSplatExtDir: dyno.DynoBlock<{
        index: "int";
        viewOrigin: "vec3";
        numSh: "int";
    }, {
        gsplat: typeof dyno.Gsplat;
    }>;
    constructor(options: SplatPagerOptions);
    dispose(): void;
    private ensureShTextures;
    private allocatePage;
    private freePage;
    getSplatsChunk(splats: PagedSplats, chunk: number): {
        page: number;
        lru: number;
    } | undefined;
    private insertSplatsChunkPage;
    private removeSplatsChunkPage;
    private uploadPage;
    private getGlTexture;
    private newUint32ArrayTexture;
    driveFetchers(): void;
    private allocateFreeable;
    private processFetched;
    processUploads(): void;
    consumeLodTreeUpdates(): {
        splats: PagedSplats;
        page: number;
        chunk: number;
        numSplats: number;
        lodTree?: Uint32Array;
    }[];
    static emptyUint32x4: THREE.DataArrayTexture;
    static emptyUint32x2: THREE.DataArrayTexture;
    static emptyIndicesTexture: THREE.DataTexture;
    static emptyPackedTexture: THREE.DataArrayTexture;
    static emptyExtTexture: THREE.DataArrayTexture;
    static emptySh1Texture: THREE.DataArrayTexture;
    static emptySh2Texture: THREE.DataArrayTexture;
    static emptySh3Texture: THREE.DataArrayTexture;
    static emptyExtSh1Texture: THREE.DataArrayTexture;
    static emptyExtSh2Texture: THREE.DataArrayTexture;
    static emptyExtSh3Texture: THREE.DataArrayTexture;
    static emptyExtSh3BTexture: THREE.DataArrayTexture;
}
