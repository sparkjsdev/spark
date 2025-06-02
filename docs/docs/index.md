# Getting Started

## Quick Start

Copy and paste code below in an `index.html` file or remix in the [Web Playground](https://glitch.com/edit/#!/forge-dev)

```html
<style> body {margin: 0;} </style>
<script type="importmap">
  {
    "imports": {
      "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.174.0/three.module.js",
      "@worldlabsai/forge": "https://forge.dev/releases/forge/0.1.0/forge.module.js"
    }
  }
</script>
<script type="module">
  import * as THREE from "three";
  import { SplatMesh } from "@worldlabsai/forge";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement)

  const splatURL = "https://forge.dev/assets/splats/butterfly.spz";
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
npm install @forge-gfx/forge
```
## Develop and contribute to Forge

Build Forge (It requires [Rust](https://www.rust-lang.org/tools/install) installed in your machine)
```
npm install
npm run dev
```

This will run a Web server at [http://localhost:8080/](http://localhost:8080/) with the examples.

## Next Steps

Read more about Forge from the left navigation panel (expand browser window to see it), or follow one of the links below:

- [Learn why Forge exists and its feature set](overview.md)
- [Forge system design overview](system-design.md)
- [Add a SplatMesh to your scene](splat-mesh.md)
- [Community resources](community-resources.md)