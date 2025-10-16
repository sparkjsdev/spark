import * as THREE from "three";
import { Readback, dyno } from ".";
import { NewSplatAccumulator } from "./NewSplatAccumulator";
import { NewSplatGeometry } from "./NewSplatGeometry";
import { workerPool } from "./NewSplatWorker";
import { SPLAT_TEX_HEIGHT, SPLAT_TEX_WIDTH } from "./defines";
import { getShaders } from "./shaders";
import { withWorker } from "./splatWorker";
import { cloneClock, getTextureSize, uintBitsToFloat } from "./utils";

export interface NewSparkRendererOptions {
  /**
   * Pass in your THREE.WebGLRenderer instance so Spark can perform work
   * outside the usual render loop. Should be created with antialias: false
   * (default setting) as WebGL anti-aliasing doesn't improve Gaussian Splatting
   * rendering and significantly reduces performance.
   */
  renderer: THREE.WebGLRenderer;
  /**
   * Whether to use premultiplied alpha when accumulating splat RGB
   * @default true
   */
  premultipliedAlpha?: boolean;
  /**
   * Whether to encode Gsplat with linear RGB (for environment mapping)
   * @default false
   */
  encodeLinear?: boolean;
  /**
   * Pass in a THREE.Clock to synchronize time-based effects across different
   * systems. Alternatively, you can set the property time directly.
   * (default: new THREE.Clock)
   */
  clock?: THREE.Clock;
  /**
   * Controls whether to check and automatically update Gsplat collection after
   * each frame render.
   * @default true
   */
  autoUpdate?: boolean;
  /**
   * Controls whether to update the Gsplats before or after rendering. For WebXR
   * this must be false in order to complete rendering as soon as possible.
   * @default true
   */
  preUpdate?: boolean;
  /**
   * Maximum standard deviations from the center to render Gaussians. Values
   * Math.sqrt(5)..Math.sqrt(8) produce good results and can be tweaked for
   * performance.
   * @default Math.sqrt(8)
   */
  maxStdDev?: number;
  /*
   **
   * Minimum pixel radius for splat rendering.
   * @default 0.0
   */
  minPixelRadius?: number;
  /**
   * Maximum pixel radius for splat rendering.
   * @default 512.0
   */
  maxPixelRadius?: number;
  /**
   * Minimum alpha value for splat rendering.
   * @default 0.5 * (1.0 / 255.0)
   */
  minAlpha?: number;
  /**
   * Enable 2D Gaussian splatting rendering ability. When this mode is enabled,
   * any scale x/y/z component that is exactly 0 (minimum quantized value) results
   * in the other two non-0 axis being interpreted as an oriented 2D Gaussian Splat,
   * rather instead of the usual projected 3DGS Z-slice. When reading PLY files,
   * scale values less than e^-30 will be interpreted as 0.
   * @default false
   */
  enable2DGS?: boolean;
  /**
   * Scalar value to add to 2D splat covariance diagonal, effectively blurring +
   * enlarging splats. In scenes trained without the Gsplat anti-aliasing tweak
   * this value was typically 0.3, but with anti-aliasing it is 0.0
   * @default 0.0
   */
  preBlurAmount?: number;
  /**
   * Scalar value to add to 2D splat covarianve diagonal, with opacity adjustment
   * to correctly account for "blurring" when anti-aliasing. Typically 0.3
   * (equivalent to approx 0.5 pixel radius) in scenes trained with anti-aliasing.
   */
  blurAmount?: number;
  /**
   * Depth-of-field distance to focal plane
   */
  focalDistance?: number;
  /**
   * Full-width angle of aperture opening (in radians), 0.0 to disable
   * @default 0.0
   */
  apertureAngle?: number;
  /**
   * Modulate Gaussian kernel falloff. 0 means "no falloff, flat shading",
   * while 1 is the normal Gaussian kernel.
   * @default 1.0
   */
  falloff?: number;
  /**
   * X/Y clipping boundary factor for Gsplat centers against view frustum.
   * 1.0 clips any centers that are exactly out of bounds, while 1.4 clips
   * centers that are 40% beyond the bounds.
   * @default 1.4
   */
  clipXY?: number;
  /**
   * Parameter to adjust projected splat scale calculation to match other renderers,
   * similar to the same parameter in the MKellogg 3DGS renderer. Higher values will
   * tend to sharpen the splats. A value 2.0 can be used to match the behavior of
   * the PlayCanvas renderer.
   * @default 1.0
   */
  focalAdjustment?: number;
  /**
   * Whether to sort splats radially (geometric distance) from the viewpoint (true)
   * or by Z-depth (false). Most scenes are trained with the Z-depth sort metric
   * and will render more accurately at certain viewpoints. However, radial sorting
   * is more stable under viewpoint rotations.
   * @default true
   */
  sortRadial?: boolean;
  /**
   * Constant added to Z-depth to bias values into the positive range for
   * sortRadial: false, but also used for culling Gsplats "well behind"
   * the viewpoint origin
   * @default 1.0
   */
  depthBias?: number;
  /**
   * Set this to true if rendering a 360 to disable "behind the viewpoint"
   * culling during sorting. This is set automatically when rendering 360 envMaps
   * using the SparkRenderer.renderEnvMap() utility function.
   * @default false
   */
  sort360?: boolean;
  /*
   * Set this to true to sort with float32 precision with two-pass sort.
   * @default true
   */
  sort32?: boolean;
  /**
   * Minimum interval between sort calls in milliseconds.
   * @default 1
   */
  minSortIntervalMs?: number;
}

