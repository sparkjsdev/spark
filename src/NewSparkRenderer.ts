import * as THREE from "three";
import {
  ExtSplats,
  PackedSplats,
  PagedSplats,
  Readback,
  type SplatGenerator,
  SplatMesh,
  SplatPager,
  dyno,
} from ".";
import { NewSplatAccumulator } from "./NewSplatAccumulator";
import { NewSplatGeometry } from "./NewSplatGeometry";
import { NewSplatWorker, workerPool } from "./NewSplatWorker";
import { SPLAT_TEX_HEIGHT, SPLAT_TEX_WIDTH } from "./defines";
import { getShaders } from "./shaders";
import { cloneClock, isAndroid, isIos, isOculus, isVisionPro } from "./utils";

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
   * Whether to use extended Gsplat encoding for intermediary splats.
   * @default false
   */
  extSplats?: boolean;
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
   * or by Z-depth (false). Most scenes are trained with the Z-depth `sort `metric
   * and will render more accurately at certain viewpoints. However, radial sorting
   * is more stable under viewpoint rotations.
   * @default true
   */
  sortRadial?: boolean;
  /**
   * Minimum interval between sort calls in milliseconds.
   * @default 1
   */
  minSortIntervalMs?: number;
  /**
   * Minimum interval between LOD calls in milliseconds.
   * @default 1
   */
  minLodIntervalMs?: number;
  /*
   * Flag to control whether LoD is enabled. @default true
   */
  enableLod?: boolean;
  /**
   * Set the target # splats for LoD. Recommended # splats is 500K for mobile and 1.5M for desktop,
   * which is set automatically if this isn't set.
   */
  lodSplatCount?: number;
  /**
   * Scale factor for target # splats for LoD. 2.0 means 2x the recommended # splats.
   * Recommended # splats is 500K for mobile and 1.5M for desktop.
   * @default 1.0
   */
  lodSplatScale?: number;
  /* Global LoD scale to apply @default 1.0
   */
  globalLodScale?: number;
  /* Foveation scale to apply outside the view frustum (but not behind viewer)
   * @default 1.0
   */
  outsideFoveate?: number;
  /* Foveation scale to apply behind viewer
   * @default 1.0
   */
  behindFoveate?: number;
  /* Full-width angle in degrees of fixed foveation cone along the view direction
   * with perfection foveation=1.0
   * @default 0.0 (disables perfect foveation zone)
   */
  coneFov0?: number;
  /* Full-width angle in degrees of fixed foveation cone along the view direction
   * @default 0.0 (disables cone foveation)
   */
  coneFov?: number;
  /* Foveation scale to apply at the edge of the cone
   * @default 1.0
   */
  coneFoveate?: number;
  numLodFetchers?: number;
  target?: {
    /**
     * Width of the render target in pixels.
     */
    width: number;
    /**
     * Height of the render target in pixels.
     */
    height: number;
    /**
     * If you want to be able to render a scene that depends on this target's
     * output (for example, a recursive viewport), set this to true to enable
     * double buffering.
     * @default false
     */
    doubleBuffer?: boolean;
    /**
     * Super-sampling factor for the render target. Values 1-4 are supported.
     * Note that re-sampling back down to .width x .height is done on the CPU
     * with simple averaging only when calling readTarget().
     * @default 1
     */
    superXY?: number;
  };
  extraUniforms?: Record<string, unknown>;
  vertexShader?: string;
  fragmentShader?: string;
  transparent?: boolean;
  depthTest?: boolean;
  depthWrite?: boolean;
}

export class NewSparkRenderer extends THREE.Mesh {
  renderer: THREE.WebGLRenderer;
  premultipliedAlpha: boolean;
  material: THREE.ShaderMaterial;
  uniforms: ReturnType<typeof NewSparkRenderer.makeUniforms>;

  autoUpdate: boolean;
  preUpdate: boolean;
  static sparkOverride?: NewSparkRenderer;

  renderSize = new THREE.Vector2();
  maxStdDev: number;
  minPixelRadius: number;
  maxPixelRadius: number;
  extSplats: boolean;
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

  sortRadial: boolean;

  clock: THREE.Clock;
  time?: number;
  lastFrame = -1;
  updateTimeoutId = -1;

  orderingTexture: THREE.DataTexture | null = null;
  maxSplats = 0;
  activeSplats = 0;

  display: NewSplatAccumulator;
  current: NewSplatAccumulator;
  accumulators: NewSplatAccumulator[] = [];

  sorting = false;
  sortDirty = false;
  lastSortTime = 0;
  sortWorker: NewSplatWorker | null = null;
  sortTimeoutId = -1;
  sortedCenter = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
  sortedDir = new THREE.Vector3().setScalar(0);
  readback32 = new Uint32Array(0);

  minSortIntervalMs: number;
  minLodIntervalMs: number;

  enableLod: boolean;
  lodSplatCount?: number;
  lodSplatScale: number;
  globalLodScale: number;
  outsideFoveate: number;
  behindFoveate: number;
  coneFov0: number;
  coneFov: number;
  coneFoveate: number;
  numLodFetchers: number;

