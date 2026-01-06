import { SplatFileType } from './SplatLoader';
import { SplatSource } from './SplatMesh';
import { DynoInt, DynoUniform, DynoUsampler2DArray, DynoVal, Gsplat, TExtSplats } from './dyno';
import * as THREE from "three";
export type ExtSplatsOptions = {
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    maxSplats?: number;
    extArrays?: [Uint32Array, Uint32Array];
    numSplats?: number;
    construct?: (splats: ExtSplats) => Promise<void> | void;
    onProgress?: (event: ProgressEvent) => void;
    extra?: Record<string, unknown>;
    lod?: boolean | number;
    nonLod?: boolean | "wait";
    lodSplats?: ExtSplats;
};
export declare class ExtSplats implements SplatSource {
    maxSplats: number;
    numSplats: number;
    extArrays: [Uint32Array, Uint32Array];
    extra: Record<string, unknown>;
    maxSh: number;
    lod?: boolean | number;
    nonLod?: boolean | "wait";
    lodSplats?: ExtSplats;
    initialized: Promise<ExtSplats>;
    isInitialized: boolean;
    textures: [THREE.DataArrayTexture, THREE.DataArrayTexture];
    dyno: DynoUniform<typeof TExtSplats, "extSplats">;
    dynoNumSh: DynoInt<"numSh">;
    constructor(options?: ExtSplatsOptions);
    reinitialize(options: ExtSplatsOptions): void;
    initialize(options: ExtSplatsOptions): void;
    asyncInitialize(options: ExtSplatsOptions): Promise<void>;
    dispose(): void;
    prepareFetchSplat(): void;
    getNumSplats(): number;
    hasRgbDir(): boolean;
    getNumSh(): number;
    setMaxSh(maxSh: number): void;
    fetchSplat({ index, viewOrigin, }: {
        index: DynoVal<"int">;
        viewOrigin?: DynoVal<"vec3">;
    }): DynoVal<typeof Gsplat>;
    private ensureShTextures;
    ensureSplats(numSplats: number): [Uint32Array, Uint32Array];
    getSplat(index: number): {
        center: THREE.Vector3;
        scales: THREE.Vector3;
        quaternion: THREE.Quaternion;
        opacity: number;
        color: THREE.Color;
    };
    setSplat(index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color): void;
    pushSplat(center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color): void;
    forEachSplat(callback: (index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => void): void;
    private updateTextures;
    static emptyArray: THREE.DataArrayTexture;
    static emptyTexture: THREE.DataArrayTexture;
    disposeLodSplats(): void;
    static emptyUint32x4: THREE.DataArrayTexture;
}
export declare const dynoExtSplats: (extSplats?: ExtSplats) => DynoExtSplats;
export declare class DynoExtSplats extends DynoUniform<typeof TExtSplats, "extSplats", {
    textureArray1: THREE.DataArrayTexture;
    textureArray2: THREE.DataArrayTexture;
    numSplats: number;
}> {
    extSplats?: ExtSplats;
    constructor({ extSplats }?: {
        extSplats?: ExtSplats;
    });
}
export declare const defineEvaluateSH1: string;
export declare const defineEvaluateSH12: string;
export declare const defineEvaluateSH3: string;
export declare function evaluateSH({ index, viewDir, numSh, sh1Texture, sh2Texture, sh3TextureA, sh3TextureB, }: {
    index: DynoVal<"int">;
    viewDir: DynoVal<"vec3">;
    numSh: DynoVal<"int">;
    sh1Texture?: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
    sh2Texture?: DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
    sh3TextureA?: DynoUsampler2DArray<"sh3a", THREE.DataArrayTexture>;
    sh3TextureB?: DynoUsampler2DArray<"sh3b", THREE.DataArrayTexture>;
}): {
    rgb: DynoVal<"vec3">;
};