export class NewSparkRenderer extends THREE.Mesh {
  renderer: THREE.WebGLRenderer;
  premultipliedAlpha: boolean;
  material: THREE.ShaderMaterial;
  uniforms: ReturnType<typeof NewSparkRenderer.makeUniforms>;

  autoUpdate: boolean;
  preUpdate: boolean;

  maxStdDev: number;
  minPixelRadius: number;
  maxPixelRadius: number;
  minAlpha: number;
  enable2DGS: boolean;
  preBlurAmount: number;
  blurAmount: number;
  focalDistance: number;
  apertureAngle: number;
  falloff: number;
  clipXY: number;
  focalAdjustment: number;
  encodeLinear: boolean;
  globalLodScale = 1.0;

  sortRadial?: boolean;
  depthBias?: number;
  sort360: boolean;
  sort32: boolean;
  minSortIntervalMs?: number;

  clock: THREE.Clock;
  time?: number;
  lastFrame = -1;
  updateTimeoutId = -1;

  sortDirty = false;
  sorting = false;
  lastSort?: number;
  readback32 = new Uint32Array(0);
  readback16 = new Uint16Array(0);

  orderingTexture: THREE.DataArrayTexture | null = null;
  activeSplats = 0;

  maxSplats = 0;
  display: NewSplatAccumulator;
  current: NewSplatAccumulator;
  accumulators: NewSplatAccumulator[] = [];
  // pending: NewSplatAccumulator;
  // pending2: NewSplatAccumulator;

  flushAfterGenerate = true;
  flushAfterRead = true;

  constructor(options: NewSparkRendererOptions) {
    const uniforms = NewSparkRenderer.makeUniforms();
    const shaders = getShaders();
    const premultipliedAlpha = options.premultipliedAlpha ?? true;
    const geometry = new NewSplatGeometry();
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: shaders.newSplatVertex,
      fragmentShader: shaders.newSplatFragment,
      uniforms,
      premultipliedAlpha,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    super(geometry, material);
    this.material = material;
    this.uniforms = uniforms;
    // Disable frustum culling because we want to always draw them all
    // and cull Gsplats individually in the shader
    this.frustumCulled = false;

    // sparkRendererInstance = this;
    this.renderer = options.renderer;
    this.premultipliedAlpha = premultipliedAlpha;
    this.autoUpdate = options.autoUpdate ?? true;
    this.preUpdate = options.preUpdate ?? false;

    this.maxStdDev = options.maxStdDev ?? Math.sqrt(8.0);
    this.minPixelRadius = options.minPixelRadius ?? 0.0; //1.6;
    this.maxPixelRadius = options.maxPixelRadius ?? 512.0;
    this.minAlpha = options.minAlpha ?? 0.5 * (1.0 / 255.0);
    this.enable2DGS = options.enable2DGS ?? false;
    this.preBlurAmount = options.preBlurAmount ?? 0.0;
    this.blurAmount = options.blurAmount ?? 0.3;
    this.focalDistance = options.focalDistance ?? 0.0;
    this.apertureAngle = options.apertureAngle ?? 0.0;
    this.falloff = options.falloff ?? 1.0;
    this.clipXY = options.clipXY ?? 1.4;
    this.focalAdjustment = options.focalAdjustment ?? 1.0;
    this.encodeLinear = options.encodeLinear ?? false;

    this.sortRadial = options.sortRadial;
    this.depthBias = options.depthBias;
    this.sort360 = options.sort360 ?? false;
    this.sort32 = options.sort32 ?? false;
    this.minSortIntervalMs = options.minSortIntervalMs ?? 1;

    this.clock = options.clock ? cloneClock(options.clock) : new THREE.Clock();
    this.time = undefined;

    this.display = new NewSplatAccumulator();
    this.current = this.display;
    this.accumulators.push(new NewSplatAccumulator());
    this.accumulators.push(new NewSplatAccumulator());

    // this.renderer.xr.setFramebufferScaleFactor(0.5);
    // this.renderer.xr.setReferenceSpaceType("local");
  }