  lodWorker: NewSplatWorker | null = null;
  lodMeshes: { mesh: SplatMesh; version: number }[] = [];
  lodDirty = false;
  lodIds: Map<
    PackedSplats | ExtSplats | PagedSplats,
    { lodId: number; lastTouched: number; rootPage?: number }
  > = new Map();
  lodIdToSplats: Map<number, PackedSplats | ExtSplats | PagedSplats> =
    new Map();
  lodInitQueue: (PackedSplats | ExtSplats | PagedSplats)[] = [];
  lodPos = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
  lodQuat = new THREE.Quaternion().set(0, 0, 0, 0);
  lodInstances: Map<
    SplatMesh,
    {
      lodId: number;
      numSplats: number;
      indices: Uint32Array;
      texture: THREE.DataTexture;
    }
  > = new Map();
  lodFetchers: Promise<void>[] = [];
  chunksToFetch: { lodId: number; chunk: number }[] = [];
  lodInserts: {
    lodId: number;
    pageBase: number;
    chunkBase: number;
    count: number;
    lodTreeData: Uint32Array;
  }[] = [];
  lodClears: {
    lodId: number;
    pageBase: number;
    chunkBase: number;
    count: number;
  }[] = [];

  pager?: SplatPager;
  pagerId = 0;

  target?: THREE.WebGLRenderTarget;
  backTarget?: THREE.WebGLRenderTarget;
  superPixels?: Uint8Array;
  targetPixels?: Uint8Array;
  superXY = 1;

  flushAfterGenerate = false;
  flushAfterRead = false;
  readPause = 1;
  sortPause = 0;
  sortDelay = 0;

