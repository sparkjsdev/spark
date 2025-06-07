# Loading Splats

Spark provides loaders for most popular splat file formats, including `.ply` (original "gsplat" format, compressed SuperSplat/gsplat variant, and plain x/y/z/r/g/b point clouds) and `.spz` (Niantic open source compressed format), both auto-detected from the file contents.

Spark can also load formats `.splat` (from [`antimatter15/splat`](https://github.com/antimatter15/splat)) and `.ksplat` (from [`mkkellogg/GaussianSplats3D`](https://github.com/mkkellogg/GaussianSplats3D)) if the file type can be inferred from the URL/path extension, or set explicitly using the `fileType` property when creating a `SplatMesh` or `PackedSplats`.

## Loading auto-detectable formats `.ply` and `.spz`

Adding an individual `SplatMesh` from an auto-detectable format is easy and can be done as simply as:

```javascript
// Load and create SplatMesh in one go
const splats = new SplatMesh({ url: "./butterfly.ply" });
scene.add(splats);

// No file extension but we can auto-detect format from the contents
scene.add(new SplatMesh({ url: "plyBin/0123456789abcdef" }));
scene.add(new SplatMesh({ url: "spzBin/fedcba9876543210" }));
```

### Load via `PackedSplats`

Alternatively, you can load a `.ply` or `.spz` into a `PackedSplats`, which can then be used as an input source for multiple `SplatMesh` instances in the scene.

```javascript
const packedSplats = new PackedSplats({ url: "./clone.ply" });

const splats1 = new SplatMesh({ packedSplats });
scene.add(splats1);

const splats2 = new SplatMesh({ packedSplats });
scene.add(splats2);
```

### Load via `SplatLoader`

Finally, you can make use of the `THREE.Loader` infrastructure via the `SplatLoader` class. A `Loader` has a synchronous and asynchronous interface. You can provide progress meters during downloads and invoke completion callbacks as follows:

```javascript
const loader = new SplatLoader();
loader.loadAsync(url, (event) => {
  if (event.type === "progress") {
    const progress = event.lengthComputable
      ? `${((event.loaded / event.total) * 100).toFixed(2)}%`
      : `${event.loaded} bytes`;
    console.log(`Background download progress: ${progress}`);
  }
})
.then((packedSplats) => {
  const splatMesh = new SplatMesh({ packedSplats });
  // Re-orient from OpenCV to OpenGL coordinates
  splatMesh.quaternion.set(1, 0, 0, 0);
  splatMesh.position.set(0, 0, -1);
  splatMesh.scale.setScalar(0.5);
  scene.add(splatMesh);
})
.catch((error) => {
  console.warn(error);
});
```

## Loading additional formats `.splat` and `.ksplat`

These formats cannot be reliably auto-detected from the file contents, so we use two fall-back mechanism to enable support for these formats.

First, the auto-detection fails on these files, which triggers file type inference via URL/path file extension. If the URL contains the `.splat` or `.ksplat` extensions (stripping out query parameters etc.), we set the corresponding file type.

```javascript
const splats = new SplatMesh({ url: "./butterfly.splat" });
scene.add(splats);

const ksplats = new SplatMesh({ url: "./butterfly.ksplat" });
scene.add(ksplats);
```

If the URL contains a path with no obvious file extension, you can set the field `fileType` when constructing a `SplatMesh` or `PackedSplats`.

```javascript
// File type can't be auto-detected, so we set it explicitly
scene.add(new SplatMesh({
  url: "splatBin/0123456789abcdef",
  fileType: SplatFileType.SPLAT,
}));

scene.add(new SplatMesh({
  url: "ksplatBin/fedcba9876543210",
  fileType: SplatFileType.KSPLAT,
}));
```