  static makeUniforms() {
    const mappingTexture = new THREE.DataTexture(
      new Uint32Array(4),
      1,
      1,
      THREE.RGBAIntegerFormat,
      THREE.UnsignedIntType,
    );
    mappingTexture.needsUpdate = true;
    const uniforms = {
      // Size of render viewport in pixels
      renderSize: { value: new THREE.Vector2() },
      // Near and far plane distances
      near: { value: 0.1 },
      far: { value: 1000.0 },
      // SplatAccumulator to view transformation quaternion
      renderToViewQuat: { value: new THREE.Quaternion() },
      // SplatAccumulator to view transformation translation
      renderToViewPos: { value: new THREE.Vector3() },
      // Maximum distance (in stddevs) from Gsplat center to render
      maxStdDev: { value: 1.0 },
      // Minimum pixel radius for splat rendering
      minPixelRadius: { value: 0.0 },
      // Maximum pixel radius for splat rendering
      maxPixelRadius: { value: 512.0 },
      // Minimum alpha value for splat rendering
      minAlpha: { value: 0.5 * (1.0 / 255.0) },
      // Enable interpreting 0-thickness Gsplats as 2DGS
      enable2DGS: { value: false },
      // Add to projected 2D splat covariance diagonal (thickens and brightens)
      preBlurAmount: { value: 0.0 },
      // Add to 2D splat covariance diagonal and adjust opacity (anti-aliasing)
      blurAmount: { value: 0.3 },
      // Depth-of-field distance to focal plane
      focalDistance: { value: 0.0 },
      // Full-width angle of aperture opening (in radians)
      apertureAngle: { value: 0.0 },
      // Modulate Gaussian kernal falloff. 0 means "no falloff, flat shading",
      // 1 is normal e^-x^2 falloff.
      falloff: { value: 1.0 },
      // Clip Gsplats that are clipXY times beyond the +-1 frustum bounds
      clipXY: { value: 1.4 },
      // Debug renderSize scale factor
      focalAdjustment: { value: 1.0 },
      // Whether to encode Gsplat with linear RGB (for environment mapping)
      encodeLinear: { value: false },
      // Back-to-front sort ordering of splat indices
      ordering: { type: "t", value: NewSparkRenderer.emptyOrdering },
      // Gsplat collection to render
      packedSplats: { type: "t", value: NewSplatAccumulator.emptyTexture },
      packedSplats2: { type: "t", value: NewSplatAccumulator.emptyTexture },
      // Time in seconds for time-based effects
      time: { value: 0 },
      // Delta time in seconds since last frame
      deltaTime: { value: 0 },
      // Debug flag that alternates each frame
      debugFlag: { value: false },
    };
    return uniforms;
  }

  onBeforeRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const frame = renderer.info.render.frame;
    const isNewFrame = frame !== this.lastFrame;
    this.lastFrame = frame;

    const renderSize = renderer.getDrawingBufferSize(
      this.uniforms.renderSize.value,
    );
    if (renderer.xr.isPresenting) {
      if (renderSize.x === 1 && renderSize.y === 1) {
        // WebXR mode on Apple Vision Pro returns 1x1 when presenting.
        // Use a different means to figure out the render size.
        const baseLayer = renderer.xr.getSession()?.renderState.baseLayer;
        if (baseLayer) {
          renderSize.x = baseLayer.framebufferWidth;
          renderSize.y = baseLayer.framebufferHeight;
        }
      }
    }

    const typedCamera = camera as
      | THREE.PerspectiveCamera
      | THREE.OrthographicCamera;

    this.uniforms.near.value = typedCamera.near;
    this.uniforms.far.value = typedCamera.far;

    const geometry = this.geometry as NewSplatGeometry;
    geometry.instanceCount = this.activeSplats;

    const worldToCamera = camera.matrixWorld.clone().invert();
    worldToCamera.decompose(
      this.uniforms.renderToViewPos.value,
      this.uniforms.renderToViewQuat.value,
      new THREE.Vector3(),
    );

