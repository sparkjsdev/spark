# Spark 2.0 Quick Start

To use Spark 2.0, use class `NewSparkRenderer` and add it to your scene instead of the old `SparkRenderer`:
```
const spark = new NewSparkRenderer({
  renderer: THREE.WebGLRenderer,
});
scene.add(spark);
```

To enable LoD rendering for a `SplatMesh`, set `lod: true` when instantiating the `SplatMesh` or `PackedSplats`. This will invoke the tiny-lod algorithm and run it in a background WebWorker, and may take a few seconds (< 5M splats) or a minute (up to 30M splats or so).
```
const splats = new SplatMesh({ url: "./my-splats.spz", lod: true });
scene.add(splats);
```

However, it is recommended that you pre-build the LoD tree and load that instead, by running `npm run build-lod my-splats.ply more-splats.spz` (alternatively you can `cd rust/build_lod && cargo run --release -- my-splats.ply...`). To see the list of options, run `npm run build-lod` by itself. One option you may want to use is `--quality` to enable higher-quality LoD tree generation at the expense of slower creation time.

The output will be a new .RAD file that can be loaded in Spark and optionally streamed in. Simply create a new SplatMesh pointing to the .RAD file (no `lod: true` necessary because the file encodes that information). To enable paged streaming, set `paged: true`, i.e. `new SplatMesh({ url: "./my-splats-lod.rad", paged: true })`.

Spark 2.0 also supports a new "extended splats" encoding for huge scenes. Note that this is only needed if the splat file encodes center coordinates that don't fit well within a float16 and causes striping/pixelation or other artifacting. To enable this, set `extSplats: true` when loading the SplatMesh, which will create an `ExtSplats` object instead of a `PackedSplats`. To enable extended splat encoding for paged/streaming, set `pagedExtSplats: true` when creating the `NewSparkRenderer`.

For more information, please refer to the [NewSparkRenderer](new-spark-renderer.md) documentation.
