# SparkRenderer

Spark internally uses a `SparkRenderer` object in your `THREE.Scene` to perform splat rendering. Spark will automatically create a `SparkRenderer` and add it to your scene if you don't create one yourself. For more advanced use cases such as multiple viewpoints, rendering environment maps, or tuning rendering parameters such as Level-of-Detail (LoD), you can create your own `SparkRenderer` and add it anywhere in the scene, for example at the root:
```typescript
const spark = new SparkRenderer({
  renderer: myThreeJsWebGlRenderer,
});
const scene = new THREE.Scene();
scene.add(spark);
```

## Creating a `SparkRenderer`

```typescript
const spark = new SparkRenderer({
  // Commonly used parameters
  renderer: THREE.WebGLRenderer;
  maxStdDev?: number;
  focalDistance?: number;
  apertureAngle?: number;
  falloff?: number;
  focalAdjustment?: number;
  sortRadial?: boolean;
  lodSplatScale?: number;

  pagedExtSplats?: boolean;
  target?: { width: number; height: number; doubleBuffer?: boolean },
});
```

### Required parameters
| **Parameter** | Description |
| ------------- | ----------- |
| **renderer**  | Pass in your `THREE.WebGLRenderer` instance so Spark can perform work outside the usual render loop. Should be created with `antialias: false` (default setting) as WebGL anti-aliasing doesn't improve Gaussian Splatting rendering and significantly reduces performance.

### Optional parameters

