import * as THREE from "three";

import {
  DEFAULT_SPLAT_ENCODING,
  PackedSplats,
  type SplatEncoding,
} from "./PackedSplats";
import { RgbaArray } from "./RgbaArray";
import { SparkViewpoint, type SparkViewpointOptions } from "./SparkViewpoint";
import { type GeneratorMapping, SplatAccumulator } from "./SplatAccumulator";
import { SplatEdit } from "./SplatEdit";
import { SplatGenerator, SplatModifier } from "./SplatGenerator";
import { SplatGeometry } from "./SplatGeometry";
import { SplatMesh } from "./SplatMesh";
import { LN_SCALE_MAX, LN_SCALE_MIN } from "./defines";
import {
  DynoVec3,
  DynoVec4,
  Gsplat,
  TPackedSplats,
  dynoBlock,
  readPackedSplat,
  transformGsplat,
} from "./dyno";
import { getShaders } from "./shaders";
import {
  averagePositions,
  averageQuaternions,
  cloneClock,
  withinCoorientDist,
} from "./utils";

// SparkRenderer aggregates splats from multiple generators into a single
// accumulated collection per frame. In normal operation we only need a
// maximum of 3 accumulators: One currently being viewed, one currently
// being sorted, and one more for generating the next frame. Accumulators
// must be "released" by each viewpoint using it, so in unusual cases
// such as slow render-outs, we may want to allow more than 3 so the
// pipeline can continue generating new frames, but we limit to a maximum
// of 5 to avoid excessive memory usage.
const MAX_ACCUMULATORS = 5;

export type SparkRendererOptions = {
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
   * Pass in a THREE.Clock to synchronize time-based effects across different
   * systems. Alternatively, you can set the SparkRenderer properties time and
   * deltaTime directly. (default: new THREE.Clock)
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
   * @default false
   */
  preUpdate?: boolean;
  /**
   * Distance threshold for SparkRenderer movement triggering a Gsplat update at
   * the new origin.
   * @default 1.0
   */
  originDistance?: number;
  /**
   * Maximum standard deviations from the center to render Gaussians. Values
   * Math.sqrt(5)..Math.sqrt(8) produce good results and can be tweaked for
   * performance.
   * @default Math.sqrt(8)
   */
  maxStdDev?: number;
  /**
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
   * Configures the SparkViewpointOptions for the default SparkViewpoint
   * associated with this SparkRenderer. Notable option: sortRadial (sort by
   * radial distance or Z-depth)
   */
  view?: SparkViewpointOptions;
  /**
   * Override the default splat encoding ranges for the PackedSplats.
   * (default: undefined)
   */
  splatEncoding?: SplatEncoding;
};

export class SparkRenderer extends THREE.Mesh {
  renderer: THREE.WebGLRenderer;
  premultipliedAlpha: boolean;
  material: THREE.ShaderMaterial;
  uniforms: ReturnType<typeof SparkRenderer.makeUniforms>;

  autoUpdate: boolean;
  preUpdate: boolean;
  needsUpdate: boolean;
  originDistance: number;
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
  splatEncoding: SplatEncoding;

  splatTexture: null | {
    enable?: boolean;
    texture?: THREE.Data3DTexture;
    multiply?: THREE.Matrix2;
    add?: THREE.Vector2;
    near?: number;
    far?: number;
    mid?: number;
  } = null;

  time?: number;
  deltaTime?: number;
  clock: THREE.Clock;

  // Latest Gsplat collection being displayed
  active: SplatAccumulator;
  // Free list of accumulators for reuse
  private freeAccumulators: SplatAccumulator[];
  // Total number of accumulators currently allocated
  private accumulatorCount: number;
  // Default SparkViewpoint used for rendering to the canvas
  defaultView: SparkViewpoint;
  // List of SparkViewpoints with autoUpdate enabled
  autoViewpoints: SparkViewpoint[] = [];

