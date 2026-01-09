import { SplatFileType } from './SplatLoader';
import { SplatSource } from './SplatMesh';
import { DynoInt, DynoUniform, DynoVal, Gsplat, TExtSplats } from './dyno';
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
export declare const defineEvaluateExtSH1: string;
export declare const defineEvaluateExtSH12: string;
export declare const defineEvaluateExtSH3: string;
