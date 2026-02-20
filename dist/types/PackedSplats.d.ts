import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RgbaArray } from './RgbaArray';
import { GsplatGenerator } from './SplatGenerator';
import { SplatSource } from './SplatMesh';
import { SplatEncoding, SplatFileType } from './defines';
import { DynoInt, DynoProgram, DynoProgramTemplate, DynoUniform, DynoUsampler2DArray, DynoVal, DynoVec3 } from './dyno';
import { Gsplat, TPackedSplats } from './dyno/splats';
import * as THREE from "three";
export type PackedSplatsOptions = {
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    stream?: ReadableStream;
    streamLength?: number;
    maxSplats?: number;
    packedArray?: Uint32Array;
    numSplats?: number;
    construct?: (splats: PackedSplats) => Promise<void> | void;
    onProgress?: (event: ProgressEvent) => void;
    extra?: Record<string, unknown>;
    splatEncoding?: SplatEncoding;
    lod?: boolean | number;
    nonLod?: boolean;
    lodAbove?: number;
    lodSplats?: PackedSplats;
};
export declare class PackedSplats implements SplatSource {
    maxSplats: number;
    numSplats: number;
    packedArray: Uint32Array | null;
    extra: Record<string, unknown>;
    maxSh: number;
    splatEncoding?: SplatEncoding;
    lod?: boolean | number;
    nonLod?: boolean;
    lodSplats?: PackedSplats;
    initialized: Promise<PackedSplats>;
    isInitialized: boolean;
    target: THREE.WebGLArrayRenderTarget | null;
    source: THREE.DataArrayTexture | null;
    needsUpdate: boolean;
    dyno: DynoUniform<typeof TPackedSplats, "packedSplats">;
    dynoRgbMinMaxLnScaleMinMax: DynoUniform<"vec4", "rgbMinMaxLnScaleMinMax">;
    dynoNumSh: DynoInt<"numSh">;
    dynoShMax: DynoVec3<THREE.Vector3, "shMax">;
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
    createLodSplats({ rgbaArray, quality, }?: {
        rgbaArray?: RgbaArray;
        quality?: boolean;
    }): Promise<void>;
    extractSplats(indices: Uint32Array, pageColoring: boolean): PackedSplats;
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
export declare function evaluatePackedSH({ coord, viewDir, numSh, sh1Texture, sh2Texture, sh3Texture, shMax, }: {
    coord: DynoVal<"ivec3">;
    viewDir: DynoVal<"vec3">;
    numSh: DynoVal<"int">;
    sh1Texture?: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
    sh2Texture?: DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
    sh3Texture?: DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>;
    shMax: DynoVal<"vec3">;
}): {
    rgb: DynoVal<"vec3">;
};
