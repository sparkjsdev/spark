import { SplatEncoding } from './PackedSplats';
export declare function decodeAntiSplat(fileBytes: Uint8Array, initNumSplats: (numSplats: number) => void, splatCallback: (index: number, x: number, y: number, z: number, scaleX: number, scaleY: number, scaleZ: number, quatX: number, quatY: number, quatZ: number, quatW: number, opacity: number, r: number, g: number, b: number) => void): void;
export declare function unpackAntiSplat(fileBytes: Uint8Array, splatEncoding: SplatEncoding): {
    packedArray: Uint32Array;
    numSplats: number;
};