  constructor(options: NewSparkRendererOptions) {
    const uniforms = NewSparkRenderer.makeUniforms();
    Object.assign(uniforms, options.extraUniforms ?? {});

    const shaders = getShaders();
    const premultipliedAlpha = options.premultipliedAlpha ?? true;
    const geometry = new NewSplatGeometry();
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: options.vertexShader ?? shaders.newSplatVertex,
      fragmentShader: options.fragmentShader ?? shaders.newSplatFragment,
      uniforms,
      premultipliedAlpha,
      transparent: options.transparent ?? true,
      depthTest: options.depthTest ?? true,
      depthWrite: options.depthWrite ?? false,
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
    this.preUpdate = options.preUpdate ?? true;

    this.maxStdDev = options.maxStdDev ?? Math.sqrt(8.0);
    this.minPixelRadius = options.minPixelRadius ?? 0.0; //1.6;
    this.maxPixelRadius = options.maxPixelRadius ?? 512.0;
    this.extSplats = options.extSplats ?? false;
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

    this.sortRadial = options.sortRadial ?? true;
    this.minSortIntervalMs = options.minSortIntervalMs ?? 0;
    this.minLodIntervalMs = options.minLodIntervalMs ?? 0;

    this.enableLod = options.enableLod ?? true;
    this.lodSplatCount = options.lodSplatCount;
    this.lodSplatScale = options.lodSplatScale ?? 1.0;
    this.globalLodScale = options.globalLodScale ?? 1.0;
    this.outsideFoveate = options.outsideFoveate ?? 1.0;
    this.behindFoveate = options.behindFoveate ?? 1.0;
    this.coneFov0 = options.coneFov0 ?? 0.0;
    this.coneFov = options.coneFov ?? 0.0;
    this.coneFoveate = options.coneFoveate ?? 1.0;
    this.numLodFetchers = options.numLodFetchers ?? 3;

    this.clock = options.clock ? cloneClock(options.clock) : new THREE.Clock();

    const accumulatorOptions = { extSplats: this.extSplats };
    this.display = new NewSplatAccumulator(accumulatorOptions);
    this.current = this.display;
    this.accumulators.push(new NewSplatAccumulator(accumulatorOptions));
    this.accumulators.push(new NewSplatAccumulator(accumulatorOptions));

    if (options.target) {
      const { width, height, doubleBuffer } = options.target;
      const superXY = Math.max(1, Math.min(4, options.target.superXY ?? 1));
      if (width * superXY > 8192 || height * superXY > 8192) {
        throw new Error("Target size too large");
      }
      this.superXY = superXY;

      const superWidth = width * superXY;
      const superHeight = height * superXY;
      this.target = new THREE.WebGLRenderTarget(superWidth, superHeight, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
      });
      if (doubleBuffer) {
        this.backTarget = new THREE.WebGLRenderTarget(superWidth, superHeight, {
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          colorSpace: THREE.SRGBColorSpace,
        });
      }
      this.encodeLinear = options.encodeLinear ?? true;
    }
  }

  static makeUniforms() {
    const uniforms = {
      // // number of active splats to render
      // numSplats: { value: 0 },
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
      enableExtSplats: { value: true },
      // Gsplat collection to render
      extSplats: { type: "t", value: NewSplatAccumulator.emptyTexture },
      extSplats2: { type: "t", value: NewSplatAccumulator.emptyTexture },
      // Time in seconds for time-based effects
      time: { value: 0 },
      // Delta time in seconds since last frame
      deltaTime: { value: 0 },
      // Debug flag that alternates each frame
      debugFlag: { value: false },
    };
    return uniforms;
  }

  dispose() {
    if (this.target) {
      this.target.dispose();
      this.target = undefined;
    }
    if (this.backTarget) {
      this.backTarget.dispose();
      this.backTarget = undefined;
    }
    if (this.orderingTexture) {
      this.orderingTexture.dispose();
      this.orderingTexture = null;
    }

    const accumulators = new Set<NewSplatAccumulator>();
    accumulators.add(this.display);
    accumulators.add(this.current);
    for (const accumulator of this.accumulators) {
      accumulators.add(accumulator);
    }
    for (const accumulator of accumulators) {
      accumulator.dispose();
    }

    const instances = this.lodInstances.values();
    this.lodInstances.clear();
    for (const instance of instances) {
      instance.texture.dispose();
    }

    if (this.sortWorker) {
      this.sortWorker.dispose();
      this.sortWorker = null;
    }
    if (this.lodWorker) {
      this.lodWorker.dispose();
      this.lodWorker = null;
    }
    if (this.pager) {
      this.pager.dispose();
      this.pager = undefined;
    }
  }

  onBeforeRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const spark = NewSparkRenderer.sparkOverride ?? this;

    const frame = renderer.info.render.frame;
    const isNewFrame = frame !== spark.lastFrame;
    spark.lastFrame = frame;

    if (spark.target) {
      spark.renderSize.set(spark.target.width, spark.target.height);
    } else {
      const renderSize = renderer.getDrawingBufferSize(spark.renderSize);
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
    }
    this.uniforms.renderSize.value.copy(spark.renderSize);

    const typedCamera = camera as
      | THREE.PerspectiveCamera
      | THREE.OrthographicCamera;

    this.uniforms.near.value = typedCamera.near;
    this.uniforms.far.value = typedCamera.far;

    const geometry = this.geometry as NewSplatGeometry;
    geometry.instanceCount = spark.activeSplats;

    const accumToWorld = new THREE.Matrix4();
    if (!this.display.extSplats) {
      accumToWorld.makeTranslation(spark.display.viewOrigin);
    }
    const cameraToWorld = camera.matrixWorld.clone();
    const worldToCamera = cameraToWorld.invert();
    const accumToCamera = worldToCamera.multiply(accumToWorld);
    accumToCamera.decompose(
      this.uniforms.renderToViewPos.value,
      this.uniforms.renderToViewQuat.value,
      new THREE.Vector3(),
    );

    this.uniforms.maxStdDev.value = spark.maxStdDev;
    this.uniforms.minPixelRadius.value = spark.minPixelRadius;
    this.uniforms.maxPixelRadius.value = spark.maxPixelRadius;
    this.uniforms.minAlpha.value = spark.minAlpha;
    this.uniforms.enable2DGS.value = spark.enable2DGS;
    this.uniforms.preBlurAmount.value = spark.preBlurAmount;
    this.uniforms.blurAmount.value = spark.blurAmount;
    this.uniforms.focalDistance.value = spark.focalDistance;
    this.uniforms.apertureAngle.value = spark.apertureAngle;
    this.uniforms.falloff.value = spark.falloff;
    this.uniforms.clipXY.value = spark.clipXY;
    this.uniforms.focalAdjustment.value = spark.focalAdjustment;
    this.uniforms.encodeLinear.value = spark.encodeLinear;

    this.uniforms.ordering.value =
      spark.orderingTexture ?? NewSparkRenderer.emptyOrdering;
    if (this.display.extSplats) {
      this.uniforms.enableExtSplats.value = true;
      const extSplats = spark.display.getTextures();
      this.uniforms.extSplats.value = extSplats[0];
      this.uniforms.extSplats2.value = extSplats[1];
    } else {
      this.uniforms.enableExtSplats.value = false;
      const packedSplats = spark.display.getTextures();
      this.uniforms.extSplats.value = packedSplats[0];
      this.uniforms.extSplats2.value = packedSplats[0];
    }

    this.uniforms.time.value = spark.display.time;
    this.uniforms.deltaTime.value = spark.display.deltaTime;
    // Alternating debug flag that can aid in visual debugging
    this.uniforms.debugFlag.value = (performance.now() / 1000.0) % 2.0 < 1.0;

    if (spark.autoUpdate && isNewFrame) {
      const preUpdate = spark.preUpdate && !renderer.xr.isPresenting;
      const useCamera = renderer.xr.isPresenting
        ? renderer.xr.getCamera()
        : camera;
      if (preUpdate) {
        spark.updateInternal({
          scene,
          camera: useCamera,
          autoUpdate: true,
        });
      } else {
        if (spark.updateTimeoutId === -1) {
          spark.updateTimeoutId = setTimeout(() => {
            spark.updateTimeoutId = -1;
            spark.updateInternal({
              scene,
              camera: useCamera,
              autoUpdate: true,
            });
          }, 1);
        }
      }
    }
  }

  async update({
    scene,
    camera,
  }: {
    scene: THREE.Scene;
    camera: THREE.Camera;
  }) {
    await this.updateInternal({ scene, camera, autoUpdate: false });
  }

  private async updateInternal({
    scene,
    camera,
    autoUpdate,
  }: {
    scene: THREE.Scene;
    camera: THREE.Camera;
    autoUpdate: boolean;
  }) {
    const renderer = this.renderer;
    const time = this.time ?? this.clock.getElapsedTime();

    const center = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());

    const viewChanged =
      center.distanceTo(this.sortedCenter) > 0.001 ||
      dir.dot(this.sortedDir) < 0.999;

    const next = this.accumulators.pop();
    if (!next) {
      // Should never happen
      throw new Error("No next accumulator");
    }
    const { version, visibleGenerators, generate } = next.prepareGenerate({
      renderer,
      scene,
      time,
      camera,
      sortRadial: this.sortRadial ?? true,
      renderSize: this.renderSize,
      previous: this.current,
      lodInstances: this.enableLod ? this.lodInstances : undefined,
    });

    this.driveLod({ visibleGenerators, camera });
    this.driveSort();

    const needsUpdate = viewChanged || version !== this.current.version;

    if (autoUpdate && !needsUpdate) {
      // Triggered by auto-update but no change, so exit early
      this.accumulators.push(next);
      return null;
    }

    if (needsUpdate && this.sorting) {
      this.accumulators.push(next);
      return null;
    }

    generate();

    if (this.flushAfterGenerate) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      gl.flush();
    }

    if (this.display.mappingVersion === next.mappingVersion) {
      this.accumulators.push(this.display);
      this.display = next;
    } else {
      if (this.display !== this.current) {
        this.accumulators.push(this.current);
      }
    }

    this.current = next;
    this.sortDirty = true;

    await this.driveSort();
  }

  private async driveSort() {
    if (this.sorting || !this.sortDirty) {
      return;
    }

    if (this.sortTimeoutId !== -1) {
      clearTimeout(this.sortTimeoutId);
      this.sortTimeoutId = -1;
    }

    const now = performance.now();
    const nextSortTime = this.lastSortTime
      ? this.lastSortTime + this.minSortIntervalMs
      : now;
    if (now < nextSortTime) {
      this.sortTimeoutId = setTimeout(() => {
        this.sortTimeoutId = -1;
        this.driveSort();
      }, nextSortTime - now);
      return;
    }

    this.sorting = true;
    this.sortDirty = false;
    this.lastSortTime = now;

    if (this.readPause > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.readPause));
    }

    const current = this.current;

    this.sortedCenter.copy(current.viewOrigin);
    this.sortedDir.copy(current.viewDirection);

    const { numSplats, maxSplats } = current;
    const rows = Math.max(1, Math.ceil(maxSplats / 16384));
    const orderingMaxSplats = rows * 16384;
    this.maxSplats = Math.max(this.maxSplats, orderingMaxSplats);

    const ordering = new Uint32Array(this.maxSplats);
    const readback = Readback.ensureBuffer(maxSplats, this.readback32);
    this.readback32 = readback;

    await this.readbackDepth({
      current,
      renderer: this.renderer,
      numSplats,
      readback,
    });

    if (this.sortPause > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.sortPause));
    }

    if (!this.sortWorker) {
      this.sortWorker = new NewSplatWorker();
    }
    const result = (await this.sortWorker.call("sortSplats32", {
      numSplats,
      readback,
      ordering,
    })) as {
      readback: Uint16Array | Uint32Array;
      ordering: Uint32Array;
      activeSplats: number;
    };

    if (this.sortDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.sortDelay));
    }

    this.readback32 = result.readback as Uint32Array<ArrayBuffer>;

    this.activeSplats = result.activeSplats;

    if (this.orderingTexture) {
      if (rows > this.orderingTexture.image.height) {
        this.orderingTexture.dispose();
        this.orderingTexture = null;
      }
    }

    if (!this.orderingTexture) {
      // console.log(`Allocating orderingTexture: ${4096}x${rows}`);
      const orderingTexture = new THREE.DataTexture(
        result.ordering,
        4096,
        rows,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
      );
      orderingTexture.internalFormat = "RGBA32UI";
      orderingTexture.needsUpdate = true;
      this.orderingTexture = orderingTexture;
    } else {
      const renderer = this.renderer;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!renderer.properties.has(this.orderingTexture)) {
        this.orderingTexture.needsUpdate = true;
      } else {
        const props = renderer.properties.get(this.orderingTexture) as {
          __webglTexture: WebGLTexture;
        };
        const glTexture = props.__webglTexture;
        if (!glTexture) {
          throw new Error("ordering texture not found");
        }
        renderer.state.activeTexture(gl.TEXTURE0);
        renderer.state.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          4096,
          rows,
          gl.RGBA_INTEGER,
          gl.UNSIGNED_INT,
          // data,
          result.ordering,
        );
        renderer.state.bindTexture(gl.TEXTURE_2D, null);
      }
    }

    // console.log(`Sorted (${this.minSortIntervalMs}) ${numSplats} splats in ${(performance.now() - now).toFixed(0)} ms`);

    if (this.display.mappingVersion !== current.mappingVersion) {
      this.accumulators.push(this.display);
      this.display = this.current;
    }
    this.sorting = false;

    this.driveSort();
  }

  private ensureLodWorker() {
    if (!this.lodWorker) {
      this.lodWorker = new NewSplatWorker();
    }
    return this.lodWorker;
  }

  private async driveLod({
    visibleGenerators,
    camera: inputCamera,
  }: { visibleGenerators: SplatGenerator[]; camera: THREE.Camera }) {
    const lodMeshes = !this.enableLod
      ? []
      : (visibleGenerators.filter((generator) => {
          return (
            generator instanceof SplatMesh &&
            (generator.packedSplats?.lodSplats ||
              generator.extSplats?.lodSplats ||
              generator.paged) &&
            generator.enableLod !== false
          );
        }) as SplatMesh[]);
    const hasPaged = lodMeshes.some((mesh) => mesh.paged);

    let forceUpdate = this.lodMeshes.length !== lodMeshes.length;
    if (
      !forceUpdate &&
      lodMeshes.some(
        (m, i) =>
          m !== this.lodMeshes[i].mesh || m.version > this.lodMeshes[i].version,
      )
    ) {
      forceUpdate = true;
    }
    this.lodMeshes = lodMeshes.map((mesh) => ({
      mesh,
      version: mesh.version + 1,
    }));
    // console.log(`lodMeshes versions: ${JSON.stringify(this.lodMeshes.map(m => m.version))}`);

    if (forceUpdate) {
      this.lodDirty = true;
    }

    if (!this.lodDirty && lodMeshes.length === 0 && this.lodIds.size === 0) {
      return;
    }

    const camera = inputCamera.clone();

    this.lodInitQueue = [];
    const now = performance.now();

    for (const mesh of lodMeshes) {
      const splats =
        mesh.packedSplats?.lodSplats ?? mesh.extSplats?.lodSplats ?? mesh.paged;
      if (splats) {
        const record = this.lodIds.get(splats);
        if (record) {
          record.lastTouched = now;
        } else {
          this.lodInitQueue.push(splats);
        }
      }
    }

    this.ensureLodWorker().tryExclusive(async (worker) => {
      if (hasPaged && !this.pager) {
        this.pager = new SplatPager({ renderer: this.renderer });
        for (const { mesh } of this.lodMeshes) {
          if (mesh.paged && !mesh.paged.pager) {
            mesh.paged.pager = this.pager;
          }
        }

        const { lodId } = (await worker.call("newLodTree", {
          capacity: this.pager.maxSplats,
        })) as { lodId: number };
        this.pagerId = lodId;
        console.log("*** Set pagerId to", lodId);
      }

      if (this.lodInitQueue.length > 0) {
        const lodInitQueue = this.lodInitQueue;
        this.lodInitQueue = [];
        while (lodInitQueue.length > 0) {
          const splats = lodInitQueue.shift();
          if (splats) {
            await this.initLodTree(worker, splats);
            this.lodDirty = true;
          }
        }
      }

      if (this.pager) {
        const { updates, clears } = this.pager.consumeLodTreeUpdates();

        for (const { splats, page, chunk } of clears) {
          const record = this.lodIds.get(splats);
          if (record) {
            this.lodClears.push({
              lodId: record.lodId,
              pageBase: page * this.pager.pageSplats,
              chunkBase: chunk * this.pager.pageSplats,
              count: this.pager.pageSplats,
            });
          }
        }

        for (const { splats, page, chunk, numSplats, lodTree } of updates) {
          const record = this.lodIds.get(splats);
          if (record) {
            if (chunk === 0) {
              record.rootPage = page;
            }
            // console.log("*** PAGER insertLodTrees", record.lodId, page, chunk);
            this.lodInserts.push({
              lodId: record.lodId,
              pageBase: page * this.pager.pageSplats,
              chunkBase: chunk * this.pager.pageSplats,
              count: numSplats,
              lodTreeData: lodTree,
            });
          }
        }
      }

      if (this.lodClears.length > 0) {
        const lodClears = this.lodClears;
        this.lodClears = [];
        await worker.call("clearLodTrees", { ranges: lodClears });
        this.lodDirty = true;
        console.log("*** clearedLodTrees", lodClears);
      }

      if (this.lodInserts.length > 0) {
        const lodInserts = this.lodInserts;
        this.lodInserts = [];
        await worker.call("insertLodTrees", { ranges: lodInserts });
        // console.log("*** insertedLodTrees", lodInserts);
        this.lodDirty = true;
      }

      const viewPos = new THREE.Vector3();
      const viewQuat = new THREE.Quaternion();
      this.current.viewToWorld.decompose(
        viewPos,
        viewQuat,
        new THREE.Vector3(),
      );
      const viewChanged =
        viewPos.distanceTo(this.lodPos) > 0.001 ||
        viewQuat.dot(this.lodQuat) < 0.999;

      if (this.lodDirty || viewChanged) {
        this.lodPos.copy(viewPos);
        this.lodQuat.copy(viewQuat);
        this.lodDirty = false;
        await this.updateLodInstances(worker, camera, lodMeshes);
      }

      await this.cleanupLodTrees(worker);
    });
  }

  private async initLodTree(
    worker: NewSplatWorker,
    splats: PackedSplats | ExtSplats | PagedSplats,
  ) {
    if (splats instanceof PackedSplats || splats instanceof ExtSplats) {
      const { lodId } = (await worker.call("initLodTree", {
        numSplats: splats.numSplats ?? 0,
        lodTree: (splats.extra.lodTree as Uint32Array).slice(),
      })) as { lodId: number };
      this.lodIds.set(splats, { lodId, lastTouched: performance.now() });
      this.lodIdToSplats.set(lodId, splats);
      console.log("*** initLodTree", lodId, splats.extra.lodTree, splats);
    } else {
      const { lodId } = (await worker.call("newSharedLodTree", {
        lodId: this.pagerId,
      })) as { lodId: number };
      this.lodIds.set(splats, { lodId, lastTouched: performance.now() });
      this.lodIdToSplats.set(lodId, splats);
      console.log("*** newSharedLodTree", lodId, this.pagerId, splats);
    }
  }

  private async updateLodInstances(
    worker: NewSplatWorker,
    camera: THREE.Camera,
    lodMeshes: SplatMesh[],
  ) {
    const defaultSplatCount =
      isAndroid() || isOculus() || isVisionPro()
        ? 500000
        : isIos()
          ? 500000
          : 1500000;
    const splatCount = this.lodSplatCount ?? defaultSplatCount;
    const maxSplats = splatCount * this.lodSplatScale;
    let pixelScaleLimit = 0.0;
    let fovXdegrees = Number.POSITIVE_INFINITY;
    let fovYdegrees = Number.POSITIVE_INFINITY;
    if (camera instanceof THREE.PerspectiveCamera) {
      const tanYfov = Math.tan((0.5 * camera.fov * Math.PI) / 180);
      pixelScaleLimit = (2.0 * tanYfov) / this.renderSize.y;
      fovYdegrees = camera.fov;
      fovXdegrees =
        ((Math.atan(tanYfov * camera.aspect) * 180) / Math.PI) * 2.0;
    }

    const uuidToMesh: Map<string, SplatMesh> = new Map();

    const instances = lodMeshes.reduce(
      (instances, mesh) => {
        uuidToMesh.set(mesh.uuid, mesh);
        const viewToObject = mesh.matrixWorld
          .clone()
          .invert()
          .multiply(camera.matrixWorld);

        const splats =
          mesh.packedSplats?.lodSplats ??
          mesh.extSplats?.lodSplats ??
          mesh.paged;
        if (!splats) {
          return instances;
        }
        const record = this.lodIds.get(splats);
        if (!record) {
          return instances;
        }

        if (this.pager && mesh.paged && record.rootPage === undefined) {
          return instances;
        }

        instances[mesh.uuid] = {
          lodId: record.lodId,
          rootPage: record.rootPage,
          viewToObjectCols: viewToObject.elements,
          lodScale: mesh.lodScale * this.globalLodScale,
          outsideFoveate: mesh.outsideFoveate ?? this.outsideFoveate,
          behindFoveate: mesh.behindFoveate ?? this.behindFoveate,
          coneFov0: mesh.coneFov0 ?? this.coneFov0,
          coneFov: mesh.coneFov ?? this.coneFov,
          coneFoveate: mesh.coneFoveate ?? this.coneFoveate,
        };
        return instances;
      },
      {} as Record<
        string,
        {
          lodId: number;
          rootPage?: number;
          viewToObjectCols: number[];
          lodScale: number;
          outsideFoveate: number;
          behindFoveate: number;
          coneFov0: number;
          coneFov: number;
          coneFoveate: number;
        }
      >,
    );
    // console.log("instances", instances);

    // const traverseStart = performance.now();
    const { keyIndices, chunks } = (await worker.call("traverseLodTrees", {
      maxSplats,
      pixelScaleLimit,
      fovXdegrees,
      fovYdegrees,
      instances,
    })) as {
      keyIndices: Record<
        string,
        { lodId: number; numSplats: number; indices: Uint32Array }
      >;
      chunks: [number, number][];
    };
    // const splatCounts = Object.keys(keyIndices).map(
    //   (uuid) => keyIndices[uuid].numSplats,
    // );
    // if (Math.random() < 0.1) {
    //   console.log(
    //     `traverseLodTrees in ${(performance.now() - traverseStart).toFixed(0)} ms, splatCounts=${JSON.stringify(splatCounts)}`,
    //     // JSON.stringify(chunks),
    //   );
    // }
    // console.log("*** counts", JSON.stringify(chunks));

    this.updateLodIndices(uuidToMesh, keyIndices);
    // console.log("chunks.length =", chunks.length);

    if (this.pager) {
      this.pager.processUploads();

      const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
      const pagedMeshes = lodMeshes
        .map((mesh) => {
          if (!mesh.paged || !this.pager) {
            return null;
          }
          const meshPosition = mesh.getWorldPosition(new THREE.Vector3());
          return {
            splats: mesh.paged,
            distance: meshPosition.distanceTo(cameraPosition),
          };
        })
        .filter((result) => result !== null);

      // Fetch root chunk of each paged splats in priority of distance to camera
      pagedMeshes.sort((a, b) => a.distance - b.distance);
      this.pager.fetchPriority = pagedMeshes.map(({ splats }) => ({
        splats,
        chunk: 0,
      }));

      for (const [lodId, chunk] of chunks) {
        const splats = this.lodIdToSplats.get(lodId);
        if (splats instanceof PagedSplats) {
          this.pager.fetchPriority.push({ splats, chunk });
        }
      }

      this.pager.driveFetchers();
    }

    const splatStats = new Map();

    // Update chunk LRU ordering. Touch in reverse order so first chunk is MRU.
    for (let i = chunks.length - 1; i >= 0; --i) {
      const [lodId, chunk] = chunks[i];
      const splats = this.lodIdToSplats.get(lodId);
      if (!splats || !(splats instanceof PackedSplats) || !splats.paged) {
        continue;
      }

      const page = splats.chunkToPage.get(chunk);
      if (page !== undefined) {
        // Update LRU ordering
        splats.chunkToPage.delete(chunk);
        splats.chunkToPage.set(chunk, page);
      }
    }

    this.chunksToFetch = [];

    for (const [lodId, chunk] of chunks) {
      const splats = this.lodIdToSplats.get(lodId);
      if (!splats || !(splats instanceof PackedSplats) || !splats.paged) {
        continue;
      }

      let stats = splatStats.get(splats);
      if (!stats) {
        const maxPages = Math.ceil(splats.maxSplats / 65536);
        // const buffer = Math.max(1, Math.min(16, Math.round(0.1 * maxPages)));
        const buffer = 0;
        const pageLimit = maxPages - buffer;
        const pages = 0;
        splats.chunkEvict = [];
        stats = { pageLimit, pages };
        splatStats.set(splats, stats);
      }
      stats.pages += 1;

      const page = splats.chunkToPage.get(chunk);
      if (page === undefined) {
        this.chunksToFetch.push({ lodId, chunk });
      } else if (page !== null) {
        if (stats.pages > stats.pageLimit) {
          splats.chunkEvict.push(chunk);
        }
      }
    }

    this.driveLodFetchers();
  }

  private driveLodFetchers() {
    if (this.lodFetchers.length >= this.numLodFetchers) {
      return;
    }

    this.chunksToFetch = this.chunksToFetch.filter(({ lodId, chunk }) => {
      if (this.lodFetchers.length >= this.numLodFetchers) {
        return true;
      }

      const splats = this.lodIdToSplats.get(lodId);
      if (!splats || !(splats instanceof PackedSplats) || !splats.paged) {
        return false;
      }

      const page = splats.allocTexturePage();
      if (page === undefined) {
        // Out of free pages, skip for now
        return true;
      }

      const promise = this.fetchLodChunk(lodId, splats, chunk, page).then(
        () => {
          this.lodFetchers = this.lodFetchers.filter((p) => p !== promise);
        },
      );
      this.lodFetchers.push(promise);

      promise.then(() => this.driveLodFetchers());
      return false;
    });
  }

  private async fetchLodChunk(
    lodId: number,
    splats: PackedSplats,
    chunk: number,
    page: number,
  ) {
    // Mark the chunk as "in progress" by setting to null
    splats.chunkToPage.set(chunk, null);

    const start = performance.now();
    const url = (splats.paged?.url ?? "").replace(/-lod-0\./, `-lod-${chunk}.`);
    const decoded = await workerPool.withWorker(async (worker) => {
      const decoded = (await worker.call("loadPackedSplats", {
        url,
        requestHeader: splats.paged?.requestHeader,
        withCredentials: splats.paged?.withCredentials,
      })) as {
        lodSplats: {
          numSplats: number;
          packedArray: Uint32Array;
          extra: Record<string, unknown>;
        };
      };
      return decoded.lodSplats;
    });

    // console.log(`Uploading chunk ${chunk} to page ${page}`);
    splats.uploadTexturePage(this.renderer, decoded.packedArray, page);
    splats.chunkToPage.set(chunk, page);
    // console.log("chunkToPage.size", splats.chunkToPage.size);
    this.lodInserts.push({
      lodId,
      pageBase: page * 65536,
      chunkBase: chunk * 65536,
      count: decoded.numSplats,
      lodTreeData: decoded.extra.lodTree as Uint32Array,
    });
    this.lodDirty = true;
    console.log(
      "Fetched LOD chunk",
      chunk,
      decoded.numSplats,
      performance.now() - start,
    );
  }

  private async cleanupLodTrees(worker: NewSplatWorker) {
    const DISPOSE_TIMEOUT_MS = 3000;
    const now = performance.now();

    let oldest = null;
    for (const [splats, record] of this.lodIds.entries()) {
      if (oldest == null || record.lastTouched < oldest.lastTouched) {
        oldest = {
          splats,
          lastTouched: record.lastTouched,
          lodId: record.lodId,
        };
      }
    }
    if (!oldest || oldest.lastTouched > now - DISPOSE_TIMEOUT_MS) {
      return;
    }

    this.lodIds.delete(oldest.splats);
    this.lodIdToSplats.delete(oldest.lodId);

    for (const [mesh, instance] of this.lodInstances.entries()) {
      if (instance.lodId === oldest.lodId) {
        instance.texture.dispose();
        this.lodInstances.delete(mesh);
      }
    }

    await worker.call("disposeLodTree", { lodId: oldest.lodId });
    // console.log("disposed lodTree", oldest.lodId);
  }

  private updateLodIndices(
    uuidToMesh: Map<string, SplatMesh>,
    keyIndices: Record<
      string,
      { lodId: number; numSplats: number; indices: Uint32Array }
    >,
  ) {
    // console.log("updateLodIndices", keyIndices);
    for (const [uuid, countIndices] of Object.entries(keyIndices)) {
      const { lodId, numSplats, indices } = countIndices;
      const mesh = uuidToMesh.get(uuid) as SplatMesh;

      if (mesh.paged) {
        mesh.paged.update(numSplats, indices);
        // console.log("*** paged.update", lodId, numSplats, indices.slice(0, 5).join(","));
      } else {
        let instance = this.lodInstances.get(mesh);
        if (instance) {
          if (indices.length > instance.indices.length) {
            instance.texture.dispose();
            instance = undefined;
          }
        }

        const rows = Math.ceil(indices.length / 16384);
        if (!instance) {
          const capacity = rows * 16384;
          if (indices.length !== capacity) {
            throw new Error("Indices length != capacity");
          }
          const texture = new THREE.DataTexture(
            indices,
            4096,
            rows,
            THREE.RGBAIntegerFormat,
            THREE.UnsignedIntType,
          );
          texture.internalFormat = "RGBA32UI";
          texture.needsUpdate = true;
          instance = { lodId, numSplats, indices, texture };
          this.lodInstances.set(mesh, instance);
        } else {
          instance.numSplats = numSplats;
          const renderer = this.renderer;
          const gl = renderer.getContext() as WebGL2RenderingContext;
          if (renderer.properties.has(instance.texture)) {
            const props = renderer.properties.get(instance.texture) as {
              __webglTexture: WebGLTexture;
            };
            const glTexture = props.__webglTexture;
            if (!glTexture) {
              throw new Error("lodIndices texture not found");
            }
            renderer.state.activeTexture(gl.TEXTURE0);
            renderer.state.bindTexture(gl.TEXTURE_2D, glTexture);
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texSubImage2D(
              gl.TEXTURE_2D,
              0,
              0,
              0,
              4096,
              rows,
              gl.RGBA_INTEGER,
              gl.UNSIGNED_INT,
              indices,
            );
            renderer.state.bindTexture(gl.TEXTURE_2D, null);
          }
        }
      }
      mesh.updateMappingVersion();
    }
  }

  private async readbackDepth({
    current,
    renderer,
    numSplats,
    readback,
  }: {
    current: NewSplatAccumulator;
    renderer: THREE.WebGLRenderer;
    numSplats: number;
    readback: Uint32Array;
  }) {
    if (!renderer) {
      throw new Error("No renderer");
    }
    if (!current.target) {
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
    const renderState = this.saveRenderState(renderer);

    // We can only read back one 2D array layer of pixels at a time,
    // so loop through them, initiate the readback, and collect the
    // completion promises.
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

      // Compute the subarray that this layer of readback corresponds to
      const readbackSize = SPLAT_TEX_WIDTH * layerYEnd * 4;
      const subReadback = readbackUint8.subarray(
        layerBase * 4,
        layerBase * 4 + readbackSize,
      );
      renderer.setRenderTarget(current.target, layer);

      const promise = renderer.readRenderTargetPixelsAsync(
        current.target,
        0,
        0,
        SPLAT_TEX_WIDTH,
        layerYEnd,
        subReadback,
        undefined,
        current.extSplats ? 2 : 1,
      );
      promises.push(promise);

      if (this.flushAfterRead) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        gl.flush();
      }

      baseIndex += SPLAT_TEX_WIDTH * layerYEnd;
    }

    this.resetRenderState(renderer, renderState);
    return Promise.all(promises).then(() => readback);
  }

  private saveRenderState(renderer: THREE.WebGLRenderer) {
    return {
      target: renderer.getRenderTarget(),
      xrEnabled: renderer.xr.enabled,
      autoClear: renderer.autoClear,
    };
  }

  private resetRenderState(
    renderer: THREE.WebGLRenderer,
    state: {
      target: THREE.WebGLRenderTarget | null;
      xrEnabled: boolean;
      autoClear: boolean;
    },
  ) {
    renderer.setRenderTarget(state.target);
    renderer.xr.enabled = state.xrEnabled;
    renderer.autoClear = state.autoClear;
  }

  private static emptyOrdering = (() => {
    const numIndices = 4 * 4096 * 1;
    const emptyArray = new Uint32Array(numIndices);
    const texture = new THREE.DataTexture(emptyArray, 4096, 1);
    texture.format = THREE.RGBAIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "RGBA32UI";
    texture.needsUpdate = true;
    return texture;
  })();

  render(scene: THREE.Scene, camera: THREE.Camera) {
    try {
      NewSparkRenderer.sparkOverride = this;
      this.renderer.render(scene, camera);
    } finally {
      NewSparkRenderer.sparkOverride = undefined;
    }
  }

  renderTarget({
    scene,
    camera,
  }: { scene: THREE.Scene; camera: THREE.Camera }): THREE.WebGLRenderTarget {
    const target = this.backTarget ?? this.target;
    if (!target) {
      throw new Error("No target");
    }

    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(target);
      NewSparkRenderer.sparkOverride = this;
      this.renderer.render(scene, camera);
    } finally {
      NewSparkRenderer.sparkOverride = undefined;
      this.renderer.setRenderTarget(previousTarget);
    }

    if (target !== this.target) {
      // Swap back buffer and target
      [this.target, this.backTarget] = [this.backTarget, this.target];
    }
    return target;
  }

  // Read back the previously rendered target image as a Uint8Array of packed
  // RGBA values (in that order). Subsequent calls to this.readTarget()
  // will reuse the same buffers to minimize memory allocations.
  async readTarget(): Promise<Uint8Array> {
    if (!this.target) {
      throw new Error("Must initialize with target");
    }
    const { width, height } = this.target;
    const byteSize = width * height * 4;
    if (!this.superPixels || this.superPixels.length < byteSize) {
      this.superPixels = new Uint8Array(byteSize);
      // console.log(`Allocated superPixels: ${width}x${height} = ${byteSize} bytes`);
    }
    const superPixels = this.superPixels;

    await this.renderer.readRenderTargetPixelsAsync(
      this.target,
      0,
      0,
      width,
      height,
      superPixels,
    );

    const { superXY } = this;
    if (superXY === 1) {
      return superPixels;
    }

    const subWidth = width / superXY;
    const subHeight = height / superXY;
    const subSize = subWidth * subHeight * 4;
    if (!this.targetPixels || this.targetPixels.length < subSize) {
      this.targetPixels = new Uint8Array(subSize);
      // console.log(`Allocated targetPixels: ${subWidth}x${subHeight} = ${subSize} bytes`);
    }
    const targetPixels = this.targetPixels;

    const super2 = superXY * superXY;
    for (let y = 0; y < subHeight; y++) {
      const row = y * subWidth;
      for (let x = 0; x < subWidth; x++) {
        const superCol = x * superXY;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < superXY; sy++) {
          const superRow = (y * superXY + sy) * width;
          for (let sx = 0; sx < superXY; sx++) {
            const superIndex = (superRow + superCol + sx) * 4;
            r += superPixels[superIndex];
            g += superPixels[superIndex + 1];
            b += superPixels[superIndex + 2];
            a += superPixels[superIndex + 3];
          }
        }
        const pixelIndex = (row + x) * 4;
        targetPixels[pixelIndex] = r / super2;
        targetPixels[pixelIndex + 1] = g / super2;
        targetPixels[pixelIndex + 2] = b / super2;
        targetPixels[pixelIndex + 3] = a / super2;
      }
    }
    return targetPixels;
  }

  async renderReadTarget({
    scene,
    camera,
  }: { scene: THREE.Scene; camera: THREE.Camera }): Promise<Uint8Array> {
    this.renderTarget({ scene, camera });
    return this.readTarget();
  }
}
