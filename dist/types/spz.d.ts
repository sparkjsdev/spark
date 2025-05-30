import { TranscodeSpzInput } from './SplatLoader';
import { GunzipReader } from './utils';
export declare class SpzReader {
    fileBytes: Uint8Array;
    reader: GunzipReader;
    version: number;
    numSplats: number;
    shDegree: number;
    fractionalBits: number;
    flags: number;
    flagAntiAlias: boolean;
    reserved: number;
    parsed: boolean;
    constructor({ fileBytes }: {
        fileBytes: Uint8Array | ArrayBuffer;
    });
    parseSplats(centerCallback?: (index: number, x: number, y: number, z: number) => void, alphaCallback?: (index: number, alpha: number) => void, rgbCallback?: (index: number, r: number, g: number, b: number) => void, scalesCallback?: (index: number, scaleX: number, scaleY: number, scaleZ: number) => void, quatCallback?: (index: number, quatX: number, quatY: number, quatZ: number, quatW: number) => void, shCallback?: (index: number, sh1: Float32Array, sh2?: Float32Array, sh3?: Float32Array) => void): void;
}
export declare const SPZ_MAGIC = 1347635022;
export declare const SPZ_VERSION = 2;
export declare const FLAG_ANTIALIASED = 1;
export declare class SpzWriter {
    buffer: ArrayBuffer;
    view: DataView;
    numSplats: number;
    shDegree: number;
    fractionalBits: number;
    fraction: number;
    flagAntiAlias: boolean;
    clippedCount: number;
    constructor({ numSplats, shDegree, fractionalBits, flagAntiAlias, }: {
        numSplats: number;
        shDegree: number;
        fractionalBits?: number;
        flagAntiAlias?: boolean;
    });
    setCenter(index: number, x: number, y: number, z: number): void;
    setAlpha(index: number, alpha: number): void;
    static scaleRgb(r: number): number;
    setRgb(index: number, r: number, g: number, b: number): void;
    setScale(index: number, scaleX: number, scaleY: number, scaleZ: number): void;
    setQuat(index: number, quatX: number, quatY: number, quatZ: number, quatW: number): void;
    static quantizeSh(sh: number, bits: number): number;
    setSh(index: number, sh1: Float32Array, sh2?: Float32Array, sh3?: Float32Array): void;
    finalize(): Promise<Uint8Array>;
}
export declare function transcodeSpz(input: TranscodeSpzInput): Promise<{
    fileBytes: Uint8Array<ArrayBufferLike>;
    clippedCount: number;
}>;