  // Dynos used to transform Gsplats to the accumulator coordinate system
  private rotateToAccumulator = new DynoVec4({ value: new THREE.Quaternion() });
  private translateToAccumulator = new DynoVec3({ value: new THREE.Vector3() });
  private modifier: SplatModifier;

  // Last rendered frame number so we know when we're rendering a new frame
  private lastFrame = -1;
  // Last update timestamp to compute deltaTime
  private lastUpdateTime: number | null = null;
  // List of cameras used for the current viewpoint (for WebXR)
  private defaultCameras: THREE.Matrix4[] = [];
  private lastStochastic: boolean | null = null;

  // Should be set to the defaultView, but can be temporarily changed to another
  // viewpoint using prepareViewpoint() for rendering from a different viewpoint.
  viewpoint: SparkViewpoint;

  // Holds data needed to perform a scheduled Gsplat update.
  private pendingUpdate = {
    scene: null as THREE.Scene | null,
    originToWorld: new THREE.Matrix4(),
    timeoutId: -1,
  };

  // Internal SparkViewpoint used for environment map rendering.
  private envViewpoint: SparkViewpoint | null = null;

  // Data and buffers used for environment map rendering
  private static cubeRender: {
    target: THREE.WebGLCubeRenderTarget;
    camera: THREE.CubeCamera;
    near: number;
    far: number;
  } | null = null;
  private static pmrem: THREE.PMREMGenerator | null = null;

  static EMPTY_SPLAT_TEXTURE = new THREE.Data3DTexture();

  constructor(options: SparkRendererOptions) {
    const uniforms = SparkRenderer.makeUniforms();
    const shaders = getShaders();
    const premultipliedAlpha = options.premultipliedAlpha ?? true;
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: shaders.splatVertex,
      fragmentShader: shaders.splatFragment,
      uniforms,
      premultipliedAlpha,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    super(EMPTY_GEOMETRY, material);
    // Disable frustum culling because we want to always draw them all
    // and cull Gsplats individually in the shader
    this.frustumCulled = false;

    this.renderer = options.renderer;
    this.material = material;
    this.uniforms = uniforms;

    // Create a Gsplat modifier that takes the output of any SplatGenerator
    // and transforms them into the accumulator's coordinate system
    const modifier = dynoBlock(
      { gsplat: Gsplat },
      { gsplat: Gsplat },
      ({ gsplat }) => {
        if (!gsplat) {
          throw new Error("gsplat not defined");
        }
        gsplat = transformGsplat(gsplat, {
          rotate: this.rotateToAccumulator,
          translate: this.translateToAccumulator,
        });
        return { gsplat };
      },
    );
    this.modifier = new SplatModifier(modifier);

    this.premultipliedAlpha = premultipliedAlpha;
    this.autoUpdate = options.autoUpdate ?? true;
    this.preUpdate = options.preUpdate ?? false;
    this.needsUpdate = false;
    this.originDistance = options.originDistance ?? 1;
    this.maxStdDev = options.maxStdDev ?? Math.sqrt(8.0);
    this.minPixelRadius = options.minPixelRadius ?? 0.0;
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
    this.splatEncoding = options.splatEncoding ?? { ...DEFAULT_SPLAT_ENCODING };

    this.active = new SplatAccumulator();
    this.active.refCount = 1;
    this.accumulatorCount = 1;
    this.freeAccumulators = [];
    // Start with the minimum of 2 total accumulators
    for (let count = 0; count < 1; ++count) {
      this.freeAccumulators.push(new SplatAccumulator());
      this.accumulatorCount += 1;
    }

    // Create a default SparkViewpoint that is used when we call render()
    // on the scene and has the sorted Gsplat collection from that viewpoint.
    this.defaultView = new SparkViewpoint({
      ...options.view,
      autoUpdate: true,
      spark: this,
    });
    this.viewpoint = this.defaultView;
    this.prepareViewpoint(this.viewpoint);

    this.clock = options.clock ? cloneClock(options.clock) : new THREE.Clock();
  }

