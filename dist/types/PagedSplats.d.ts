import * as THREE from "three";
import { type PagedSplatsFetcher } from "./PagedSplatsFetcher";
import type { SplatSource } from "./SplatMesh";
import type { SplatPager } from "./SplatPager";
import { type RadMeta, type SplatEncoding, SplatFileType } from "./defines";
import * as dyno from "./dyno";
/**
 * Options for constructing {@link PagedSplats}. At least one source needs to be provided.
 * When multiple sources are given, only one takes effect. Order of precedence:
 *  * {@link PagedSplatsOptions#fileBytes `fileBytes`}
 *  * {@link PagedSplatsOptions#fetchSource `fetchSource`}
 *  * {@link PagedSplatsOptions#rootUrl `rootUrl`}
 */
export interface PagedSplatsOptions {
    pager?: SplatPager;
    /**
     * The root URL to fetch the paged splats from. Chunks are expected
     * to be relative to this URL.
     */
    rootUrl?: string;
    /**
     * Additional headers to set when making fetch requests.
     * @note Only relevant when using a {@link PagedSplatsOptions#rootUrl `rootUrl`}.
     */
    requestHeader?: Record<string, string>;
    /**
     * Whether credentials should be sent when making fetch requests.
     * @note Only relevant when using a {@link PagedSplatsOptions#rootUrl `rootUrl`}.
     */
    withCredentials?: boolean;
    /**
     * Raw bytes of the paged splats file.
     */
    fileBytes?: Uint8Array;
    /**
     * Custom paged splats fetcher to use.
     */
    fetchSource?: PagedSplatsFetcher;
    /**
     * The file type of the paged splats. This is required when using a {@link PagedSplatsOptions#fetchSource `fetchSource`}.
     * In case of {@link PagedSplatsOptions#fileBytes `fileBytes`} or a {@link PagedSplatsOptions#rootUrl `rootUrl`} the file type
     * is optional and will be automatically inferred unless provided.
     */
    fileType?: SplatFileType;
    /**
     * Maximum Spherical Harmonics level to use.
     * @default 3
     */
    maxSh?: number;
}
export declare class PagedSplats implements SplatSource {
    pager?: SplatPager;
    readonly fileType: SplatFileType;
    readonly fetchSource: PagedSplatsFetcher;
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
    readonly dynoNumSplats: dyno.DynoInt<"numSplats">;
    readonly dynoIndices: dyno.DynoUsampler2D<"indices", THREE.DataTexture>;
    readonly rgbMinMaxLnScaleMinMax: dyno.DynoVec4<THREE.Vector4, "rgbMinMaxLnScaleMinMax">;
    readonly lodOpacity: dyno.DynoBool<"lodOpacity">;
    readonly dynoNumSh: dyno.DynoInt<"numSh">;
    readonly shMax: dyno.DynoVec3<THREE.Vector3, "shMax">;
    readonly abortController: AbortController;
    constructor(options: PagedSplatsOptions);
    dispose(): void;
    setMaxSh(maxSh: number): void;
    getRadMeta(): Promise<{
        meta: RadMeta;
        chunksStart: number;
    }>;
    fetchDecodeChunk(chunk: number): Promise<import("./defines").ExtResult | import("./defines").PackedResult>;
    /** Draw nothing until the next update(), keeping the indices texture allocated. */
    clear(): void;
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
    static emptyIndicesTexture: THREE.DataTexture;
}
