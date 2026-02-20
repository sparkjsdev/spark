import * as THREE from "three";
import {
  ExtSplats,
  PackedSplats,
  PagedSplats,
  Readback,
  type SplatGenerator,
  SplatMesh,
  SplatPager,
} from ".";
import { SplatAccumulator } from "./SplatAccumulator";
import { SplatGeometry } from "./SplatGeometry";
import { SplatWorker } from "./SplatWorker";
import { SPLAT_TEX_HEIGHT, SPLAT_TEX_WIDTH } from "./defines";
import { getShaders } from "./shaders";
import {
  cloneClock,
  isAndroid,
  isIos,
  isMobile,
  isOculus,
  isVisionPro,
} from "./utils";

export interface SparkRendererOptions {
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
   * Whether to use extended Gsplat encoding for intermediary accumulator splats.
   * @default false
   */
  accumExtSplats?: boolean;
  /**
   * Whether to use covariance Gsplat encoding for intermediary splats.
   * @default false
   */
  covSplats?: boolean;
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
  /*
   * Flag to control whether LoD is enabled. @default true
   */
  enableLod?: boolean;
  /**
   * Whether to drive LOD updates (compute lodInstances, update pager, etc.).
   * Set to false to use LOD instances from another renderer without driving updates.
   * Only has effect if enableLod is true.
   * @default true (if enableLod is true)
   */
  enableDriveLod?: boolean;
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
  /**
   * Scale factor for render size. 2.0 means 2x the render size.
   * @default 1.0
   */
  lodRenderScale?: number;
  /* Global LoD scale to apply @default 1.0
   */
  globalLodScale?: number;
  /**
   * Whether to use extended Gsplat encoding for paged splats.
   * @default false
   */
  pagedExtSplats?: boolean;
  /**
   * Allocation size of paged splats
   * @default 16777216
   */
  maxPagedSplats?: number;
  /**
   * Number of parallel chunk fetchers for LoD.
   * @default 3
   */
  numLodFetchers?: number;
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

export class SparkRenderer extends THREE.Mesh {
  renderer: THREE.WebGLRenderer;
  premultipliedAlpha: boolean;
  material: THREE.ShaderMaterial;
  uniforms: ReturnType<typeof SparkRenderer.makeUniforms>;

  autoUpdate: boolean;
  preUpdate: boolean;
  static sparkOverride?: SparkRenderer;

  renderSize = new THREE.Vector2();
  maxStdDev: number;
  minPixelRadius: number;
  maxPixelRadius: number;
  accumExtSplats: boolean;
  covSplats: boolean;
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
  minSortIntervalMs: number;

  clock: THREE.Clock;
  time?: number;
  lastFrame = -1;
  updateTimeoutId = -1;

  orderingTexture: THREE.DataTexture | null = null;
  maxSplats = 0;
  activeSplats = 0;

  display: SplatAccumulator;
  current: SplatAccumulator;
  accumulators: SplatAccumulator[] = [];

  sorting = false;
  sortDirty = false;
  lastSortTime = 0;
  sortWorker: SplatWorker | null = null;
  sortTimeoutId = -1;
  sortedCenter = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
  sortedDir = new THREE.Vector3().setScalar(0);
  readback32 = new Uint32Array(0);

  enableLod: boolean;
  enableDriveLod: boolean;
  lodSplatCount?: number;
  lodSplatScale: number;
  lodRenderScale: number;
  globalLodScale: number;
  pagedExtSplats: boolean;
  maxPagedSplats: number;
  numLodFetchers: number;
  outsideFoveate: number;
  behindFoveate: number;
  coneFov0: number;
  coneFov: number;
  coneFoveate: number;

  lodWorker: SplatWorker | null = null;
  lodMeshes: { mesh: SplatMesh; version: number }[] = [];
  lodDirty = false;
  lodIds: Map<
    PackedSplats | ExtSplats | PagedSplats,
    { lodId: number; lastTouched: number; rootPage?: number }
  > = new Map();
  lodIdToSplats: Map<number, PackedSplats | ExtSplats | PagedSplats> =
    new Map();
  lodInitQueue: (PackedSplats | ExtSplats | PagedSplats)[] = [];
  lastLod?: {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    fovXdegrees: number;
    fovYdegrees: number;
    pixelScaleLimit: number;
    maxSplats: number;
    timestamp: number;
  };
  lodInstances: Map<
    SplatMesh,
    {
      lodId: number;
      numSplats: number;
      indices: Uint32Array;
      texture: THREE.DataTexture;
    }
  > = new Map();
  lodUpdates: {
    lodId: number;
    pageBase: number;
    chunkBase: number;
    count: number;
    lodTreeData?: Uint32Array;
  }[] = [];
  lastTraverseTime = 0;
  lastPixelLimit?: number;