  static makeUniforms() {
    // Create uniforms used for Gsplat vertex and fragment shaders
    const uniforms = {
      // Size of render viewport in pixels
      renderSize: { value: new THREE.Vector2() },
      // Near and far plane distances
      near: { value: 0.1 },
      far: { value: 1000.0 },
      // Total number of Gsplats in packedSplats to render
      numSplats: { value: 0 },
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
      // Enable stochastic splat rendering
      stochastic: { value: false },
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
      // Enable splat texture rendering
      splatTexEnable: { value: false },
      // Splat texture to render
      splatTexture: { type: "t", value: SparkRenderer.EMPTY_SPLAT_TEXTURE },
      // Splat texture UV transform (multiply)
      splatTexMul: { value: new THREE.Matrix2() },
      // Splat texture UV transform (add)
      splatTexAdd: { value: new THREE.Vector2() },
      // Splat texture near plane distance
      splatTexNear: { value: 0.1 },
      // Splat texture far plane distance
      splatTexFar: { value: 1000.0 },
      // Splat texture mid plane distance, or 0.0 to disable
      splatTexMid: { value: 0.0 },
      // Gsplat collection to render
      packedSplats: { type: "t", value: PackedSplats.getEmpty() },
      // Splat encoding ranges
      rgbMinMaxLnScaleMinMax: { value: new THREE.Vector4() },
      // Time in seconds for time-based effects
      time: { value: 0 },
      // Delta time in seconds since last frame
      deltaTime: { value: 0 },
      // Whether to encode Gsplat with linear RGB (for environment mapping)
      encodeLinear: { value: false },
      // Debug flag that alternates each frame
      debugFlag: { value: false },
    };
    return uniforms;
  }

  private canAllocAccumulator(): boolean {
    // Returns true if can allocate an accumulator immediately
    return (
      this.freeAccumulators.length > 0 ||
      this.accumulatorCount < MAX_ACCUMULATORS
    );
  }

  private maybeAllocAccumulator(): SplatAccumulator | null {
    // Allocate an accumulator immediately if possible, else return null
    let accumulator = this.freeAccumulators.pop();
    if (accumulator === undefined) {
      if (this.accumulatorCount >= MAX_ACCUMULATORS) {
        return null;
      }
      accumulator = new SplatAccumulator();
      this.accumulatorCount += 1;
    }
    accumulator.refCount = 1;
    return accumulator;
  }

  releaseAccumulator(accumulator: SplatAccumulator) {
    // Decrement reference count and recycle if no longer in use
    accumulator.refCount -= 1;
    if (accumulator.refCount === 0) {
      this.freeAccumulators.push(accumulator);
    }
  }

  newViewpoint(options: SparkViewpointOptions) {
    // Create a new SparkViewpoint for this SparkRenderer.
    // Note that every SparkRenderer has an initial spark.defaultView: SparkViewpoint
    // from construction, which is used for the default canvas render loop.
    // Calling this method allows you to create additional viewpoints, which can be
    // updated automatically each frame (performing Gsplat sorting every time there
    // is an update), or updated on-demand for controlled rendering for video render
    // or similar applications.
    return new SparkViewpoint({ ...options, spark: this });
  }

  onBeforeRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    // Called by Three.js before rendering this SparkRenderer.
    // At this point we can't modify the geometry or material, all these must
    // be set in the scene already before this is called. Update the uniforms
    // to render the Gsplats from the current active viewpoint.
    const time = this.time ?? this.clock.getElapsedTime();
    const deltaTime = time - (this.viewpoint.lastTime ?? time);
    this.viewpoint.lastTime = time;

    const frame = renderer.info.render.frame;
    const isNewFrame = frame !== this.lastFrame;
    this.lastFrame = frame;

