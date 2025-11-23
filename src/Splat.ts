import * as THREE from "three";
import { SplatGeometry } from "./SplatGeometry";
import {
  ReadbackSplatSorter,
  type SplatOrdering,
  type SplatSorter,
} from "./SplatSorter";
import type { TransformRange } from "./defines";
import { simpleRaycastMethod } from "./raycast";
import { getShaders } from "./shaders";
import { withinCoorientDist } from "./utils";

/**
 * Global counter used to generate unique ordering IDs
 */
let globalOrderingId = 0;

/**
 * Interface providing the properties for the individual splats.
 * The data is considered to be read-only for the purpose of this interface.
 */
export interface SplatData {
  /**
   * The maximum number of splats this SplatData can hold.
   */
  readonly maxSplats: number;
  /**
   * The actual number of splats, must be less than maxSplats.
   */
  readonly numSplats: number;
  /**
   * The number of spherical harmonic degrees for each splat.
   */
  readonly numSh: number;

  /**
   * Adjusts a given ShaderMaterial so it can read from this SplatData.
   * This generally includes setting up the right uniforms and shader chunks.
   * @param material The material to setup.
   */
  setupMaterial: (material: THREE.ShaderMaterial) => void;

  /**
   * Method for iterating over the raw splat centers.
   * @param callback Callback to call with each center
   */
  iterateCenters: (
    callback: (index: number, x: number, y: number, z: number) => void,
  ) => void;

  /**
   * Dispose any resources
   */
  dispose(): void;
}

export type SplatCallback = (
  i: number,
  x: number,
  y: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  quatX: number,
  quatY: number,
  quatZ: number,
  quatW: number,
  opacity: number,
  r: number,
  g: number,
  b: number,
  sh?: ArrayLike<number>,
) => void;

/**
 * Extended SplatData interface that allows the splat properties
 * to be decoded and read back.
 */
export interface IterableSplatData extends SplatData {
  iterateSplats: (callback: SplatCallback) => void;
}

export type SortContext = {
  lastOriginToCamera: THREE.Matrix4;
  lastWorldTransform: THREE.Matrix4;
  sortJob: Promise<SplatOrdering> | null;
  ordering: Uint32Array;
  pendingOrdering: Uint32Array;
  activeSplats: number;
  orderingId: number;
  splatVersion: number;
};

export interface SplatOptions {
  sorter?: SplatSorter;
  premultipliedAlpha?: boolean;
}

/**
 * Object representing a collection of Gaussian Splats in a scene.
 */
export class Splat extends THREE.Mesh<SplatGeometry, THREE.ShaderMaterial> {
  /**
   * The underlying splat data.
   */
  readonly splatData: SplatData;

  /**
   * Collection of (shared) uniforms for the splat shader.
   * Additional uniforms might be provided by the SplatData for de-/encoding
   * and by user-provided shader hooks.
   */
  private readonly uniforms: ReturnType<typeof Splat.makeUniforms>;

  /**
   * Set of user-provided shader hooks to
   */
  private shaderHooks: ShaderHooks | null = null;

  /**
   * The sort implementation to use to sort the splats.
   * Only used when stochastic flag is false.
   */
  readonly sorter: SplatSorter;
  /**
   * Mapping from camera to sort context.
   * This allows multiple viewpoints from different cameras.
   */
  private readonly sortContext: WeakMap<THREE.Camera, SortContext> =
    new WeakMap();
  /**
   * Id of the current ordering used by the SplatGeometry.
   */
  private currentOrderingId = -1;

  /**
   * The current version of the splat. While splat data is intended to be
   * static, changes through shader hooks or transform ranges can require
   * sorting to performed again.
   */
  private splatVersion = 0;

  /**
   * The raycast method to use when raycasting against this splat object.
   * Initial tests against bounding sphere and box take place, regardless of
   * the chosen method.
   */
  raycastMethod:
    | ((
        splat: Splat,
        raycaster: THREE.Raycaster,
        intersects: THREE.Intersection[],
      ) => void)
    | null = simpleRaycastMethod;