  pager?: SplatPager;
  pagerId = 0;
  // prefetchCameras: THREE.Camera[] = [];
  // prefetchLodScale = 1.0;
  // prefetchMeshesCache: SplatMesh[] = [];
  // prefetchMeshesCacheScene?: THREE.Scene;

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

  constructor(options: SparkRendererOptions) {
    const uniforms = SparkRenderer.makeUniforms();
    Object.assign(uniforms, options.extraUniforms ?? {});

    const shaders = getShaders();
    const premultipliedAlpha = options.premultipliedAlpha ?? true;
    const geometry = new SplatGeometry();
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
      allowOverride: false,
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
    this.accumExtSplats = options.accumExtSplats ?? false;
    this.covSplats = options.covSplats ?? false;
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

    this.enableLod = options.enableLod ?? true;
    // enableDriveLod defaults to true if enableLod is true, false otherwise
    this.enableDriveLod = options.enableDriveLod ?? this.enableLod;
    this.lodSplatCount = options.lodSplatCount;
    this.lodSplatScale = options.lodSplatScale ?? 1.0;
    this.lodRenderScale = options.lodRenderScale ?? 1.0;
    this.globalLodScale = options.globalLodScale ?? 1.0;
    this.pagedExtSplats = options.pagedExtSplats ?? false;
    const defaultPages = isMobile() ? (isIos() ? 96 : 128) : 256;
    this.maxPagedSplats = options.maxPagedSplats ?? defaultPages * 65536;
    this.numLodFetchers = options.numLodFetchers ?? 3;
    this.outsideFoveate = options.outsideFoveate ?? 1.0;
    this.behindFoveate = options.behindFoveate ?? 1.0;
    this.coneFov0 = options.coneFov0 ?? 0.0;
    this.coneFov = options.coneFov ?? 0.0;
    this.coneFoveate = options.coneFoveate ?? 1.0;

    this.clock = options.clock ? cloneClock(options.clock) : new THREE.Clock();

    const accumulatorOptions = {
      extSplats: this.accumExtSplats,
      covSplats: this.covSplats,
    };
    this.display = new SplatAccumulator(accumulatorOptions);
    this.current = this.display;
    this.accumulators.push(new SplatAccumulator(accumulatorOptions));
    this.accumulators.push(new SplatAccumulator(accumulatorOptions));

    if (options.target) {
      const { width, height, doubleBuffer } = options.target;
      const superXY = Math.max(1, Math.min(4, options.target.superXY ?? 1));
      if (width * superXY > 8192 || height * superXY > 8192) {
        throw new Error("Target size too large");
      }
      this.superXY = superXY;

      const superWidth = width * superXY;
      const superHeight = height * superXY;
      const targetOptions: THREE.RenderTargetOptions = {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
      };

      this.target = new THREE.WebGLRenderTarget(
        superWidth,
        superHeight,
        targetOptions,
      );
      if (doubleBuffer) {
        this.backTarget = new THREE.WebGLRenderTarget(
          superWidth,
          superHeight,
          targetOptions,
        );
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
      renderToViewBasis: { value: new THREE.Matrix3() },
      renderToViewOffset: { value: new THREE.Vector3() },
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
      ordering: { type: "t", value: SparkRenderer.emptyOrdering },
      enableExtSplats: { value: false },
      enableCovSplats: { value: false },
      // Gsplat collection to render
      extSplats: { type: "t", value: SplatAccumulator.emptyTexture },
      extSplats2: { type: "t", value: SplatAccumulator.emptyTexture },
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

    const accumulators = new Set<SplatAccumulator>();
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
    const spark = SparkRenderer.sparkOverride ?? this;

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

    const geometry = this.geometry as SplatGeometry;
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
    this.uniforms.renderToViewBasis.value.setFromMatrix4(accumToCamera);

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
      spark.orderingTexture ?? SparkRenderer.emptyOrdering;
    this.uniforms.enableExtSplats.value = this.display.extSplats;
    this.uniforms.enableCovSplats.value = this.display.covSplats;
    if (this.display.extSplats) {
      const extSplats = spark.display.getTextures();
      this.uniforms.extSplats.value = extSplats[0];
      this.uniforms.extSplats2.value = extSplats[1];
    } else {
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

  // /**
  //  * Provide additional cameras to prefetch paged splat chunks without
  //  * affecting main LOD selection.
  //  */
  // setPrefetchCameras(cameras?: THREE.Camera[], lodScaleMultiplier = 1.0) {
  //   const next = cameras?.filter(Boolean) ?? [];
  //   const sameCameras =
  //     this.prefetchCameras.length === next.length &&
  //     this.prefetchCameras.every((camera, index) => camera === next[index]);
  //   if (sameCameras && this.prefetchLodScale === lodScaleMultiplier) {
  //     return;
  //   }
  //   this.prefetchCameras = next;
  //   this.prefetchLodScale = lodScaleMultiplier;
  //   this.invalidatePrefetchCache();
  // }

  // /**
  //  * Invalidate the prefetch meshes cache. Call this when SplatMeshes are
  //  * added or removed from the scene.
  //  */
  // invalidatePrefetchCache() {
  //   this.prefetchMeshesCacheScene = undefined;
  // }

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
    if (next === this.current) {
      // Should never happen
      throw new Error(
        "Next accumulator is the same as the current accumulator",
      );
    }
    const { version, mappingVersion, visibleGenerators, generate, readback } =
      next.prepareGenerate({
        renderer,
        scene,
        time,
        camera,
        sortRadial: this.sortRadial ?? true,
        renderSize: this.renderSize,
        previous: this.current,
        lodInstances: this.enableLod ? this.lodInstances : undefined,
      });

    let doUpdate = true;
    const needsUpdate = viewChanged || version !== this.current.version;
    const mappingUpdated = mappingVersion !== this.current.mappingVersion;

    if (autoUpdate && !needsUpdate) {
      // Triggered by auto-update but no change
      doUpdate = false;
    }

    if (needsUpdate && this.sorting) {
      // We need to be able to sort the splats because the mapping has changed.
      // Try again next time around.
      doUpdate = false;
    }

    if (!doUpdate) {
      // Restore unused accumulator to the free list
      this.accumulators.push(next);
    } else {
      generate();

      if (this.flushAfterGenerate) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        gl.flush();
      }

      if (this.display.mappingVersion === next.mappingVersion) {
        // Same splat mapping so let's display it immediately and
        // reuse the sort order
        this.accumulators.push(this.display);
        this.display = next;
      } else {
        if (this.display !== this.current) {
          // The previous current is not being displayed, so replace it
          this.accumulators.push(this.current);
        }
      }

      this.current = next;
      this.sortDirty = true;
    }

    if (this.enableDriveLod) {
      this.driveLod({ visibleGenerators, camera, scene });
    }
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
      this.sortWorker = new SplatWorker();
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

    if (this.current.mappingVersion === current.mappingVersion) {
      if (this.current.mappingVersion !== this.display.mappingVersion) {
        this.accumulators.push(this.display);
        this.display = this.current;
      }
    }
    this.sorting = false;

    this.driveSort();
  }

  private ensureLodWorker() {
    if (!this.lodWorker) {
      this.lodWorker = new SplatWorker();
    }
    return this.lodWorker;
  }

  private driveLod({
    visibleGenerators,
    camera: inputCamera,
    scene,
  }: {
    visibleGenerators: SplatGenerator[];
    camera: THREE.Camera;
    scene: THREE.Scene;
  }) {
    inputCamera.updateMatrixWorld(true);
    // Make a copy of the camera so it can't change underneath us
    const camera = inputCamera.clone();

    const defaultSplatCount = isOculus()
      ? 500000
      : isVisionPro()
        ? 750000
        : isAndroid()
          ? 1000000
          : isIos()
            ? 1500000
            : 2500000;
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
    pixelScaleLimit *= this.lodRenderScale;

    const viewPos = new THREE.Vector3();
    const viewQuat = new THREE.Quaternion();
    this.current.viewToWorld.decompose(viewPos, viewQuat, new THREE.Vector3());

    if (this.lastLod) {
      if (
        viewPos.distanceTo(this.lastLod.pos) > 0.001 ||
        viewQuat.dot(this.lastLod.quat) < 0.999 ||
        this.lastLod.fovXdegrees !== fovXdegrees ||
        this.lastLod.fovYdegrees !== fovYdegrees ||
        this.lastLod.pixelScaleLimit !== pixelScaleLimit ||
        this.lastLod.maxSplats !== maxSplats
      ) {
        this.lodDirty = true;
      }
    }

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

    if (this.lodMeshes.length !== lodMeshes.length) {
      this.lodDirty = true;
    } else {
      if (
        lodMeshes.some(
          (m, i) =>
            m !== this.lodMeshes[i].mesh ||
            m.version > this.lodMeshes[i].version,
        )
      ) {
        this.lodDirty = true;
      }
    }

    this.lodMeshes = lodMeshes.map((mesh) => ({
      mesh,
      version: mesh.version + 1,
    }));

    // if (!this.lodDirty && lodMeshes.length === 0 && this.lodIds.size === 0) {
    //   return;
    // }

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
        this.pager = new SplatPager({
          renderer: this.renderer,
          extSplats: this.pagedExtSplats,
          maxSplats: this.maxPagedSplats,
          numFetchers: this.numLodFetchers,
        });

        const { lodId } = (await worker.call("newLodTree", {
          capacity: this.pager.maxSplats,
        })) as { lodId: number };
        this.pagerId = lodId;
      }

      // Assign pager to any new meshes that don't have one yet
      // (must run every frame, not just when pager is first created)
      if (this.pager) {
        for (const { mesh } of this.lodMeshes) {
          if (mesh.paged && !mesh.paged.pager) {
            mesh.paged.pager = this.pager;
          }
        }
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
        const updates = this.pager.consumeLodTreeUpdates();

        for (const { splats, page, chunk, numSplats, lodTree } of updates) {
          const record = this.lodIds.get(splats);
          if (record) {
            if (lodTree && chunk === 0) {
              record.rootPage = page;
            }
            this.lodUpdates.push({
              lodId: record.lodId,
              pageBase: page * this.pager.pageSplats,
              chunkBase: chunk * this.pager.pageSplats,
              count: numSplats,
              lodTreeData: lodTree,
            });
          }
        }
      }

      if (this.lodUpdates.length > 0) {
        const lodUpdates = this.lodUpdates;
        this.lodUpdates = [];
        await worker.call("updateLodTrees", { ranges: lodUpdates });
        this.lodDirty = true;
      }

      if (this.lodDirty) {
        const deltaPred = new THREE.Vector3();
        if (this.lastLod) {
          const now = performance.now();
          const deltaTime = now - this.lastLod.timestamp;
          deltaPred
            .copy(viewPos)
            .sub(this.lastLod.pos)
            .multiplyScalar(this.lastTraverseTime / deltaTime);
        }
        this.lastLod = {
          pos: viewPos,
          quat: viewQuat,
          fovXdegrees,
          fovYdegrees,
          pixelScaleLimit,
          maxSplats,
          timestamp: now,
        };
        this.lodDirty = false;

        await this.updateLodInstances(
          worker,
          camera,
          deltaPred,
          lodMeshes,
          scene,
          maxSplats,
          pixelScaleLimit,
          fovXdegrees,
          fovYdegrees,
        );
      }

      await this.cleanupLodTrees(worker);
    });
  }

