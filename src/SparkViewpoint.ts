import * as THREE from "three";

import { DynoPackedSplats } from "./PackedSplats";
import { Readback } from "./Readback";
import type { SparkRenderer } from "./SparkRenderer";
import type { SplatAccumulator } from "./SplatAccumulator";
import { SplatGeometry } from "./SplatGeometry";
import {
  type DynoBlock,
  DynoBool,
  DynoFloat,
  type DynoVal,
  DynoVec3,
  Gsplat,
  add,
  combine,
  defineGsplat,
  dyno,
  dynoBlock,
  dynoConst,
  floatBitsToUint,
  mul,
  packHalf2x16,
  readPackedSplat,
  uintToRgba8,
  unindent,
  unindentLines,
} from "./dyno";
import { withWorker } from "./splatWorker";
import { FreeList, withinCoorientDist } from "./utils";

export type SparkViewpointOptions = {
  /**
   * Controls whether to auto-update its sort order whenever the SparkRenderer
   * updates the Gsplats. If you expect to render/display from this viewpoint
   * most frames, set this to true.
   * @default false
   */
  autoUpdate?: boolean;
  /**
   * Set a THREE.Camera for this viewpoint to follow.
   * @default undefined
   */
  camera?: THREE.Camera;
  /**
   * Set an explicit view-to-world transformation matrix for this viewpoint (equivalent
   * to camera.matrixWorld), overrides any camera setting.
   * @default undefined
   */
  viewToWorld?: THREE.Matrix4;
  /**
   * Configure viewpoint with an off-screen render target.
   * @default undefined
   */
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
  /**
   * Callback function that is called when the render target texture is updated.
   * Receives the texture as a parameter. Use this to update a viewport with
   * the latest viewpoint render each frame.
   * @default undefined
   */
  onTextureUpdated?: (texture: THREE.Texture) => void;
  /**
   * Whether to sort splats radially (geometric distance) from the viewpoint (true)
   * or by Z-depth (false). Most scenes are trained with the Z-depth sort metric
   * and will render more accurately at certain viewpoints. However, radial sorting
   * is more stable under viewpoint rotations.
   * @default true
   */
  sortRadial?: boolean;
  /**
   * Distance threshold for re-sorting splats. If the viewpoint moves more than
   * this distance, splats will be re-sorted.
   * @default 0.01 units
   */
  sortDistance?: number;
  /**
   * View direction dot product threshold for re-sorting splats. For
   * sortRadial: true we use 0.99 while sortRadial: false uses 0.999 because it is
   * more sensitive to view direction.
   * @default 0.99 if sortRadial else 0.999
   */
  sortCoorient?: boolean;
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
  /*
   * Set this to true to enable sort-free stochastic splat rendering.
   * @default false
   */
  stochastic?: boolean;
};

// A SparkViewpoint is created from and tied to a SparkRenderer, and represents
// an independent viewpoint of all the scene Gsplats and their sort order. Making
// these viewpoints explicit allows us to have multiple, simultaneous viewpoint
// renders, for example for camera preview panes or overhead map views.
//
// When creating a SparkRenderer it automatically creates a default viewpoint
// .defaultView that is used in the normal render loop when drawing to the canvas,
// and is automatically updated whenever the camera moves. Additional viewpoints
// can be created and configured separately.

export class SparkViewpoint {
  spark: SparkRenderer;
  autoUpdate: boolean;
  camera?: THREE.Camera;
  viewToWorld: THREE.Matrix4;
  lastTime: number | null = null;

  target?: THREE.WebGLRenderTarget;
  private back?: THREE.WebGLRenderTarget;
  onTextureUpdated?: (texture: THREE.Texture) => void;
  encodeLinear = false;
  superXY = 1;
  private superPixels?: Uint8Array;
  private pixels?: Uint8Array;

  sortRadial: boolean;
  sortDistance?: number;
  sortCoorient?: boolean;
  depthBias?: number;
  sort360?: boolean;
  sort32?: boolean;
  stochastic: boolean;

  display: {
    accumulator: SplatAccumulator;
    viewToWorld: THREE.Matrix4;
    geometry: SplatGeometry;
  } | null = null;

  private sorting: { viewToWorld: THREE.Matrix4 } | null = null;
  private pending: {
    accumulator?: SplatAccumulator;
    viewToWorld: THREE.Matrix4;
    displayed: boolean;
  } | null = null;
  private sortingCheck = false;

