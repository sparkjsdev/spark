import * as THREE from "three";
import type { PagedSplats } from "./PagedSplats";
import * as dyno from "./dyno";
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
    /**
     * Called after each chunk fetch attempt settles (success or failure);
     * a render is needed to page in the chunk or retry.
     */
    onUpdate: () => void;
}
export declare class SplatPager {
    readonly renderer: THREE.WebGLRenderer;
    readonly extSplats: boolean;
    readonly maxPages: number;
    readonly maxSplats: number;
    readonly pageSplats: number;
    readonly maxSh: number;
    curSh: number;
    autoDrive: boolean;
    numFetchers: number;
    onUpdate?: () => void;
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
    private readonly pageFreelist;
    private readonly pageLru;
    private freeablePages;
    private newUploads;
    private readonly readyUploads;
    lodTreeUpdates: {
        splats: PagedSplats;
        page: number;
        chunk: number;
        numSplats: number;
        lodTree?: Uint32Array;
    }[];
    private readonly fetchers;
    private readonly fetched;
    fetchPriority: {
        splats: PagedSplats;
        chunk: number;
    }[];
    packedTexture: dyno.DynoUsampler2DArray<"packedTexture", THREE.DataArrayTexture>;
    extTexture: dyno.DynoUsampler2DArray<"extTexture", THREE.DataArrayTexture>;
    readonly shTextures: [
        dyno.DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>,
        dyno.DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>,
        dyno.DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>,
        dyno.DynoUsampler2DArray<"sh3b", THREE.DataArrayTexture>
    ];
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
    getSplatsChunk(splats: PagedSplats, chunk: number): {
        page: number;
        lru: number;
    } | undefined;
    private insertSplatsChunkPage;
    private removeSplatsChunkPage;
    removeSplats(splats: PagedSplats): void;
    private uploadPage;
    private newUint32ArrayTexture;
    driveFetchers(): void;
    private allocateFreeable;
    private processFetched;
    processUploads(): void;
    /** True while chunk requests are in flight. */
    isFetching(): boolean;
    /**
     * True while fetched chunks, uploads, or tree updates wait for Spark to
     * consume them. Uploads already handed to Spark (flushed by its next LoD
     * traverse via processUploads) are not counted.
     */
    hasQueued(): boolean;
    /** True while chunks are being fetched or are waiting to be paged in. */
    isPending(): boolean;
    consumeLodTreeUpdates(): {
        splats: PagedSplats;
        page: number;
        chunk: number;
        numSplats: number;
        lodTree?: Uint32Array;
    }[];
    static emptyUint32x4: THREE.DataArrayTexture;
    static emptyUint32x2: THREE.DataArrayTexture;
    static emptyPackedTexture: THREE.DataArrayTexture;
    static emptyExtTexture: THREE.DataArrayTexture;
    static emptyShTextures: readonly [THREE.DataArrayTexture, THREE.DataArrayTexture, THREE.DataArrayTexture];
    static emptyExtShTextures: readonly [THREE.DataArrayTexture, THREE.DataArrayTexture, THREE.DataArrayTexture, THREE.DataArrayTexture];
}
