import * as THREE from "three";
import {
  type PackedSplats,
  Readback,
  type SplatGenerator,
  SplatMesh,
  dyno,
} from ".";
import { NewSplatAccumulator } from "./NewSplatAccumulator";
import { NewSplatGeometry } from "./NewSplatGeometry";
import { NewSplatWorker } from "./NewSplatWorker";
import { SPLAT_TEX_HEIGHT, SPLAT_TEX_WIDTH } from "./defines";
import { getShaders } from "./shaders";
import { cloneClock, isAndroid, isIos } from "./utils";

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
   * Minimum interval between sort calls in milliseconds.
   * @default 10
   */
  minSortIntervalMs?: number;
  /**
   * Minimum interval between LOD calls in milliseconds.
   * @default 10
   */
  minLodIntervalMs?: number;
  /**
   * Set the target # splats for LoD. Recommended # splats is 500K forf mobile and 1.5M for desktop,
   * which is set automatically if this isn't set.
   */
  lodSplatCount?: number;
  /**
   * Scale factor for target # splats for LoD. 2.0 means 2x the recommended # splats.
   * Recommended # splats is 500K forf mobile and 1.5M for desktop.
   * @default 1.0
   */
  lodSplatScale?: number;
  /* LoD scale to apply @default 1.0
   */
  lodScale?: number;
  /* Foveation scale to apply outside the view frustum (but not behind viewer)
   * @default 0.6
   */
  outsideFoveate?: number;
  /* Foveation scale to apply behind viewer
   * @default 0.3
   */
  behindFoveate?: number;
}

export class NewSparkRenderer extends THREE.Mesh {
  renderer: THREE.WebGLRenderer;
  premultipliedAlpha: boolean;
  material: THREE.ShaderMaterial;
  uniforms: ReturnType<typeof NewSparkRenderer.makeUniforms>;

  autoUpdate: boolean;
  preUpdate: boolean;

  renderSize = new THREE.Vector2();
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

  sortRadial: boolean;
  depthBias?: number;
  // sort32: boolean;

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
  sortedVersion = -1;
  sortedMappingVersion = -1;
  sortedCenter = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
  sortedDir = new THREE.Vector3().setScalar(0);
  sortedTime = 0;
  readback32 = new Uint32Array(0);

  minSortIntervalMs: number;
  minLodIntervalMs: number;
  lodSplatCount?: number;
  lodSplatScale: number;
  lodScale: number;
  outsideFoveate: number;
  behindFoveate: number;

  lodWorker: NewSplatWorker | null = null;
  lodMeshes: SplatMesh[] = [];
  lodDirty = false;
  lodIds: Map<PackedSplats, { lodId: number; lastTouched: number }> = new Map();
  lodInitQueue: PackedSplats[] = [];
  lodPos = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
  lodQuat = new THREE.Quaternion().set(0, 0, 0, 0);
  lodInstances: Map<
    SplatMesh,
    { numSplats: number; indices: Uint32Array; texture: THREE.DataTexture }
  > = new Map();
  lodUpdate: {
    uuidToMesh: Map<string, SplatMesh>;
    keyIndices: Record<string, { numSplats: number; indices: Uint32Array }>;
  } | null = null;

  flushAfterGenerate = false;
  flushAfterRead = false;
  readPause = 1;
  sortPause = 0;
  sortDelay = 0;

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
    this.preUpdate = options.preUpdate ?? true;

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

    this.sortRadial = options.sortRadial ?? true;
    this.depthBias = options.depthBias;
    // this.sort32 = options.sort32 ?? true;
    this.minSortIntervalMs = options.minSortIntervalMs ?? 10;
    this.minLodIntervalMs = options.minLodIntervalMs ?? 10;
    this.lodSplatCount = options.lodSplatCount;
    this.lodSplatScale = options.lodSplatScale ?? 1.0;
    this.lodScale = options.lodScale ?? 1.0;
    this.outsideFoveate = options.outsideFoveate ?? 0.6;
    this.behindFoveate = options.behindFoveate ?? 0.3;

    this.clock = options.clock ? cloneClock(options.clock) : new THREE.Clock();

