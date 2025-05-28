<p align="center">

  ![Forge logo](https://github.com/user-attachments/assets/d9cec150-8ca1-47f4-b7d9-4782aa629166#gh-dark-mode-only)
  ![Forge logo](https://github.com/user-attachments/assets/adb2f0d7-df30-49e5-be7f-75c14f008735#gh-light-mode-only)

  <h3 align="center">An advanced 3D Gaussian Splatting renderer for THREE.js</h3>
  <div align="center">

  [Features](#features) -
  [Getting Started](#getting-started) -
  <a href="https://www.forge.dev/">Documentation</a> -
  <a href="https://www.forge.dev/">FAQ</a>
  </div>
  </p>

   <div align="center">

  [![License](https://img.shields.io/badge/license-MIT-%23d43e4c)](https://github.com/forge-gfx/forge/blob/main/LICENSE)
  [![npm version](https://img.shields.io/npm/v/forge?color=d43e4c)](https://www.npmjs.com/package/forge)

  </div>

<p>
  <a href="https://www.forge.dev" target="_blank">
    <picture>
    </picture>
  </a>

## Features

- Load multiple splats files simultaneously ([demo]())
- Combine and composite splats with regular Meshes ([demo]())
- Animation ([demo]())
- Real Time Visual Effects ([demo]())
- Multiple Camera Views ([demo]())
- Procedurally generated splats ([demo]())

Check out all the [examples]()

## Getting Started

### Hello World - Local Development
This minimal example is included in `examples/hello-world/index.html`:

```html
<style> body {margin: 0;} </style>
<script type="importmap">
{
  "imports": {
    "three": "/node_modules/three/build/three.module.js",
    "@forge-gfx/forge": "/dist/forge.module.js"
  }
}
</script>
<script type="module">
import * as THREE from "three";
import { SplatMesh } from "@forge-gfx/forge";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement)

const butterfly = new SplatMesh({ url: "../assets/basic/butterfly.wlg"});
butterfly.quaternion.set(1, 0, 0, 0);
butterfly.position.set(0, 0, -1);
scene.add(butterfly);

renderer.setAnimationLoop(function animate(time) {
  renderer.render(scene, camera);
  butterfly.rotation.y += 0.01;
});
</script>
```
See the [Run Examples](#run-examples) section below, to run this hello-world example as well as others.

### Hello World - Web Editor

Remix the [glitch starter template](https://glitch.com/edit/#!/forge-dev)

### Usage from CDN
TO-DO: setup CDN
```html
<script type="importmap">
  {
    "imports": {
      "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.174.0/three.module.js",
      "forge": "cdn/url/to/forge.module.js"
     }
  }
</script>
```

### Install with NPM
TO-DO: publish package
```shell
npm install forge-dev
```

## Run Examples

Download the example assets files with the following command:

```
npm run assets:download
```

Install [Rust](https://www.rust-lang.org/tools/install) if it's not already installed in your machine.

Next, build Forge by running:
```
npm install
npm run build
```
This will first build the Rust Wasm component (can be invoked via `npm run build:wasm`), then Forge itself (`npm run build`).

Once you've fetched the data and built Forge, you can now run the examples:
```
npm start
```
This will run a dev server by default at [http://localhost:8080/](http://localhost:8080/). Check the console log output to see if yours is served on a different port.

## Develop and contribute to the project
Here are some additional development tips and instructions:
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

### Build docs

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
mkdocs serve
```

### Build Forge website

Build the static site and docs in a `site` directory.

```
npm run site:build
```

You can run any static server in the `site` directory but for convenience you can run

```
npm run site:serve
```

### Deploy Forge website

TO-DO

### Compress splats

To compress a splat to [spz](https://scaniverse.com/spz) run

`npm run assets:compress <file or URL to ply>`
