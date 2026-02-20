# Getting Started

> ## Spark 2.0 Preview
>
> Spark 2.0 is now available as a preview release! This documentation is being updated to cover the new features and changes, and expect code changes and improvements, but the core functionality and API should be stable enough to develop on.
>
> Read about the new features on the [New Features in 2.0](new-features-2.0.md) page.
>
> v2.0.* is mostly backwards compatible with v0.1.*, with breaking changes described in [1.0 → 2.0 Migration Guide](0.1-2.0-migration-guide.md).
>
> The source is on GitHub under the [`v2.0.0-preview` branch](https://github.com/sparkjsdev/spark/tree/v2.0.0-preview) of the `sparkjsdev/spark` repository.

## Quick Start

Copy and paste code below in an `index.html` file or remix in the [Web Playground](https://stackblitz.com/edit/spark?file=index.html)

```html
<style> body {margin: 0;} </style>
<script type="importmap">
  {
    "imports": {
      "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.178.0/three.module.js",
      "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/0.1.10/spark.module.js"
    }
  }
</script>
<script type="module">
  import * as THREE from "three";
  import { SplatMesh } from "@sparkjsdev/spark";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement)

  const splatURL = "https://sparkjs.dev/assets/splats/butterfly.spz";
  const butterfly = new SplatMesh({ url: splatURL });
  butterfly.quaternion.set(1, 0, 0, 0);
  butterfly.position.set(0, 0, -3);
  scene.add(butterfly);

  renderer.setAnimationLoop(function animate(time) {
    renderer.render(scene, camera);
    butterfly.rotation.y += 0.01;
  });
</script>
```

## Install with NPM

```shell
[TODO] npm install @sparkjsdev/spark
```
## Develop and contribute to Spark

Build Spark (It requires [Rust](https://www.rust-lang.org/tools/install) installed in your machine)
```
npm install
npm run dev
```

This will run a Web server at [http://localhost:8080/](http://localhost:8080/) with the examples.

## Table of Contents

- [New Features in 2.0](new-features-2.0.md)
- [0.1 → 2.0 Migration Guide](0.1-2.0-migration-guide.md)
- [Spark Overview](overview.md)
- [System Design](system-design.md)
- [SparkRenderer](spark-renderer.md)
- [SparkViewpoint](spark-viewpoint.md)
- [SplatMesh](splat-mesh.md)
- [PackedSplats](packed-splats.md)
- [ExtSplats](ext-splats.md)
- [Loading Gsplats](loading-splats.md)
- [Procedural Splats](procedural-splats.md)
- [Splat RGBA-XYZ SDF editing](splat-editing.md)
- [Dyno overview](dyno-overview.md)
- [Dyno standard library](dyno-stdlib.md)
- [Controls](controls.md)
- [Performance tuning](performance.md)
- [Community Resources](community-resources.md)
