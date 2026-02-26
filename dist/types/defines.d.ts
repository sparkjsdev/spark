export declare const LN_SCALE_MIN = -12;
export declare const LN_SCALE_MAX = 9;
export declare const SCALE_MIN: number;
export declare const SCALE_MAX: number;
export declare const LN_SCALE_ZERO = -30;
export declare const SCALE_ZERO: number;
export declare const SPLAT_TEX_WIDTH_BITS = 11;
export declare const SPLAT_TEX_HEIGHT_BITS = 11;
export declare const SPLAT_TEX_DEPTH_BITS = 11;
export declare const SPLAT_TEX_LAYER_BITS: number;
export declare const SPLAT_TEX_WIDTH: number;
export declare const SPLAT_TEX_HEIGHT: number;
export declare const SPLAT_TEX_DEPTH: number;
export declare const SPLAT_TEX_MIN_HEIGHT = 1;
export declare const SPLAT_TEX_WIDTH_MASK: number;
export declare const SPLAT_TEX_HEIGHT_MASK: number;
export declare const SPLAT_TEX_DEPTH_MASK: number;
export declare const WASM_SPLAT_SORT = true;
export declare const USE_COMPILED_PARSER_FUNCTION = true;
export declare enum SplatFileType {
    PLY = "ply",
    SPZ = "spz",
    SPLAT = "splat",
    KSPLAT = "ksplat",
    PCSOGS = "pcsogs",
    PCSOGSZIP = "pcsogszip",
    RAD = "rad"
}
export type SplatEncoding = {
    rgbMin?: number;
    rgbMax?: number;
    lnScaleMin?: number;
    lnScaleMax?: number;
    sh1Max?: number;
    sh2Max?: number;
    sh3Max?: number;
    lodOpacity?: boolean;
};
export declare const DEFAULT_SPLAT_ENCODING: SplatEncoding;
export type RadMeta = {
    version: number;
    type: string;
    count: number;
    maxSh?: number;
    lodTree?: boolean;
    chunkSize?: number;
    chunks: {
        offset: number;
        bytes: number;
        base?: number;
        count?: number;
        filename?: string;
    }[];
    splatEncoding?: SplatEncoding;
};
export type PackedExtra = {
    sh1?: Uint32Array;
    sh2?: Uint32Array;
    sh3?: Uint32Array;
    lodTree?: Uint32Array;
    radMeta?: RadMeta;
};
export type PackedResult = {
    numSplats: number;
    packedArray: Uint32Array;
    extra: PackedExtra;
    splatEncoding: SplatEncoding;
};
export type ExtExtra = {
    sh1?: Uint32Array;
    sh2?: Uint32Array;
    sh3a?: Uint32Array;
    sh3b?: Uint32Array;
    lodTree?: Uint32Array;
    radMeta?: RadMeta;
};
export type ExtResult = {
    numSplats: number;
    extArrays: [Uint32Array, Uint32Array];
    extra: ExtExtra;
};
