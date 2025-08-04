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

// Enable/disable Gsplat sorting via Rust WASM code. In testing the sorting
// time between pure JS and WASM are minimal and don't make a big difference.

export const WASM_SPLAT_SORT = true;

// Enable/disable compiling a dedicated parse function per element type
// in the plyReader.

export const USE_COMPILED_PARSER_FUNCTION = true;
