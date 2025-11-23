import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import { BatchedSplat } from "./BatchedSplat";
import type { Splat, SplatData } from "./Splat";
import { type SplatWorker, allocWorker, withWorkerCall } from "./SplatWorker";
import { SPLAT_TEX_HEIGHT, SPLAT_TEX_WIDTH } from "./defines";
import { getShaders } from "./shaders";
import { getTextureSize } from "./utils";

/**
 * Specific order of splats. The ordering might not include
 * all splats, indicated by the amount of active splats.
 */
export type SplatOrdering = {
  /**
   * Array of splat indices.
   */
  ordering: Uint32Array;
  /**
   * Number of active splats in this ordering.
   */
  activeSplats: number;
};

export interface SplatSorter {
  sort(
    camera: THREE.Camera,
    splat: Splat,
    renderer: THREE.WebGLRenderer,
    ordering: Uint32Array,
  ): Promise<SplatOrdering>;
}

export type ReadbackSorterOptions = {
  /**
   * Whether to sort splats radially (geometric distance) from the viewpoint (true)
   * or by Z-depth (false). Most scenes are trained with the Z-depth sort metric
   * and will render more accurately at certain viewpoints. However, radial sorting
   * is more stable under viewpoint rotations.
   * @default false
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
  /**
   * Set this to true to sort with float32 precision with two-pass sort.
   * @default true
   */
  sort32?: boolean;
};

export class ReadbackSplatSorter implements SplatSorter {
  sortRadial: boolean;
  depthBias: number;
  sort360: boolean;
  sort32: boolean;

  private capacity = 0;
  private target?: THREE.WebGLArrayRenderTarget;
  private readonly readbackBufferPool: ReadbackBufferPool;

  private readonly material: THREE.RawShaderMaterial;

  constructor(options: ReadbackSorterOptions = {}) {
    this.sortRadial = options.sortRadial ?? false;
    this.depthBias = options.depthBias ?? 1.0;
    this.sort360 = options.sort360 ?? false;
    this.sort32 = options.sort32 ?? false;

    this.readbackBufferPool = new ReadbackBufferPool();
    this.material = ReadbackSplatSorter.createMaterial();
  }

  async sort(
    camera: THREE.Camera,
    splat: Splat,
    renderer: THREE.WebGLRenderer,
    ordering: Uint32Array,
  ): Promise<SplatOrdering> {
    // Read the depth for each splat
    const splatData = splat.splatData;
    const maxSplats = splatData.maxSplats;
    const numSplats = splatData.numSplats;

    // Render
    const count = this.sort32 ? numSplats : numSplats / 2;
    const readbackBuffer = await this.ensureCapacity(count);
    const readback = this.sort32
      ? readbackBuffer.readback32
      : readbackBuffer.readback16;

    const renderState = this.saveRenderState(renderer);

    const material = this.material;
    splatData.setupMaterial(material);
    material.uniforms.sortRadial.value = this.sortRadial;
    material.uniforms.sortDepthBias.value = this.depthBias;
    material.uniforms.sort360.value = this.sort360;
    material.uniforms.splatModelViewMatrix.value.multiplyMatrices(
      camera.matrixWorldInverse,
      splat.matrixWorld,
    );
    material.defines.SORT32 = this.sort32;

    this.render(renderer, count, material);
    const promise = this.read(renderer, count, readback);

    this.resetRenderState(renderer, renderState);

    await promise;

    // Perform sorting
    const rpcName = this.sort32 ? "sort32Splats" : "sortDoubleSplats";
    const result = await withWorkerCall(rpcName, {
      maxSplats,
      numSplats,
      readback: readback as Uint16Array<ArrayBuffer>, // FIXME: type depends on RPC method
      ordering,
    });

    // Restore transferred array readback buffers
    if (result.readback instanceof Uint16Array) {
      readbackBuffer.readback16 = result.readback;
    } else {
      readbackBuffer.readback32 = result.readback;
    }
    readbackBuffer.buffer = result.readback.buffer;
    this.readbackBufferPool.free(readbackBuffer);

    return { ordering: result.ordering, activeSplats: result.activeSplats };
  }

  dispose() {
    if (this.target) {
      this.target.dispose();
      this.target = undefined;
    }
  }

