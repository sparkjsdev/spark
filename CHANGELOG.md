### 0.1.8 (July 31, 2025)

Bug fix.

### Bug fixes

- Fix SH encoding scale factors (#142) (@asundqui, @mrxz, @heimeii)

### 0.1.7 (July 30, 2025)

Image quality and performance improvements.

### Enhancements

- Allow custom splat encoding ranges (rgb, sh1, sh2, sh3). Expose `premultipliedAlpha` flag to use when accumulating splat RGB (#134) (@asundqui)
- Add higher precision mode (float32) for splat sorting in addition to the default one (float16) (@asundqui, @mrxz) (#129)
- Allow decoding and parsing of SOGS images to happen in parallel (@mrxz) (#122)
- New [splat shaders effect example](http://sparkjs.dev/examples/splat-shader-effects) (#141) (@kali-shade)
- Expose `minAlpha` and `maxPixelRadius` in the [SparkRenderer](https://sparkjs.dev/docs/spark-renderer/) parameters (#130) (@asundqui)
- Tree-shaking on worker code (@mrxz) (#118)
- Add JSDocs to docs (@mrxz) (#123)
- Use THREE.js built-in [full screen quad](https://github.com/mrdoob/three.js/blob/95febf473cc326ac2029c51442b2fea3348c5321/examples/jsm/postprocessing/Pass.js#L138) instead of custom setup to cover the entire render target (@mrxz) (#121)
- Redunce bundle size by removing `anyhow::anyhow` dependency (#127) (@asundqui)

### Deprecations

- Remove `SparkRenderer` blending parameter. Rely instead on `THREE.js` built-in support for `premultipliedAlpha` that sets the right blending mode automatically (#136) (@mrxz)


### 0.1.6 (July 11, 2025)

Visual quality improvements, .zip sogs file support, bug fixes.

### Enhancements

- Can load [SOGS](https://blog.playcanvas.com/playcanvas-adopts-sogs-for-20x-3dgs-compression/) compressed splats packaged in a .zip file (#100) (@asundqui)
- Rename `SparkRenderer` renderScale parameter to [focalAdjustment](https://sparkjs.dev/docs/spark-renderer/#optional-parameters) (#113) (fix #99) (@asundqui, @mrxz)
- Use OffscreenCanvas and WebGL2 context to decode webp SOGS images instead of 3rd party dependency (#90) (@mrxz)
- [Animated transitions between splats example](https://sparkjs.dev/examples/splat-transitions/) (#69) (@winnie1994)
- [Example of loading a SOGS compressed splat](https://sparkjs.dev/examples/sogs/) (@dmarcos, @vincentwoo, @61cygni)
- Expand value range of internal splat encoding to improve visual quality. Lower zero cut-off to retain and render small splats. (#110) (@asundqui, @mrxz)

### Bug fixes

- Fix visible property of SplatMesh not having effect. (fix #77) (#100) (@asundqui, @cyango)
- Add missing sh1 and sh2 support to SOGS compressed support (fix #108) (#109) (@lucasoptml)
- Prevent unintentional reuse of ArrayBuffer on concurrent file requests or hits to THREE.Cache. Replace use of THREE.FileLoader with fetch API (#94, #112) (fix #93) (@mrxz, @asundqui)


### 0.1.5 (July 1, 2025)

Visual quality improvements and [SOGS](https://blog.playcanvas.com/playcanvas-adopts-sogs-for-20x-3dgs-compression/) support

### Enhancements

- Add support for [SOGS](https://blog.playcanvas.com/playcanvas-adopts-sogs-for-20x-3dgs-compression/) compression format 3D Gaussian Splatting (#73) (@asundqui)
- Change splat shapes by using any RGBA texture to compute the Gaussian falloff (#79) (@asundqui)
- Use RenderTarget properties to reduce manual render state tracking (#80) (@mrxz)

### Bug fixes

- Visual quality, Fix .ksplat decoding (fix #66) (@asundqui)
- Visual quality, Fix Spherical Harmonics not included in SPZ transcoding (fix #66) (#83) (@asundqui)
- Visual quality, Fix incorrect calculation of renderer size. Especially improves rendering in high DPI displays (#71) (@mrxz)
- Fix support of compressed .ply files exported from SuperSplat. Newer versions include min/max_r/g/b properties in the header that were not parsed (#82) (@asundqui)

### 0.1.4 (June 24, 2025)

### Enhancements

- Ability to render depth and normal values (#58) (@asundqui)
- New parameters to change renderer focal distance and aperture angle (#59) (@asundqui)
- GLSL code injection example (#56)
- WebXR example (#50)

### Bug fixes

- Option to disable SparkControls camera roll for touch controls (fix #46) (#60) (@asundqui)
- Fix sign in SH2 coefficient signs improving visual quality (#64)

### 0.1.3 (June 11, 2025)

Fix types export in npm package.

### 0.1.2 (June 10, 2025)

It removes unnecessary dependencies from npm package.

### 0.1.1 (June 10, 2025)

### Bug fixes

- Fix compressed .ply files by gsplat not loading (#34) (@bolopenguin, @asundqui)
- Fix image quality rendering with mostly transparent splats (#36) (@hybridherbst, @@asundqui)
- Fix SplatMesh not rendering when it's a child of an Object3D (#38) (@dmarcos)


### 0.1.0 (June 2, 2025)

First release