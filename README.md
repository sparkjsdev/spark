<p align="center">

  ![Spark logo](https://github.com/user-attachments/assets/5287631a-083c-4c86-80f6-4dca24aa263f#gh-light-mode-only)
  ![Spark logo](https://github.com/user-attachments/assets/91e8d74b-84a5-4073-bd72-d7228f948dc6#gh-dark-mode-only)

  <h3 align="center">An advanced 3D Gaussian Splatting renderer for THREE.js</h3>
  <div align="center">

  [Features](#features) -
  [Getting Started](#getting-started) -
  <a href="https://sparkjs.dev/">Documentation</a> -
  <a href="https://sparkjs.dev/">FAQ</a>
  </div>
  </p>

   <div align="center">

  [![License](https://img.shields.io/badge/license-MIT-%23d43e4c)](https://github.com/sparkjsdev/spark/blob/main/LICENSE)
  [![npm version](https://img.shields.io/npm/v/@sparkjsdev/spark?color=d43e4c)](https://www.npmjs.com/package/@sparkjsdev/spark)

  </div>

<p>
  <a href="https://sparkjs.dev" target="_blank">
    <picture>
    </picture>
  </a>

## Features

- Integrates with THREE.js rendering pipeline to fuse splat and mesh-based objects
- Portable: Works across almost all devices, targeting 98%+ WebGL2 support
- Renders fast even on low-powered mobile devices
- Render multiple splat objects together with correct sorting
- Most major splat file formats supported including .PLY (also compressed), .SPZ, .SPLAT, .KSPLAT
- Render multiple viewpoints simultaneously
- Fully dynamic: each splat can be transformed and edited for animation
- Real-time splat color editing, displacement, and skeletal animation
- Shader graph system to dynamically create/edit splats on the GPU

Check out all the [examples](https://sparkjs.dev/examples/)

## Getting Started

### Copy Code

Copy the following code into an `index.html` file.


```html
<style> body {margin: 0;} </style>
<script type="importmap">
  {
    "imports": {
      "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.174.0/three.module.js",
      "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/0.1.8/spark.module.js"
    }
  }
</script>
<script type="module">
  import * as THREE from "three";
  import { SplatMesh } from "@sparkjsdev/spark";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
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

### Web Editor

Remix the [glitch starter template](https://glitch.com/edit/#!/sparkjs-dev)

### CDN

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.174.0/three.module.js",
      "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/0.1.8/spark.module.js"
     }
  }
</script>
```

### NPM

```shell
npm install @sparkjsdev/spark
```

## Run Examples locally

Install [Rust](https://www.rust-lang.org/tools/install) if it's not already installed in your machine.

Next, build Spark by running:
```
npm install
npm run build
```
This will first build the Rust Wasm component (can be invoked via `npm run build:wasm`), then Spark itself (`npm run build`).

The examples fetch assets from a remote URL. This step is optional, but offline development and faster loading times are possible if you download and cache the assets files locally with the following command:
```
npm run assets:download
```

Once you've built Spark and optionally downloaded the assets, you can now run the examples:
```
npm start
```
This will run a dev server by default at [http://localhost:8080/](http://localhost:8080/). Check the console log output to see if yours is served on a different port.

## Develop and contribute to the project

### Build troubleshooting

First try cleaning all the build files and re-building everything:
```
npm run clean
npm install
npm run build
```

There's no versioning system for assets. If you need to re-download a specific file you can delete that asset file individually or download all assets from scratch:

```
 npm run assets:clean
 npm run assets:download
```

### Ignore dist directory during development

To ignore the dist directory and prevent accidental commits and merge conflicts

```
git update-index --assume-unchanged dist/*
```

To revert and be able to commit into to the dist directory again:

```
git update-index --no-assume-unchanged dist/*
```

To list ignored files in case of need to troubleshoot

```
git ls-files -v | grep '^[a-z]' | cut -c3-
```

### Build docs and site

Install [Mkdocs Material](https://squidfunk.github.io/mkdocs-material/)

```
pip install mkdocs-material
```

If you hit an `externally managed environment` error on macOS and if you installed python via `brew` try:

```
brew install mkdocs-material
```

Edit markdown in `/docs` directory

```
npm run docs
```

### Build Spark website

Build the static site and docs in a `site` directory.

```
npm run site:build
```

You can run any static server in the `site` directory but for convenience you can run

```
npm run site:serve
```

### Deploy Spark website

The following command will generate a static site from the `docs` directory and push it to the [repo](https://github.com/sparkjsdev/sparkjsdev.github.io) that hosts the site via `gh-pages`

```
npm run site:deploy
```

### Compress splats

To compress a splat to [spz](https://scaniverse.com/spz) run

`npm run assets:compress <file or URL to ply>`