    this.uniforms.maxStdDev.value = this.maxStdDev;
    this.uniforms.minPixelRadius.value = this.minPixelRadius;
    this.uniforms.maxPixelRadius.value = this.maxPixelRadius;
    this.uniforms.minAlpha.value = this.minAlpha;
    this.uniforms.enable2DGS.value = this.enable2DGS;
    this.uniforms.preBlurAmount.value = this.preBlurAmount;
    this.uniforms.blurAmount.value = this.blurAmount;
    this.uniforms.focalDistance.value = this.focalDistance;
    this.uniforms.apertureAngle.value = this.apertureAngle;
    this.uniforms.falloff.value = this.falloff;
    this.uniforms.clipXY.value = this.clipXY;
    this.uniforms.focalAdjustment.value = this.focalAdjustment;
    this.uniforms.encodeLinear.value = this.encodeLinear;

    this.uniforms.ordering.value =
      this.orderingTexture ?? NewSparkRenderer.emptyOrdering;
    const packedSplats = this.display.getTextures();
    this.uniforms.packedSplats.value = packedSplats[0];
    this.uniforms.packedSplats2.value = packedSplats[1];

    this.uniforms.time.value = this.display.time;
    this.uniforms.deltaTime.value = this.display.deltaTime;
    // Alternating debug flag that can aid in visual debugging
    this.uniforms.debugFlag.value = (performance.now() / 1000.0) % 2.0 < 1.0;

