import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import { SPLAT_TEX_HEIGHT, SPLAT_TEX_WIDTH } from "./defines";
import { type Dyno, OutputRgba8, dynoBlock } from "./dyno";
import { DynoProgram, DynoProgramTemplate } from "./dyno/program";
import computeVec4Template from "./shaders/computeVec4.glsl";
import { getTextureSize } from "./utils";

// Readback can be used to run a Dyno program that maps an index to a 32-bit
// RGBA8 value, which is the only allowed, portable readback format for WebGL2.
// Using data packing and conversion you can read back any 32-bit value, which
// Spark uses to read back 2 float16 Gsplat distance values per index.

export type Rgba8Readback = Dyno<{ index: "int" }, { rgba8: "vec4" }>;

// Readback can be performed with various typed buffers, making it convenient
// to encode readback data in a variety of formats.

export type ReadbackBuffer =
  | ArrayBuffer
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array;

export class Readback {
  renderer?: THREE.WebGLRenderer;
  target?: THREE.WebGLArrayRenderTarget;
  capacity: number;
  count: number;

  constructor({ renderer }: { renderer?: THREE.WebGLRenderer } = {}) {
    this.renderer = renderer;
    this.capacity = 0;
    this.count = 0;
  }

  dispose() {
    if (this.target) {
      this.target.dispose();
      this.target = undefined;
    }
  }

  // Ensure we have a buffer large enough for the readback of count indices.
  // Pass in previous bufer of the desired type.
  ensureBuffer<B extends ReadbackBuffer>(count: number, buffer: B): B {
    // Readback is performed in a 2D array of pixels, so round up with SPLAT_TEX_WIDTH
    const roundedCount =
      Math.ceil(Math.max(1, count) / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    const bytes = roundedCount * 4;
    if (buffer.byteLength >= bytes) {
      return buffer;
    }

    // Need a larger buffer, create a new one of the same type
    const newBuffer = new ArrayBuffer(bytes);
    if (buffer instanceof ArrayBuffer) {
      return newBuffer as B;
    }

    const ctor = buffer.constructor as { new (arrayBuffer: ArrayBuffer): B };
    return new ctor(newBuffer) as B;
  }

  // Ensure our render target is large enough for the readback of capacity indices.
  ensureCapacity(capacity: number) {
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
  }

  // Get a program and THREE.RawShaderMaterial for a given Rgba8Readback,
  // generating it if necessary and caching the result.
  prepareProgramMaterial(reader: Rgba8Readback): {
    program: DynoProgram;
    material: THREE.RawShaderMaterial;
  } {
    let program = Readback.readbackProgram.get(reader);
    if (!program) {
      const graph = dynoBlock(
        { index: "int" },
        { rgba8: "vec4" },
        ({ index }) => {
          reader.inputs.index = index;
          const rgba8 = new OutputRgba8({ rgba8: reader.outputs.rgba8 });
          return { rgba8 };
        },
      );
      if (!Readback.programTemplate) {
        Readback.programTemplate = new DynoProgramTemplate(computeVec4Template);
      }
      // Create a program from the template and graph
      program = new DynoProgram({
        graph,
        inputs: { index: "index" },
        outputs: { rgba8: "target" },
        template: Readback.programTemplate,
      });
      Object.assign(program.uniforms, {
        targetLayer: { value: 0 },
        targetBase: { value: 0 },
        targetCount: { value: 0 },
      });
      Readback.readbackProgram.set(reader, program);
    }

    const material = program.prepareMaterial();
    Readback.fullScreenQuad.material = material;
    return { program, material };
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

  private process({
    count,
    material,
  }: { count: number; material: THREE.RawShaderMaterial }) {
    const renderer = this.renderer;
    if (!renderer) {
      throw new Error("No renderer");
    }
    if (!this.target) {
      throw new Error("No target");
    }

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
      Readback.fullScreenQuad.render(renderer);

      baseIndex += SPLAT_TEX_WIDTH * layerYEnd;
    }

    this.count = count;
  }

  private async read<B extends ReadbackBuffer>({
    readback,
  }: { readback: B }): Promise<B> {
    const renderer = this.renderer;
    if (!renderer) {
      throw new Error("No renderer");
    }
    if (!this.target) {
      throw new Error("No target");
    }

    const roundedCount =
      Math.ceil(this.count / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
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

    while (baseIndex < this.count) {
      const layer = Math.floor(baseIndex / layerSize);
      const layerBase = layer * layerSize;
      const layerYEnd = Math.min(
        SPLAT_TEX_HEIGHT,
        Math.ceil((this.count - layerBase) / SPLAT_TEX_WIDTH),
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

  // Perform render operation to run the Rgba8Readback program
  // but don't perform the readback yet.
  render({
    reader,
    count,
    renderer,
  }: { reader: Rgba8Readback; count: number; renderer?: THREE.WebGLRenderer }) {
    this.renderer = renderer || this.renderer;
    if (!this.renderer) {
      throw new Error("No renderer");
    }

    this.ensureCapacity(count);

    const { program, material } = this.prepareProgramMaterial(reader);
    program.update();

    const renderState = this.saveRenderState(this.renderer);
    this.process({ count, material });
    this.resetRenderState(this.renderer, renderState);
  }

  // Perform a readback of the render target, returning a buffer of the
  // given type.
  async readback<B extends ReadbackBuffer>({
    readback,
  }: { readback: B }): Promise<B> {
    if (!this.renderer) {
      throw new Error("No renderer");
    }
    const renderState = this.saveRenderState(this.renderer);
    const promise = this.read({ readback });
    this.resetRenderState(this.renderer, renderState);
    return promise;
  }

  // Perform a render and readback operation for the given Rgba8Readback,
  // and readback buffer (call ensureBuffer first).
  async renderReadback<B extends ReadbackBuffer>({
    reader,
    count,
    renderer,
    readback,
  }: {
    reader: Rgba8Readback;
    count: number;
    renderer?: THREE.WebGLRenderer;
    readback: B;
  }): Promise<B> {
    this.renderer = renderer || this.renderer;
    if (!this.renderer) {
      throw new Error("No renderer");
    }

    this.ensureCapacity(count);

    const { program, material } = this.prepareProgramMaterial(reader);
    program.update();

    const renderState = this.saveRenderState(this.renderer);

    // Generate output
    this.process({ count, material });

    // Initiate readback
    const promise = this.read({ readback });

    this.resetRenderState(this.renderer, renderState);
    return promise;
  }

  getTexture(): THREE.DataArrayTexture | undefined {
    return this.target?.texture;
  }

  static programTemplate: DynoProgramTemplate | null = null;

  // Cache for Rgba8Readback programs
  static readbackProgram = new Map<Rgba8Readback, DynoProgram>();

  // Static full-screen quad for pseudo-compute shader rendering
  static fullScreenQuad = new FullScreenQuad(
    new THREE.RawShaderMaterial({ visible: false }),
  );
}