  /**
   * Maximum standard deviations from the center to render Gaussians.
   * Values `Math.sqrt(5)..Math.sqrt(9)` produce good results and can be tweaked for performance.
   * @default Math.sqrt(8)
   */
  maxStdDev: number = Math.sqrt(8);
  /**
   * Minimum pixel radius for splat rendering.
   * @default 0.0
   */
  minPixelRadius = 0;
  /**
   * Maximum pixel radius for splat rendering.
   * @default 512.0
   */
  maxPixelRadius = 512;
  /**
   * Minimum alpha value for splat rendering.
   * @default 0.5 / 255.0
   */
  minAlpha: number = 0.5 / 255.0;
  preBlurAmount = 0.0;
  blurAmount = 0.3;
  falloff = 1.0;
  clipXY = 1.4;
  focalAdjustment = 2.0;

  /**
   * Maximum Spherical Harmonics level to use. Spark supports up to SH3.
   *
   * @default 3
   */
  maxSh = 3;

  /**
   * Whether or not sorting should happen automatically.
   * @default true
   */
  autoSort = true;
  /**
   * Whether or not to use sort-free stochastic rendering.
   * @default false
   */
  stochastic = false;
  enable2DGS = false;

  /**
   * Distance threshold in world units for re-sorting splats.
   * If the viewpoint moves more than this distance, splats will be re-sorted.
   * @default 0.01
   */
  sortDistance = 0.01;
  /**
   * View direction dot product threshold for re-sorting splats. For `sortRadial: true`
   * it defaults to 0.99 while `sortRadial: false` uses 0.999 because it is more
   * sensitive to view direction.
   * @default 0.99 if sortRadial else 0.999
   */
  sortCoorient = 0.999; // FIXME: Depend on sortRadial :-/

  constructor(splatData: SplatData, options: SplatOptions = {}) {
    const uniforms = Splat.makeUniforms();
    const shaders = getShaders();
    const premultipliedAlpha = options.premultipliedAlpha ?? true;
    const material = new THREE.ShaderMaterial({
      name: "SplatShader",
      glslVersion: THREE.GLSL3,
      vertexShader: shaders.splatVertex,
      fragmentShader: shaders.splatFragment,
      uniforms,
      premultipliedAlpha,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      defines: {
        STOCHASTIC: false,
        SPLAT_DECODE_FN: "",
        SPLAT_SH_DECODE_FN: "",
        NUM_SH: 0,
      },
    });

    super(new SplatGeometry(), material);

    // Use a high render order to ensure being rendered at the end of the transparent queue.
    this.renderOrder = 9999;
    this.frustumCulled = false;

    this.uniforms = uniforms;

    this.sorter = options.sorter ?? new ReadbackSplatSorter();

    this.splatData = splatData;
    this.splatData.setupMaterial(material);

    this.geometry.updateBounds(this.splatData);
  }

  onBeforeRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    // Keep track of the camera to use for sorting.
    // Generally this is the same camera as used for rendering, though during
    // WebXR sessions this will be the XRCamera instead.
    let sortCamera = camera;

    // During immersive WebXR sessions this method can be called multiple times.
    // Only act on the first one.
    if (renderer.xr.isPresenting) {
      const xrCamera = renderer.xr.getCamera();
      const cameraIndex = xrCamera.cameras.indexOf(camera as THREE.WebXRCamera);
      if (cameraIndex === 0) {
        // First camera, use the main xrCamera for sorting.
        sortCamera = xrCamera;
      } else if (cameraIndex > 0) {
        // This is not the first camera (index 0) nor a different camera (index -1).
        // Material should already be prepared and sorting kicked off, nothing to do.
        return;
      }
    }