    if (this.autoUpdate && isNewFrame) {
      const preUpdate = this.preUpdate && !renderer.xr.isPresenting;
      // const preUpdate = true;
      if (preUpdate) {
        this.update({ renderer, scene, camera });
      } else {
        if (this.updateTimeoutId === -1) {
          this.updateTimeoutId = setTimeout(() => {
            this.updateTimeoutId = -1;
            this.update({ renderer, scene, camera });
          }, 1);
        }
      }
    }
  }

  maxHistory = 300;
  history: string[] = [];

  update({
    renderer,
    scene,
    camera,
  }: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
  }) {
    this.updateMatrixWorld();
    const renderSize = this.uniforms.renderSize.value;
    const time = this.time ?? this.clock.getElapsedTime();
    if (this.history.length < this.maxHistory) {
      this.history.push(`frame#=${Math.round(time * 240.0)} | time=${time}`);
    }

    if (this.maxHistory > 0 && this.history.length >= this.maxHistory) {
      // console.log("HISTORY:");
      // for (const line of this.history) {
      //   console.log(line);
      // }
      this.maxHistory = 0;
    }

    const now = performance.now();
    let sortOkay = true;
    if (this.lastSort) {
      if (
        this.minSortIntervalMs &&
        now - this.lastSort < this.minSortIntervalMs
      ) {
        sortOkay = false;
      }
    }

    const next = this.accumulators.pop();
    if (!next) {
      // Should never happen
      throw new Error("No next accumulator");
    }

    // let numAccumulators;
    // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
    // console.log(`A: ${numAccumulators} | ${this.accumulators.length}`);

    const { sameMapping, mappingVersion, generate } = next.prepareGenerate({
      renderer,
      scene,
      time,
      camera,
      sortRadial: this.sortRadial ?? true,
      renderSize,
      previous: this.current,
    });

    if (this.history.length < this.maxHistory) {
      this.history.push(
        `sorting=${this.sorting} | sameMapping=${sameMapping} | frame#=${Math.round(this.display.time * 240.0)} | display=${this.display.numSplats}, ${this.display.time} | current=${this.current.numSplats}, ${this.current.time} | next=${next.numSplats}, ${next.time}`,
      );
    }

    const needSort = mappingVersion > this.current.mappingVersion;
    if (needSort && !sortOkay) {
      this.accumulators.push(next);
      return false;
    }

    if (this.sorting && needSort) {
      // Don't create yet another new mapping while we're processing one
      this.accumulators.push(next);
      return false;
    }

    generate();

    if (this.flushAfterGenerate) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      gl.flush();
    }

    this.sortDirty = true;

    if (this.sorting) {
      // sameMapping == true by above check
      if (this.display.mappingVersion === next.mappingVersion) {
        // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
        // console.log(`B0: ${numAccumulators} | ${this.accumulators.length}`);

        this.accumulators.push(this.display);
        this.display = next;

        // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
        // console.log(`B1: ${numAccumulators} | ${this.accumulators.length}`);
      } else {
        this.accumulators.push(this.current);
      }

      // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
      // console.log(`B2: ${numAccumulators} | ${this.accumulators.length}`);
      this.current = next;

      // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
      // console.log(`B3: ${numAccumulators} | ${this.accumulators.length}`);
    } else {
      // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
      // console.log(`C0: ${numAccumulators} | ${this.accumulators.length}`);
      if (sameMapping) {
        if (this.current === this.display) {
          this.display = next;
        } else {
        }
      } else {
        if (sortOkay) {
          console.log("!sameMapping && sortOkay");
        }
      }
      this.accumulators.push(this.current);
      this.current = next;

      // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
      // console.log(`C1: ${numAccumulators} | ${this.accumulators.length}`);

      if (sortOkay) {
        // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
        // console.log(`D0: ${numAccumulators} | ${this.accumulators.length}`);

        // Don't await this
        this.driveSort(sortOkay, sameMapping);
        // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
        // console.log(`D1: ${numAccumulators} | ${this.accumulators.length}`);
      } else {
        if (this.display !== next) {
          this.accumulators.push(next);
        }
        // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
        // console.log(`E: ${numAccumulators} | ${this.accumulators.length}`);
      }
    }

    // numAccumulators = new Set([this.display, this.current, next, ...this.accumulators]).size;
    // console.log(`E: ${numAccumulators} | ${this.accumulators.length}`);
    if (this.accumulators.length > 2) {
      throw new Error("Accumulators length > 2");
    }

    return true;
  }

  async driveSort(sortOkay: boolean, sameMapping: boolean) {
    this.history.push(
      `driveSort with current=${this.current.numSplats}, ${this.current.time}`,
    );
    if (this.sorting || !this.sortDirty) {
      return;
    }
    try {
      this.sorting = true;
      this.sortDirty = false;
      this.lastSort = performance.now();
      // console.log("minSortIntervalMs:", this.minSortIntervalMs, "driveSort lastSort:", this.lastSort, "sortOkay:", sortOkay, "sameMapping:", sameMapping);
      // let numAccumulators = new Set([this.display, this.current, ...this.accumulators]).size;
      // console.log(`D0: ${numAccumulators} | ${this.accumulators.length} | display=${this.display.mappingVersion} | current=${this.current.mappingVersion}`);
      // await new Promise((resolve) => setTimeout(resolve, 1));

      const sort32 = true;

      const { numSplats, maxSplats } = this.current;
      const { maxSplats: orderingMaxSplats } = getTextureSize(
        Math.max(maxSplats, 1),
      );
      this.maxSplats = Math.max(this.maxSplats, orderingMaxSplats);
      const ordering = new Uint32Array(this.maxSplats);
      const readback = reader.ensureBuffer(maxSplats, this.readback32);
      this.readback32 = readback;

      // let readback: Uint32Array | Uint16Array;
      // if (sort32) {
      //   this.readback32 = reader.ensureBuffer(maxSplats, this.readback32);
      //   readback = this.readback32;
      // } else {
      //   const halfMaxSplats = Math.ceil(maxSplats / 2);
      //   this.readback16 = reader.ensureBuffer(halfMaxSplats, this.readback16);
      //   readback = this.readback16;
      // }

      // dynoSort360.value = this.sort360;
      // dynoSortRadial.value = dynoSort360.value
      //   ? true
      //   : (this.sortRadial ?? true);
      // dynoOrigin.value.setFromMatrixColumn(this.current.viewToWorld, 3);
      // dynoDirection.value.setFromMatrixColumn(this.current.viewToWorld, 2).negate().normalize();
      // // dynoOrigin.value.set(0, 0, 0).applyMatrix4(this.current.viewToWorld);
      // // dynoDirection.value
      // //   .set(0, 0, -1)
      // //   .applyMatrix4(this.current.viewToWorld)
      // //   .sub(dynoOrigin.value)
      // //   .normalize();
      // dynoDepthBias.value = this.depthBias ?? 1.0;
      // dynoNumSplats.value = numSplats;
      // dynoPacked1.value = this.current.getTextures()[0];

      // const sortReader = sort32 ? sort32Reader : doubleSortReader;
      // const count = sort32 ? numSplats : Math.ceil(numSplats / 2);
      // this.history.push(`renderReadback ${numSplats}`);
      // await reader.renderReadback({
      //   renderer: this.renderer,
      //   reader: sortReader,
      //   count,
      //   readback,
      // });

      // await new Promise((resolve) => setTimeout(resolve, 1));

      await this.readbackDepth({
        renderer: this.renderer,
        numSplats,
        readback,
      });
      console.log(
        "readback:",
        [...readback.slice(0, 5)]
          .map((u) => {
            const value = uintBitsToFloat(u);
            return `${value.toFixed(4)}`;
          })
          .join(" | "),
      );
      // console.log("readback:", readback.slice(0, 5).join(" | "));

      // if ((performance.now() % 2000) < 1000) {
      //   const floats = new Float32Array(readback.buffer);
      //   for (let i = 0; i < numSplats; ++i) {
      //     floats[i] = 1000.0 - floats[i];
      //   }
      // }

      // numAccumulators = new Set([this.display, this.current, ...this.accumulators]).size;
      // console.log(`D1: ${numAccumulators} | ${this.accumulators.length} | display=${this.display.mappingVersion} | current=${this.current.mappingVersion}`);

      // await new Promise((resolve) => setTimeout(resolve, 1));

      this.history.push(
        `Sort worker maxSplats=${maxSplats} | numSplats=${numSplats}`,
      );
      // const result = (await withWorker(async (worker) => {
      //   return worker.call(sort32 ? "sort32Splats" : "sortDoubleSplats", {
      //     maxSplats,
      //     numSplats,
      //     readback,
      //     ordering,
      //   });
      // })) as {
      //   readback: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
      //   ordering: Uint32Array<ArrayBuffer>;
      //   activeSplats: number;
      // };
      const result = (await workerPool.withWorker(async (worker) => {
        return worker.call(sort32 ? "sortSplats32" : "sortSplats16", {
          numSplats,
          readback,
          ordering,
        });
      })) as {
        readback: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
        ordering: Uint32Array<ArrayBuffer>;
        activeSplats: number;
      };
      this.history.push(
        `Sort worker result activeSplats=${result.activeSplats}`,
      );

      // numAccumulators = new Set([this.display, this.current, ...this.accumulators]).size;
      // console.log(`D2: ${numAccumulators} | ${this.accumulators.length} | display=${this.display.mappingVersion} | current=${this.current.mappingVersion}`);

      // await new Promise((resolve) => setTimeout(resolve, 1));

      // // Add delay to sort
      // await new Promise(resolve => setTimeout(resolve, 1000));

      if (sort32) {
        this.readback32 = result.readback as Uint32Array<ArrayBuffer>;
      } else {
        this.readback16 = result.readback as Uint16Array<ArrayBuffer>;
      }

      this.activeSplats = result.activeSplats;

      if (this.orderingTexture) {
        const { width, height, depth } = this.orderingTexture.image;
        if (width * height * depth !== result.ordering.length) {
          // this.history.push(`Disposing orderingTexture: ${width}x${height}x${depth} !== ${result.ordering.length}`);
          console.log(
            `Disposing orderingTexture: ${width}x${height}x${depth} !== ${result.ordering.length}`,
          );
          this.orderingTexture.dispose();
          this.orderingTexture = null;
        }
      }
      if (!this.orderingTexture) {
        const { width, height, depth } = getTextureSize(result.ordering.length);
        // this.history.push(`Allocating orderingTexture: ${width}x${height}x${depth}`);
        console.log(`Allocating orderingTexture: ${width}x${height}x${depth}`);
        this.orderingTexture = new THREE.DataArrayTexture(
          result.ordering,
          width,
          height,
          depth,
        );
        this.orderingTexture.format = THREE.RedIntegerFormat;
        this.orderingTexture.type = THREE.UnsignedIntType;
        this.orderingTexture.internalFormat = "R32UI";
      } else {
        this.orderingTexture.image.data = result.ordering;
        const { width, height } = this.orderingTexture.image;
        const numLayers = Math.ceil(result.activeSplats / (width * height));
        this.history.push(`Adding ${numLayers} layers to orderingTexture`);
        for (let layer = 0; layer < numLayers; ++layer) {
          this.orderingTexture.addLayerUpdate(layer);
          // console.log(`Adding layer ${layer} to orderingTexture`);
        }
      }
      this.orderingTexture.needsUpdate = true;

      if (this.current.mappingVersion > this.display.mappingVersion) {
        this.accumulators.push(this.display);
        this.display = this.current;
      }

      // numAccumulators = new Set([this.display, this.current, ...this.accumulators]).size;
      // console.log(`D3: ${numAccumulators} | ${this.accumulators.length} | display=${this.display.mappingVersion} | current=${this.current.mappingVersion}`);
    } finally {
      this.sorting = false;
    }

    // // Don't await this
    // this.driveSort();
  }

  readbackDepth({
    renderer,
    numSplats,
    readback,
  }: {
    renderer: THREE.WebGLRenderer;
    numSplats: number;
    readback: Uint32Array;
  }) {
    if (!renderer) {
      throw new Error("No renderer");
    }
    if (!this.current.target) {
      throw new Error("No target");
    }

    const roundedCount =
      Math.ceil(numSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    if (readback.byteLength < roundedCount * 4) {
      throw new Error(
        `Readback buffer too small: ${readback.byteLength} < ${roundedCount * 4}`,
      );
    }
    const readbackUint8 = new Uint8Array(readback.buffer);

    // We can only read back one 2D array layer of pixels at a time,
    // so loop through them, initiate the readback, and collect the
    // completion promises.

    const renderState = this.saveRenderState(this.renderer);

    const layerSize = SPLAT_TEX_WIDTH * SPLAT_TEX_HEIGHT;
    let baseIndex = 0;
    const promises = [];

    while (baseIndex < numSplats) {
      const layer = Math.floor(baseIndex / layerSize);
      const layerBase = layer * layerSize;
      const layerYEnd = Math.min(
        SPLAT_TEX_HEIGHT,
        Math.ceil((numSplats - layerBase) / SPLAT_TEX_WIDTH),
      );

      renderer.setRenderTarget(this.current.target, layer);

      // Compute the subarray that this layer of readback corresponds to
      const readbackSize = SPLAT_TEX_WIDTH * layerYEnd * 4;
      const subReadback = readbackUint8.subarray(
        layerBase * 4,
        layerBase * 4 + readbackSize,
      );
      // console.log("readbackSize:", readbackSize);
      // console.log("width * height:", layerYEnd * SPLAT_TEX_WIDTH);
      // console.log("Readback:", 0, 0, SPLAT_TEX_WIDTH, layerYEnd, subReadback.length);
      const promise = renderer?.readRenderTargetPixelsAsync(
        this.current.target,
        0,
        0,
        SPLAT_TEX_WIDTH,
        layerYEnd,
        subReadback,
        undefined,
        2,
      );
      promises.push(promise);

      baseIndex += SPLAT_TEX_WIDTH * layerYEnd;
    }

    if (this.flushAfterRead) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      gl.flush();
    }

    // renderer.setRenderTarget(null);
    this.resetRenderState(renderer, renderState);

    return Promise.all(promises).then(() => readback);
  }

  private saveRenderState(renderer: THREE.WebGLRenderer) {
    return {
      xrEnabled: renderer.xr.enabled,
      autoClear: renderer.autoClear,
    };
  }

  private resetRenderState(
    renderer: THREE.WebGLRenderer,
    state: {
      xrEnabled: boolean;
      autoClear: boolean;
    },
  ) {
    renderer.setRenderTarget(null);
    renderer.xr.enabled = state.xrEnabled;
    renderer.autoClear = state.autoClear;
  }

  static emptyOrdering = (() => {
    const { width, height, depth, maxSplats } = getTextureSize(1);
    const emptyArray = new Uint32Array(maxSplats);
    const texture = new THREE.DataArrayTexture(
      emptyArray,
      width,
      height,
      depth,
    );
    texture.format = THREE.RedIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "R32UI";
    texture.needsUpdate = true;
    return texture;
  })();
}

