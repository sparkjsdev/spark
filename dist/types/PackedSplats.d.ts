import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GsplatGenerator } from './SplatGenerator';
import { SplatFileType } from './SplatLoader';
import { DynoProgram, DynoProgramTemplate, DynoUniform } from './dyno';
import { TPackedSplats } from './dyno/splats';
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
    extra?: Record<string, unknown>;
    splatEncoding?: SplatEncoding;
};
export declare class PackedSplats {
    maxSplats: number;
    numSplats: number;
    packedArray: Uint32Array | null;
    extra: Record<string, unknown>;
    splatEncoding?: SplatEncoding;
    initialized: Promise<PackedSplats>;
    isInitialized: boolean;
    target: THREE.WebGLArrayRenderTarget | null;
    source: THREE.DataArrayTexture | null;
    needsUpdate: boolean;
    dyno: DynoUniform<typeof TPackedSplats, "packedSplats">;
    dynoRgbMinMaxLnScaleMinMax: DynoUniform<"vec4", "rgbMinMaxLnScaleMinMax">;
    dynoSh1MinMax: DynoUniform<"vec2", "sh1MinMax">;
    dynoSh2MinMax: DynoUniform<"vec2", "sh2MinMax">;
    dynoSh3MinMax: DynoUniform<"vec2", "sh3MinMax">;
    constructor(options?: PackedSplatsOptions);
    reinitialize(options: PackedSplatsOptions): void;
    initialize(options: PackedSplatsOptions): void;
    asyncInitialize(options: PackedSplatsOptions): Promise<void>;
    dispose(): void;
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
    private static emptySource;
    static getEmpty(): THREE.DataArrayTexture;
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
    static programTemplate: DynoProgramTemplate | null;
    static generatorProgram: Map<GsplatGenerator, DynoProgram>;
    static fullScreenQuad: FullScreenQuad;
}
export declare const dynoPackedSplats: (packedSplats?: PackedSplats) => DynoPackedSplats;
export declare class DynoPackedSplats extends DynoUniform<typeof TPackedSplats, "packedSplats", {
    texture: THREE.DataArrayTexture;
    numSplats: number;
    rgbMinMaxLnScaleMinMax: THREE.Vector4;
}> {
    packedSplats?: PackedSplats;
    constructor({ packedSplats }?: {
        packedSplats?: PackedSplats;
    });
}
