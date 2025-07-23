import { SplatEncoding } from './PackedSplats';
export declare function decodeKsplat(fileBytes: Uint8Array, initNumSplats: (numSplats: number) => void, splatCallback: (index: number, x: number, y: number, z: number, scaleX: number, scaleY: number, scaleZ: number, quatX: number, quatY: number, quatZ: number, quatW: number, opacity: number, r: number, g: number, b: number) => void, shCallback?: (index: number, sh1: Float32Array, sh2?: Float32Array, sh3?: Float32Array) => void): void;
export declare function unpackKsplat(fileBytes: Uint8Array, splatEncoding: SplatEncoding): {
    packedArray: Uint32Array;
    numSplats: number;
    extra: Record<string, unknown>;
};
