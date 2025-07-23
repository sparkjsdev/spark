import { Gunzip } from 'fflate';
import * as THREE from "three";
export declare function floatBitsToUint(f: number): number;
export declare function uintBitsToFloat(u: number): number;
export declare function toHalf(f: number): number;
export declare function fromHalf(h: number): number;
export declare function floatToUint8(v: number): number;
export declare function floatToSint8(v: number): number;
export declare function Uint8ToFloat(v: number): number;
export declare function Sint8ToFloat(v: number): number;
export declare class DataCache {
    maxItems: number;
    asyncFetch: (key: string) => Promise<unknown>;
    items: {
        key: string;
        data: unknown;
    }[];
    constructor({ asyncFetch, maxItems, }: {
        asyncFetch: (key: string) => Promise<unknown>;
        maxItems?: number;
    });
    getFetch(key: string): Promise<unknown>;
}
export declare function mapObject(obj: Record<string, unknown>, fn: (value: unknown, key: string) => unknown): Record<string, unknown>;
export declare function mapFilterObject(obj: Record<string, unknown>, fn: (value: unknown, key: string) => unknown): Record<string, unknown>;
export declare function getArrayBuffers(ctx: unknown): Transferable[];
export declare function newArray<T>(n: number, initFunction: (index: number) => T): T[];
export declare class FreeList<T, Args> {
    items: T[];
    allocate: (args: Args) => T;
    dispose?: (item: T) => void;
    valid: (item: T, args: Args) => boolean;
    constructor({ allocate, dispose, valid, }: {
        allocate: (args: Args) => T;
        dispose?: (item: T) => void;
        valid: (item: T, args: Args) => boolean;
    });
    alloc(args: Args): T;
    free(item: T): void;
    disposeAll(): void;
}
export declare function setPackedSplat(packedSplats: Uint32Array, index: number, x: number, y: number, z: number, scaleX: number, scaleY: number, scaleZ: number, quatX: number, quatY: number, quatZ: number, quatW: number, opacity: number, r: number, g: number, b: number, encoding?: {
    rgbMin?: number;
    rgbMax?: number;
    lnScaleMin?: number;
    lnScaleMax?: number;
}): void;
export declare function setPackedSplatCenter(packedSplats: Uint32Array, index: number, x: number, y: number, z: number): void;
export declare function setPackedSplatScales(packedSplats: Uint32Array, index: number, scaleX: number, scaleY: number, scaleZ: number, encoding?: {
    lnScaleMin?: number;
    lnScaleMax?: number;
}): void;
export declare function setPackedSplatQuat(packedSplats: Uint32Array, index: number, quatX: number, quatY: number, quatZ: number, quatW: number): void;
export declare function setPackedSplatRgba(packedSplats: Uint32Array, index: number, r: number, g: number, b: number, a: number, encoding?: {
    rgbMin?: number;
    rgbMax?: number;
}): void;
export declare function setPackedSplatRgb(packedSplats: Uint32Array, index: number, r: number, g: number, b: number, encoding?: {
    rgbMin?: number;
    rgbMax?: number;
}): void;
export declare function setPackedSplatOpacity(packedSplats: Uint32Array, index: number, opacity: number): void;
export declare function unpackSplat(packedSplats: Uint32Array, index: number, encoding?: {
    rgbMin?: number;
    rgbMax?: number;
    lnScaleMin?: number;
    lnScaleMax?: number;
}): {
    center: THREE.Vector3;
    scales: THREE.Vector3;
    quaternion: THREE.Quaternion;
    color: THREE.Color;
    opacity: number;
};
export declare function getTextureSize(numSplats: number): {
    width: number;
    height: number;
    depth: number;
    maxSplats: number;
};
export declare function computeMaxSplats(numSplats: number): number;
export declare function isMobile(): boolean;
export declare function isAndroid(): boolean;
export declare function isOculus(): boolean;
export declare function flipPixels(pixels: Uint8Array, width: number, height: number): Uint8Array;
export declare function pixelsToPngUrl(pixels: Uint8Array, width: number, height: number): string;
export declare function cloneClock(clock: THREE.Clock): THREE.Clock;
export declare function omitUndefined<T extends object>(obj: T): Partial<T>;
export declare const IDENT_VERTEX_SHADER: string;
export declare function averagePositions(positions: THREE.Vector3[]): THREE.Vector3;
export declare function averageQuaternions(quaternions: THREE.Quaternion[]): THREE.Quaternion;
export declare function coinciDist(matrix1: THREE.Matrix4, matrix2: THREE.Matrix4): {
    distance: number;
    coincidence: number;
};
export declare function withinDist({ matrix1, matrix2, maxDistance, }: {
    matrix1: THREE.Matrix4;
    matrix2: THREE.Matrix4;
    maxDistance: number;
}): boolean;
export declare function withinCoinciDist({ matrix1, matrix2, maxDistance, minCoincidence, }: {
    matrix1: THREE.Matrix4;
    matrix2: THREE.Matrix4;
    maxDistance: number;
    minCoincidence?: number;
}): boolean;
export declare function coorientDist(matrix1: THREE.Matrix4, matrix2: THREE.Matrix4): {
    distance: number;
    coorient: number;
};
export declare function withinCoorientDist({ matrix1, matrix2, maxDistance, minCoorient, }: {
    matrix1: THREE.Matrix4;
    matrix2: THREE.Matrix4;
    maxDistance: number;
    minCoorient?: number;
}): boolean;
export declare function epsilonSign(value: number, epsilon?: number): number;
export declare function encodeQuatXyz888(q: THREE.Quaternion): number;
export declare function decodeQuatXyz888(encoded: number, out: THREE.Quaternion): THREE.Quaternion;
/**
 * Encodes a THREE.Quaternion into a 24‐bit integer.
 *
 * Bit layout (LSB → MSB):
 *   - Bits  0–7:  quantized U (8 bits)
 *   - Bits  8–15: quantized V (8 bits)
 *   - Bits 16–23: quantized angle θ (8 bits) from [0,π]
 *
 * This version uses folded octahedral mapping (all inline).
 */