    const currentRenderTarget = renderer.getRenderTarget();
    if (currentRenderTarget) {
      // Rendering to a texture target, so its dimensions
      this.uniforms.renderSize.value.set(
        currentRenderTarget.width,
        currentRenderTarget.height,
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

    // Check for stochastic rendering
    if (this.material.defines.STOCHASTIC !== this.stochastic) {
      this.material.defines.STOCHASTIC = this.stochastic;
      this.material.transparent = !this.stochastic;
      this.material.depthWrite = this.stochastic;
      this.material.needsUpdate = true;
    }

    // Update the number of SH to evaluate
    const numSh = Math.min(this.maxSh, this.splatData.numSh);
    if (this.material.defines.NUM_SH !== numSh) {
      this.material.defines.NUM_SH = numSh;
      this.material.needsUpdate = true;
    }

    // Update uniforms
    this.uniforms.numSplats.value = this.splatData.numSplats;
    this.uniforms.maxStdDev.value = this.maxStdDev;
    this.uniforms.minPixelRadius.value = this.minPixelRadius;
    this.uniforms.maxPixelRadius.value = this.maxPixelRadius;
    this.uniforms.minAlpha.value = this.minAlpha;
    this.uniforms.time.value = performance.now() / 1000;
    this.uniforms.enable2DGS.value = this.enable2DGS;
    this.uniforms.preBlurAmount.value = this.preBlurAmount;
    this.uniforms.blurAmount.value = this.blurAmount;
    this.uniforms.falloff.value = this.falloff;
    this.uniforms.clipXY.value = this.clipXY;
    this.uniforms.focalAdjustment.value = this.focalAdjustment;
    this.uniforms.opacity.value = this.material.opacity;
    const outputColorSpace =
      currentRenderTarget === null
        ? renderer.outputColorSpace
        : "isXRRenderTarget" in currentRenderTarget &&
            currentRenderTarget.isXRRenderTarget === true
          ? currentRenderTarget.texture.colorSpace
          : THREE.LinearSRGBColorSpace;
    this.uniforms.encodeLinear.value =
      outputColorSpace !== THREE.SRGBColorSpace;

    // Perform sorting if needed
    if (this.autoSort && !this.stochastic) {
      this.sortFor(renderer, sortCamera, false);
    }

    // Ensure geometry uses the correct order
    if (this.stochastic) {
      // Ordering does not apply for stochastic and is camera independent
      this.geometry.instanceCount = this.splatData.numSplats;
    } else {
      // Fetch sorting context for this camera
      const context = this.sortContext.get(sortCamera);
      if (context && this.currentOrderingId !== context.orderingId) {
        this.currentOrderingId = context.orderingId;
        this.geometry.update(renderer, context.ordering, context.activeSplats);
      }
    }
  }

  async sortFor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    updateOrdering = true,
  ) {
    // Calculate the transform from the accumulator to the current camera
    const worldToCamera = camera.matrixWorld.clone().invert();
    const originToCamera = this.matrixWorld.clone().premultiply(worldToCamera);

    // Check if sorting is needed
    let context = this.sortContext.get(camera);
    let needsSort = false;
    if (!context) {
      context = {
        lastOriginToCamera: new THREE.Matrix4(),
        lastWorldTransform: new THREE.Matrix4(),
        sortJob: null,
        ordering: new Uint32Array(this.splatData.maxSplats),
        pendingOrdering: new Uint32Array(this.splatData.maxSplats),
        activeSplats: 0,
        orderingId: globalOrderingId++,
        splatVersion: this.splatVersion,
      };
      needsSort = true;
      this.sortContext.set(camera, context);
    }

    // Check if the underlying splat version matches
    if (context.splatVersion !== this.splatVersion) {
      needsSort = true;
    }

    // Check if the camera moved, requiring a new sort
    if (
      !needsSort &&
      !withinCoorientDist({
        matrix1: originToCamera,
        matrix2: context.lastOriginToCamera,
        // By default update sort each 1 cm
        maxDistance: this.sortDistance ?? 0.01,
        // By default for radial sort, update for intermittent movement so that
        // we bring back splats culled by being behind the camera.
        // For depth sort, small rotations can change sort order a lot, so
        // update sort for even small rotations.
        minCoorient: 0.999, // FIXME
      })
    ) {
      needsSort = true;
    }

    if (!this.matrixWorld.equals(context.lastWorldTransform)) {
      needsSort = true;
    }

    // Prepare next sort when needed
    if (needsSort && !context.sortJob) {
      context.lastOriginToCamera.copy(originToCamera);
      context.lastWorldTransform.copy(this.matrixWorld);
      context.splatVersion = this.splatVersion;
      context.sortJob = this.sorter.sort(
        camera,
        this,
        renderer,
        context.pendingOrdering,
      );
      context.sortJob.then((result) => this.onSortComplete(context, result));
    }

    if (context.sortJob) {
      await context.sortJob;
    }

    if (updateOrdering) {
      this.currentOrderingId = context.orderingId;
      this.geometry.update(renderer, context.ordering, context.activeSplats);
    }
  }