  private async initLodTree(
    worker: SplatWorker,
    splats: PackedSplats | ExtSplats | PagedSplats,
  ) {
    if (splats instanceof PackedSplats || splats instanceof ExtSplats) {
      const { lodId } = (await worker.call("initLodTree", {
        numSplats: splats.numSplats ?? 0,
        lodTree: (splats.extra.lodTree as Uint32Array).slice(),
      })) as { lodId: number };
      this.lodIds.set(splats, { lodId, lastTouched: performance.now() });
      this.lodIdToSplats.set(lodId, splats);
      // console.log("*** initLodTree", lodId, splats.extra.lodTree, splats);
    } else {
      const { lodId } = (await worker.call("newSharedLodTree", {
        lodId: this.pagerId,
      })) as { lodId: number };
      this.lodIds.set(splats, { lodId, lastTouched: performance.now() });
      this.lodIdToSplats.set(lodId, splats);
      // console.log("*** newSharedLodTree", lodId, this.pagerId, splats);
    }
  }

  private pageSizeWarning = false;

  private async updateLodInstances(
    worker: SplatWorker,
    camera: THREE.Camera,
    deltaPred: THREE.Vector3,
    lodMeshes: SplatMesh[],
    scene: THREE.Scene,
    maxSplats: number,
    pixelScaleLimit: number,
    fovXdegrees: number,
    fovYdegrees: number,
  ) {
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

    const traverseStart = performance.now();
    const { keyIndices, chunks, pixelLimit } = (await worker.call(
      "traverseLodTrees",
      {
        maxSplats,
        pixelScaleLimit,
        lastPixelLimit: this.lastPixelLimit,
        fovXdegrees,
        fovYdegrees,
        instances,
      },
    )) as {
      keyIndices: Record<
        string,
        { lodId: number; numSplats: number; indices: Uint32Array }
      >;
      chunks: [number, number][];
      pixelLimit?: number;
    };
    this.lastTraverseTime = performance.now() - traverseStart;
    this.lastPixelLimit = pixelLimit;
    const totalLodSplats = Object.values(keyIndices).reduce(
      (sum, { numSplats }) => sum + numSplats,
      0,
    );
    // console.log(
    //   `traverseLodTrees in ${this.lastTraverseTime} ms, pixelLimit=${pixelLimit}, totalLodSplats=${totalLodSplats}`,
    // );

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

      if (!this.pageSizeWarning && pagedMeshes.length > this.pager.maxPages) {
        this.pageSizeWarning = true;
        console.warn(
          `# paged SplatMeshes exceeds maxPages: ${pagedMeshes.length} > ${this.pager.maxPages}`,
        );
      }

      // Fetch root chunk of each paged splats in priority of distance to camera
      pagedMeshes.sort((a, b) => a.distance - b.distance);
      this.pager.fetchPriority = pagedMeshes.map(({ splats }) => ({
        splats,
        chunk: 0,
      }));

      for (const [lodId, chunk] of chunks) {
        const splats = this.lodIdToSplats.get(lodId);
        if (splats instanceof PagedSplats) {
          if (chunk !== 0) {
            this.pager.fetchPriority.push({ splats, chunk });
          }
        }
      }

      this.pager.driveFetchers();
    }
  }

  private async cleanupLodTrees(worker: SplatWorker) {
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
    current: SplatAccumulator;
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
      SparkRenderer.sparkOverride = this;
      this.renderer.render(scene, camera);
    } finally {
      SparkRenderer.sparkOverride = undefined;
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
      SparkRenderer.sparkOverride = this;
      this.renderer.render(scene, camera);
    } finally {
      SparkRenderer.sparkOverride = undefined;
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
      // console.log(`Allocated superPixels: ${width}x${height} = ${pixelCount} bytes`);
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
  }: {
    scene: THREE.Scene;
    camera: THREE.Camera;
  }): Promise<Uint8Array> {
    this.renderTarget({ scene, camera });
    return this.readTarget();
  }

  // Data and buffers used for environment map rendering
  private static cubeRender: {
    target: THREE.WebGLCubeRenderTarget;
    cubeCamera: THREE.CubeCamera;
    near: number;
    far: number;
  } | null = null;
  private static pmrem: THREE.PMREMGenerator | null = null;

  // Renders out the scene to a cube map that can be used for
  // Image-based lighting or similar applications. First optionally updates Gsplats,
  // sorts them with respect to the provided worldCenter, renders 6 cube faces.
  async renderCubeMap({
    scene,
    worldCenter,
    size = 256,
    near = 0.1,
    far = 1000,
    hideObjects = [],
    update = true,
    filter = false,
  }: {
    scene: THREE.Scene;
    worldCenter: THREE.Vector3;
    size?: number;
    near?: number;
    far?: number;
    hideObjects: THREE.Object3D[];
    update: boolean;
    filter: boolean;
  }): Promise<THREE.CubeTexture> {
    const renderer = this.renderer;
    if (
      !SparkRenderer.cubeRender ||
      SparkRenderer.cubeRender.target.width !== size ||
      SparkRenderer.cubeRender.near !== near ||
      SparkRenderer.cubeRender.far !== far
    ) {
      if (SparkRenderer.cubeRender) {
        SparkRenderer.cubeRender.target.dispose();
      }
      const target = new THREE.WebGLCubeRenderTarget(size, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        generateMipmaps: filter,
        minFilter: filter ? THREE.LinearMipMapLinearFilter : THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        colorSpace: filter ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace,
      });
      const cubeCamera = new THREE.CubeCamera(near, far, target);
      SparkRenderer.cubeRender = { target, cubeCamera, near, far };
    }

    const { target, cubeCamera } = SparkRenderer.cubeRender;
    cubeCamera.position.copy(worldCenter);

    // Save the visibility state of objects we want to hide before render
    const objectVisibility = new Map<THREE.Object3D, boolean>();
    for (const object of hideObjects) {
      objectVisibility.set(object, object.visible);
      object.visible = false;
    }

    if (update) {
      const tempCamera = new THREE.Camera();
      tempCamera.position.copy(worldCenter);
      await this.update({ scene, camera: tempCamera });
    }

    try {
      SparkRenderer.sparkOverride = this;
      // Update the CubeCamera, which performs 6 cube face renders
      cubeCamera.update(this.renderer, scene);
    } finally {
      SparkRenderer.sparkOverride = undefined;
    }

    // Restore viewpoint to default and object visibility
    for (const [object, visible] of objectVisibility.entries()) {
      object.visible = visible;
    }

    return target.texture;
  }

  async readCubeTargets(): Promise<Uint8Array[]> {
    if (!SparkRenderer.cubeRender) {
      throw new Error("No cube render");
    }

    const textures = SparkRenderer.cubeRender.target.texture;
    const promises = [];
    const buffers = [];

    for (let i = 0; i < textures.images.length; ++i) {
      const { width, height } = textures.images[i];
      const byteSize = width * height * 4;
      const readback = new Uint8Array(byteSize);
      buffers.push(readback);
      const promise = this.renderer.readRenderTargetPixelsAsync(
        SparkRenderer.cubeRender.target,
        0,
        0,
        width,
        height,
        readback,
        i,
      );
      promises.push(promise);
    }

    await Promise.all(promises);
    return buffers;
  }

  // Renders out the scene to an environment map that can be used for
  // Image-based lighting or similar applications. First optionally updates Gsplats,
  // sorts them with respect to the provided worldCenter, renders 6 cube faces,
  // then pre-filters them using THREE.PMREMGenerator and returns a THREE.Texture
  // that can assigned directly to a THREE.MeshStandardMaterial.envMap property.
  async renderEnvMap({
    scene,
    worldCenter,
    size = 256,
    near = 0.1,
    far = 1000,
    hideObjects = [],
    update = true,
  }: {
    scene: THREE.Scene;
    worldCenter: THREE.Vector3;
    size?: number;
    near?: number;
    far?: number;
    hideObjects: THREE.Object3D[];
    update: boolean;
  }): Promise<THREE.Texture> {
    const cubeTexture = await this.renderCubeMap({
      scene,
      worldCenter,
      size,
      near,
      far,
      hideObjects,
      update,
      filter: true,
    });
    // Pre-filter the cube map using THREE.PMREMGenerator if requested
    if (!SparkRenderer.pmrem) {
      SparkRenderer.pmrem = new THREE.PMREMGenerator(this.renderer);
    }

    return SparkRenderer.pmrem?.fromCubemap(cubeTexture).texture;
  }

  // Utility function to recursively set the envMap property for any
  // THREE.MeshStandardMaterial within the subtree of root.
  recurseSetEnvMap(root: THREE.Object3D, envMap: THREE.Texture) {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        if (Array.isArray(node.material)) {
          for (const material of node.material) {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.envMap = envMap;
            }
          }
        } else {
          if (node.material instanceof THREE.MeshStandardMaterial) {
            node.material.envMap = envMap;
          }
        }
      }
    });
  }

  async getLodTreeLevel(
    splats: SplatMesh,
    level: number,
    pageColoring = false,
  ) {
    const instance = this.lodInstances.get(splats);
    if (!instance) {
      return null;
    }

    const result = await this.ensureLodWorker().exclusive(async (worker) => {
      return (await worker.call("getLodTreeLevel", {
        lodId: instance.lodId,
        level,
      })) as { indices: Uint32Array };
    });

    if (splats.packedSplats?.lodSplats) {
      const newSplats = splats.packedSplats.lodSplats.extractSplats(
        result.indices,
        pageColoring,
      );
      return new SplatMesh({ packedSplats: newSplats });
    }
    if (splats.extSplats?.lodSplats) {
      const newSplats = splats.extSplats.lodSplats.extractSplats(
        result.indices,
        pageColoring,
      );
      return new SplatMesh({ extSplats: newSplats });
    }
    throw new Error(
      "Only LoD-enabled PackedSplats and ExtSplats are supported",
    );
  }
}