const dynoSortRadial = new dyno.DynoBool({ value: true });
const dynoOrigin = new dyno.DynoVec3({ value: new THREE.Vector3() });
const dynoDirection = new dyno.DynoVec3({ value: new THREE.Vector3() });
const dynoDepthBias = new dyno.DynoFloat({ value: 1.0 });
const dynoSort360 = new dyno.DynoBool({ value: false });
const dynoNumSplats = new dyno.DynoInt({ value: 0 });
const dynoPacked1 = new dyno.DynoUsampler2DArray({
  value: new THREE.DataArrayTexture(),
});

const reader = new Readback();
const sort32Reader = dyno.dynoBlock(
  { index: "int" },
  { rgba8: "vec4" },
  ({ index }) => {
    if (!index) {
      throw new Error("No index");
    }
    const sortParams = {
      sortRadial: dynoSortRadial,
      sortOrigin: dynoOrigin,
      sortDirection: dynoDirection,
      sortDepthBias: dynoDepthBias,
      sort360: dynoSort360,
    };

    const xyza = readPackedCenterAlpha({
      packed1: dynoPacked1,
      numSplats: dynoNumSplats,
      index,
    });
    const metric = computeSortMetric({ xyza, ...sortParams });
    const rgba8 = dyno.uintToRgba8(dyno.floatBitsToUint(metric));
    return { rgba8 };
  },
);
const doubleSortReader = dyno.dynoBlock(
  { index: "int" },
  { rgba8: "vec4" },
  ({ index }) => {
    if (!index) {
      throw new Error("No index");
    }
    const sortParams = {
      sortRadial: dynoSortRadial,
      sortOrigin: dynoOrigin,
      sortDirection: dynoDirection,
      sortDepthBias: dynoDepthBias,
      sort360: dynoSort360,
    };
    const index0 = dyno.mul(index, dyno.dynoConst("int", 2));
    const index1 = dyno.add(index0, dyno.dynoConst("int", 1));

    const xyza0 = readPackedCenterAlpha({
      packed1: dynoPacked1,
      numSplats: dynoNumSplats,
      index: index0,
    });
    const xyza1 = readPackedCenterAlpha({
      packed1: dynoPacked1,
      numSplats: dynoNumSplats,
      index: index1,
    });

    const metric0 = computeSortMetric({ xyza: xyza0, ...sortParams });
    const metric1 = computeSortMetric({ xyza: xyza1, ...sortParams });

    const combined = dyno.combine({
      vectorType: "vec2",
      x: metric0,
      y: metric1,
    });
    const rgba8 = dyno.uintToRgba8(dyno.packHalf2x16(combined));
    return { rgba8 };
  },
);