export declare function encodeQuatOctXy88R8(q: THREE.Quaternion): number;
/**
 * Decodes a 24‐bit encoded quaternion (packed in a number) back to a THREE.Quaternion.
 *
 * Assumes the same bit layout as in encodeQuatOctXy88R8.
 */
export declare function decodeQuatOctXy88R8(encoded: number, out: THREE.Quaternion): THREE.Quaternion;
/**
 * Encodes a THREE.Quaternion into a 24‑bit unsigned integer
 * by converting it to Euler angles (roll, pitch, yaw).
 * The Euler angles are assumed to be in radians in the range [-π, π].
 * Each angle is normalized to [0,1] and quantized to 8 bits.
 * Bit layout (LSB→MSB):
 *   - Bits 0–7:   roll (quantized)
 *   - Bits 8–15:  pitch (quantized)
 *   - Bits 16–23: yaw (quantized)
 */
export declare function encodeQuatEulerXyz888(q: THREE.Quaternion): number;
/**
 * Decodes a 24‑bit unsigned integer into a THREE.Quaternion
 * by unpacking three 8‑bit values (roll, pitch, yaw) in the range [0,255]
 * and then converting them back to Euler angles in [-π, π] and to a quaternion.
 */
export declare function decodeQuatEulerXyz888(encoded: number, out: THREE.Quaternion): THREE.Quaternion;
export declare function encodeSh1Rgb(sh1Array: Uint32Array, index: number, sh1Rgb: Float32Array, encoding?: {
    sh1Min?: number;
    sh1Max?: number;
}): void;
export declare function encodeSh2Rgb(sh2Array: Uint32Array, index: number, sh2Rgb: Float32Array, encoding?: {
    sh2Min?: number;
    sh2Max?: number;
}): void;
export declare function encodeSh3Rgb(sh3Array: Uint32Array, index: number, sh3Rgb: Float32Array, encoding?: {
    sh3Min?: number;
    sh3Max?: number;
}): void;
export declare function decompressPartialGzip(fileBytes: Uint8Array, numBytes: number): Uint8Array;
export declare class GunzipReader {
    fileBytes: Uint8Array;
    chunkBytes: number;
    offset: number;
    chunks: Uint8Array[];
    totalBytes: number;
    gunzip: Gunzip;
    constructor({ fileBytes, chunkBytes, }: {
        fileBytes: Uint8Array;
        chunkBytes?: number;
    });
    read(numBytes: number): Uint8Array;
}
