import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RgbaArray } from './RgbaArray';
import { GsplatGenerator } from './SplatGenerator';
import { SplatFileType } from './SplatLoader';
import { SplatSource } from './SplatMesh';
import { DynoInt, DynoProgram, DynoProgramTemplate, DynoUniform, DynoVal } from './dyno';
import { Gsplat, TPackedSplats } from './dyno/splats';
import * as THREE from "three";
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
    lodOpacity?: boolean;
};
export declare const DEFAULT_SPLAT_ENCODING: SplatEncoding;
export type PackedSplatsOptions = {
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    maxSplats?: number;
    packedArray?: Uint32Array;
    numSplats?: number;
    construct?: (splats: PackedSplats) => Promise<void> | void;
    onProgress?: (event: ProgressEvent) => void;
    extra?: Record<string, unknown>;
    splatEncoding?: SplatEncoding;
    lod?: boolean | number;
    nonLod?: boolean | "wait";
    lodSplats?: PackedSplats;
    maxBoneSplats?: number;
    computeBoneWeights?: boolean;
    minBoneOpacity?: number;
    boneSplats?: PackedSplats;
};
export declare class PackedSplats implements SplatSource {
    maxSplats: number;
    numSplats: number;
    packedArray: Uint32Array | null;
    extra: Record<string, unknown>;
    maxSh: number;
    splatEncoding?: SplatEncoding;
    lod?: boolean | number;
    nonLod?: boolean | "wait";
    lodSplats?: PackedSplats;
    maxBoneSplats?: number;
    computeBoneWeights?: boolean;
    minBoneOpacity?: number;
    boneSplats?: PackedSplats;
    initialized: Promise<PackedSplats>;
    isInitialized: boolean;
    target: THREE.WebGLArrayRenderTarget | null;
    source: THREE.DataArrayTexture | null;
    needsUpdate: boolean;
    dyno: DynoUniform<typeof TPackedSplats, "packedSplats">;
    dynoRgbMinMaxLnScaleMinMax: DynoUniform<"vec4", "rgbMinMaxLnScaleMinMax">;
    dynoNumSh: DynoInt<"numSh">;
    dynoSh1MidScale: DynoUniform<"vec2", "sh1MidScale">;
    dynoSh2MidScale: DynoUniform<"vec2", "sh2MidScale">;
    dynoSh3MidScale: DynoUniform<"vec2", "sh3MidScale">;
    constructor(options?: PackedSplatsOptions);
    reinitialize(options: PackedSplatsOptions): void;
    initialize(options: PackedSplatsOptions): void;
    asyncInitialize(options: PackedSplatsOptions): Promise<void>;
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
    ensureSplats(numSplats: number): Uint32Array;
    ensureSplatsSh(level: number, numSplats: number): Uint32Array;
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
    ensureGenerate(maxSplats: number): boolean;
    generateMapping(splatCounts: number[]): {
        maxSplats: number;
        mapping: {
            base: number;
            count: number;
        }[];
    };
    getTexture(): THREE.DataArrayTexture;
    private maybeUpdateSource;
    static getEmptyArray: THREE.DataArrayTexture;
    prepareProgramMaterial(generator: GsplatGenerator): {
        program: DynoProgram;
        material: THREE.RawShaderMaterial;
    };
    private saveRenderState;
    private resetRenderState;
    generate({ generator, base, count, renderer, }: {
        generator: GsplatGenerator;
        base: number;
        count: number;
        renderer: THREE.WebGLRenderer;
    }): {
        nextBase: number;
    };
    disposeLodSplats(): void;
    disposeBoneSplats(): void;
    createLodSplats({ rgbaArray }?: {
        rgbaArray?: RgbaArray;
    }): Promise<void>;
    static programTemplate: DynoProgramTemplate | null;
    static generatorProgram: Map<GsplatGenerator, DynoProgram>;
    static fullScreenQuad: FullScreenQuad;
    static emptyUint32x4: THREE.DataArrayTexture;
    static emptyUint32x2: THREE.DataArrayTexture;
}
export declare const dynoPackedSplats: (packedSplats?: PackedSplats) => DynoPackedSplats;
export declare class DynoPackedSplats extends DynoUniform<typeof TPackedSplats, "packedSplats", {
    textureArray: THREE.DataArrayTexture;
    numSplats: number;
    rgbMinMaxLnScaleMinMax: THREE.Vector4;
    lodOpacity: boolean;
}> {
    packedSplats?: PackedSplats;
    constructor({ packedSplats }?: {
        packedSplats?: PackedSplats;
    });
}
export declare const defineEvalPackedSH1: string;
export declare const defineEvalPackedSH2: string;
export declare const defineEvalPackedSH3: string;