const defineReadPackedCenterAlpha = dyno.unindent(`
  vec4 readPackedCenterAlpha(usampler2DArray texture, int numSplats, int index) {
    if ((index >= 0) && (index < numSplats)) {
      uvec4 packed = texelFetch(texture, splatTexCoord(index), 0);
      return unpackSplatExtCenterAlpha(packed);
    } else {
      return vec4(0.0);
    }
  }
`);

function readPackedCenterAlpha({
  packed1,
  numSplats,
  index,
}: {
  packed1: dyno.DynoVal<"usampler2DArray">;
  numSplats: dyno.DynoVal<"int">;
  index: dyno.DynoVal<"int">;
}) {
  return dyno.dyno({
    inTypes: { packed1: "usampler2DArray", numSplats: "int", index: "int" },
    outTypes: { xyza: "vec4" },
    inputs: { packed1, numSplats, index },
    globals: () => [defineReadPackedCenterAlpha],
    statements: ({ inputs, outputs }) => {
      const { xyza } = outputs;
      const { packed1, numSplats, index } = inputs;
      if (!xyza || !packed1 || !numSplats || !index) {
        return [];
      }
      return [
        `${xyza} = readPackedCenterAlpha(${packed1}, ${numSplats}, ${index});`,
      ];
    },
  }).outputs.xyza;
}

