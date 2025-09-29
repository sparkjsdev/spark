# SparkRenderer

## Optionally adding to your `THREE.Scene`

Spark internally uses a `SparkRenderer` object in your `THREE.Scene` to perform splat rendering. Spark will automatically create a `SparkRenderer` and add it to your scene if you don't create one yourself. For more advanced use cases such as multiple viewpoints or rendering environment maps, you can create your own `SparkRenderer` and add it anywhere in the scene, for example at the root:
```typescript
const spark = new SparkRenderer({
  renderer: myThreeJsWebGlRenderer,
});
const scene = new THREE.Scene();
scene.add(spark);
```

## Larger scenes

All scene splats are accumulated by SplatAccumulator into a single global PackedSplats, whose coordinates are relative to the SparkRenderer's origin. Splats that are far away from this origin may exhibit float16 quantization artifacts, so if you plan on moving the camera large distances you can instead add `SparkRenderer` as a child of your `THREE.Camera`, ensuring that coordinates will have higher precision near the camera viewpoint:
```javascript
const aspect = canvas.width / canvas.height;
const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
scene.add(camera);
// Add SparkRenderer as a child of camera to follow it
camera.add(spark);
```

## Creating a `SparkRenderer`

```typescript
const spark = new SparkRenderer({
  renderer: THREE.WebGLRenderer;
  clock?: THREE.Clock;
  autoUpdate?: boolean;
  preUpdate?: boolean;
  originDistance?: number;
  maxStdDev?: number;
  enable2DGS?: boolean;
  preBlurAmount?: number;
  blurAmount?: number;
  focalDistance?: number;
  apertureAngle?: number;
  falloff?: number;
  clipXY?: number;
  focalAdjustment?: number;
  view?: SparkViewpointOptions;
});
```
### Required parameters
| **Parameter** | Description |
| ------------- | ----------- |
| **renderer**  | Pass in your `THREE.WebGLRenderer` instance so Spark can perform work outside the usual render loop. Should be created with `antialias: false` (default setting) as WebGL anti-aliasing doesn't improve Gaussian Splatting rendering and significantly reduces performance.

### Optional parameters

| **Parameter**     | Description |
| ----------------- | ----------- |
| **clock**         | Pass in a `THREE.Clock` to synchronize time-based effects across different systems. Alternatively, you can set the `SparkRenderer` properties `time` and `deltaTime` directly. (default: `new THREE.Clock`)
| **autoUpdate**    | Controls whether to check and automatically update splat collection after each frame render. (default: `true`)
| **preUpdate**     | Controls whether to update the splats before or after rendering. For WebXR this *must* be false in order to complete rendering as soon as possible. (default: `false`)
| **originDistance** | Distance threshold for `SparkRenderer` movement triggering a splat update at the new origin. (default: `1.0`) This can be useful when your `SparkRenderer` is a child of your camera and you want to retain high precision coordinates near the camera.
| **maxStdDev**     | Maximum standard deviations from the center to render Gaussians. Values `Math.sqrt(5)`..`Math.sqrt(9)` produce good results and can be tweaked for performance. (default: `Math.sqrt(8)`)
| **minPixelRadius** | Minimum pixel radius for splat rendering. (default: `0.0`)
| **maxPixelRadius** | Maximum pixel radius for splat rendering. (default: `512.0`)
| **minAlpha**      | Minimum alpha value for splat rendering. (default: `0.5 * (1.0 / 255.0)`)
| **enable2DGS**    | Enable 2D Gaussian splatting rendering ability. When this mode is enabled, any `scale` x/y/z component that is exactly `0` (minimum quantized value) results in the other two non-zero axes being interpreted as an oriented 2D Gaussian Splat instead of the usual approximate projected 3DGS Z-slice. When reading PLY files, scale values less than e^-30 will be interpreted as `0`. (default: `false`)
| **preBlurAmount** | Scalar value to add to 2D splat covariance diagonal, effectively blurring + enlarging splats. In scenes trained without the splat anti-aliasing tweak this value was typically 0.3, but with anti-aliasing it is 0.0 (default: `0.0`)
| **blurAmount**    | Scalar value to add to 2D splat covariance diagonal, with opacity adjustment to correctly account for "blurring" when anti-aliasing. Typically 0.3 (equivalent to approx 0.5 pixel radius) in scenes trained with anti-aliasing.
| **focalDistance** | Depth-of-field distance to focal plane (default: `0.0`)
| **apertureAngle** | Full-width angle of aperture opening from pinhole camera origin in radians (default: `0.0` to disable)
| **falloff**       | Modulate Gaussian kernel falloff. 0 means "no falloff, flat shading", while 1 is the normal Gaussian kernel. (default: `1.0`)
| **clipXY**        | X/Y clipping boundary factor for splat centers against view frustum. 1.0 clips any centers that are exactly out of bounds (but the splat's entire projection may still be in bounds), while 1.4 clips centers that are 40% beyond the bounds. (default: `1.4`)
| **focalAdjustment** | Parameter to adjust projected splat scale calculation to match other renderers, similar to the same parameter in the MKellogg 3DGS renderer. Higher values will tend to sharpen the splats. A value 2.0 can be used to match the behavior of the PlayCanvas renderer.  (default: `1.0`)
| **view**          | Configures the `SparkViewpointOptions` for the default `SparkViewpoint` associated with this `SparkRenderer`. Notable option: `sortRadial` (sort by radial distance or Z-depth)

## `newViewpoint(options: SparkViewpointOptions)`

Create a new `SparkViewpoint` for this `SparkRenderer`. Note that every `SparkRenderer` has an initial `spark.defaultView: SparkViewpoint` created during construction, which is used for default canvas rendering. Calling this method allows you to create additional viewpoints, which can be updated automatically each frame (performing splat sorting every time there is an update), or updated on-demand for controlled rendering for video frame rendering or similar applications.

## `update({ scene })`

If `spark.autoUpdate` is `false` then you must manually call `spark.update({ scene })` to have the scene splats re-generated.

## `renderEnvMap({ renderer, scene, worldCenter, ... })`

Renders out the scene to an environment map that can be used for image-based lighting or similar applications. First updates splats, sorts them with respect to the provided `worldCenter`, renders 6 cube faces, then pre-filters them using `THREE.PMREMGenerator` and returns a `THREE.Texture` that can assigned directly to a `THREE.MeshStandardMaterial.envMap` property.

## `recurseSetEnvMap(root, envMap)`

Utility function to recursively set the `envMap` property for any `THREE.MeshStandardMaterial` within the subtree of `root`.

## `getRgba({ generator, ... })`

Utility function that helps extract the splat RGBA values from a `SplatGenerator`, including the result of any real-time RGBA SDF edits applied to a `SplatMesh`. This effectively "bakes" any computed RGBA values, which can now be used as a pipeline input via `SplatMesh.splatRgba` to inject these baked values into the splat data.

## `readRgba({ generator, ...})`

Utility function that builds on `getRgba({ generator })` and additionally reads back the RGBA values to the CPU in a Uint8Array with packed RGBA in that byte order.
