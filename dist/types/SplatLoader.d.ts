import { FileLoader, Loader, LoadingManager } from 'three';
import { PackedSplats, SplatEncoding } from './PackedSplats';
import { SplatMesh } from './SplatMesh';
export declare class SplatLoader extends Loader {
    fileLoader: FileLoader;
    fileType?: SplatFileType;
    packedSplats?: PackedSplats;
    constructor(manager?: LoadingManager);
    load(url: string, onLoad?: (decoded: PackedSplats) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<PackedSplats>;
    parse(packedSplats: PackedSplats): SplatMesh;
}
export declare enum SplatFileType {
    PLY = "ply",
    SPZ = "spz",
    SPLAT = "splat",
    KSPLAT = "ksplat",
    PCSOGS = "pcsogs",
    PCSOGSZIP = "pcsogszip"
}
export declare function getSplatFileType(fileBytes: Uint8Array): SplatFileType | undefined;
export declare function getFileExtension(pathOrUrl: string): string;
export declare function getSplatFileTypeFromPath(pathOrUrl: string): SplatFileType | undefined;
export type PcSogsJson = {
    means: {
        shape: number[];
        dtype: string;
        mins: number[];
        maxs: number[];
        files: string[];
    };
    scales: {
        shape: number[];
        dtype: string;
        mins: number[];
        maxs: number[];
        files: string[];
    };
    quats: {
        shape: number[];
        dtype: string;
        encoding?: string;
        files: string[];
    };
    sh0: {
        shape: number[];
        dtype: string;
        mins: number[];
        maxs: number[];
        files: string[];
    };
    shN?: {
        shape: number[];
        dtype: string;
        mins: number;
        maxs: number;
        quantization: number;
        files: string[];
    };
};
export declare function isPcSogs(input: ArrayBuffer | Uint8Array | string): boolean;
export declare function tryPcSogs(input: ArrayBuffer | Uint8Array | string): PcSogsJson | undefined;
export declare function tryPcSogsZip(input: ArrayBuffer | Uint8Array): {
    name: string;
    json: PcSogsJson;
} | undefined;
export declare function unpackSplats({ input, extraFiles, fileType, pathOrUrl, splatEncoding, }: {
    input: Uint8Array | ArrayBuffer;
    extraFiles?: Record<string, ArrayBuffer>;
    fileType?: SplatFileType;
    pathOrUrl?: string;
    splatEncoding?: SplatEncoding;
}): Promise<{
    packedArray: Uint32Array;
    numSplats: number;
    extra?: Record<string, unknown>;
}>;
export declare class SplatData {
    numSplats: number;
    maxSplats: number;
    centers: Float32Array;
    scales: Float32Array;
    quaternions: Float32Array;
    opacities: Float32Array;
    colors: Float32Array;
    sh1?: Float32Array;
    sh2?: Float32Array;
    sh3?: Float32Array;
    constructor({ maxSplats }?: {
        maxSplats?: number;
    });
    pushSplat(): number;
    unpushSplat(index: number): void;
    ensureCapacity(numSplats: number): void;
    ensureIndex(index: number): void;
    setCenter(index: number, x: number, y: number, z: number): void;
    setScale(index: number, scaleX: number, scaleY: number, scaleZ: number): void;
    setQuaternion(index: number, x: number, y: number, z: number, w: number): void;
    setOpacity(index: number, opacity: number): void;
    setColor(index: number, r: number, g: number, b: number): void;
    setSh1(index: number, sh1: Float32Array): void;
    setSh2(index: number, sh2: Float32Array): void;
    setSh3(index: number, sh3: Float32Array): void;
}
export declare function transcodeSpz(input: TranscodeSpzInput): Promise<{
    input: TranscodeSpzInput;
    fileBytes: Uint8Array;
}>;
export type FileInput = {
    fileBytes: Uint8Array;
    fileType?: SplatFileType;
    pathOrUrl?: string;
    transform?: {
        translate?: number[];
        quaternion?: number[];
        scale?: number;
    };
};
export type TranscodeSpzInput = {
    inputs: FileInput[];
    maxSh?: number;
    clipXyz?: {
        min: number[];
        max: number[];
    };
    fractionalBits?: number;
    opacityThreshold?: number;
};