const defineComputeSortMetric = dyno.unindent(`
float computeSort(vec4 xyza, bool sortRadial, vec3 sortOrigin, vec3 sortDirection, float sortDepthBias, bool sort360) {
  if (xyza.a < (0.5 / 255.0)) {
    return INFINITY;
  }

  vec3 center = xyza.xyz - sortOrigin;
  float biasedDepth = dot(center, sortDirection) + sortDepthBias;
  if (!sort360 && (biasedDepth <= 0.0)) {
    return INFINITY;
  }

  return sortRadial ? length(center) : biasedDepth;
}
`);

function computeSortMetric({
  xyza,
  sortRadial,
  sortOrigin,
  sortDirection,
  sortDepthBias,
  sort360,
}: {
  xyza: dyno.DynoVal<"vec4">;
  sortRadial: dyno.DynoVal<"bool">;
  sortOrigin: dyno.DynoVal<"vec3">;
  sortDirection: dyno.DynoVal<"vec3">;
  sortDepthBias: dyno.DynoVal<"float">;
  sort360: dyno.DynoVal<"bool">;
}) {
  return dyno.dyno({
    inTypes: {
      xyza: "vec4",
      sortRadial: "bool",
      sortOrigin: "vec3",
      sortDirection: "vec3",
      sortDepthBias: "float",
      sort360: "bool",
    },
    outTypes: { metric: "float" },
    globals: () => [dyno.defineGsplat, defineComputeSortMetric],
    inputs: {
      xyza,
      sortRadial,
      sortOrigin,
      sortDirection,
      sortDepthBias,
      sort360,
    },
    statements: ({ inputs, outputs }) => {
      const {
        xyza,
        sortRadial,
        sortOrigin,
        sortDirection,
        sortDepthBias,
        sort360,
      } = inputs;
      return dyno.unindentLines(`
        ${outputs.metric} = computeSort(${xyza}, ${sortRadial}, ${sortOrigin}, ${sortDirection}, ${sortDepthBias}, ${sort360});
      `);
    },
  }).outputs.metric;
}