  protected onSortComplete(context: SortContext, result: SplatOrdering) {
    context.sortJob = null;
    // Swap ordering arrays
    context.pendingOrdering = context.ordering;
    context.ordering = result.ordering;

    context.activeSplats = result.activeSplats;
    context.orderingId = globalOrderingId++;
  }

  /**
   * Returns an array of splat ranges with their corresponding (world) transform.
   * This allows rigid transforms to apply to subsets of the splats.
   */
  getTransformRanges(): Array<TransformRange> {
    return [
      {
        start: 0,
        end: this.splatData.numSplats,
        matrix: this.matrixWorld.toArray(),
      },
    ];
  }

  setShaderHooks(hooks: ShaderHooks | null): ShaderHooks | null {
    const previousShaderHooks = this.shaderHooks;
    this.shaderHooks = hooks;

    // Add additional uniforms
    if (hooks?.vertex?.uniforms) {
      for (const uniform in hooks.vertex.uniforms) {
        this.material.uniforms[uniform] = hooks.vertex.uniforms[uniform];
      }
    }
    if (hooks?.fragment?.uniforms) {
      for (const uniform in hooks.fragment.uniforms) {
        this.material.uniforms[uniform] = hooks.fragment.uniforms[uniform];
      }
    }

    // Prepare compile hook
    this.material.onBeforeCompile = (program, renderer) => {
      if (!program.defines) {
        program.defines = {};
      }

      if (this.shaderHooks?.vertex) {
        program.defines.HOOK_UNIFORMS = !!this.shaderHooks.vertex.uniforms;
        if (this.shaderHooks.vertex.uniforms) {
          // Generate uniform code block
          const uniforms = Object.entries(this.shaderHooks.vertex.uniforms)
            .map(
              (entry) =>
                `uniform ${entry[1].type} ${entry[0]}${Array.isArray(entry[1].value) ? `[${entry[1].value.length}]` : ""};`,
            )
            .join("\n");
          program.vertexShader = program.vertexShader.replace(
            "{{HOOK_UNIFORMS}}",
            uniforms,
          );
        }
        program.defines.HOOK_GLOBAL = !!this.shaderHooks.vertex.global;
        program.vertexShader = program.vertexShader.replace(
          "{{HOOK_GLOBAL}}",
          this.shaderHooks.vertex.global ?? "",
        );
        program.defines.HOOK_OBJECT_MODIFIER =
          !!this.shaderHooks.vertex.objectModifier;
        program.vertexShader = program.vertexShader.replace(
          "{{HOOK_OBJECT_MODIFIER}}",
          this.shaderHooks.vertex.objectModifier ?? "",
        );
        program.defines.HOOK_WORLD_MODIFIER =
          !!this.shaderHooks.vertex.worldModifier;
        program.vertexShader = program.vertexShader.replace(
          "{{HOOK_WORLD_MODIFIER}}",
          this.shaderHooks.vertex.worldModifier ?? "",
        );
        program.defines.HOOK_SPLAT_COLOR = !!this.shaderHooks.vertex.splatColor;
        program.vertexShader = program.vertexShader.replace(
          "{{HOOK_SPLAT_COLOR}}",
          this.shaderHooks.vertex.splatColor ?? "",
        );
      }

      if (this.shaderHooks?.fragment) {
        if (this.shaderHooks.fragment.uniforms) {
          // Generate uniform code block
          const uniforms = Object.entries(this.shaderHooks.fragment.uniforms)
            .map(
              (entry) =>
                `uniform ${entry[1].type} ${entry[0]}${Array.isArray(entry[1].value) ? `[${entry[1].value.length}]` : ""};`,
            )
            .join("\n");
          program.vertexShader = program.vertexShader.replace(
            "#define HOOK_UNIFORMS",
            uniforms,
          );
        }
      }

      if (this.shaderHooks?.onBeforeCompile) {
        this.shaderHooks.onBeforeCompile(program, renderer);
      }
    };

    // Material is specific to instance.
    // FIXME: Maybe hash the shader hooks struct?
    this.material.customProgramCacheKey = () => this.uuid;

    // Make sure the material recompiles
    this.material.needsUpdate = true;

    return previousShaderHooks;
  }

