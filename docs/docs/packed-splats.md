# PackedSplats

A `PackedSplats` is a collection of Gaussian splats, packed into a format that takes exactly 16 bytes per splat to maximize memory and cache efficiency. The `center` xyz coordinates are encoded as float16 (3 x 2 bytes), `scale` xyz as 3 x uint8 that encode a log scale from e^-12 to e^9, `rgba` as 4 x uint8, and quaternion encoded via axis+angle using 2 x uint8 for octahedral encoding of the axis direction and a uint8 to encode rotation amount from 0..Pi.

## Creating a `PackedSplats`

```typescript
const packedSplats = new PackedSplats({
  // Fetch PLY/SPZ/SPLAT/KSPLAT file from URL
  url?: string;
  // Decode raw PLY/SPZ/SPLAT/KSPLAT file bytes
  fileBytes?: Uint8Array | ArrayBuffer;
  // Override file type
  fileType?: SplatFileType;
  // Reserve space for at least this many splats for construction
  maxSplats?: number;
  // Use provided packed data array, 4 words per splat
  packedArray?: Uint32Array;
  // Override number of splats in packed array to a subset
  numSplats?: number;
  // Constructor callback to create splats
  construct?: (splats: PackedSplats) => Promise<void> | void;
  // Extra splat data, such as sh1..3 components
  extra?: Record<string, unknown>;
});
```

### Optional parameters

Like for `SplatMesh` you can create a `new PackedSplats()` with no options, which will create a new empty instance with 0 splats. Similarly, you can provide an input `url` or `fileBytes` to decode from a file source. You can also create a `PackedSplats` from a raw `Uint32Array` where each successive 4 Uint32 values encodes one "packed" splat. Finally, a `construct(splats)` callback provides an ergonomic way to create splats procedurally with an in-line initialization closure.

| **Parameter**     | Description |
| ----------------- | ----------- |
| **url**           | URL to fetch a Gaussian splat file from (supports .ply, .splat, .ksplat, .spz formats). (default: `undefined`)
| **fileBytes**     | Raw bytes of a Gaussian splat file to decode directly instead of fetching from URL. (default: `undefined`)
| **fileType**      | Override the file type detection for formats that can't be reliably auto-detected (.splat, .ksplat). (default: `undefined` auto-detects other formats from file contents)
| **maxSplats**     | Reserve space for at least this many splats when constructing the collection initially. The array will automatically resize past maxSplats so setting it is an optional optimization. (default: `0`)
| **packedArray**   | Use provided packed data array, where each 4 consecutive uint32 values encode one "packed" splat. (default: `undefined`)
| **numSplats**     | Override number of splats in packed array to use only a subset. (default: length of packed array / 4)
| **construct**     | Callback function to programmatically create splats at initialization. (default: `undefined`)
| **extra**         | Additional splat data, such as spherical harmonics components (sh1, sh2, sh3). (default: `{}`)

## Encoding / Decoding

Utility functions are provided in Javascript to pack/unpack these encodings:
```javascript

// Set via packedSplats interface
packedSplats.setSplat(index, center, scales, quaternion, opacity, color);

// Set underlying Uint32 array directly
import { utils } from "@sparkjsdev/spark";
utils.setPackedSplat(packedSplats.packedArray, index, x, y, z, scaleX, scaleY, ...);

// Set rotation components of underlying Uint32 array directly
utils.setPackedSplatQuat(packedSplats.packedArray, index, quatX, quatY, quatZ, quatW);

// Unpack all splat components from the Uint32 array
const { center, scales, quaternion, color, opacity } = utils.unpackSplat(packedSplats.packedArray, index);

// Unpack all splats with callback
packedSplats.forEachSplat((index, center, scales, quaternion, opacity, color) => {
    // Use unpacked splat data. Changing the inputs directly has no effect.
    // Update just the scales component
    utils.setPackedSplatScales(packedSplat.packedArray, index, 0.005, 0.01, 0.015);
    // Update the entire splat
    packedSplat.setSplat(index, center, scales, quaternion, opacity, color);
});
```

In GLSL code you can use the following utility functions that are available via `splatDefines.glsl`, which is included in all GLSL shader programs:
```glsl
// Pack a splat into a uvec4
uvec4 packSplat(vec3 center, vec3 scales, vec4 quaternion, vec4 rgba);

// Unpack a splat from a uvec4
void unpackSplat(uvec4 packed, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba);
```