| **Parameter**     | Description |
| ----------------- | ----------- |
| **premultipliedAlpha** | Whether to use premultiplied alpha when accumulating splat RGB. (default: `true`)
| **encodeLinear**    | Whether to encode Gsplat with linear RGB (for example for rendering environment maps). (default: `false`)
| **clock**         | Pass in a `THREE.Clock` to synchronize time-based effects across different systems. Alternatively, you can set the `SparkRenderer` properties `time` and `deltaTime` directly. (default: `new THREE.Clock`)
| **autoUpdate**    | Controls whether to check and automatically update splat collection each frame render. (default: `true`)
| **preUpdate**     | Controls whether to update the splats before or after rendering. For WebXR this is set to `false` in order to complete rendering as soon as possible. (default: `true` if not WebXR)
| **maxStdDev**     | Maximum standard deviations from the center to render Gaussians. Values `Math.sqrt(4)`..`Math.sqrt(9)` produce acceptable results and can be tweaked for performance. (default: `Math.sqrt(8)`)
| **minPixelRadius** | Minimum pixel radius for splat rendering. (default: `0.0`)
| **maxPixelRadius** | Maximum pixel radius for splat rendering. (default: `512.0`)
| **accumExtSplats** | Whether to use extended Gsplat encoding for intermediary accumulator splats. This is typically not necessary because Spark will encode data relative to the camera origin, giving higher precision where it's needed around the viewer. (default: `false`)
| **covSplats**     | *Experimental:* Control whether to use covariance Gsplat encoding for intermediary accumulator splats, which enables non-uniform `SplatMesh` scaling. Note this requires `accumExtSplats: true` for precision reasons. (default: `false`)
| **minAlpha**      | Minimum alpha value for splat rendering. (default: `0.5 * (1.0 / 255.0)`)
| **enable2DGS**    | Enable 2D Gaussian splatting rendering ability. When this mode is enabled, any `scale` x/y/z component that is exactly `0` (minimum quantized value) results in the other two non-zero axes being interpreted as an oriented 2D Gaussian Splat instead of the usual approximate projected 3DGS Z-slice. When reading PLY files, scale values less than e^-30 will be interpreted as `0`. (default: `false`)
| **preBlurAmount** | Scalar value to add to 2D splat covariance diagonal, effectively blurring + enlarging splats. In scenes trained without the splat anti-aliasing tweak this value was typically 0.3, but with anti-aliasing it is 0.0 (default: `0.0`)
| **blurAmount**    | Scalar value to add to 2D splat covariance diagonal, with opacity adjustment to correctly account for "blurring" when anti-aliasing. Typically 0.3 (equivalent to approx 0.5 pixel radius) in scenes trained with anti-aliasing.
| **focalDistance** | Depth-of-field distance to focal plane (default: `0.0`)
| **apertureAngle** | Full-width angle of aperture opening from pinhole camera origin in radians (default: `0.0` to disable)
| **falloff**       | Modulate Gaussian kernel falloff. 0 means "no falloff, flat shading", while 1 is the normal Gaussian kernel. (default: `1.0`)
| **clipXY**        | X/Y clipping boundary factor for splat centers against view frustum. 1.0 clips any centers that are exactly out of bounds (but the splat's entire projection may still be in bounds), while 1.4 clips centers that are 40% beyond the bounds. (default: `1.4`)
| **focalAdjustment** | Parameter to adjust projected splat scale calculation to match other renderers, similar to the same parameter in the MKellogg 3DGS renderer. Higher values will tend to sharpen the splats. A value 2.0 can be used to match the behavior of the PlayCanvas renderer.  (default: `1.0`)
| **sortRadial**    | Whether to sort splats radially (geometric distance) from the viewpoint (true) or by Z-depth (false). Most scenes are trained with the Z-depth sort metric and will render more accurately at certain viewpoints. However, radial sorting is more stable under viewpoint rotations and eliminates the dreaded "black side bars" when turning quickly. (default: `true`)
| **minSortIntervalMs** | Minimum interval between sort calls in milliseconds. (default: `0`)
| **enableLod**    | Flag to control whether LoD rendering is enabled. Individual `SplatMesh` objects must also opt-in by creating an LoD tree, for example using `{ lod: true }` during construction or loading a pre-built .RAD file. (default: `true`)
| **enableDriveLod** | Flag to control whether to drive LoD updates (compute lodInstances, update pager, etc.). Set to false to use LoD instances from another renderer without driving updates. Only has effect if enableLod is true. (default: `true` if enableLod is true)
| **lodSplatCount** | Set the target # splats for LoD. If this isn't set then default base LoD splat counts will apply: 500K-750K for WebXR, 1-1.5M for mobile, and 2.5M for desktop.
| **lodSplatScale** | Scale factor for target # splats for LoD. 2.0 means 2x the base LoD splat count. This is the easiest LoD parameter to adjust and will scale detail appropriately for the platform. (default: `1.0`)
| **lodRenderScale** | Determines the minimum screen pixel size of LoD splats. The default 1.0 means the splat LoD tree will pick splats that are no smaller than 1 pixel in size. Setting this to a higher value as high as 5.0 will often be indistinguishable but will avoid wasting rendering capacity on tiny splats. (default: `1.0`)
| **pagedExtSplats** | Whether to use extended Gsplat encoding for paged splats, useful for eliminating quantization artifacts from splat scenes with large internal position coordinates. (default: `false`)
| **maxPagedSplats** | Allocation size of paged splats. This must be a multiple of the page size (65536). (default: `16777216` for desktop, `6291456` for iOS, `8,388,608` for other mobile)
| **numLodFetchers** | Number of parallel chunk fetchers for LoD. These are run within a shared pool of 4 background WebWorker threads, so setting it above 4 will not have any effect. Setting it 3 leaves one spare worker for other loading/decoding tasks. (default: `3`)
| **coneFov0** | Full-width angle in degrees of fixed foveation cone along the view direction with no foveation applied (full resolution, foveate=1.0). (default: `0.0`)
| **coneFov** | Full-width angle in degrees of fixed foveation cone along the view direction with reduced resolution specified by `coneFoveate`. Foveation will be applied smoothly from 1.0 down to `coneFoveate` as you move outward from `coneFov0` to `coneFov`. (default: `0.0`)
| **coneFoveate** | Foveation scale to apply to LoD splats at the edge of coneFov. Foveation will be applied smoothly from `coneFoveate` down to `behindFoveate` as you move outward from `coneFov` to 180 degrees (behind the viewer). (default: `1.0`)
| **behindFoveate** | Foveation scale to apply to LoD splats behind the viewer. Setting this to 0.1 for example will result in splats 10x larger than inside the viewing frustum. (default: `1.0`)
| **target**        | Configures an offline render target for the `SparkRenderer` (as opposed to rendering to the canvas). This is useful for rendering environment maps, additional viewpoints, or video frame rendering. (default: `undefined`)
| **target.width**  | Width of the render target in pixels.
| **target.height** | Height of the render target in pixels.
| **target.doubleBuffer** | If you want to be able to render a scene that depends on this target's output (for example, a recursive viewport), set this to true to enable double buffering. (default: `false`)
| **target.superXY** | Super-sampling factor for the render target. Values 1-4 are supported. Note that re-sampling back down to .width x .height is done on the CPU with simple averaging only when calling `readTarget()`. (default: `1`)
| **extraUniforms** | Extra uniform values to pass to the shader. (default: undefined = no extra uniforms)
| **vertexShader** | Replace the default `splatVertex.glsl` splat shader with a custom one. (default: undefined = use the default `splatVertex.glsl` shader)
| **fragmentShader** | Replace the default `splatFragment.glsl` splat shader with a custom one. (default: undefined = use the default `splatFragment.glsl` shader)
| **transparent** | Set the splat shader material to be transparent which determines if the splats are rendered during the first opaque THREE.js render pass or the second transparent render pass. (default: undefined = true)
| **depthTest** | Set the splat shader material to enable depth testing which determines if the splats respect the Z depth buffer and blend with other opaque objects in the scene. (default: undefined = true)
| **depthWrite** | Set the splat shader material to enable depth writing which determines if the splats write to the Z depth buffer. Note that enabling this may produce undesirable results because most of the Gsplat is transparent. (default: undefined = false)

## `dispose()`

Dispose of the `SparkRenderer` and all associated resources. Mainly useful
for secondary renderers that you've create but no longer need. If you are
repeatedly creating and disposing of renderers, make sure to clean up so you
don't run out of GPU resources.

## `update({ scene, camera })`

If `spark.autoUpdate` is `false` or this is a secondary renderer that isn't
driven by a `setAnimationLoop` then you must manually call `spark.update({ scene })` to have the scene splats re-generated. Awaiting this call will make sure splat sorting
has completed and can be rendered correctly in a synchronous call.

## `render(scene, camera)`

Render the scene to the canvas. Note that this is mostly useful for invoking
secondary `SparkRenderer`s. Calling your THREE.js renderer's `render()` method
will do the same thing using the default `SparkRenderer` that is attached to the
scene. Calling this method on a secondary `SparkRenderer` will use its set of
splats and render parameters instead of the default one.

## `renderTarget({ scene, camera })`

Render the scene to the render target (specified using the `target` parameter during construction). To ensure correct sorting in an offline render loop, make sure you
call and await `spark.update({ scene, scene })` before calling this method.
If `doubleBuffer: true` was set during target construction, this will swap the
back buffer and target, and return the target.

## `readTarget()`

Read back the previously rendered target image as a Uint8Array of packed RGBA values (in that order). If `superXY` was set greater than `1` then downsampling is performed in the target pixel array with simple averaging to derive the returned pixel values. Subsequent calls to `this.readTarget()` will reuse the same buffers to minimize memory allocations.

## `renderReadTarget({ scene, camera })`

Convenience method that renders the scene to the target and then reads back the result.

## `renderCubeMap({ scene, worldCenter, ... })`

Renders out the scene to a cube map that can used for Image-based lighting,
rendering out depth maps, or similar applications, and returns a `THREE.CubeTexture`.

## `readCubeTargets()`

Read back the 6 cube faces from a previous `renderCubeMap()` call into 6 RGBA Uint8Array buffers.

## `renderEnvMap({ scene, worldCenter, ... })`

Renders out the scene to an environment map that can be used for image-based lighting or similar applications. First updates splats, sorts them with respect to the provided `worldCenter`, renders 6 cube faces, then pre-filters them using `THREE.PMREMGenerator` and returns a `THREE.Texture` that can assigned directly to a `THREE.MeshStandardMaterial.envMap` property for environment mapped lighting.

## `recurseSetEnvMap(root, envMap)`

Utility function to recursively set the `envMap` property for any `THREE.MeshStandardMaterial` within the subtree of `root`.