  private readback16: Uint16Array = new Uint16Array(0);
  private readback32: Uint32Array = new Uint32Array(0);
  private orderingFreelist: FreeList<Uint32Array, number>;

  constructor(options: SparkViewpointOptions & { spark: SparkRenderer }) {
    this.spark = options.spark;
    this.camera = options.camera;
    this.viewToWorld = options.viewToWorld ?? new THREE.Matrix4();

    if (options.target) {
      const { width, height, doubleBuffer } = options.target;
      const superXY = Math.max(1, Math.min(4, options.target.superXY ?? 1));
      this.superXY = superXY;
      if (width * superXY > 8192 || height * superXY > 8192) {
        throw new Error("Target size too large");
      }

      this.target = new THREE.WebGLRenderTarget(
        width * superXY,
        height * superXY,
        {
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          colorSpace: THREE.SRGBColorSpace,
        },
      );
      if (doubleBuffer) {
        this.back = new THREE.WebGLRenderTarget(
          width * superXY,
          height * superXY,
          {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            colorSpace: THREE.SRGBColorSpace,
          },
        );
      }
      this.encodeLinear = true;
    }
    this.onTextureUpdated = options.onTextureUpdated;

    this.sortRadial = options.sortRadial ?? true;
    this.sortDistance = options.sortDistance;
    this.sortCoorient = options.sortCoorient;
    this.depthBias = options.depthBias;
    this.sort360 = options.sort360;
    this.sort32 = options.sort32;
    this.stochastic = options.stochastic ?? false;

    this.orderingFreelist = new FreeList({
      allocate: (maxSplats) => new Uint32Array(maxSplats),
      valid: (ordering, maxSplats) => ordering.length === maxSplats,
    });

    this.autoUpdate = false;
    this.setAutoUpdate(options.autoUpdate ?? false);
  }

  // Call this when you are done with the SparkViewpoint and want to
  // free up its resources (GPU targets, pixel buffers, etc.)
  dispose() {
    this.setAutoUpdate(false);
    if (this.target) {
      this.target.dispose();
      this.target = undefined;
    }
    if (this.back) {
      this.back.dispose();
      this.back = undefined;
    }
    if (this.display) {
      this.spark.releaseAccumulator(this.display.accumulator);
      this.display.geometry.dispose();
      this.display = null;
    }
    if (this.pending?.accumulator) {
      this.spark.releaseAccumulator(this.pending.accumulator);
      this.pending = null;
    }
  }

  // Use this function to change whether this viewpoint will auto-update
  // its sort order whenever the attached SparkRenderer updates the Gsplats.
  // Turn this on or off depending on whether you expect to do renders from
  // this viewpoint most frames.
  setAutoUpdate(autoUpdate: boolean) {
    if (!this.autoUpdate && autoUpdate) {
      this.spark.autoViewpoints.push(this);
    } else if (this.autoUpdate && !autoUpdate) {
      this.spark.autoViewpoints = this.spark.autoViewpoints.filter(
        (v) => v !== this,
      );
    }
    this.autoUpdate = autoUpdate;
  }