    const viewpoint = this.viewpoint;
    if (viewpoint === this.defaultView) {
      // When rendering is triggered on the default viewpoint,
      // perform automatic updates.
      if (isNewFrame) {
        if (!renderer.xr.isPresenting) {
          // Non-WebXR mode, just a single camera
          this.defaultView.viewToWorld = camera.matrixWorld.clone();
          this.defaultCameras = [this.defaultView.viewToWorld];
        } else {
          // In WebXR mode we are called multiple times, once for each eye,
          // so use their average to compute the sort center.
          const cameras = renderer.xr.getCamera().cameras;
          this.defaultCameras = cameras.map((camera) => camera.matrixWorld);
          this.defaultView.viewToWorld =
            averageOriginToWorlds(this.defaultCameras) ?? new THREE.Matrix4();
        }
      }

      if (this.autoUpdate) {
        this.update({ scene, viewToWorld: this.defaultView.viewToWorld });
      }
    }

    // Update uniforms for rendering

    if (isNewFrame) {
      // Keep these uniforms the same for both eyes if in WebXR
      if (this.material.premultipliedAlpha !== this.premultipliedAlpha) {
        this.material.premultipliedAlpha = this.premultipliedAlpha;
        this.material.needsUpdate = true;
      }
      this.uniforms.time.value = time;
      this.uniforms.deltaTime.value = deltaTime;
      // Alternating debug flag that can aid in visual debugging
      this.uniforms.debugFlag.value = (performance.now() / 1000.0) % 2.0 < 1.0;

      if (viewpoint.display && viewpoint.stochastic) {
        (this.geometry as SplatGeometry).instanceCount =
          this.uniforms.numSplats.value;
      }
    }

    if (viewpoint.target) {
      // Rendering to a texture target, so its dimensions
      this.uniforms.renderSize.value.set(
        viewpoint.target.width,
        viewpoint.target.height,
      );
    } else {
      // Rendering to the canvas or WebXR
      const renderSize = renderer.getDrawingBufferSize(
        this.uniforms.renderSize.value,
      );
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

    // Update uniforms from instance properties
    const typedCamera = camera as
      | THREE.PerspectiveCamera
      | THREE.OrthographicCamera;
    this.uniforms.near.value = typedCamera.near;
    this.uniforms.far.value = typedCamera.far;
    this.uniforms.encodeLinear.value = viewpoint.encodeLinear;
    this.uniforms.maxStdDev.value = this.maxStdDev;
    this.uniforms.minPixelRadius.value = this.minPixelRadius;
    this.uniforms.maxPixelRadius.value = this.maxPixelRadius;
    this.uniforms.minAlpha.value = this.minAlpha;
    this.uniforms.stochastic.value = viewpoint.stochastic;
    this.uniforms.enable2DGS.value = this.enable2DGS;
    this.uniforms.preBlurAmount.value = this.preBlurAmount;
    this.uniforms.blurAmount.value = this.blurAmount;
    this.uniforms.focalDistance.value = this.focalDistance;
    this.uniforms.apertureAngle.value = this.apertureAngle;
    this.uniforms.falloff.value = this.falloff;
    this.uniforms.clipXY.value = this.clipXY;
    this.uniforms.focalAdjustment.value = this.focalAdjustment;

    if (this.lastStochastic !== !viewpoint.stochastic) {
      this.lastStochastic = !viewpoint.stochastic;
      this.material.transparent = !viewpoint.stochastic;
      this.material.depthWrite = viewpoint.stochastic;
      this.material.needsUpdate = true;
    }

    if (this.splatTexture) {
      const { enable, texture, multiply, add, near, far, mid } =
        this.splatTexture;
      if (enable && texture) {
        this.uniforms.splatTexEnable.value = true;
        this.uniforms.splatTexture.value = texture;
        if (multiply) {
          this.uniforms.splatTexMul.value.fromArray(multiply.elements);
        } else {
          this.uniforms.splatTexMul.value.set(
            0.5 / this.maxStdDev,
            0,
            0,
            0.5 / this.maxStdDev,
          );
        }
        this.uniforms.splatTexAdd.value.set(add?.x ?? 0.5, add?.y ?? 0.5);
        this.uniforms.splatTexNear.value = near ?? this.uniforms.near.value;
        this.uniforms.splatTexFar.value = far ?? this.uniforms.far.value;
        this.uniforms.splatTexMid.value = mid ?? 0.0;
      } else {
        this.uniforms.splatTexEnable.value = false;
        this.uniforms.splatTexture.value = SparkRenderer.EMPTY_SPLAT_TEXTURE;
      }
    } else {
      this.uniforms.splatTexEnable.value = false;
      this.uniforms.splatTexture.value = SparkRenderer.EMPTY_SPLAT_TEXTURE;
    }

    // Calculate the transform from the accumulator to the current camera
    const accumToWorld =
      viewpoint.display?.accumulator.toWorld ?? new THREE.Matrix4();
    const worldToCamera = camera.matrixWorld.clone().invert();
    const originToCamera = accumToWorld.clone().premultiply(worldToCamera);
    originToCamera.decompose(
      this.uniforms.renderToViewPos.value,
      this.uniforms.renderToViewQuat.value,
      new THREE.Vector3(),
    );
  }

