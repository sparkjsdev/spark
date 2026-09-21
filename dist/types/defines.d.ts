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
    rgbMin: number;
    rgbMax: number;
    lnScaleMin: number;
    lnScaleMax: number;
    sh1Max: number;
    sh2Max: number;
    sh3Max: number;
    lodOpacity: boolean;
};
export declare const DEFAULT_SPLAT_ENCODING: SplatEncoding;
export type RadMeta = {
    readonly version: number;
    readonly type: string;
    readonly count: number;
    readonly maxSh?: number;
    readonly lodTree?: boolean;
    readonly chunkSize?: number;
    readonly chunks: {
        readonly offset: number;
        readonly bytes: number;
        readonly base?: number;
        readonly count?: number;
        readonly filename?: string;
    }[];
    readonly splatEncoding?: SplatEncoding;
};
export type PackedExtra = {
    readonly sh1?: Uint32Array;
    readonly sh2?: Uint32Array;
    readonly sh3?: Uint32Array;
    readonly sh1Codes?: Uint32Array;
    readonly sh2Codes?: Uint32Array;
    readonly sh3Codes?: Uint32Array;
    readonly lodTree?: Uint32Array;
    readonly radMeta?: RadMeta;
};
export type PackedResult = {
    readonly numSplats: number;
    readonly packedArray: Uint32Array;
    readonly extra: PackedExtra;
    readonly splatEncoding: SplatEncoding;
};
export type ExtExtra = {
    readonly sh1?: Uint32Array;
    readonly sh2?: Uint32Array;
    readonly sh3a?: Uint32Array;
    readonly sh3b?: Uint32Array;
    readonly sh1Codes?: Uint32Array;
    readonly sh2Codes?: Uint32Array;
    readonly sh3Codes?: [Uint32Array, Uint32Array];
    readonly lodTree?: Uint32Array;
    readonly radMeta?: RadMeta;
};
export type ExtResult = {
    readonly numSplats: number;
    readonly extArrays: [Uint32Array, Uint32Array];
    readonly extra: ExtExtra;
};