  // See below async prepareRenderPixels() for explanation of parameters.
  // Awaiting this method updates the Gsplats in the scene and performs a sort of the
  // Gsplats from this viewpoint, preparing it for a subsequent this.renderTarget()
  // call in the same tick.
  async prepare({
    scene,
    camera,
    viewToWorld,
    update,
    forceOrigin,
  }: {
    scene: THREE.Scene;
    camera?: THREE.Camera;
    viewToWorld?: THREE.Matrix4;
    update?: boolean;
    forceOrigin?: boolean;
  }) {
    if (viewToWorld) {
      this.viewToWorld = viewToWorld;
    } else {
      this.camera = camera ?? this.camera;
      if (this.camera) {
        this.camera.updateMatrixWorld();
        this.viewToWorld = this.camera.matrixWorld.clone();
      }
    }
    while (update ?? true) {
      // Force an update, possibly with origin centered at this camera
      // to yield the best quality output.
      const originToWorld = forceOrigin ? this.viewToWorld : undefined;
      const updated = this.spark.updateInternal({ scene, originToWorld });
      if (updated) {
        break;
      }
      // A bit of a hack, but try again. We shouldn't be starved for long.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const accumulator = this.spark.active;
    if (accumulator !== this.display?.accumulator) {
      this.spark.active.refCount += 1;
    }
    await this.sortUpdate({ accumulator, viewToWorld: this.viewToWorld });
  }

  // Render out the viewpoint to the view target RGBA buffer.
  // Swaps buffers if doubleBuffer: true was set.
  // Calls onTextureUpdated(texture) with the resulting texture.
  renderTarget({
    scene,
    camera,
  }: { scene: THREE.Scene; camera?: THREE.Camera }) {
    const target = this.back ?? this.target;
    if (!target) {
      throw new Error("Must initialize SparkViewpoint with target");
    }

    camera = camera ?? this.camera;
    if (!camera) {
      throw new Error("Must provide camera");
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      const newCam = new THREE.PerspectiveCamera().copy(camera, false);
      newCam.aspect = target.width / target.height;
      newCam.updateProjectionMatrix();
      camera = newCam;
    }
    this.viewToWorld = camera.matrixWorld.clone();

    try {
      this.spark.renderer.setRenderTarget(target);
      this.spark.prepareViewpoint(this);

      this.spark.renderer.render(scene, camera);
    } finally {
      this.spark.prepareViewpoint(this.spark.defaultView);
      this.spark.renderer.setRenderTarget(null);
    }

    if (target !== this.target) {
      // Swap back buffer and target
      [this.target, this.back] = [this.back, this.target];
    }
    this.onTextureUpdated?.(target.texture);
  }

  // Read back the previously rendered target image as a Uint8Array of packed
  // RGBA values (in that order). If superXY was set greater than 1 then
  // downsampling is performed in the target pixel array with simple averaging
  // to derive the returned pixel values. Subsequent calls to this.readTarget()
  // will reuse the same buffers to minimize memory allocations.
  async readTarget(): Promise<Uint8Array> {
    if (!this.target) {
      throw new Error("Must initialize SparkViewpoint with target");
    }
    const { width, height } = this.target;
    const byteSize = width * height * 4;
    if (!this.superPixels || this.superPixels.length < byteSize) {
      this.superPixels = new Uint8Array(byteSize);
    }
    await this.spark.renderer.readRenderTargetPixelsAsync(
      this.target,
      0,
      0,
      width,
      height,
      this.superPixels,
    );

    const { superXY } = this;
    if (superXY === 1) {
      return this.superPixels;
    }

    const subWidth = width / superXY;
    const subHeight = height / superXY;
    const subSize = subWidth * subHeight * 4;
    if (!this.pixels || this.pixels.length < subSize) {
      this.pixels = new Uint8Array(subSize);
    }

    const { superPixels, pixels } = this;
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
          const superRow = (y * superXY + sy) * this.target.width;
          for (let sx = 0; sx < superXY; sx++) {
            const superIndex = (superRow + superCol + sx) * 4;
            r += superPixels[superIndex];
            g += superPixels[superIndex + 1];
            b += superPixels[superIndex + 2];
            a += superPixels[superIndex + 3];
          }
        }
        const pixelIndex = (row + x) * 4;
        pixels[pixelIndex] = r / super2;
        pixels[pixelIndex + 1] = g / super2;
        pixels[pixelIndex + 2] = b / super2;
        pixels[pixelIndex + 3] = a / super2;
      }
    }
    return pixels;
  }

  // Render out a viewpoint as a Uint8Array of RGBA values for the provided scene
  // and any camera/viewToWorld viewpoint overrides. By default update is true,
  // which triggers its SparkRenderer to check and potentially update the Gsplats.
  // Setting update to false disables this and sorts the Gsplats as they are.
  // Setting forceOrigin (default: false) to true forces the view update to
  // recalculate the splats with this view origin, potentially altering any
  // view-dependent effects. If you expect view-dependent effects to play a role
  // in the rendering quality, enable this.
  //
  // Underneath, prepareRenderPixels() simply calls await this.prepare(...),
  // this.renderTarget(...), and finally returns the result this.readTarget(),
  // a Promise to a Uint8Array with RGBA values for all the pixels (potentially
  // downsampled if the superXY parameter was used). These steps can also be called
  // manually, for example if you need to alter the scene before and after
  // this.renderTarget(...) to hide UI elements from being rendered.
  async prepareRenderPixels({
    scene,
    camera,
    viewToWorld,
    update,
    forceOrigin,
  }: {
    scene: THREE.Scene;
    camera?: THREE.Camera;
    viewToWorld?: THREE.Matrix4;
    update?: boolean;
    forceOrigin?: boolean;
  }) {
    await this.prepare({ scene, camera, viewToWorld, update, forceOrigin });
    this.renderTarget({ scene, camera });
    return this.readTarget();
  }

  // This is called automatically by SparkRenderer, there is no need to call it!
  // The method cannot be private because then SparkRenderer would
  // not be able to call it.
  autoPoll({ accumulator }: { accumulator?: SplatAccumulator }) {
    if (this.camera) {
      this.camera.updateMatrixWorld();
      this.viewToWorld = this.camera.matrixWorld.clone();
    }

    let needsSort = false;
    let displayed = false;

    if (!this.display) {
      // Need to do first sort
      needsSort = true;
    } else if (accumulator) {
      needsSort = true;
      const { mappingVersion } = this.display.accumulator;
      if (accumulator.mappingVersion === mappingVersion) {
        // Splat mapping has not changed, so reuse the existing sorted
        // geometry to show updates faster. We will still fire off
        // a re-sort if necessary. First release old accumulator.
        accumulator.refCount += 1;
        this.spark.releaseAccumulator(this.display.accumulator);
        this.display.accumulator = accumulator;
        this.display.viewToWorld.copy(this.viewToWorld);
        displayed = true;

        if (this.spark.viewpoint === this) {
          this.spark.prepareViewpoint(this);
        }
      }
    }

    const latestView = this.sorting?.viewToWorld ?? this.display?.viewToWorld;
    if (
      latestView &&
      !withinCoorientDist({
        matrix1: this.viewToWorld,
        matrix2: latestView,
        // By default update sort each 1 cm
        maxDistance: this.sortDistance ?? 0.01,
        // By default for radial sort, update for intermittent movement so that
        // we bring back splats culled by being behind the camera.
        // For depth sort, small rotations can change sort order a lot, so
        // update sort for even small rotations.
        minCoorient: (this.sortCoorient ?? this.sortRadial) ? 0.99 : 0.999,
      })
    ) {
      needsSort = true;
    }

    if (!needsSort) {
      // Stop here, no sort necessary
      return;
    }

    if (accumulator) {
      // Hold a reference to the accumulator for sorting
      accumulator.refCount += 1;
    }

    if (this.pending?.accumulator) {
      // Release the reference of the pending accumulator
      this.spark.releaseAccumulator(this.pending.accumulator);
    }
    this.pending = { accumulator, viewToWorld: this.viewToWorld, displayed };

    // Don't await this, just trigger the sort if necessary
    this.driveSort();
  }

  private async driveSort() {
    while (true) {
      if (this.sorting || !this.pending) {
        return; // Sort already in process or nothing to sort
      }

      const { viewToWorld, displayed } = this.pending;
      let accumulator = this.pending.accumulator;
      if (!accumulator) {
        // Hold a reference to the accumulator while sorting
        accumulator = this.display?.accumulator ?? this.spark.active;
        accumulator.refCount += 1;
      }
      this.pending = null;
      if (!accumulator) {
        throw new Error("No accumulator to sort");
      }

      this.sorting = { viewToWorld };
      await this.sortUpdate({ accumulator, viewToWorld, displayed });
      this.sorting = null;

      // Release the reference to the accumulator
      this.spark.releaseAccumulator(accumulator);

      // Continue in loop with any queued sort
    }
  }

  private async sortUpdate({
    accumulator,
    viewToWorld,
    displayed = false,
  }: {
    accumulator?: SplatAccumulator;
    viewToWorld: THREE.Matrix4;
    displayed?: boolean;
  }) {
    if (this.sortingCheck) {
      throw new Error("Only one sort at a time");
    }
    this.sortingCheck = true;

    accumulator = accumulator ?? this.spark.active;
    const { numSplats, maxSplats } = accumulator.splats;
    let activeSplats = 0;
    let ordering = this.orderingFreelist.alloc(maxSplats);

    if (this.stochastic) {
      activeSplats = numSplats;
      // Render all splats in order since the Z-buffer
      // will handle ordering.
      for (let i = 0; i < numSplats; ++i) {
        ordering[i] = i;
      }
    } else if (numSplats > 0) {
      const {
        reader,
        doubleSortReader,
        sort32Reader,
        dynoSortRadial,
        dynoOrigin,
        dynoDirection,
        dynoDepthBias,
        dynoSort360,
        dynoSplats,
      } = SparkViewpoint.makeSorter();
      const sort32 = this.sort32 ?? false;
      let readback: Uint16Array | Uint32Array;
      if (sort32) {
        this.readback32 = reader.ensureBuffer(maxSplats, this.readback32);
        readback = this.readback32;
      } else {
        const halfMaxSplats = Math.ceil(maxSplats / 2);
        this.readback16 = reader.ensureBuffer(halfMaxSplats, this.readback16);
        readback = this.readback16;
      }

      const worldToOrigin = accumulator.toWorld.clone().invert();
      const viewToOrigin = viewToWorld.clone().premultiply(worldToOrigin);

      dynoSortRadial.value = this.sort360 ? true : this.sortRadial;
      dynoOrigin.value.set(0, 0, 0).applyMatrix4(viewToOrigin);
      dynoDirection.value
        .set(0, 0, -1)
        .applyMatrix4(viewToOrigin)
        .sub(dynoOrigin.value)
        .normalize();
      dynoDepthBias.value = this.depthBias ?? 1.0;
      dynoSort360.value = this.sort360 ?? false;
      dynoSplats.packedSplats = accumulator.splats;

      const sortReader = sort32 ? sort32Reader : doubleSortReader;
      const count = sort32 ? numSplats : Math.ceil(numSplats / 2);
      await reader.renderReadback({
        renderer: this.spark.renderer,
        reader: sortReader,
        count,
        readback,
      });

      const result = (await withWorker(async (worker) => {
        const rpcName = sort32 ? "sort32Splats" : "sortDoubleSplats";
        return worker.call(rpcName, {
          maxSplats,
          numSplats,
          readback,
          ordering,
        });
      })) as {
        readback: Uint16Array | Uint32Array;
        ordering: Uint32Array;
        activeSplats: number;
      };
      if (sort32) {
        this.readback32 = result.readback as Uint32Array;
      } else {
        this.readback16 = result.readback as Uint16Array;
      }
      ordering = result.ordering;
      activeSplats = result.activeSplats;
    }

    this.updateDisplay({
      accumulator,
      viewToWorld,
      ordering,
      activeSplats,
      displayed,
    });
    this.sortingCheck = false;
  }

  private updateDisplay({
    accumulator,
    viewToWorld,
    ordering,
    activeSplats,
    displayed = false,
  }: {
    accumulator: SplatAccumulator;
    viewToWorld: THREE.Matrix4;
    ordering: Uint32Array;
    activeSplats: number;
    displayed?: boolean;
  }) {
    if (!this.display) {
      // Hold a reference to the accumulator while part of display
      accumulator.refCount += 1;
      this.display = {
        accumulator,
        viewToWorld,
        geometry: new SplatGeometry(ordering, activeSplats),
      };
    } else {
      if (!displayed && accumulator !== this.display.accumulator) {
        // Hold a reference to the new accumulator being displayed
        accumulator.refCount += 1;
        // Release the reference to the previously displayed accumulator
        this.spark.releaseAccumulator(this.display.accumulator);
        this.display.accumulator = accumulator;
      }

      this.display.viewToWorld = viewToWorld;

      const oldOrdering = this.display.geometry.ordering;
      if (oldOrdering.length === ordering.length) {
        this.display.geometry.update(ordering, activeSplats);
      } else {
        this.display.geometry.dispose();
        // console.log("*** alloc SplatGeometry", ordering.length);
        this.display.geometry = new SplatGeometry(ordering, activeSplats);
      }
      this.orderingFreelist.free(oldOrdering);
    }
    if (this.spark.viewpoint === this) {
      this.spark.prepareViewpoint(this);
    }
  }

  // If you need an empty THREE.Texture to use to initialize a uniform that is
  // updated via onTextureUpdated(texture), this static texture can be handy.
  static EMPTY_TEXTURE = new THREE.Texture();

  private static dynos: {
    dynoSortRadial: DynoBool<string>;
    dynoOrigin: DynoVec3<THREE.Vector3, "value">;
    dynoDirection: DynoVec3<THREE.Vector3, "value">;
    dynoDepthBias: DynoFloat<string>;
    dynoSort360: DynoBool<string>;
    dynoSplats: DynoPackedSplats;
    reader: Readback;
    doubleSortReader: DynoBlock<{ index: "int" }, { rgba8: "vec4" }>;
    sort32Reader: DynoBlock<{ index: "int" }, { rgba8: "vec4" }>;
  } | null = null;

  private static makeSorter() {
    if (!SparkViewpoint.dynos) {
      const dynoSortRadial = new DynoBool({ value: true });
      const dynoOrigin = new DynoVec3({ value: new THREE.Vector3() });
      const dynoDirection = new DynoVec3({ value: new THREE.Vector3() });
      const dynoDepthBias = new DynoFloat({ value: 1.0 });
      const dynoSort360 = new DynoBool({ value: false });
      const dynoSplats = new DynoPackedSplats();

      const reader = new Readback();
      const doubleSortReader = dynoBlock(
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
          const index2 = mul(index, dynoConst("int", 2));

          const gsplat0 = readPackedSplat(dynoSplats, index2);
          const metric0 = computeSortMetric({ gsplat: gsplat0, ...sortParams });

          const gsplat1 = readPackedSplat(
            dynoSplats,
            add(index2, dynoConst("int", 1)),
          );
          const metric1 = computeSortMetric({ gsplat: gsplat1, ...sortParams });

          const combined = combine({
            vectorType: "vec2",
            x: metric0,
            y: metric1,
          });
          const rgba8 = uintToRgba8(packHalf2x16(combined));
          return { rgba8 };
        },
      );

      const sort32Reader = dynoBlock(
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

          const gsplat = readPackedSplat(dynoSplats, index);
          const metric = computeSortMetric({ gsplat, ...sortParams });
          const rgba8 = uintToRgba8(floatBitsToUint(metric));
          return { rgba8 };
        },
      );

      SparkViewpoint.dynos = {
        dynoSortRadial,
        dynoOrigin,
        dynoDirection,
        dynoDepthBias,
        dynoSort360,
        dynoSplats,
        reader,
        doubleSortReader,
        sort32Reader,
      };
    }
    return SparkViewpoint.dynos;
  }
}