  // Ensure our render target is large enough for the readback of capacity indices.
  private async ensureCapacity(capacity: number): Promise<ReadbackBuffer> {
    const { width, height, depth, maxSplats } = getTextureSize(capacity);
    if (!this.target || maxSplats > this.capacity) {
      this.dispose();
      this.capacity = maxSplats;

      // The only portable readback format for WebGL2 is RGBA8
      this.target = new THREE.WebGLArrayRenderTarget(width, height, depth, {
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
        magFilter: THREE.NearestFilter,
        minFilter: THREE.NearestFilter,
      });
      this.target.texture.format = THREE.RGBAFormat;
      this.target.texture.type = THREE.UnsignedByteType;
      this.target.texture.internalFormat = "RGBA8";
      this.target.scissorTest = true;
    }

    const byteLength = this.target.width * this.target.height * 4;
    const readbackBuffer = await this.readbackBufferPool.alloc(byteLength);
    return readbackBuffer;
  }

  private saveRenderState(renderer: THREE.WebGLRenderer) {
    return {
      currentRenderTarget: renderer.getRenderTarget(),
      xrEnabled: renderer.xr.enabled,
      autoClear: renderer.autoClear,
    };
  }

  private resetRenderState(
    renderer: THREE.WebGLRenderer,
    state: {
      currentRenderTarget: THREE.WebGLRenderTarget | null;
      xrEnabled: boolean;
      autoClear: boolean;
    },
  ) {
    renderer.setRenderTarget(state.currentRenderTarget);
    renderer.xr.enabled = state.xrEnabled;
    renderer.autoClear = state.autoClear;
  }

  private render(
    renderer: THREE.WebGLRenderer,
    count: number,
    material: THREE.RawShaderMaterial,
  ) {
    if (!this.target) {
      throw new Error("No target");
    }

    ReadbackSplatSorter.fullScreenQuad.material = material;

    // Run the program in "layer" chunks, in horizontal row ranges,
    // that cover the total count of indices.
    const layerSize = SPLAT_TEX_WIDTH * SPLAT_TEX_HEIGHT;
    material.uniforms.targetBase.value = 0;
    material.uniforms.targetCount.value = count;
    let baseIndex = 0;

    // Keep generating layers until completed count items
    while (baseIndex < count) {
      const layer = Math.floor(baseIndex / layerSize);
      const layerBase = layer * layerSize;
      const layerYEnd = Math.min(
        SPLAT_TEX_HEIGHT,
        Math.ceil((count - layerBase) / SPLAT_TEX_WIDTH),
      );
      material.uniforms.targetLayer.value = layer;

      // Render the desired portion of the layer
      this.target.scissor.set(0, 0, SPLAT_TEX_WIDTH, layerYEnd);
      renderer.setRenderTarget(this.target, layer);
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      ReadbackSplatSorter.fullScreenQuad.render(renderer);

      baseIndex += SPLAT_TEX_WIDTH * layerYEnd;
    }
  }

