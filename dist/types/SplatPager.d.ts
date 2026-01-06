import { dyno } from '.';
import { SplatEncoding } from './PackedSplats';
import { SplatSource } from './SplatMesh';
import * as THREE from "three";
export interface PagedSplatsOptions {
    pager?: SplatPager;
    rootUrl: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    maxSh?: number;
}
export declare class PagedSplats implements SplatSource {
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
    rgbMinMaxLnScaleMinMax: dyno.DynoVec4<THREE.Vector4, "rgbMinMaxLnScaleMinMax">;
    lodOpacity: dyno.DynoBool<"lodOpacity">;
    dynoNumSh: dyno.DynoInt<"numSh">;
    sh1MidScale: dyno.DynoUniform<"vec2", "sh1MidScale", THREE.Vector2>;
    sh2MidScale: dyno.DynoUniform<"vec2", "sh2MidScale", THREE.Vector2>;
    sh3MidScale: dyno.DynoUniform<"vec2", "sh3MidScale", THREE.Vector2>;
    constructor(options: PagedSplatsOptions);
    dispose(): void;
    setMaxSh(maxSh: number): void;
    chunkUrl(chunk: number): string;
    fetchDecodeChunk(chunk: number): Promise<PackedResult>;
    update(numSplats: number, indices: Uint32Array): void;
    prepareFetchSplat(): void;
    getNumSplats(): number;
    hasRgbDir(): boolean;
    getNumSh(): number;
    fetchSplat({ index, viewOrigin, }: {
        index: dyno.DynoVal<"int">;
        viewOrigin?: dyno.DynoVal<"vec3">;
    }): dyno.DynoVal<typeof dyno.Gsplat>;
}
export type PackedResult = {
    numSplats: number;
    packedArray: Uint32Array;
    extra: Record<string, unknown>;
    splatEncoding: SplatEncoding;
};
export interface SplatPagerOptions {
    /**
     * THREE.WebGLRenderer instance to upload texture data
     */
    renderer: THREE.WebGLRenderer;
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
    maxPages: number;
    maxSplats: number;
    pageSplats: number;
    maxSh: number;
    curSh: number;
    autoDrive: boolean;
    numFetchers: number;
    splatsChunkToPage: Map<PagedSplats, ({
        page: number;
        lru: number;
    } | undefined)[]>;
    pageToSplatsChunk: ({
        splats: PagedSplats;
        chunk: number;
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
        extra: Record<string, unknown>;
    }[];
    readyUploads: {
        page: number;
        numSplats: number;
        packedArray: Uint32Array;
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
        data: PackedResult;
    }[];
    fetchPriority: {
        splats: PagedSplats;
        chunk: number;
    }[];
    packedTexture: dyno.DynoUsampler2DArray<"packedTexture", THREE.DataArrayTexture>;
    sh1Texture: dyno.DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
    sh2Texture: dyno.DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
    sh3Texture: dyno.DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>;
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
    readSplatDir: dyno.DynoBlock<{
        index: "int";
        rgbMinMaxLnScaleMinMax: "vec4";
        lodOpacity: "bool";
        viewOrigin: "vec3";
        numSh: "int";
        sh1MidScale: "vec2";
        sh2MidScale: "vec2";
        sh3MidScale: "vec2";
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
    static emptySh1Texture: THREE.DataArrayTexture;
    static emptySh2Texture: THREE.DataArrayTexture;
    static emptySh3Texture: THREE.DataArrayTexture;
}