  // Update the uniforms for the given viewpoint.
  // Note that the client expects to be able to call render() at any point
  // to update the canvas, so we must switch the viewpoint back to
  // defaultView when we're finished.
  prepareViewpoint(viewpoint?: SparkViewpoint) {
    this.viewpoint = viewpoint ?? this.viewpoint;

    if (this.viewpoint.display) {
      const { accumulator, geometry } = this.viewpoint.display;
      this.uniforms.numSplats.value = accumulator.splats.numSplats;
      this.uniforms.packedSplats.value = accumulator.splats.getTexture();
      this.uniforms.rgbMinMaxLnScaleMinMax.value.set(
        accumulator.splats.splatEncoding?.rgbMin ?? 0.0,
        accumulator.splats.splatEncoding?.rgbMax ?? 1.0,
        accumulator.splats.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN,
        accumulator.splats.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX,
      );
      this.geometry = geometry;
      this.material.transparent = !this.viewpoint.stochastic;
      this.material.depthWrite = this.viewpoint.stochastic;
      this.material.needsUpdate = true;
    } else {
      // No Gsplats to display for this viewpoint yet
      this.uniforms.numSplats.value = 0;
      this.uniforms.packedSplats.value = PackedSplats.getEmpty();
      this.geometry = EMPTY_GEOMETRY;
    }
  }

  // If spark.autoUpdate is false then you must manually call
  // spark.update({ scene }) to have the scene Gsplats be re-generated.
  update({
    scene,
    viewToWorld,
  }: { scene: THREE.Scene; viewToWorld?: THREE.Matrix4 }) {
    // Compute the transform for the SparkRenderer to use as origin
    // for Gsplat generation and accumulation.
    const originToWorld = this.matrixWorld;

    // Either do the update now, or in the next "tick" depending on preUpdate
    if (this.preUpdate) {
      this.updateInternal({
        scene,
        originToWorld: originToWorld.clone(),
        viewToWorld,
      });
    } else {
      // Pass the update parameters to be performed on the next tick
      this.pendingUpdate.scene = scene;
      this.pendingUpdate.originToWorld.copy(originToWorld);

      // Schedule a timeout if there isn't one already
      if (this.pendingUpdate.timeoutId === -1) {
        this.pendingUpdate.timeoutId = setTimeout(() => {
          const { scene, originToWorld } = this.pendingUpdate;
          this.pendingUpdate.scene = null;
          this.pendingUpdate.timeoutId = -1;
          const updated = this.updateInternal({
            scene: scene as THREE.Scene,
            originToWorld,
            viewToWorld,
          });

          if (updated) {
            // Flush to encourage eager execution
            const gl = this.renderer.getContext() as WebGL2RenderingContext;
            gl.flush();
          }
        }, 1);
      }
    }
  }

