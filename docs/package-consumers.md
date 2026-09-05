# CommonJS and ESM package consumers

The package declares `type: module`. CommonJS output must therefore use a `.cjs` extension. Publishing CommonJS statements in `spark.cjs.js` caused Node to load that entry as an ES module: a CommonJS consumer could fail or receive no Spark exports. The `main` and `exports.require` entries now point to `dist/spark.cjs`; the ESM/CDN entry stays `dist/spark.module.js`.

Build before checking consumers:

```sh
npm run build:wasm
npm run build
npm run test:package
```

The test creates an `npm pack` tarball and installs it in a temporary consumer project. It checks a real `require()` call from a `.cjs` file, an ESM import, and the existing synchronous WebGL API in TypeScript. It tests Three.js 0.180.0 and pinned 0.185.1, uses bundler resolution for browser TypeScript consumers, and rejects declarations that silently resolve to `any`. A failed consumer project is retained for reproduction.

Linux and Windows CI build the package before running this check. The distribution workflow also watches the package/build configuration so this fix produces the new CommonJS artifact after merging. Generated distribution files are not included in the source contribution.