In `dyno` shader contexts you can read and unpack a splat from a `PackedSplats`:
```javascript
// Fetch and unpack a particular index from a PackedSplats.
const gsplat = dyno.readPackedSplat(packedSplats.dyno, index);
```

### Byte Layout

Each `PackedSplat` occupies 16 bytes (4 × `uint32`), with the following layout of fields by byte offset:

| Offset (bytes) | Field           | Size (bytes) | Description                                                |
|----------------|-----------------|--------------|------------------------------------------------------------|
| 0              | R               | 1            | Red color channel (uint8 0–255 → 0.0–1.0)                  |
| 1              | G               | 1            | Green color channel (uint8 0–255 → 0.0–1.0)                |
| 2              | B               | 1            | Blue color channel (uint8 0–255 → 0.0–1.0)                 |
| 3              | A               | 1            | Alpha (opacity) channel (uint8 0–255 → 0.0–1.0)            |
| 4–5            | center.x        | 2            | X coordinate of splat center (float16)                     |
| 6–7            | center.y        | 2            | Y coordinate of splat center (float16)                     |
| 8–9            | center.z        | 2            | Z coordinate of splat center (float16)                     |
| 10             | quat oct.U      | 1            | Octahedral quaternion U component (uint8)                  |
| 11             | quat oct.V      | 1            | Octahedral quaternion V component (uint8)                  |
| 12             | scale.x         | 1            | X scale, log-encoded to uint8                              |
| 13             | scale.y         | 1            | Y scale, log-encoded to uint8                              |
| 14             | scale.z         | 1            | Z scale, log-encoded to uint8                              |
| 15             | quat angle (θ)  | 1            | Encoded quaternion rotation angle (uint8, θ/π·255)         |

### Splat RGBA encoding

RGB values are encoded are uint8 sRGB values with 0..255 mapping to 0..1. When loading from a PLY file these values are derived by calculating `ply[f_dc_0] * SH_C0 + 0.5`.

Opacity is encoded on a linear scale where 0..255 maps to 0..1.

### Splat center encoding

The center x/y/z components are encoded as float16, which provides 10 bits of mantissa, or approximately 1K steps (0.1%) of resolution between each successive power of 0 from the origin, with a range of up to 32K in distance. If most of the splats are positioned relative to the origin this provides enough positional resolution. Splats that are transformed far from the origin, however (for example when bringing multiple `SplatMesh`es together in a scene that are far apart) may lose precision when mapped to the space of `SparkRenderer`. For scenes where the user camera may move far from the origin, you may want to tie the `SparkRenderer` origin to your camera by adding it as a child of the camera.

### Splat scales encoding

The XYZ scales are encoded independently using the following mapping: Any scale values below e^-30 are interpreted as "true zero" scale, and encoded as `uint8(0)`. Any other values quantized by computing `ln(scale_xyz)`, mapping the range e^-12..e^9 to uint8 values 1..255, rounding, and clamping. This logarithmic scale range can encode values from 0.0001 up to 8K in scale, with approximately 7% steps between discrete sizes, and has minimal impact on perceptible visual quality.

### Splat orientation encoding

We encode a splat's quaternion/orientation by encoding it explicitly in an axis + angle representation: 8 bits for each U/V coordinate for octahedral encoding of the axis direction, and 8 bits to encode the rotation angle range 0..Pi.

This representation was chosen over other internal rotation representations because it provides a good mix of speed/simplicity, uniformity of representable orientations, and especially its ability to handle rotations "near identity". Other encodings such as the more common "3 quaternion components" tend to have poor rotational resolution around I(1), which is a particularly important regime of this parameter.

### `extra` splat data

Each instance of `PackedSplats` also has a property `extra: Record<string, unknown>` that is used to attach additional splat-related data to the `PackedSplats` container. For example, spherical harmonics degrees 1..3 are stored in `sh1: Uint32Array(numSplats * 2)`, `sh2: Uint32Array(numSplats * 4)`, `sh3: Uint32Array(numSplats * 4)`, and intermediate textures are generated by `SplatMesh` and stored as `sh1Texture` etc.