  updateInternal({
    scene,
    originToWorld,
    viewToWorld,
  }: {
    scene: THREE.Scene;
    originToWorld?: THREE.Matrix4;
    viewToWorld?: THREE.Matrix4;
  }): boolean {
    if (!this.canAllocAccumulator()) {
      // We don't have any available accumulators because of sorting
      // back pressure, so don't update this time but try again next time.
      // Signal update not attempted.
      return false;
    }

    // Figure out the frame of the SparkRenderer and current view
    if (!originToWorld) {
      originToWorld = this.active.toWorld;
    }
    viewToWorld = viewToWorld ?? originToWorld.clone();

    const time = this.time ?? this.clock.getElapsedTime();
    const deltaTime = time - (this.lastUpdateTime ?? time);
    this.lastUpdateTime = time;

    // Create a lookup from last active SplatGenerator to Gsplat mapping record
    const activeMapping = this.active.mapping.reduce((map, record) => {
      map.set(record.node, record);
      return map;
    }, new Map<SplatGenerator, GeneratorMapping>());

    // Traverse visible scene to find all SplatGenerators and global SplatEdits
    const { generators, visibleGenerators, globalEdits } =
      this.compileScene(scene);

    // Let all SplatGenerators run their frameUpdate() method
    for (const object of generators) {
      object.frameUpdate?.({
        object,
        time,
        deltaTime,
        viewToWorld,
        globalEdits,
      });
    }

    const visibleGenHash = new Set(visibleGenerators.map((g) => g.uuid));

    // Make sure we have new version numbers for any objects with either
    // generator or numSplats that have changed since the last frame.
    for (const object of generators) {
      const current = activeMapping.get(object);
      const isVisible = object.generator && visibleGenHash.has(object.uuid);
      const numSplats = isVisible ? object.numSplats : 0;
      if (
        this.needsUpdate ||
        object.generator !== current?.generator ||
        numSplats !== current?.count
      ) {
        object.updateVersion();
      }
    }

    // Check if the origin is within the maximum allowed distance before
    // we trigger an update.
    const originUpdate = !withinCoorientDist({
      matrix1: originToWorld,
      matrix2: this.active.toWorld,
      maxDistance: this.originDistance,
    });

    // Check if we need any update at all
    const needsUpdate =
      this.needsUpdate ||
      originUpdate ||
      generators.length !== activeMapping.size ||
      generators.some((g) => g.version !== activeMapping.get(g)?.version);
    this.needsUpdate = false;

    let accumulator: SplatAccumulator | null = null;
    if (needsUpdate) {
      // Need to update, so allocate an accumulator
      accumulator = this.maybeAllocAccumulator();
      if (!accumulator) {
        // This should never happen since we checked canAllocAccumulator() above
        throw new Error("Unreachable");
      }

      // Compute whether our view frame has changed enough to warrant
      // doing a Gsplat sort. Check both distance epsilon and
      // minimum co-orientation (dot product of quaternions)
      const originChanged = !withinCoorientDist({
        matrix1: originToWorld,
        matrix2: accumulator.toWorld,
        maxDistance: 0.00001,
        minCoorient: 0.99999,
      });

      // Compute an ordering of the generators with the rough goal
      // of keeping unchanging generators near the front to minimize
      // the number of Gsplats that need to be regenerated.
      const sorted = visibleGenerators
        .map((g, gIndex): [number, number, SplatGenerator] => {
          const lastGen = activeMapping.get(g);
          // If no previous generator, sort by absolute version, which will
          // tend to push frequently updated generators toward the end
          return !lastGen
            ? [Number.POSITIVE_INFINITY, g.version, g]
            : // Sort by version deltas then by previous ordering in the mapping,
              // attempting to keep unchanging generators near the front
              // to improve our chances of avoiding a re-generation.
              [g.version - lastGen.version, lastGen.base, g];
        })
        .sort((a, b) => {
          // Sort by first then second element of the tuple
          if (a[0] !== b[0]) {
            return a[0] - b[0];
          }
          return a[1] - b[1];
        });
      const genOrder = sorted.map(([_version, _seq, g]) => g);

      // Compute sequential layout of generated splats
      const splatCounts = genOrder.map((g) => g.numSplats);
      const { maxSplats, mapping } =
        accumulator.splats.generateMapping(splatCounts);
      const newGenerators = genOrder.map((node, gIndex) => {
        const { base, count } = mapping[gIndex];
        return {
          node,
          generator: node.generator,
          version: node.version,
          base,
          count,
        };
      });

      // Compute worldToAccumulator origin transform (no scale)
      originToWorld
        .clone()
        .invert()
        .decompose(
          this.translateToAccumulator.value,
          this.rotateToAccumulator.value,
          new THREE.Vector3(),
        );

      // Generate the Gsplats according to the mapping that need updating
      accumulator.ensureGenerate(maxSplats);
      accumulator.splats.splatEncoding = { ...this.splatEncoding };
      const generated = accumulator.generateSplats({
        renderer: this.renderer,
        modifier: this.modifier,
        generators: newGenerators,
        forceUpdate: originChanged,
        originToWorld,
      });

      // Update splat version number
      accumulator.splatsVersion = this.active.splatsVersion + 1;
      // Increment the mapping version if the mapping isn't identical to before
      const hasCorrespondence = accumulator.hasCorrespondence(this.active);
      accumulator.mappingVersion =
        this.active.mappingVersion + (hasCorrespondence ? 0 : 1);

      // Release the old accumulator and make the new one active
      this.releaseAccumulator(this.active);
      this.active = accumulator;
      this.prepareViewpoint();
    }

    // Let the system breath before potentially triggering sorts
    setTimeout(() => {
      // Notify all auto-updating viewpoints that we updated the Gsplats
      for (const view of this.autoViewpoints) {
        view.autoPoll({ accumulator: accumulator ?? undefined });
      }
    }, 1);

    // Signal update was performed
    return true;
  }

