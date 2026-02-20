# SplatMesh

A `SplatMesh` is a high-level interface for displaying and manipulating a "Splat mesh", a collection of Gaussian splats that serves as an object of sorts. It is analagous to a traditional triangle-based `THREE.Mesh`, which consists of geometry (points and triangles) and materials (color and lighting). Similarly, a `SplatMesh` contains geometry (splat centers, orientation, and xyz scales) and materials (RGB color, opacity, spherical harmonics), and can be added anywhere in the scene hierarchy.

The usual THREE.js properties `position`, `quaternion`, `rotation` behave as you would expect, however `scale` only allows uniform scaling and averages the x/y/z scales. Additional properties `recolor` and `opacity` are multiplied in with the final splat color and opacity.

`SplatMesh` is a subclass of the more fundamental `SplatGenerator`, which itself is a subclass of `THREE.Object3D`. Any methods and properties on `Object3D` are also available in `SplatMesh`. `SplatGenerator` gives you more control over splat generation and modification, but `SplatMesh` has an simpler higher-level API.

## Creating a `SplatMesh`

```typescript
const splats = new SplatMesh({
  // Fetch PLY/SPZ/SPLAT/KSPLAT/SOG/ZIP/RAD file from URL
  url?: string;
  // Decode raw PLY/SPZ/SPLAT/KSPLAT/SOG/ZIP/RAD file bytes
  fileBytes?: Uint8Array | ArrayBuffer;
  // ReadableStream to read file from
  stream?: ReadableStream;
  // Length of stream in bytes
  streamLength?: number;
  // Use PackedSplats object as source
  packedSplats?: PackedSplats;
  // Reserve space for at least this many splats for construction
  maxSplats?: number;
  // Constructor callback to create splats
  constructSplats?: (splats: PackedSplats) => Promise<void> | void;
  // Callback function called while downloading and initializing (default: undefined)
  onProgress?: (event: ProgressEvent) => void;
  // Callback for when mesh initialization is complete
  onLoad?: (mesh: SplatMesh) => Promise<void> | void;
  // Toggle controls whether SplatEdits have an effect, default true
  editable?: boolean;
  // Controls whether SplatMesh participates in Three.js raycasting (default: true)
  raycastable?: boolean;
  // Frame callback to update mesh. Call mesh.updateVersion() if we need to re-generate
  onFrame?: ({
    mesh,
    time,
    deltaTime,
  }: { mesh: SplatMesh; time: number; deltaTime: number }) => void;
  // Object-space and world-space splat modifiers to apply in sequence
  objectModifiers?: GsplatModifier[];
  worldModifiers?: GsplatModifier[];
  // Override the default splat encoding ranges for the PackedSplats.
  // (default: undefined)
  splatEncoding?: SplatEncoding;
  // Set to true to load/use "extended splat" encoding with float32 x/y/z,
  // or use provided ExtSplats object
  extSplats?: boolean | ExtSplats;
  // Enable Level-of-Detail (LoD). If set to true, it will ensure the SplatMesh
  // has a LoD version, whether it's pre-computed in a .RAD file, or generate it
  // on-the-fly in a background WebWorker using the quick tiny-lod algorithm.
  lod?: boolean | number;
  // If set, the original non-LoDd input splats will be retained along with the LoD version.
  // The original splats are in .packedSplats/.extSplats, while the LoD version is contained
  // within those in .packedSplats.lodSplats/.extSplats.lodSplats.
  nonLod?: boolean;
  // If unset, will default to using LoD if the LoD version is available, otherwise
  // falling back to the non-LoD version. If set to true, will force the use of the
  // LoD version if both exist, and vice versa if set to false.
  enableLod?: boolean;
  // LoD detail scale to apply for this particular SplatMesh. 2.0 will 2x the detail
  // while 0.5 well result in 2x coarser (2x larger splats on average).
  lodScale?: number;
  // Set this to true to enable paged splat streaming from a .RAD file.
  paged?: boolean | PagedSplats | SplatPager;
});
// Add to scene to show splats
scene.add(splats);
```

### Optional parameters

You can create a `new SplatMesh()` with no options, which creates a default instance with `.numSplats=0`. You can also initialize from `url`, `fileBytes`, `stream`, or `packedSplats`. Spark supports most splat file formats, including `.ply` (including SuperSplat/gsplat compressed), `.splat`, `.ksplat`, `.spz`, `.sog`, `.zip`, and `.rad`.

Constructor callbacks include `constructSplats` (procedural creation), `onProgress` (download/decode progress), `onLoad` (initialization complete), and `onFrame` (per-frame updates). Splat effects can be injected into the processing pipeline in object-space and world-space via `objectModifiers` and `worldModifiers` (and covariance variants when covariance splats are enabled).