  private async read<B extends Uint16Array | Uint32Array>(
    renderer: THREE.WebGLRenderer,
    count: number,
    readback: B,
  ): Promise<B> {
    if (!renderer) {
      throw new Error("No renderer");
    }
    if (!this.target) {
      throw new Error("No target");
    }

    const roundedCount = Math.ceil(count / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    if (readback.byteLength < roundedCount * 4) {
      throw new Error(
        `Readback buffer too small: ${readback.byteLength} < ${roundedCount * 4}`,
      );
    }
    const readbackUint8 = new Uint8Array(
      readback instanceof ArrayBuffer ? readback : readback.buffer,
    );

    // We can only read back one 2D array layer of pixels at a time,
    // so loop through them, initiate the readback, and collect the
    // completion promises.

    const layerSize = SPLAT_TEX_WIDTH * SPLAT_TEX_HEIGHT;
    let baseIndex = 0;
    const promises = [];

    while (baseIndex < count) {
      const layer = Math.floor(baseIndex / layerSize);
      const layerBase = layer * layerSize;
      const layerYEnd = Math.min(
        SPLAT_TEX_HEIGHT,
        Math.ceil((count - layerBase) / SPLAT_TEX_WIDTH),
      );

      renderer.setRenderTarget(this.target, layer);

      // Compute the subarray that this layer of readback corresponds to
      const readbackSize = SPLAT_TEX_WIDTH * layerYEnd * 4;
      const subReadback = readbackUint8.subarray(
        layerBase * 4,
        layerBase * 4 + readbackSize,
      );
      const promise = renderer?.readRenderTargetPixelsAsync(
        this.target,
        0,
        0,
        SPLAT_TEX_WIDTH,
        layerYEnd,
        subReadback,
      );
      promises.push(promise);

      baseIndex += SPLAT_TEX_WIDTH * layerYEnd;
    }
    return Promise.all(promises).then(() => readback);
  }

  private static createMaterial() {
    const shaders = getShaders();
    const material = new THREE.RawShaderMaterial({
      name: "SplatDistanceShader",
      glslVersion: "300 es",
      uniforms: {
        targetBase: { value: 0 },
        targetCount: { value: 0 },
        targetLayer: { value: 0 },
        // Note: this modelViewMatrix is named differently to avoid Three.js
        //       populating it with the MVP of the fullscreen quad.
        splatModelViewMatrix: { value: new THREE.Matrix4() },
        sortRadial: { value: false },
        sortDepthBias: { value: 1.0 },
        sort360: { value: false },
      },
      vertexShader: shaders.identityVertex,
      fragmentShader: shaders.splatDistanceFragment,
    });

    return material;
  }

  static fullScreenQuad = new FullScreenQuad(
    new THREE.RawShaderMaterial({ visible: false }),
  );
}

type ReadbackBuffer = {
  buffer: ArrayBuffer;
  readback16: Uint16Array<ArrayBuffer>;
  readback32: Uint32Array<ArrayBuffer>;
};

export class ReadbackBufferPool {
  private items: Array<ReadbackBuffer> = [];

  async alloc(byteLength: number): Promise<ReadbackBuffer> {
    const item = this.allocInternal();
    if (item.buffer.byteLength < byteLength) {
      item.buffer = item.buffer.transfer(byteLength);
      item.readback16 = new Uint16Array(item.buffer);
      item.readback32 = new Uint32Array(item.buffer);
    }
    return item;
  }

  free(item: ReadbackBuffer) {
    this.items.push(item);
  }

  private allocInternal() {
    const item = this.items.pop();
    if (item) {
      return item;
    }
    const buffer = new ArrayBuffer();
    return {
      buffer,
      readback16: new Uint16Array(buffer),
      readback32: new Uint32Array(buffer),
    };
  }
}

const tempV3 = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();

/**
 * CPU based sorting solution that supports rigid transforms of splats.
 */
export class CpuSplatSorter implements SplatSorter {
  /**
   * Private splat worker, kept around as local worker memory is used to retain splat center data.
   */
  private worker?: SplatWorker;
  private workerPromise: Promise<void>;

  private centersUploaded = false;

  constructor() {
    this.workerPromise = allocWorker().then((worker) => {
      this.worker = worker;
    });
  }

  async sort(
    camera: THREE.Camera,
    splat: Splat,
    renderer: THREE.WebGLRenderer,
    ordering: Uint32Array,
  ): Promise<SplatOrdering> {
    await this.workerPromise;
    if (!this.worker) {
      throw new Error("Unreachable");
    }

    let splatCenters: Float32Array<ArrayBuffer> | undefined = undefined;
    if (!this.centersUploaded) {
      const centers = new Float32Array(splat.splatData.numSplats * 3);
      splat.splatData.iterateCenters((i, x, y, z) => {
        centers[i * 3 + 0] = x;
        centers[i * 3 + 1] = y;
        centers[i * 3 + 2] = z;
      });
      splatCenters = centers;
      this.centersUploaded = true;
    }

    tempMatrix.copy(camera.matrixWorld);
    const viewOrigin = camera.getWorldPosition(tempV3).toArray();
    const viewDir = tempV3
      .set(0, 0, -1)
      .transformDirection(tempMatrix)
      .toArray();

    const result = this.worker.call("sortSplatsCpu", {
      centers: splatCenters,
      transforms: splat.getTransformRanges(),
      viewOrigin,
      viewDir,
      ordering,
    });
    return result;
  }
}