  private compileScene(scene: THREE.Scene): {
    generators: SplatGenerator[];
    visibleGenerators: SplatGenerator[];
    globalEdits: SplatEdit[];
  } {
    // Take a snapshot of the SplatGenerators and SplatEdits in the scene
    // to be used to run an update.
    const generators: SplatGenerator[] = [];
    // Collect all SplatGenerators, even if not visible, because we want to
    // be able to call their update functions every frame.
    scene.traverse((node) => {
      if (node instanceof SplatGenerator) {
        generators.push(node);
      }
    });

    const visibleGenerators: SplatGenerator[] = [];
    scene.traverseVisible((node) => {
      if (node instanceof SplatGenerator) {
        visibleGenerators.push(node);
      }
    });

    const globalEdits = new Set<SplatEdit>();
    scene.traverseVisible((node) => {
      if (node instanceof SplatEdit) {
        let ancestor = node.parent;
        while (ancestor != null && !(ancestor instanceof SplatMesh)) {
          ancestor = ancestor.parent;
        }
        if (ancestor == null) {
          // Not part of a SplatMesh so it's a global edit
          globalEdits.add(node);
        }
      }
    });
    return {
      generators,
      visibleGenerators,
      globalEdits: Array.from(globalEdits),
    };
  }

  // Renders out the scene to an environment map that can be used for
  // Image-based lighting or similar applications. First optionally updates Gsplats,
  // sorts them with respect to the provided worldCenter, renders 6 cube faces,
  // then pre-filters them using THREE.PMREMGenerator and returns a THREE.Texture
  // that can assigned directly to a THREE.MeshStandardMaterial.envMap property.
  async renderEnvMap({
    renderer,
    scene,
    worldCenter,
    size = 256,
    near = 0.1,
    far = 1000,
    hideObjects = [],
    update = false,
  }: {
    renderer?: THREE.WebGLRenderer;
    scene: THREE.Scene;
    worldCenter: THREE.Vector3;
    size?: number;
    near?: number;
    far?: number;
    hideObjects?: THREE.Object3D[];
    update?: boolean;
  }): Promise<THREE.Texture> {
    if (!this.envViewpoint) {
      this.envViewpoint = this.newViewpoint({ sort360: true });
    }
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
        generateMipmaps: true,
        minFilter: THREE.LinearMipMapLinearFilter,
      });
      const camera = new THREE.CubeCamera(near, far, target);
      SparkRenderer.cubeRender = { target, camera, near, far };
    }

    if (!SparkRenderer.pmrem) {
      SparkRenderer.pmrem = new THREE.PMREMGenerator(renderer ?? this.renderer);
    }

    // Prepare the viewpoint, sorting Gsplats for this view origin.
    const viewToWorld = new THREE.Matrix4().setPosition(worldCenter);
    await this.envViewpoint?.prepare({ scene, viewToWorld, update });

    const { target, camera } = SparkRenderer.cubeRender;
    camera.position.copy(worldCenter);

    // Save the visibility state of objects we want to hide before render
    const objectVisibility = new Map<THREE.Object3D, boolean>();
    for (const object of hideObjects) {
      objectVisibility.set(object, object.visible);
      object.visible = false;
    }

    // Update the CubeCamera, which performs 6 cube face renders
    this.prepareViewpoint(this.envViewpoint);
    camera.update(renderer ?? this.renderer, scene);

    // Restore viewpoint to default and object visibility
    this.prepareViewpoint(this.defaultView);
    for (const [object, visible] of objectVisibility.entries()) {
      object.visible = visible;
    }

    // Pre-filter the cube map using THREE.PMREMGenerator
    return SparkRenderer.pmrem?.fromCubemap(target.texture).texture;
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

  // Utility function that helps extract the Gsplat RGBA values from a
  // SplatGenerator, including the result of any real-time RGBA SDF edits applied
  // to a SplatMesh. This effectively "bakes" any computed RGBA values, which can
  // now be used as a pipeline input via SplatMesh.splatRgba to inject these
  // baked values into the Gsplat data.
  getRgba({
    generator,
    rgba,
  }: { generator: SplatGenerator; rgba?: RgbaArray }): RgbaArray {
    const mapping = this.active.mapping.find(({ node }) => node === generator);
    if (!mapping) {
      throw new Error("Generator not found");
    }

    rgba = rgba ?? new RgbaArray();
    rgba.fromPackedSplats({
      packedSplats: this.active.splats,
      base: mapping.base,
      count: mapping.count,
      renderer: this.renderer,
    });
    return rgba;
  }

  // Utility function that builds on getRgba({ generator }) and additionally
  // reads back the RGBA values to the CPU in a Uint8Array with packed RGBA
  // in that byte order.
  async readRgba({
    generator,
    rgba,
  }: { generator: SplatGenerator; rgba?: RgbaArray }): Promise<Uint8Array> {
    rgba = this.getRgba({ generator, rgba });
    return rgba.read();
  }
}

const EMPTY_GEOMETRY = new SplatGeometry(new Uint32Array(1), 0);

const reorderSplats = dynoBlock(
  { packedSplats: TPackedSplats, index: "int" },
  { gsplat: Gsplat },
  ({ packedSplats, index }) => {
    if (!packedSplats || !index) {
      throw new Error("Invalid input");
    }
    const gsplat = readPackedSplat(packedSplats, index);
    return { gsplat };
  },
);

function averageOriginToWorlds(
  originToWorlds: THREE.Matrix4[],
): THREE.Matrix4 | null {
  if (originToWorlds.length === 0) {
    return null;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  const positions: THREE.Vector3[] = [];
  const quaternions: THREE.Quaternion[] = [];
  for (const matrix of originToWorlds) {
    matrix.decompose(position, quaternion, scale);
    positions.push(position);
    quaternions.push(quaternion);
  }

  return new THREE.Matrix4().compose(
    averagePositions(positions),
    averageQuaternions(quaternions),
    new THREE.Vector3(1, 1, 1),
  );
}
