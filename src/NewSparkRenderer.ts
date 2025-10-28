import * as THREE from "three";
import { type PackedSplats, Readback, SplatMesh, dyno } from ".";
import { NewSplatAccumulator } from "./NewSplatAccumulator";
import { NewSplatGeometry } from "./NewSplatGeometry";
import { NewSplatWorker, workerPool } from "./NewSplatWorker";
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
  // sort360?: boolean;
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
  // sort360: boolean;
  sort32: boolean;
  minSortIntervalMs?: number;

  clock: THREE.Clock;
  time?: number;
  lastFrame = -1;
  updateTimeoutId = -1;

  sortDirty = false;
  sorting = false;
  lastSort?: number;
  sortCenter = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
  sortDir = new THREE.Vector3().setScalar(0);
  sortTimeoutId = -1;
  readback32 = new Uint32Array(0);
  readback16 = new Uint16Array(0);

  orderingTexture: THREE.DataArrayTexture | null = null;
  activeSplats = 0;

  maxSplats = 0;
  display: NewSplatAccumulator;
  current: NewSplatAccumulator;
  accumulators: NewSplatAccumulator[] = [];

  worker: NewSplatWorker | null = null;
  lodIds: Map<PackedSplats, { lodId: number; lastTouched: number }> = new Map();
  lodInitQueue: PackedSplats[] = [];
  lodInstances: Map<
    SplatMesh,
    { numSplats: number; indices: Uint32Array; texture: THREE.DataTexture }
  > = new Map();
  lodCenter = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
  lodOrient = new THREE.Quaternion().set(0, 0, 0, 0);

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
    // this.sort360 = options.sort360 ?? false;
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

  // maybeUpdateSort(camera: THREE.Camera) {
  //   if (this.sortCamera) {
  //     this.sortCamera.copy(camera);
  //   } else {
  //     const center = camera.getWorldPosition(new THREE.Vector3());
  //     const dir = camera.getWorldDirection(new THREE.Vector3());
  //     const needsSort = (center.distanceTo(this.sortCenter) > 0.001) ||
  //       (dir.dot(this.sortDir) < (this.sortRadial ? 0.99 : 0.999));
  //     if (needsSort) {
  //       this.sortCamera = camera.clone();
  //     }
  //   }

  //   this.maybeTriggerSort()
  // }

  // maybeTriggerSort() {
  //   if (this.sortCamera && !this.sorting) {
  //     const nextSort = (this.minSortIntervalMs && this.lastSort) ?
  //       (this.lastSort + this.minSortIntervalMs - performance.now()) : 0;

  //     if (this.sortTimeoutId !== -1) {
  //       clearTimeout(this.sortTimeoutId);
  //       this.sortTimeoutId = -1;
  //     }

  //     if (nextSort <= 0) {
  //       this.runSort();
  //     } else {
  //       this.sortTimeoutId = setTimeout(() => {
  //         this.sortTimeoutId = -1;
  //         this.runSort();
  //       }, nextSort);
  //     }
  //   }
  // }

  // runSort() {
  //   this.sorting = true;

  //   //
  //   this.maybeTriggerSort();
  // }

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
    camera.updateMatrixWorld();

    const renderSize = this.uniforms.renderSize.value;
    const time = this.time ?? this.clock.getElapsedTime();

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

    const { sameMapping, mappingVersion, visibleGenerators, generate } =
      next.prepareGenerate({
        renderer,
        scene,
        time,
        camera,
        sortRadial: this.sortRadial ?? true,
        renderSize,
        previous: this.current,
        lodInstances: this.lodInstances,
      });

    const center = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const viewChanged =
      center.distanceTo(this.sortCenter) > 0.001 ||
      dir.dot(this.sortDir) < (this.sortRadial ? 0.99 : 0.999);

    const needSort =
      viewChanged || mappingVersion > this.current.mappingVersion;
    if (needSort && !sortOkay) {
      console.log(`push: needSort && !sortOkay, viewChanged=${viewChanged}`);
      this.accumulators.push(next);
      return false;
    }

    if (this.sorting && needSort) {
      console.log(`push: sorting && needsSort, viewChanged=${viewChanged}`);
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
        this.accumulators.push(this.display);
        this.display = next;
      } else {
        this.accumulators.push(this.current);
      }

      this.current = next;
    } else {
      if (sameMapping) {
        if (this.current === this.display) {
          this.display = next;
          console.log("Short circuit sameMapping");
        } else {
        }
      } else {
        if (sortOkay) {
          console.log("!sameMapping && sortOkay");
        }
      }
      if (this.display !== this.current) {
        this.accumulators.push(this.current);
      }
      this.current = next;

      if (sortOkay) {
        // Don't await this
        this.driveSort(sortOkay, sameMapping);
      } else {
        if (this.display !== next) {
          this.accumulators.push(next);
        }
      }
    }

    if (this.accumulators.length > 2) {
      throw new Error("Accumulators length > 2");
    }

    const lodMeshes = visibleGenerators.filter((generator) => {
      return (
        generator instanceof SplatMesh && generator.packedSplats.extra.lodTree
      );
    }) as SplatMesh[];

    const lodSplats = lodMeshes.reduce((splats, mesh) => {
      splats.add(mesh.packedSplats);
      return splats;
    }, new Set<PackedSplats>());

    this.lodInitQueue = [];

    for (const splats of lodSplats) {
      const record = this.lodIds.get(splats);
      if (record) {
        record.lastTouched = now;
      } else {
        this.lodInitQueue.push(splats);
      }
    }

    if (lodMeshes.length > 0) {
      if (!this.worker) {
        this.worker = new NewSplatWorker();
      }
      this.worker?.tryExclusive(async (worker) => {
        const now = performance.now();
        if (this.lodInitQueue.length > 0) {
          const splats = this.lodInitQueue.shift() as PackedSplats;
          const { lodId } = (await worker.call("initLodTree", {
            numSplats: splats.numSplats,
            lodTree: (splats.extra.lodTree as Uint32Array).slice(),
          })) as { lodId: number };
          console.log("initLodTree", lodId);
          this.lodIds.set(splats, { lodId, lastTouched: now });
          return;
        }

        const viewQuaternion = new THREE.Quaternion();
        const viewPosition = new THREE.Vector3();
        next.viewToWorld.decompose(
          viewPosition,
          viewQuaternion,
          new THREE.Vector3(),
        );
        const lodViewChanged =
          viewPosition.distanceTo(this.lodCenter) > 0.001 ||
          viewQuaternion.dot(this.lodOrient) < 0.999;

        if (lodViewChanged) {
          const maxSplats = 1500000;
          let pixelScaleLimit = 0.0;
          let fovXdegrees = Number.POSITIVE_INFINITY;
          let fovYdegrees = Number.POSITIVE_INFINITY;
          if (camera instanceof THREE.PerspectiveCamera) {
            const tanYfov = Math.tan((0.5 * camera.fov * Math.PI) / 180);
            pixelScaleLimit = (2.0 * tanYfov) / renderSize.y;
            fovYdegrees = camera.fov;
            fovXdegrees =
              ((Math.atan(tanYfov * camera.aspect) * 180) / Math.PI) * 2.0;
          }

          const uuidToMesh: Record<string, SplatMesh> = {};

          const instances = lodMeshes.reduce(
            (instances, mesh) => {
              const record = this.lodIds.get(mesh.packedSplats);
              if (record) {
                const viewToObject = new THREE.Matrix4();
                viewToObject.compose(
                  mesh.context.viewToObject.translate.value,
                  mesh.context.viewToObject.rotate.value,
                  new THREE.Vector3().setScalar(
                    mesh.context.viewToObject.scale.value,
                  ),
                );
                uuidToMesh[mesh.uuid] = mesh;
                instances[mesh.uuid] = {
                  lodId: record.lodId,
                  viewToObjectCols: viewToObject.elements,
                };
              }
              return instances;
            },
            {} as Record<string, { lodId: number; viewToObjectCols: number[] }>,
          );

          const traverseStart = performance.now();
          const { keyIndices } = (await worker.call("traverseLodTrees", {
            maxSplats,
            pixelScaleLimit,
            fovXdegrees,
            fovYdegrees,
            outsideFoveate: 1.0,
            behindFoveate: 0.5,
            instances,
          })) as {
            keyIndices: Record<
              string,
              { numSplats: number; indices: Uint32Array }
            >;
          };
          const debugSplats = Object.keys(keyIndices).map((uuid) => [
            uuid,
            keyIndices[uuid].numSplats,
          ]);
          console.log(
            "traverseLodTrees result",
            performance.now() - traverseStart,
            JSON.stringify(debugSplats),
          );

          for (const [uuid, countIndices] of Object.entries(keyIndices)) {
            const { numSplats, indices } = countIndices;
            const mesh = uuidToMesh[uuid];
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
            } else {
              instance.numSplats = numSplats;
              // TODO: Do we need to do this since we are directly uploading from indices?
              instance.indices.set(indices);

              const gl = renderer.getContext() as WebGL2RenderingContext;
              if (!renderer.properties.has(instance.texture)) {
                instance.texture.needsUpdate = true;
              } else {
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
            }
            mesh.updateMappingVersion();
          }

          this.lodCenter.copy(viewPosition);
          this.lodOrient.copy(viewQuaternion);

          return;
        }

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
          const { lastTouched, lodId } = this.lodIds.get(oldest) ?? {
            lastTouched: 0,
            lodId: 0,
          };
          if (lastTouched < now - 3000) {
            for (const [mesh, indices] of this.lodInstances.entries()) {
              if (mesh.packedSplats === oldest) {
                indices.texture.dispose();
                this.lodInstances.delete(mesh);
              }
            }
            await worker.call("disposeLodTree", { lodId });
          }
        }
      });
    }

    return true;
  }

  async driveSort(sortOkay: boolean, sameMapping: boolean) {
    if (this.sorting || !this.sortDirty) {
      return;
    }
    try {
      this.sorting = true;
      this.sortDirty = false;
      this.lastSort = performance.now();

      this.sortCenter.copy(this.current.viewCenterUniform.value);
      this.sortDir.copy(this.current.viewDirUniform.value);

      if (this.readPause > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.readPause));
      }

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

      await this.readbackDepth({
        renderer: this.renderer,
        numSplats,
        readback,
      });

      if (this.sortPause > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.sortPause));
      }

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

      if (this.sortDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.sortDelay));
      }

      if (sort32) {
        this.readback32 = result.readback as Uint32Array<ArrayBuffer>;
      } else {
        this.readback16 = result.readback as Uint16Array<ArrayBuffer>;
      }

      this.activeSplats = result.activeSplats;

      if (this.orderingTexture) {
        const { width, height, depth } = this.orderingTexture.image;
        if (width * height * depth < result.ordering.length) {
          console.log(
            `Disposing orderingTexture: ${width}x${height}x${depth} < ${result.ordering.length}`,
          );
          this.orderingTexture.dispose();
          this.orderingTexture = null;
        }
      }
      if (!this.orderingTexture) {
        const { width, height, depth } = getTextureSize(result.ordering.length);
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
        for (let layer = 0; layer < numLayers; ++layer) {
          this.orderingTexture.addLayerUpdate(layer);
        }
      }
      this.orderingTexture.needsUpdate = true;

      // this.sortCenter.copy(this.current.viewCenterUniform.value);
      // this.sortDir.copy(this.current.viewDirUniform.value);

      if (this.current.mappingVersion > this.display.mappingVersion) {
        this.accumulators.push(this.display);
        this.display = this.current;
        console.log("Updating display to current");
      } else {
        console.log("NOT updating display to current");
      }
    } finally {
      this.sorting = false;
    }
  }

  async readbackDepth({
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

      // await new Promise((resolve) => {
      //   requestAnimationFrame(() => {
      //     setTimeout(resolve, 1);
      //   });
      // });

      baseIndex += SPLAT_TEX_WIDTH * layerYEnd;
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
