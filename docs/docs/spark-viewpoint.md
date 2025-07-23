# SparkViewpoint

A `SparkViewpoint` is created from and tied to a `SparkRenderer`, and represents an independent viewpoint of all the scene splats and their sort order. Making these viewpoints explicit allows us to have multiple, simultaneous viewpoint renders, for example for camera preview panes or overhead map views.

When creating a `SparkRenderer` it automatically creates a default viewpoint `.defaultView` that is used in the normal render loop when drawing to the canvas, and is automatically updated whenever the camera moves. Additional viewpoints can be created and configured separately:

## Creating a `SparkViewpoint`

```typescript
const viewpoint = spark.newViewpoint({
  autoUpdate?: boolean;
  camera?: THREE.Camera;
  viewToWorld?: THREE.Matrix4;
  target?: {
    width: number;
    height: number;
    doubleBuffer?: boolean;
    superXY?: number;
  };
  onTextureUpdated?: (texture: THREE.Texture) => void;
  sortRadial?: boolean;
  sortDistance?: number;
  sortCoorient?: boolean;
  depthBias?: number;
  sort360?: boolean;
  sort32?: boolean;
  stochastic?: boolean;
});
```

### Optional parameters

| **Parameter**     | Description |
| ----------------- | ----------- |
| **autoUpdate**    | Controls whether to auto-update its sort order whenever the SparkRenderer updates the splats. If you expect to render/display from this viewpoint most frames, set this to `true`. (default: `false`)
| **camera**        | Set a `THREE.Camera` for this viewpoint to follow. (default: `undefined`)
| **viewToWorld**   | Set an explicit view-to-world transformation matrix for this viewpoint (equivalent to `camera.matrixWorld`), overrides any `camera` setting. (default: `undefined`)
| **target**        | Configure viewpoint with an off-screen render target. (default: `undefined`)
| **target.width**  | Width of the render target in pixels.
| **target.height** | Height of the render target in pixels.
| **target.doubleBuffer** | If you want to be able to render a scene that depends on this target's output (for example, a recursive viewport), set this to `true` to enable double buffering. (default: `false`)
| **target.superXY** | Super-sampling factor for the render target. Values 1-4 are supported. Note that re-sampling back down to `.width` x `.height` is done on the CPU with simple averaging only when calling `readTarget()`. (default: `1`)
| **onTextureUpdated** | Callback function that is called when the render target texture is updated. Receives the texture as a parameter. Use this to update a viewport with the latest viewpoint render each frame. (default: `undefined`)
| **sortRadial**    | Whether to sort splats radially (geometric distance) from the viewpoint (true) or by Z-depth (false). Most scenes are trained with the Z-depth sort metric and will render more accurately at certain viewpoints. However, radial sorting is more stable under viewpoint rotations. (default: `true`)
| **sortDistance**  | Distance threshold for re-sorting splats. If the viewpoint moves more than this distance, splats will be re-sorted. (default: `0.01` units)
| **sortCoorient**  | View direction dot product threshold for re-sorting splats. For `sortRadial: true` it defaults to 0.99 while `sortRadial: false` uses 0.999 because it is more sensitive to view direction. (default: `0.99` if `sortRadial` else `0.999`)
| **depthBias**     | Constant added to Z-depth to bias values into the positive range for `sortRadial: false`, but also used for culling splats "well behind" the viewpoint origin (default: `1.0`)
| **sort360**       | Set this to true if rendering a 360 to disable "behind the viewpoint" culling during sorting. This is set automatically when rendering 360 envMaps using the `SparkRenderer.renderEnvMap()` utility function. (default: `false`)
| **sort32**        | Set this to true to sort with float32 precision with two-pass sort. (default: `false`)
| **stochastic**    | Set this to true to enable sort-free stochastic splat rendering. (default: `false`)

## `dispose()`

Call this when you are done with the `SparkViewpoint` and want to free up its resources (GPU targets, pixel buffers, etc.)

## `setAutoUpdate(autoUpdate: boolean)`

Use this function to change whether this viewpoint will auto-update its sort order whenever the attached `SparkRenderer` updates the splats. Turn this on or off depending on whether you expect to do renders from this viewpoint for most frames.

## `async prepareRenderPixels({ scene, camera?, viewToWorld?, update?, forceOrigin? })`

Render out a viewpoint as a Uint8Array of RGBA values for the provided scene and any `camera`/`viewToWorld` viewpoint overrides. By default `update` is `true`, which triggers its `SparkRenderer` to check and potentially update the splats. Setting `update` to `false` disables this and sorts the splats as they are. Setting `forceOrigin` (default: `false`) to `true` forces the view update to recalculate the splats with this view origin, potentially altering any view-dependent effects. If you expect view-dependent effects to play a role in the rendering quality, enable this.

Underneath, `prepareRenderPixels()` simply calls `await this.prepare(...)`, `this.renderTarget(...)`, and finally returns the result of `this.readTarget()`, a Promise to a Uint8Array with RGBA values for all the pixels (potentially downsampled if the `superXY` parameter was used). These steps can also be called manually, for example if you need to alter the scene before and after `this.renderTarget(...)` to hide UI elements from being rendered.

## `async prepare({ scene, camera?, viewToWorld?, update?, forceOrigin? })`

See above `async prepareRenderPixels()` for explanation of parameters. Awaiting this method updates the splats in the scene and performs a sort of the splats from this viewpoint, preparing it for a subsequent `this.renderTarget()` call in the same tick.

## `renderTarget({ scene, camera? })`

Render out the viewpoint to the view target RGBA buffer. Swaps buffers if `doubleBuffer: true` was set. Calls `onTextureUpdated(texture)` with the resulting texture.

## `async readTarget()`

Read back the previously rendered target image as a Uint8Array of packed RGBA values (in that order). If `superXY` was set greater than `1` than downsampling is performed in the target pixel array with simple averaging to derive the returned pixel values. Subsequent calls to `this.readTarget()` will reuse the same buffers to minimize memory allocations.

## `autoPoll()`

This is called automatically by `SparkRenderer`, there is no need to call it! The method cannot be private because then SparkRenderer would not be able to call it.

## `SparkViewpoint.EMPTY_TEXTURE`

If you need an empty `THREE.Texture` to use to initialize a uniform that is updated via `onTextureUpdated(texture)`, this static texture can be handy.