  get opacity(): number {
    return this.material.opacity;
  }

  set opacity(value: number) {
    this.material.opacity = value;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.splatData.dispose();
  }

  set needsUpdate(value: boolean) {
    if (value === true) this.splatVersion++;
  }

  // NOTE: Override _computeIntersections to allow base implementation of THREE.Mesh to check
  //       against bounding sphere and bounding box.
  _computeIntersections(
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ): void {
    if (this.raycastMethod) {
      this.raycastMethod(this, raycaster, intersects);
    }
  }

  clone() {
    const ctor = this.constructor as new (splatData: SplatData) => this;
    const clone = new ctor(this.splatData).copy(this);
    return clone;
  }

  copy(source: this, recursive?: boolean): this {
    // Avoid copying the material and geometry as these are unique to the Splat
    const material = this.material;
    const geometry = this.geometry;

    super.copy(source, recursive);
    // TODO: Copy over Splat specific properties

    this.material = material;
    this.geometry = geometry;
    return this;
  }

  static makeUniforms() {
    // Create uniforms used for Gsplat vertex and fragment shaders
    const uniforms = {
      // Opacity of the splat
      opacity: { value: 1.0 },

      // Total number of splats, active or not
      numSplats: { value: 0 },

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

      // Modulate Gaussian kernel falloff. 0 means "no falloff, flat shading",
      // 1 is normal e^-x^2 falloff.
      falloff: { value: 1.0 },
      // Clip Gsplats that are clipXY times beyond the +-1 frustum bounds
      clipXY: { value: 1.4 },
      // Size of render viewport in pixels
      renderSize: { value: new THREE.Vector2() },
      // Debug renderSize scale factor
      focalAdjustment: { value: 1.0 },

      // Time in seconds for time-based effects
      time: { value: 0 },
      // Whether to encode Gsplat with linear RGB (for environment mapping)
      encodeLinear: { value: false },
    };
    return uniforms;
  }
}

/**
 * Shader hooks for customizing the shader used for rendering splats.
 * This allows modifying the splats in object space, in world space
 * as well as adjusting the splats color, opacity and shading.
 */
export type ShaderHooks = {
  /**
   * Hooks for the vertex shader.
   */
  vertex?: {
    /**
     * Additional uniforms to add to the vertex shader.
     */
    uniforms?: { [key: string]: THREE.IUniform & { type: string } };
    /**
     * Shader chunk to include at the start of the vertex shader.
     * This can be used to define additional methods and constant
     * that can be used in the other hooks.
     */
    global?: string;
    /**
     * Shader chunk for adjusting the splat in object space.
     */
    objectModifier?: string;
    /**
     * Shader chunk for adjusting the splat in world space.
     */
    worldModifier?: string;
    /**
     * Shader chunk for changing the color of the splat.
     */
    splatColor?: string;
  };
  /**
   * Hooks for the fragment shader.
   */
  fragment?: {
    /**
     * Additional uniforms to add to the fragment shader.
     */
    uniforms?: { [key: string]: THREE.IUniform & { type: string } };
    /**
     * Shader chunk to include at the start of the fragment shader.
     * This can be used to define additional methods and constant
     * that can be used in the other hooks.
     */
    global?: string;
  };
  /**
   * Custom onBeforeCompile allowing the full shader code to be adjusted.
   */
  onBeforeCompile?: typeof THREE.Material.prototype.onBeforeCompile;
};
