// LN_SCALE_MIN..LN_SCALE_MAX define the internal scale range of for Gsplats,
// covering approx 0.0001..8000 in range with discrete steps 7% apart.
// The value "0" is reserved for truly flat scales, indicating a 2DGS.
// If these values are changed, the corresponding values in splatDefines.glsl
// must also be updated to match.

export const LN_SCALE_MIN = -12.0;
export const LN_SCALE_MAX = 9.0;
export const SCALE_MIN = Math.exp(LN_SCALE_MIN);
export const SCALE_MAX = Math.exp(LN_SCALE_MAX);

export const LN_SCALE_ZERO = -30.0;
export const SCALE_ZERO = Math.exp(LN_SCALE_ZERO);

// Gsplats are stored in textures that are 2^11 x 2^11 x up to 2^11
// Most WebGL2 implementations support 2D textures up to 2^12 x 2^12 (max 16M Gsplats)
// 2D array textures and 3D textures up to 2^11 x 2^11 x 2^11 (max 8G Gsplats),
// so we use 2D array textures for our representation for higher limits.

export const SPLAT_TEX_WIDTH_BITS = 11;
export const SPLAT_TEX_HEIGHT_BITS = 11;
export const SPLAT_TEX_DEPTH_BITS = 11;
export const SPLAT_TEX_LAYER_BITS =
  SPLAT_TEX_WIDTH_BITS + SPLAT_TEX_HEIGHT_BITS;

export const SPLAT_TEX_WIDTH = 1 << SPLAT_TEX_WIDTH_BITS; // 2048
export const SPLAT_TEX_HEIGHT = 1 << SPLAT_TEX_HEIGHT_BITS; // 2048
export const SPLAT_TEX_DEPTH = 1 << SPLAT_TEX_DEPTH_BITS; // 2048
export const SPLAT_TEX_MIN_HEIGHT = 1;

export const SPLAT_TEX_WIDTH_MASK = SPLAT_TEX_WIDTH - 1;
export const SPLAT_TEX_HEIGHT_MASK = SPLAT_TEX_HEIGHT - 1;
export const SPLAT_TEX_DEPTH_MASK = SPLAT_TEX_DEPTH - 1;

export enum SplatFileType {
  PLY = "ply",
  SPZ = "spz",
  SPLAT = "splat",
  KSPLAT = "ksplat",
  PCSOGS = "pcsogs",
  PCSOGSZIP = "pcsogszip",
  RAD = "rad",
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

export const DEFAULT_SPLAT_ENCODING: SplatEncoding = {
  rgbMin: 0,
  rgbMax: 1,
  lnScaleMin: LN_SCALE_MIN,
  lnScaleMax: LN_SCALE_MAX,
  sh1Max: 1,
  sh2Max: 1,
  sh3Max: 1,
  lodOpacity: false,
};

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
