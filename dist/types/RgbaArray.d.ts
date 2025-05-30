import { PackedSplats } from './PackedSplats';
import { Readback, Rgba8Readback } from './Readback';
import { DynoUniform, DynoVal } from './dyno';
import * as THREE from "three";
export type RgbaArrayOptions = {
    capacity?: number;
    array?: Uint8Array;
    count?: number;
};
export declare class RgbaArray {
    capacity: number;
    count: number;
    array: Uint8Array | null;
    readback: Readback | null;
    source: THREE.DataArrayTexture | null;
    needsUpdate: boolean;
    dyno: DynoUniform<typeof TRgbaArray, "rgbaArray">;
    constructor(options?: RgbaArrayOptions);
    dispose(): void;
    ensureCapacity(capacity: number): Uint8Array;
    getTexture(): THREE.DataArrayTexture;
    private maybeUpdateSource;
    render({ reader, count, renderer, }: {
        reader: Rgba8Readback;
        count: number;
        renderer: THREE.WebGLRenderer;
    }): void;
    fromPackedSplats({ packedSplats, base, count, renderer, }: {
        packedSplats: PackedSplats;
        base: number;
        count: number;
        renderer: THREE.WebGLRenderer;
    }): this;
    read(): Promise<Uint8Array>;
    private static emptySource;
    static getEmpty(): THREE.DataArrayTexture;
    private static dynos;
    private static makeDynos;
}
export declare const TRgbaArray: {
    type: "RgbaArray";
};
export declare const defineRgbaArray: string;
export declare function readRgbaArray(rgba: DynoVal<typeof TRgbaArray>, index: DynoVal<"int">): DynoVal<"vec4">;
