# SplatMesh

A `SplatMesh` is a high-level interface for displaying and manipulating a "Splat mesh", a collection of Gaussian splats that serves as an object of sorts. It is analagous to a traditional triangle-based `THREE.Mesh`, which consists of geometry (points and triangles) and materials (color and lighting). Similarly, a `SplatMesh` contains geometry (splat centers, orientation, and xyz scales) and materials (RGB color, opacity, spherical harmonics), and can be added anywhere in the scene hierarchy.

The usual THREE.js properties `position`, `quaternion`, `rotation` behave as you would expect, however `scale` only allows uniform scaling and averages the x/y/z scales. Additional properties `recolor` and `opacity` are multiplied in with the final splat color and opacity.

`SplatMesh` is a subclass of the more fundamental `SplatGenerator`, which itself is a subclass of `THREE.Object3D`. Any methods and properties on `Object3D` are also available in `SplatMesh`. `SplatGenerator` gives you more control over splat generation and modification, but `SplatMesh` has an simpler higher-level API.

## Creating a `SplatMesh`

```typescript
const splats = new SplatMesh({
  // Fetch PLY/SPZ/SPLAT/KSPLAT file from URL
  url?: string;
  // Decode raw PLY/SPZ/SPLAT/KSPLAT file bytes
  fileBytes?: Uint8Array | ArrayBuffer;
  // Override file type
  fileType?: SplatFileType;
  // Use PackedSplats object as source
  packedSplats?: PackedSplats;
  // Reserve space for at least this many splats for construction
  maxSplats?: number;
  // Constructor callback to create splats
  constructSplats?: (splats: PackedSplats) => Promise<void> | void;
  // Callback for when mesh initialization is complete
  onLoad?: (mesh: SplatMesh) => Promise<void> | void;
  // Toggle controls whether SplatEdits have an effect, default true
  editable?: boolean;
  // Frame callback to update mesh. Call mesh.updateVersion() if we need to re-generate
  onFrame?: ({
    mesh,
    time,
    deltaTime,
  }: { mesh: SplatMesh; time: number; deltaTime: number }) => void;
  // Object-space and world-space splat modifiers to apply
  objectModifier?: GsplatModifier;
  worldModifier?: GsplatModifier;
});
// Add to scene to show splats
scene.add(splats);
```

### Optional parameters

You can create a `new SplatMesh()` with no options, which will create a new default instance with `.numSplats=0`. Alternatively, you can provide an input `url` to fetch and decode, `fileBytes`, or `packedSplats` (an existing collection of "packed" splats). Spark supports most splat file types, including .ply (including SuperSplat/gsplat compressed), .splat, .ksplat, .spz. To load filetypes .splat and .ksplat (which can't be reliably auto-detected), use the optional `fileType` argument.

Constructor argument callbacks can be used like `constructSplats` to create a collection of splats procedurally at initialization, `onLoad` when loading and initialization completes, `onFrame` to update state every frame. Splat effects can be injected into the standard splat processing pipeline that operate in object-space and world-space via `objectModifier` and `worldModifier` respectively.

| **Parameter**     | Description |
| ----------------- | ----------- |
| **url**           | URL to fetch a Gaussian splat file from (supports .ply, .splat, .ksplat, .spz formats). (default: `undefined`)
| **fileBytes**     | Raw bytes of a Gaussian splat file to decode directly instead of fetching from URL. (default: `undefined`)
| **fileType**      | Override the file type detection for formats that can't be reliably auto-detected (.splat, .ksplat). (default: `undefined` auto-detects other formats from file contents)
| **packedSplats**  | Use an existing PackedSplats object as the source instead of loading from a file. Can be used to share a collection of splats among multiple `SplatMesh`es (default: `undefined` creates a new empty `PackedSplats` or decoded from a data source above)
| **maxSplats**     | Reserve space for at least this many splats when constructing the mesh initially. (default: determined by file)
| **constructSplats** | Callback function to programmatically create splats at initialization in a newly created `PackedSplats`. (default: `undefined`)
| **onLoad**        | Callback function that is called when mesh initialization is complete. (default: `undefined`)
| **editable**      | Controls whether SplatEdits have any effect on this mesh. (default: `true`)
| **onFrame**       | Callback function that is called every frame to update the mesh. Call `mesh.updateVersion()` if splats need to be regenerated due to some change. Calling `updateVersion()` is not necessary for object transformations, recoloring, or opacity adjustments as these changes are auto-detected. (default: `undefined`)
| **objectModifier** | Splat modifier to apply in object-space before any transformations. A `GsplatModifier` is a `dyno` shader-graph block that transforms an input `gsplat: DynoVal<Gsplat>` to an output `gsplat: DynoVal<Gsplat>` with `gsplat.center` and other parameters in object-space. (default: `undefined`)
| **worldModifier** | Splat modifier to apply in world-space after transformations. (default: `undefined`)

## Instance properties

The constructor argument options `packedSplats`, `editable`, `onFrame`, `objectModifier`, and `worldModifier` can be modified directly on the `SplatMesh`.

If you modify `packedSplats` you should set `splatMesh.packedSplats.needsUpdate = true` to signal to THREE.js that it should re-upload the data to the underlying texture. Use this sparingly with objects with lower splat counts as it requires a CPU-GPU data transfer for each frame. Thousands to tens of thousands of splats is reasonable. (See `hands.ts` for an example of rendering "splat hands" in WebXR using this technique.)

If you modify `objectModifier` or `worldModifier` you should call `splatMesh.updateGenerator()` to update the pipeline and have it compile to run efficiently on the GPU.

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

Call this whenever something changes in the splat processing pipeline, for example changing `maxSh` or updating `objectModifier` or `worldModifier`. Compiled generators are cached for efficiency and re-used when the same graph structure emerges after successive changes.

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
