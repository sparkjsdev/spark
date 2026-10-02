import * as THREE from "three";
import type { SplatSource } from "./SplatMesh";
import type { SplatPager } from "./SplatPager";
import { type RadMeta, type SplatEncoding, SplatFileType } from "./defines";
import * as dyno from "./dyno";
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
    readonly abortController: AbortController;
    constructor(options: PagedSplatsOptions);
    dispose(): void;
    setMaxSh(maxSh: number): void;
    getRadMeta(): Promise<{
        meta: RadMeta;
        chunksStart: number;
    }>;
    chunkUrl(chunk: number): string;
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
