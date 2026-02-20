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

## Tuning LoD detail and performance

Spark's LoD system allows you to trade off between quality (more splats rendered) and performance (less splats, faster updates). You may need to tinker with the LoD parameters to achieve the right balance for your application.

[TODO]

## `build-lod` command-line tool

[TODO]