| **Parameter** | Description |
| ------------- | ----------- |
| **url** | `string` URL to fetch a splat file from (`.ply`, `.splat`, `.ksplat`, `.spz`, `.sog`, `.zip`, `.rad`). (default: `undefined`) |
| **fileBytes** | `Uint8Array | ArrayBuffer` raw file bytes to decode directly instead of fetching from URL. (default: `undefined`) |
| **fileType** | `SplatFileType` override for file type detection. Use this for formats like `.splat` / `.ksplat` that may not be reliably auto-detected from content alone. (default: `undefined`) |
| **fileName** | `string` filename hint used for `.splat` / `.ksplat` type inference when using bytes/streams (other file types can usually be detected from content). (default: `undefined`) |
| **stream** | `ReadableStream` source to load and decode from a stream instead of a URL/byte buffer. (default: `undefined`) |
| **streamLength** | `number` total stream length in bytes, used for stream/progress handling. (default: `undefined`) |
| **packedSplats** | `PackedSplats` source to initialize directly from an existing packed splat set instead of decoding a file. (default: `undefined`) |
| **maxSplats** | `number` reserved capacity for at least this many splats during construction. (default: derived from source) |
| **constructSplats** | `(splats: PackedSplats) => Promise<void> | void` callback to procedurally populate a newly created `PackedSplats`. (default: `undefined`) |
| **onProgress** | `(event: ProgressEvent) => void` callback fired while downloading/decoding/initializing. (default: `undefined`) |
| **onLoad** | `(mesh: SplatMesh) => Promise<void> | void` callback fired when initialization is complete. (default: `undefined`) |
| **editable** | `boolean` toggle controlling whether `SplatEdit`s have any effect on this mesh. (default: `true`) |
| **raycastable** | `boolean` controls whether this `SplatMesh` participates in Three.js raycasting. (default: `true`) |
| **onFrame** | `({ mesh, time, deltaTime }) => void` per-frame callback for dynamic updates. Call `mesh.updateVersion()` when changes require splat re-generation. (default: `undefined`) |
| **objectModifiers** | `GsplatModifier[]` object-space modifiers applied in sequence before transforms. (default: `undefined`) |
| **worldModifiers** | `GsplatModifier[]` world-space modifiers applied in sequence after transforms. (default: `undefined`) |
| **covObjectModifiers** | `CovSplatModifier[]` object-space covariance-encoded modifier pipeline (requires covariance splat workflow). (default: `undefined`) |
| **covWorldModifiers** | `CovSplatModifier[]` world-space covariance-encoded modifier pipeline (requires covariance splat workflow). (default: `undefined`) |
| **splatEncoding** | `SplatEncoding` override for default packed splat encoding ranges used by `PackedSplats`. (default: `undefined`) |
| **extSplats** | `boolean | ExtSplats`; set `true` to load/use extended splat encoding (float32 `x/y/z`) or provide an `ExtSplats` source directly. (default: `undefined`) |
| **covSplats** | `boolean`; set `true` to output/use covariance splats for anisotropic scaling (requires `SparkRenderer.covSplats=true`). (default: `undefined`) |
| **lod** | `boolean | number`; `true` ensures LoD is available (from `.rad` if present or generated in a background WebWorker). A `number` sets the LoD exponential base (default base `1.5`). (default: `undefined`) |
| **lodAbove** | `number` threshold: only create LoD when input splat count is at least this value. (default: `undefined`) |
| **nonLod** | `boolean`; when LoD is generated/loaded, keep original non-LoD splats too (`.packedSplats`/`.extSplats` originals, LoD under `.lodSplats`). (default: `undefined`) |
| **enableLod** | `boolean`; when both LoD and non-LoD exist, force LoD (`true`) or non-LoD (`false`). If unset, Spark auto-selects LoD when available. (default: `undefined`, auto behavior) |
| **lodScale** | `number` per-mesh LoD detail scale (`2.0` = ~2x finer, `0.5` = ~2x coarser / larger splats on average). (default: `1`) |
| **behindFoveate** | `number` foveation scale behind viewer (`0.1` means ~10x larger splats behind the viewer). (default: `undefined`) |
| **coneFov0** | `number` full-width angle in degrees for full-detail foveation along view direction. (default: `undefined`) |
| **coneFov** | `number` full-width angle in degrees for reduced-detail foveation region (paired with `coneFoveate`). (default: `undefined`) |
| **coneFoveate** | `number` foveation scale at the edge of `coneFov`. (default: `undefined`) |
| **paged** | `boolean | PagedSplats | SplatPager`; set `true` to enable paged streaming from `.rad`, or provide an existing pager/paged source object. (default: `undefined`) |

## Instance properties

The constructor argument options `packedSplats`, `editable`, `onFrame`, `objectModifiers`, and `worldModifiers` can be modified directly on the `SplatMesh`.

If you modify `packedSplats` you should set `splatMesh.packedSplats.needsUpdate = true` to signal to THREE.js that it should re-upload the data to the underlying texture. Use this sparingly with objects with lower splat counts as it requires a CPU-GPU data transfer for each frame. Thousands to tens of thousands of splats is reasonable. (See `hands.ts` for an example of rendering "splat hands" in WebXR using this technique.)