    this.display = new NewSplatAccumulator();
    this.current = this.display;
    this.accumulators.push(new NewSplatAccumulator());
    this.accumulators.push(new NewSplatAccumulator());
  }

  static makeUniforms() {
    const uniforms = {
      // number of active splats to render
      numSplats: { value: 0 },
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

    const renderSize = renderer.getDrawingBufferSize(this.renderSize);
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
    this.uniforms.renderSize.value.copy(renderSize);

    const typedCamera = camera as
      | THREE.PerspectiveCamera
      | THREE.OrthographicCamera;

    this.uniforms.near.value = typedCamera.near;
    this.uniforms.far.value = typedCamera.far;

    const geometry = this.geometry as NewSplatGeometry;
    geometry.instanceCount = this.activeSplats;
    this.uniforms.numSplats.value = this.activeSplats;

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
      this.updateInternal({ renderer, scene, camera, autoUpdate: true });
    }
  }

  update({
    renderer,
    scene,
    camera,
  }: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
  }) {
    this.updateInternal({ renderer, scene, camera, autoUpdate: false });
  }

  private updateInternal({
    renderer,
    scene,
    camera,
    autoUpdate,
  }: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
    autoUpdate: boolean;
  }) {
    const time = this.time ?? this.clock.getElapsedTime();

    const center = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());

    const currentToWorld = this.current.viewToWorld.clone().invert();
    const currentCenter = new THREE.Vector3().applyMatrix4(currentToWorld);
    const currentDir = new THREE.Vector3(0, 0, -1)
      .applyMatrix4(currentToWorld)
      .sub(currentCenter)
      .normalize();

    const viewChanged =
      center.distanceTo(currentCenter) > 0.001 || dir.dot(currentDir) < 0.999;

    if (this.lodUpdate) {
      const { uuidToMesh, keyIndices } = this.lodUpdate;
      this.lodUpdate = null;
      this.updateLodIndices(uuidToMesh, keyIndices);
    }

    const next = this.accumulators.pop();
    if (!next) {
      // Should never happen
      throw new Error("No next accumulator");
    }
    const { version, mappingVersion, visibleGenerators, generate } =
      next.prepareGenerate({
        renderer,
        scene,
        time,
        camera,
        sortRadial: this.sortRadial ?? true,
        renderSize: this.renderSize,
        previous: this.current,
        lodInstances: this.lodInstances,
      });

    this.driveLod({ visibleGenerators, camera });

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
      this.accumulators.push(this.current);
    }

    if (this.display !== this.current) {
      this.accumulators.push(this.current);
    }
    this.current = next;
    this.sortDirty = true;

    this.driveSort();
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
      this.sortTimeoutId = setTimeout(
        () => this.driveSort(),
        nextSortTime - now,
      );
      return;
    }

    this.sorting = true;
    this.sortDirty = false;
    this.lastSortTime = now;
    const current = this.current;

    const currentToWorld = current.viewToWorld.clone().invert();
    this.sortedCenter.set(0, 0, 0).applyMatrix4(currentToWorld);
    this.sortedDir
      .set(0, 0, -1)
      .applyMatrix4(currentToWorld)
      .sub(this.sortedCenter)
      .normalize();

    if (this.readPause > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.readPause));
    }

    const { numSplats, maxSplats } = current;
    const rows = Math.max(1, Math.ceil(maxSplats / 16384));
    const orderingMaxSplats = rows * 16384;
    this.maxSplats = Math.max(this.maxSplats, orderingMaxSplats);

    const ordering = new Uint32Array(this.maxSplats);
    const readback = Readback.ensureBuffer(maxSplats, this.readback32);
    this.readback32 = readback;

    await this.readbackDepth({
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
      console.log(`Allocating orderingTexture: ${4096}x${rows}`);
      const orderingTexture = new THREE.DataTexture(
        result.ordering,
        4096,
        rows,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType,
      );
      orderingTexture.internalFormat = "RGBA32UI";
      this.orderingTexture = orderingTexture;
    } else {
      const data = new Uint32Array(this.orderingTexture.image.data.buffer);
      data.set(result.ordering);
      // console.log("Setting ordering", result.ordering.slice(0, 10));

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
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          4096,
          rows,
          gl.RGBA_INTEGER,
          gl.UNSIGNED_INT,
          data,
        );
        renderer.state.bindTexture(gl.TEXTURE_2D, null);
      }
    }
    this.orderingTexture.needsUpdate = true;

    // console.log(`Sorted ${numSplats} splats in ${performance.now() - now} ms`);

    if (this.display !== current) {
      this.accumulators.push(this.display);
      this.display = current;
    }
    this.sorting = false;

    this.driveSort();
  }

  private async driveLod({
    visibleGenerators,
    camera: inputCamera,
  }: { visibleGenerators: SplatGenerator[]; camera: THREE.Camera }) {
    const lodMeshes = visibleGenerators.filter((generator) => {
      return (
        generator instanceof SplatMesh &&
        generator.packedSplats.lodSplats &&
        generator.enableLod !== false
      );
    }) as SplatMesh[];

    let forceUpdate = this.lodMeshes.length !== lodMeshes.length;
    if (
      !forceUpdate &&
      this.lodMeshes.some((mesh, i) => mesh !== lodMeshes[i])
    ) {
      forceUpdate = true;
    }
    this.lodMeshes = lodMeshes;

    if (forceUpdate) {
      this.lodDirty = true;
    }

    if (!this.lodDirty && lodMeshes.length === 0 && this.lodIds.size === 0) {
      return;
    }

    const camera = inputCamera.clone();

    const lodSplats = lodMeshes.reduce((splats, mesh) => {
      splats.add(mesh.packedSplats.lodSplats as PackedSplats);
      return splats;
    }, new Set<PackedSplats>());

    this.lodInitQueue = [];
    const now = performance.now();

    for (const splat of lodSplats) {
      const record = this.lodIds.get(splat);
      if (record) {
        record.lastTouched = now;
      } else {
        this.lodInitQueue.push(splat);
      }
    }

    if (!this.lodWorker) {
      this.lodWorker = new NewSplatWorker();
    }
    this.lodWorker.tryExclusive(async (worker) => {
      if (this.lodInitQueue.length > 0) {
        const splats = this.lodInitQueue.shift() as PackedSplats;
        await this.initLodTree(worker, splats);
        return;
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
        return;
      }

      await this.cleanupLodTrees(worker);
    });
  }

  private async initLodTree(worker: NewSplatWorker, splats: PackedSplats) {
    console.log("initLodTree", splats.extra.lodTree, splats);
    const { lodId } = (await worker.call("initLodTree", {
      numSplats: splats.numSplats ?? 0,
      lodTree: (splats.extra.lodTree as Uint32Array).slice(),
    })) as { lodId: number };
    console.log("=> initLodTree: lodId =", lodId);
    this.lodIds.set(splats, { lodId, lastTouched: performance.now() });
  }

  private async updateLodInstances(
    worker: NewSplatWorker,
    camera: THREE.Camera,
    lodMeshes: SplatMesh[],
  ) {
    const splatCount =
      this.lodSplatCount ?? (isAndroid() ? 500000 : isIos() ? 500000 : 1500000);
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
        const record = this.lodIds.get(
          mesh.packedSplats.lodSplats as PackedSplats,
        );
        if (record) {
          const viewToObject = mesh.matrixWorld
            .clone()
            .invert()
            .multiply(camera.matrixWorld);
          uuidToMesh.set(mesh.uuid, mesh);
          instances[mesh.uuid] = {
            lodId: record.lodId,
            viewToObjectCols: viewToObject.elements,
            lodScale: mesh.lodScale * this.lodScale,
            outsideFoveate: mesh.outsideFoveate ?? this.outsideFoveate,
            behindFoveate: mesh.behindFoveate ?? this.behindFoveate,
          };
        }
        return instances;
      },
      {} as Record<
        string,
        {
          lodId: number;
          viewToObjectCols: number[];
          lodScale: number;
          outsideFoveate: number;
          behindFoveate: number;
        }
      >,
    );
    // console.log("instances", instances);

    const traverseStart = performance.now();
    const { keyIndices } = (await worker.call("traverseLodTrees", {
      maxSplats,
      pixelScaleLimit,
      fovXdegrees,
      fovYdegrees,
      instances,
    })) as {
      keyIndices: Record<string, { numSplats: number; indices: Uint32Array }>;
    };
    const debugSplats = Object.keys(keyIndices).map(
      (uuid) => keyIndices[uuid].numSplats,
    );
    console.log(
      `traverseLodTrees in ${performance.now() - traverseStart} ms`,
      JSON.stringify(debugSplats),
    );

    this.lodUpdate = { uuidToMesh, keyIndices };
  }

  private async cleanupLodTrees(worker: NewSplatWorker) {
    const DISPOSE_TIMEOUT_MS = 3000;

    let oldest = null;
    for (const [splats, record] of this.lodIds.entries()) {
      if (
        oldest == null ||
        record.lastTouched < (this.lodIds.get(oldest)?.lastTouched ?? 0)
      ) {
        oldest = splats;
      }
    }

    if (oldest != null) {
      const now = performance.now();
      const { lastTouched, lodId } = this.lodIds.get(oldest) ?? {
        lastTouched: 0,
        lodId: 0,
      };
      if (lastTouched < now - DISPOSE_TIMEOUT_MS) {
        for (const [mesh, indices] of this.lodInstances.entries()) {
          if (mesh.packedSplats.lodSplats === oldest) {
            indices.texture.dispose();
            this.lodInstances.delete(mesh);
          }
        }
        await worker.call("disposeLodTree", { lodId });
      }
    }
  }

  private updateLodIndices(
    uuidToMesh: Map<string, SplatMesh>,
    keyIndices: Record<string, { numSplats: number; indices: Uint32Array }>,
  ) {
    // console.log("updateLodIndices", keyIndices);
    for (const [uuid, countIndices] of Object.entries(keyIndices)) {
      const { numSplats, indices } = countIndices;
      const mesh = uuidToMesh.get(uuid) as SplatMesh;
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
        instance = { numSplats, indices, texture };
        this.lodInstances.set(mesh, instance);
        console.log(
          "updateLodIndices: new texture",
          numSplats,
          indices.slice(0, 10),
        );
      } else {
        instance.numSplats = numSplats;
        // TODO: Do we need to do this since we are directly uploading from indices?
        instance.indices.set(indices);

        // instance.texture.needsUpdate = true;
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
        console.log(
          "updateLodIndices: texture",
          numSplats,
          indices.slice(0, 10),
        );
      }
      mesh.updateMappingVersion();
    }
  }

  private async readbackDepth({
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
      renderer.setRenderTarget(this.current.target, layer);

      const promise = renderer.readRenderTargetPixelsAsync(
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
}