const defineComputeSortMetric = unindent(`
  float computeSort(Gsplat gsplat, bool sortRadial, vec3 sortOrigin, vec3 sortDirection, float sortDepthBias, bool sort360) {
    if (!isGsplatActive(gsplat.flags)) {
      return INFINITY;
    }

    vec3 center = gsplat.center - sortOrigin;
    float biasedDepth = dot(center, sortDirection) + sortDepthBias;
    if (!sort360 && (biasedDepth <= 0.0)) {
      return INFINITY;
    }

    return sortRadial ? length(center) : biasedDepth;
  }
`);

function computeSortMetric({
  gsplat,
  sortRadial,
  sortOrigin,
  sortDirection,
  sortDepthBias,
  sort360,
}: {
  gsplat: DynoVal<typeof Gsplat>;
  sortRadial: DynoVal<"bool">;
  sortOrigin: DynoVal<"vec3">;
  sortDirection: DynoVal<"vec3">;
  sortDepthBias: DynoVal<"float">;
  sort360: DynoVal<"bool">;
}) {
  return dyno({
    inTypes: {
      gsplat: Gsplat,
      sortRadial: "bool",
      sortOrigin: "vec3",
      sortDirection: "vec3",
      sortDepthBias: "float",
      sort360: "bool",
    },
    outTypes: { metric: "float" },
    globals: () => [defineGsplat, defineComputeSortMetric],
    inputs: {
      gsplat,
      sortRadial,
      sortOrigin,
      sortDirection,
      sortDepthBias,
      sort360,
    },
    statements: ({ inputs, outputs }) => {
      const {
        gsplat,
        sortRadial,
        sortOrigin,
        sortDirection,
        sortDepthBias,
        sort360,
      } = inputs;
      return unindentLines(`
        ${outputs.metric} = computeSort(${gsplat}, ${sortRadial}, ${sortOrigin}, ${sortDirection}, ${sortDepthBias}, ${sort360});
      `);
    },
  }).outputs.metric;
}
