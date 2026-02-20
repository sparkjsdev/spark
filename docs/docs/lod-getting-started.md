# Getting Started with Level-of-Detail

To get started with the new Level-of-Detail (LoD) features in Spark 2.0, the two simplest approaches are:

### 1. Create your `SplatMesh` with the new `lod` flag
```javascript
const splats = new SplatMesh({ url: "./my-splats.spz", lod: true });
scene.add(splats);
```

This will load the splat file and create an LoD version of it in a background WebWorker (1-3 seconds per 1M input splats), supporting up to 30M or so input splats. Once the creation is complete, Spark will automatically render downsampled versions of your splats within a reasonable splat count budget for your platform.

### 2. Pre-build the LoD tree for faster loading and streaming (recommended approach)

Create the LoD tree from the command line and load the resulting .RAD file:
```shell
npm run build-lod -- my-splats.ply more-splats.spz --quality
```
This will output files `my-splats-lod.rad` and `more-splats-lod.rad`. These can be loaded directly by Spark:
```javascript
const splats = new SplatMesh({ url: "./my-splats-lod.rad" });
scene.add(splats);
```
Note that the `lod: true` flag is unnecessary because the .RAD file encodes that information.

For instant loading you can stream the .RAD file, simply by setting the `paged` flag:
```javascript
const splats = new SplatMesh({ url: "./my-splats-lod.rad", paged: true });
scene.add(splats);
```

## Handling huge coordinates

Spark internally defaults to a compact 16 bytes/splat encoding `PackedSplats` to save memory and increase performance (through less memory bandwidth). However, splat center coordinates are stored as float16, which has 0.1% relative precision, meaning coordinates that are 1000 units away will only allow steps of 1 unit, which can cause striping or other quantization artifacts.

Spark 2.0 supports a new `ExtSplats` extended splat encoding that uses 32 bytes/splat and stores center coordinates as float32 (along with other precision/range improvements). Because this can slightly reduce perforance, you should explicitly enable it where you need it:

1. **Increased precision for loaded splats:** If the splat file itself has large coordinates, you can enable `ExtSplats` when creating the `SplatMesh`:
```javascript
new SplatMesh({ url: "./my-splats.spz", extSplats: true });
```
This will decode the splat file into the extended encoding format.

2. **Increased precision for streamed/pooled splats:** A `SplatMesh` loaded with the `paged` flag will use a shared pool of splat buffers. Choosing `ExtSplats` for this pool is controlled by `SparkRenderer` during construction:
```
const spark = new SparkRenderer({
    renderer,
    pagedExtSplats: true,
});
scene.add(spark);
```
Once this is set, all `SplatMesh`s loaded with the `paged` flag will use the extended encoding format.

Spark also allows you to control the intermediate global splat collection in `SplatAccumulator` through the additional option `SparkRenderer.accumExtSplats`. However, this is typically not necessary as Spark will encode the splats relative to the camera viewpoint, ensuring more precision is focused near the viewer where it matters.

## Tuning LoD detail and performance

Spark's LoD system allows you to trade off between quality (more splats rendered) and performance (less splats, faster updates). You may need to tinker with the LoD parameters to achieve the right balance for your application.

### Adjusting the LoD splat count budget

There are two main parameters for adjusting the # splat selected by the LoD system and rendered to the screen:

- `SparkRenderer.lodSplatCount`: Set the base nubmer of LoD splats to render. If not set, this will be automatically set based on the platform: 500K for Oculus, 750K for Vision Pro, 1M for Android, 1.5M for iOS, and 2.5M for desktop. It is recommended to leave this alone and use the next parameter instead, so your application scales automatically by platform.

- `SparkRenderer.lodSplatScale`: LoD splat count multiplier. By default this is 1.0, and setting it to 2.0 will result in 2x the `lodSplatCount` budget. Adjusting this is the easiest way to adjust detail vs. performance.

### Shaping the selected LoD splats

Spark implements a fixed foveation system that allows you to emphasize splats directly in front of the viewer, falling off as the angle from the center increases. By default Spark will select splats around the viewer such that they all have roughly the same size based on distance. Setting foveation parameters will bias the selected splats toward the front direction, which matches human visual acuity. To adjust the shape, use the following parameters:

- `SparkRenderer.behindFoveate`: Foveation scale to apply to LoD splats behind the viewer. Setting this to 0.1 for example will result in splats 10x larger behind the viewer compared to in front.

- `SparkRenderer.coneFov0`: Full-width angle in degrees of a cone around the view direction that will have "full resolution" (foveation=1.0).

- `SparkRenderer.coneFov`: Full-width angle in degrees of a cone around the view direction that will have "reduced resolution" specified by the next parameter.

- `SparkRenderer.coneFoveate`: Foveation to apply at the `coneFov` angle. The foveation will scale smoothly from 1.0 down to `coneFoveate` as the angle goes from `coneFov0` to `coneFov`. From `coneFov` to 180 degrees (behind the viewer), the foveation will scale smoothly from `coneFoveate` down to `behindFoveate`.

Choosing these parameters well will focus the "splat budget" towards the frontal direction, resulting in more detail where the user is looking. When the viewpoint changes, the LoD system will update the selected splats to maintain the foveation shape, but there will be some latency in the update. Higher total splat budgets (for example by increasing `lodSplatScale`) will result in longer delays updating the selected shapes, so carefully selecting foveation parameters and splat count to balance detail vs. slower updates is important.

### Biasing individual `SplatMesh` LoD budgets

The above parameters adjust the global splat LoD parameters, but you can also adjust individual `SplatMesh`es to emphasize/de-emphasize particular objects. To do this, set/adjust the following parameters on the `SplatMesh` object:

- `SplatMesh.lodScale`: LoD detail scale factor for this object. Setting this to 2.0 results in 2x finer detail for this object, while setting to 0.5 will result in 2x coarser splats.

- `SplatMesh.behindFoveate` / `SplatMesh.coneFov0` / `SplatMesh.coneFov` / `SplatMesh.coneFoveate`: Override the global `SparkRenderer.behindFoveate` / `SparkRenderer.coneFov0` / `SparkRenderer.coneFov` / `SparkRenderer.coneFoveate` for this object.

## `build-lod` command-line tool

To pre-build an LoD tree for a splat file and output a `.RAD` that can be loaded faster in Spark and even streamed in, use the `build-lod` command-line tool:
```shell
npm run build-lod -- my-splats.ply more-splats.spz [..options]
```

NOTE 1: The additional `--` in the options tells `npm` that the following options are for the `build-lod` program. This is necessary if you have additional options that start with `-`/`--`, which will confuse `npm.

NOTE 2: Building and running the `build-lod` tool requires Rust to be installed. The recommended approach is by installing `rustup` as described on the main Rust page: https://rust-lang.org/tools/install/

Calling `npm run build-lod` invokes the Rust program in `rust/build-lod`, and you can build or run it directly:
```shell
cd rust/build-lod
cargo build --release
cargo run --release -- my-splats.ply more-splats.spz [..options]
```
The `--release` option is important, without it the LoD building will run very slowly!

To get help for the command, run it without any parameters:
```shell
npm run build-lod
Usage: build-lod
  [--unlod]              // Remove LoD nodes with children from file
  [--csplat] [--gsplat]  // Use compact (csplat) or higher-precision (default gsplat) splat encoding
  [--quick] [--quality]  // Use quick (tiny-lod) or quality (bhatt-lod) LoD method (default quick)
...
```

For each input file `my-splats.ply` the tool will output a file `my-splats-lod.rad`, appending the `-lod` suffix to make it clear that it is an LoD tree file. There is also an `--spz` output option that will output a non-standard SPZ file that can be loaded in Spark, but has been deprecated in favor of the new RAD file which supports configurable encoding as well as streaming.

The most important options are:

- `--quick`: Use the fast, compact `tiny-lod` method (default setting, no need to specify)
- `--quality`: Use the higher-quality, slower `bhatt-lod` method. Recommended for offline LoD tree building and streaming.
- `--max-sh=#`: Limit the maximum Spherical Harmonics encoded, from 0..3.

The tool `build-lod` supports most splat file formats: .ply (including PlayCanvas compressed), .spz, .splat, .ksplat, .sog, .zip (containing SOGS files). It also accepts multiple file inputs, so you can for example run:
```shell
npm run build-lod -- splats-dir/*.spz --quality
```
Each file will have an `-lod.rad` suffix and extension added to it.
