# ExtSplats

`ExtSplats` is the Spark 2.0 preview extended splat container. It uses a **double-width encoding** of **32 bytes per splat** (vs 16 bytes for `PackedSplats`) to preserve more precision while keeping a GPU-friendly layout.

Each splat is stored across two `Uint32Array`s:
- `extArrays[0]`: 4 words (`uvec4`)
- `extArrays[1]`: 4 words (`uvec4`)

## Creating an `ExtSplats`

```typescript
const extSplats = new ExtSplats({
  url?: string;
  fileBytes?: Uint8Array | ArrayBuffer;
  fileType?: SplatFileType;
  fileName?: string;
  stream?: ReadableStream;
  streamLength?: number;
  maxSplats?: number;
  extArrays?: [Uint32Array, Uint32Array];
  numSplats?: number;
  construct?: (splats: ExtSplats) => Promise<void> | void;
  onProgress?: (event: ProgressEvent) => void;
  extra?: Record<string, unknown>;
  lod?: boolean | number;
  nonLod?: boolean;
  lodAbove?: number;
  lodSplats?: ExtSplats;
});
```

Like `PackedSplats`, you can initialize empty, from file data (`url`, `fileBytes`, `stream`), from raw arrays (`extArrays`), or procedurally via `construct`.

### Parameters

Like `PackedSplats`, you can create a `new ExtSplats()` with no options, which creates a new empty instance with 0 splats. You can initialize from `url` / `fileBytes` / `stream`, from raw `extArrays` (two `Uint32Array`s, 4 words per array per splat), or procedurally with `construct(splats)`.

| **Parameter**     | Description |
| ----------------- | ----------- |
| **url**           | URL to fetch a Gaussian splat file from (supports `.ply`, `.spz`, `.splat`, `.ksplat`, `.sog`/PC-SOGS zip, and `.rad`; PC-SOGS JSON can be loaded with `fileType`). (default: `undefined`)
| **fileBytes**     | Raw bytes of a Gaussian splat file to decode directly instead of fetching from URL. (default: `undefined`)
| **fileType**      | Override the file type detection for formats that can't be reliably auto-detected (especially `.splat`, `.ksplat`, and extension-less inputs). (default: `undefined` auto-detects when possible)
| **fileName**      | Optional file name hint used for type detection. (default: `undefined`)
| **stream**        | Stream to read a Gaussian splat file from. (default: `undefined`)
| **streamLength**  | Byte length for `stream`. (default: `undefined`)
| **maxSplats**     | Reserve space for at least this many splats when constructing the collection initially. The arrays automatically resize past `maxSplats`, so setting it is an optional optimization. (default: `0`)
| **extArrays**     | Use provided extended data arrays, where each splat uses 4 consecutive `uint32` words in each array (`[ext0, ext1]`). (default: `undefined`)
| **numSplats**     | Override number of splats in `extArrays` to use only a subset. (default: min(`ext0.length/4`, `ext1.length/4`))
| **construct**     | Callback function to programmatically create splats at initialization. (default: `undefined`)
| **onProgress**    | Callback fired while downloading/initializing. (default: `undefined`)
| **extra**         | Additional splat data, such as spherical harmonics components (`sh1`, `sh2`, `sh3a`, `sh3b`). (default: `{}`)
| **lod**           | Enable LoD generation/loading. `number` sets LoD base; `true` uses default base. (default: `false`)
| **nonLod**        | Keep original data when creating LoD representation. (default: `false`)
| **lodAbove**      | Only create LoD if source splat count exceeds this value. (default: `undefined`)
| **lodSplats**     | Explicit LoD `ExtSplats` to attach to this instance. (default: `undefined`)

## 32-byte layout

Each `ExtSplat` occupies 8 × `uint32` total = 32 bytes.

`extArrays[0]` contains bytes `0..15` and `extArrays[1]` contains bytes `16..31` for each splat index.

| Offset (bytes) | Field | Size (bytes) | Description |
|----------------|-------|--------------|-------------|
| 0-3   | `center.x` | 4 | float32 bits (`uintBitsToFloat`) |
| 4-7   | `center.y` | 4 | float32 bits (`uintBitsToFloat`) |
| 8-11  | `center.z` | 4 | float32 bits (`uintBitsToFloat`) |
| 12-13 | `opacity` | 2 | float16 |
| 14-15 | reserved | 2 | currently unused |
| 16-17 | `color.r` | 2 | float16 |
| 18-19 | `color.g` | 2 | float16 |
| 20-21 | `color.b` | 2 | float16 |
| 22-23 | `ln(scale.x)` | 2 | float16 (decoded with `exp`) |
| 24-25 | `ln(scale.y)` | 2 | float16 (decoded with `exp`) |
| 26-27 | `ln(scale.z)` | 2 | float16 (decoded with `exp`) |
| 28-31 | quaternion | 4 | packed octahedral + angle (`10/10/12` bits) |

## Encoding / decoding helpers

```typescript
import { utils } from "@sparkjsdev/spark";

utils.encodeExtSplat(extSplats.extArrays, index, x, y, z, sx, sy, sz, qx, qy, qz, qw, opacity, r, g, b);
const { center, scales, quaternion, color, opacity } = utils.decodeExtSplat(extSplats.extArrays, index);
```

You can also use instance helpers: `setSplat`, `pushSplat`, `getSplat`, and `forEachSplat`.

## `extra` splat data

`ExtSplats.extra` stores optional spherical harmonics data:
- `sh1: Uint32Array(numSplats * 4)`
- `sh2: Uint32Array(numSplats * 4)`
- `sh3a: Uint32Array(numSplats * 4)`
- `sh3b: Uint32Array(numSplats * 4)`

SH3 is split into `sh3a` + `sh3b` for the extended representation.

### Spherical harmonics (SH) layout

Each SH RGB coefficient in `ExtSplats` is stored as one `uint32` using `encodeExtRgb`:
- 8 bits magnitude for `R`, `G`, and `B` (24 bits total)
- 5-bit shared exponent/base for the coefficient triplet
- 3 sign bits (`R/G/B`)

This gives 4 bytes per RGB coefficient with a shared dynamic range per coefficient.

| Buffer | Words per splat | Coefficients stored | Notes |
| ------ | --------------- | ------------------- | ----- |
| `sh1`  | 4 (`16` bytes)  | `sh1_0`, `sh1_1`, `sh1_2`, `sh2_0` | The 4th word is reused by SH2 when SH2 exists |
| `sh2`  | 4 (`16` bytes)  | `sh2_1`..`sh2_4` | Completes SH2 together with `sh1[3]` |
| `sh3a` | 4 (`16` bytes)  | `sh3_0`..`sh3_3` | First half of SH3 |
| `sh3b` | 4 (`16` bytes)  | `sh3_4`..`sh3_6` | Last word currently unused/reserved |

## Dyno usage

In `dyno` shader graphs you can read an extended splat with:

```typescript
const gsplat = dyno.readExtSplat(extSplats.dyno, index);
```