If you modify `objectModifiers` or `worldModifiers` you should call `splatMesh.updateGenerator()` to update the pipeline and have it compile to run efficiently on the GPU.

Additional properties on a `SplatMesh` instance:

| **Property**      | Description |
| ----------------- | ----------- |
| **initialized**   | A `Promise<SplatMesh>` you can await to ensure fetching, parsing, and initialization has completed
| **isInitialized** | A `boolean` indicating whether initialization is complete
| **recolor**       | A `THREE.Color` that can be used to tint all splats in the mesh. (default: `new THREE.Color(1, 1, 1)`)
| **opacity**       | Global opacity multiplier for all splats in the mesh. (default: `1`)
| **context**       | A `SplatMeshContext` consisting of useful scene and object `dyno` uniforms that can be used to in the splat processing pipeline, for example via `objectModifier` and `worldModifier`. (created on construction)
| **enableViewToObject** | Set to `true` to have the `viewToObject` property in `context` be updated each frame. If the mesh has `extra.sh1` (first order spherical harmonics directional lighting) this property will always be updated. (default: `false` )
| **enableViewToWorld** | Set to `true` to have `context.viewToWorld` updated each frame. (default: `false`)
| **enableWorldToView** | Set to `true` to have `context.worldToView` updated each frame. (default: `false`)
| **skinning**      | Optional `SplatSkinning` instance for animating splats with dual-quaternion skeletal animation. (default: `null`)
| **edits**         | Optional list of `SplatEdit`s to apply to the mesh. If `null`, any `SplatEdit` children in the scene graph will be added automatically. (default: `null`)
| **splatRgba**     | Optional `RgbaArray` to overwrite splat RGBA values with custom values. Useful for "baking" RGB and opacity edits into the `SplatMesh`. (default: `null`)
| **maxSh**         | Maximum Spherical Harmonics level to use. Spark supports up to SH3. Call `updateGenerator()` after changing. (default: `3`)

## `dispose()`

Call this when you are finished with the `SplatMesh` and want to free any buffers it holds (via `packedSplats`).

## `pushSplat(center, scales, quaternion, opacity, color)`

Creates a new splat with the provided parameters (all values in "float" space, i.e. 0-1 for opacity and color) and adds it to the end of the `packedSplats`, increasing `numSplats` by 1. If necessary, reallocates the buffer with an exponential doubling strategy to fit the new data, so it's fairly efficient to `pushSplat(...)` each splat you want to create in a loop.

## `forEachSplat(callback: (index, center, scales, quaternion, opacity, color) => void)`

This method iterates over all splats in this instance's `packedSplats`, invoking the provided callback with `index: number` in `0..=(this.numSplats-1)`, `center: THREE.Vector3`, `scales: THREE.Vector3`, `quaternion: THREE.Quaternion`, `opacity: number` (0..1), and `color: THREE.Color` (rgb values in 0..1). Note that the objects passed in as `center` etc. are the same for every callback invocation: they are reused for efficiency. *Changing these values has no effect* as they are decoded/unpacked copies of the underlying data. To update the `packedSplats`, call `.packedSplats.setSplat(index, center, scales, quaternion, opacity, color)`.


## `getBoundingBox(centers_only=true)`

This method returns a `THREE.Box3` representing the axis-aligned bounding box of all splats in the mesh.
The parameter `centers_only` (boolean, default: `true`) controls whether we calculate the bounding box using only splat center positions, or include the full extent of each splat by considering their scales and orientations. The latter gives a slightly more accurate but more computationally expensive bounding box. 
Note that this function will raise an error if called before splats are initialized.

## `updateGenerator()`

Call this whenever something changes in the splat processing pipeline, for example changing `maxSh` or updating `objectModifiers` or `worldModifiers`. Compiled generators are cached for efficiency and re-used when the same graph structure emerges after successive changes.

## `update(...)`

This is called automatically by `SparkRenderer` and you should not have to call it. It updates parameters for the generated pipeline and calls `updateGenerator()` if the pipeline needs to change.

## `raycast(raycaster, intersects: { distance, point, object}[])`

This method conforms to the standard `THREE.Raycaster` API, performing object-ray intersections using this method to populate the provided `intersects[]` array with each intersection point's `distance: number`, `point: THREE.Vector3`, and `object: SplatMesh`. Note that this method is synchronous and uses a WebAssembly-based ray-splat intersection algorithm that iterates over all points. Raycasting against millions of splats have a noticeable delay, and should not be called every frame.

Usage example:
```javascript
const raycaster = new THREE.Raycaster();
canvas.addEventListener("click", (event) => {
  raycaster.setFromCamera(new THREE.Vector2(
    (event.clientX / canvas.width) * 2 - 1,
    -(event.clientY / canvas.height) * 2 + 1,
  ), camera);
  const intersects = raycaster.intersectObjects(scene.children);
  const splatIndex = intersects.findIndex((i) => i.object instanceof SplatMesh);
});
```