This structure can be used to extend and store additional data in a `PackedSplats`, but there is no specific convention yet to prevent collisions.

`sh1` stores each of 3 x 3 RGB signed components as Sint7 (mapping -1..1) in 63 bits (8 bytes) per splat. `sh2` stores each of 5 x 3 RGB signed components as Sint8 in 120 bits (16 bytes). `sh3` stores each of 7 x 3 RGB signed components as Sint6 in 126 bits (16 bytes) to improve memory bandwidth efficiency. Note that using spherical harmonics dramatically increases the memory footprint from 16 bytes per splat up to 56 bytes per splat with SH0..3, which can impact rendering performance.

## `PackedSplats` instance methods

### `dispose()`

Call this when you are finished with the PackedSplats and want to free any render targets + textures it holds.

### `ensureSplats(numSplats)`

Ensures that `this.packedArray` can fit `numSplats` splats. If it's too small, resize exponentially and copy over the original data.

Typically you don't need to call this, because calling `this.setSplat(index, ...)` and `this.pushSplat(...)` will automatically call `ensureSplats()` so we have enough splats.

### `getSplat(index): { center, scales, quaternion, opacity, color }`

Unpack the 16-byte splat data at `index` into the THREE.js components `center: THREE.Vector3`, `scales: THREE.Vector3`, `quaternion: THREE.Quaternion`, `opacity: number 0..1`, `color: THREE.Color 0..1`.

### `setSplat(index, center, scales, quaternion, opacity, color)`

Set all PackedSplat components at `index` with the provided splat attributes (can be the same objects returned by `getSplat`). Ensures there is capacity for at least `index+1` splats.

### `pushSplat(center, scales, quaternion, opacity, color)`

Effectively calls `this.setSplat(this.numSplats++, center, ...)`, useful on construction where you just want to iterate and create a collection of splats.

### `forEachSplat(callback: (index, center, scales, quaternion, opacity, color) => void)`

Iterate over splats index `0..=(this.numSplats-1)`, unpack each splat and invoke the callback function with the splat attributes.

### `getTexture()`

Returns a `THREE.DataArrayTexture` representing the PackedSplats content as a Uint32x4 data array texture (2048 x 2048 x depth in size)

### `getEmpty()`

Can be used where you need an uninitialized `THREE.DataArrayTexture` like a uniform you will update with the result of `this.getTexture()` later.

## Generating splats on the GPU

To generate a large number of splats we can use the `dyno` shader graph system, which allows you to create a computation graph mapping `{ index: DynoVal<"int"> }` to `{ gsplat: DynoVal<Gsplat> }` via Javascript code, then have that synthesize GLSL code, which is finally compiled and executed in parallel on the GPU.

This building block is used by `SparkRenderer` to traverse each visible `SplatMesh`/`SplatGenerator` and have it "generate" its splats into the global `PackedSplats` array managed by a `SplatAccumulator`. At its core a `PackedSplats` has the ability to run `dyno` computation graphs to produce its contents using the following methods, which are typically managed by `SparkRenderer`:

### `generateMapping(splatCounts: number[]): { maxSplats, mapping[] }`

Given an array of splatCounts (`.numSplats` for each `SplatGenerator`/`SplatMesh` in the scene), compute a "mapping layout" in the composite array of generated outputs.

### `ensureGenerate(maxSplats)`

Ensures our `PackedSplats.target` render target has enough space to generate `maxSplats` total splats, and reallocate if not large enough.

### `generate({ generator, base, count, ... })`

Executes a `dyno` program specified by `generator` which is any `DynoBlock` that maps `{ index: "int" }` to `{ gsplat: Gsplat }`. This is invoked from `SparkRenderer.updateInternal()` to re-generate splats in the scene for `SplatGenerator` instances whose version is newer than last generated version.

## Using dynamic PackedSplats inputs in `dyno`

You can use a `PackedSplats` in a `dyno` block using the function `dyno.readPackedSplats(packedSplats.dyno, dynoIndex)` where `dynoIndex` is of type `DynoVal<"int">` If you need to be able to change the input `PackedSplats` dynamically, however, you should create a `DynoPackedSplats`, whose property `packedSplats` you can set to any `PackedSplats`, which will be used in the next `dyno` shader program execution.
