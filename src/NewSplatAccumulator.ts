import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import type { GeneratorMapping } from "./SplatAccumulator";
import { SplatEdit } from "./SplatEdit";
import { type GsplatGenerator, SplatGenerator } from "./SplatGenerator";
import { SplatMesh } from "./SplatMesh";
import { SPLAT_TEX_HEIGHT, SPLAT_TEX_WIDTH } from "./defines";
import {
  DynoBool,
  DynoProgram,
  DynoProgramTemplate,
  DynoVec3,
  dynoBlock,
  outputExtendedSplat,
  outputSplatDepth,
} from "./dyno";
import computeUvec4x2Vec4Template from "./shaders/computeUvec4x2_Vec4.glsl";
import { getTextureSize, threeMrtArray } from "./utils";

export class NewSplatAccumulator {
  time = 0;
  deltaTime = 0;
  viewToWorld = new THREE.Matrix4();
  viewCenterUniform: DynoVec3<THREE.Vector3>;
  viewDirUniform: DynoVec3<THREE.Vector3>;
  sortRadialUniform: DynoBool<string>;
  maxSplats = 0;
  numSplats = 0;
  target: THREE.WebGLArrayRenderTarget | null = null;
  mapping: GeneratorMapping[] = [];
  version = -1;
  mappingVersion = -1;

  constructor() {
    if (!threeMrtArray) {
      throw new Error("Spark requires THREE.js r179 or above");
    }
    this.viewCenterUniform = new DynoVec3({ value: new THREE.Vector3() });
    this.viewDirUniform = new DynoVec3({ value: new THREE.Vector3() });
    this.sortRadialUniform = new DynoBool({ value: true });
  }

  dispose() {
    if (this.target) {
      this.target.dispose();
      this.target = null;
    }
  }

  // Returns a THREE.DataArrayTexture representing the NewSplatAccumulator
  // content as 2 x Uint32x4 data array textures (2048 x 2048 x 2048 in size)
  getTextures(): THREE.DataArrayTexture[] {
    if (this.target) {
      return this.target.textures;
    }
    return NewSplatAccumulator.emptyTextures;
  }

  static emptyTexture = (() => {
    const { width, height, depth, maxSplats } = getTextureSize(1);
    const emptyArray = new Uint32Array(maxSplats * 4);
    const texture = new THREE.DataArrayTexture(
      emptyArray,
      width,
      height,
      depth,
    );
    texture.format = THREE.RGBAIntegerFormat;
    texture.type = THREE.UnsignedIntType;
    texture.internalFormat = "RGBA32UI";
    texture.needsUpdate = true;
    return texture;
  })();

  static emptyTextures = (() => {
    return [NewSplatAccumulator.emptyTexture, NewSplatAccumulator.emptyTexture];
  })();

  // Given an array of splatCounts (.numSplats for each
  // SplatGenerator/SplatMesh in the scene), compute a
  // "mapping layout" in the composite array of generated outputs.
  generateMapping(splatCounts: number[]): {
    maxSplats: number;
    mapping: { base: number; count: number }[];
  } {
    let maxSplats = 0;
    const mapping = splatCounts.map((numSplats) => {
      const base = maxSplats;
      // Generation happens in horizontal row chunks, so round up to full width
      const rounded = Math.ceil(numSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
      maxSplats += rounded;
      return { base, count: numSplats };
    });
    return { maxSplats, mapping };
  }

  // Ensures our NewSplatAccumulator.target render target has enough space
  // to generate maxSplats total Gsplats, and reallocate if not large enough.
  ensureGenerate({ maxSplats }: { maxSplats: number }) {
    if (this.target && (maxSplats ?? 1) <= this.maxSplats) {
      return false;
    }
    this.dispose();

    // The packed Gsplats are stored in a 2D array texture of max size
    // 2048 x 2048 x 2048, one RGBA32UI pixel = 4 uint32 = one Gsplat
    const textureSize = getTextureSize(maxSplats ?? 1);
    const { width, height, depth } = textureSize;
    this.maxSplats = textureSize.maxSplats;
    this.target = new THREE.WebGLArrayRenderTarget(width, height, depth, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      format: THREE.RGBAIntegerFormat,
      type: THREE.UnsignedIntType,
      // format: THREE.RGBAFormat,
      // type: THREE.UnsignedByteType,
    });
    // this.target.texture.internalFormat = "RGBA32UI";
    this.target.scissorTest = true;

    const target2 = this.target.texture.clone();
    // target2.format = THREE.RGBAIntegerFormat;
    // target2.type = THREE.UnsignedIntType;
    // target2.internalFormat = "RGBA32UI";
    const target3 = this.target.texture.clone();
    target3.format = THREE.RGBAFormat;
    target3.type = THREE.UnsignedByteType;
    target3.internalFormat = "RGBA8";
    // target3.format = THREE.RGBAIntegerFormat;
    // target3.type = THREE.UnsignedIntType;
    // target3.internalFormat = "RGBA32UI";

    this.target.textures = [this.target.texture, target2, target3];
    // this.target.textures = [target3, this.target.texture, target2];

    return true;
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

  // Get a program and THREE.RawShaderMaterial for a given GsplatGenerator,
  // generating it if necessary and caching the result.
  prepareProgramMaterial(generator: GsplatGenerator) {
    let program = NewSplatAccumulator.generatorProgram.get(generator);
    if (!program) {
      const graph = dynoBlock(
        { index: "int" },
        {},
        ({ index }, _outputs, { roots }) => {
          generator.inputs.index = index;
          const output = outputExtendedSplat(generator.outputs.gsplat);
          const outputDepth = outputSplatDepth(
            generator.outputs.gsplat,
            this.viewCenterUniform,
            this.viewDirUniform,
            this.sortRadialUniform,
          );
          roots.push(output, outputDepth);
          return undefined;
        },
      );
      program = new DynoProgram({
        graph,
        inputs: { index: "index" },
        outputs: {},
        template: NewSplatAccumulator.programTemplate,
      });
    }
    Object.assign(program.uniforms, {
      targetLayer: { value: 0 },
      targetBase: { value: 0 },
      targetCount: { value: 0 },
    });
    NewSplatAccumulator.generatorProgram.set(generator, program);

    const material = program.prepareMaterial();
    NewSplatAccumulator.fullScreenQuad.material = material;
    return { program, material };
  }

  static programTemplate = new DynoProgramTemplate(computeUvec4x2Vec4Template);
  static generatorProgram = new Map<GsplatGenerator, DynoProgram>();
  static fullScreenQuad = new FullScreenQuad(
    new THREE.RawShaderMaterial({ visible: false }),
  );

  generate({
    generator,
    base,
    count,
    renderer,
  }: {
    generator: GsplatGenerator;
    base: number;
    count: number;
    renderer: THREE.WebGLRenderer;
  }) {
    if (!this.target) {
      throw new Error("Target must be initialized with ensureGenerate");
    }
    if (base + count > this.maxSplats) {
      throw new Error("Base + count exceeds maxSplats");
    }

    const { program, material } = this.prepareProgramMaterial(generator);
    program.update();

    const renderState = this.saveRenderState(renderer);

    // Generate the Gsplats in "layer" chunks, in horizontal row ranges,
    // that cover the total count of Gsplats.
    const nextBase =
      Math.ceil((base + count) / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    const layerSize = SPLAT_TEX_WIDTH * SPLAT_TEX_HEIGHT;
    material.uniforms.targetBase.value = base;
    material.uniforms.targetCount.value = count;

    // Keep generating layers until we've reached the next generation's base
    while (base < nextBase) {
      const layer = Math.floor(base / layerSize);
      material.uniforms.targetLayer.value = layer;

      const layerBase = layer * layerSize;
      const layerYStart = Math.floor((base - layerBase) / SPLAT_TEX_WIDTH);
      const layerYEnd = Math.min(
        SPLAT_TEX_HEIGHT,
        Math.ceil((nextBase - layerBase) / SPLAT_TEX_WIDTH),
      );

      // Render the desired portion of the layer
      this.target.scissor.set(
        0,
        layerYStart,
        SPLAT_TEX_WIDTH,
        layerYEnd - layerYStart,
      );
      renderer.setRenderTarget(this.target, layer);
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      NewSplatAccumulator.fullScreenQuad.render(renderer);

      base += SPLAT_TEX_WIDTH * (layerYEnd - layerYStart);
    }

    this.resetRenderState(renderer, renderState);
    return { nextBase };
  }

  prepareGenerate({
    renderer,
    scene,
    time,
    camera,
    sortRadial,
    renderSize,
    previous,
    lodInstances,
  }: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    time: number;
    camera: THREE.Camera;
    sortRadial: boolean;
    renderSize: THREE.Vector2;
    previous: NewSplatAccumulator;
    lodInstances: Map<
      SplatMesh,
      { numSplats: number; texture: THREE.DataTexture }
    >;
  }) {
    this.viewToWorld.copy(camera.matrixWorld);

    camera.getWorldPosition(this.viewCenterUniform.value);
    camera.getWorldDirection(this.viewDirUniform.value);
    this.sortRadialUniform.value = sortRadial;

    this.time = time;
    this.deltaTime = time - previous.time;

    const allGenerators: SplatGenerator[] = [];
    scene.traverse((node) => {
      if (node instanceof SplatGenerator) {
        if (!camera.layers || camera.layers.test(node.layers)) {
          allGenerators.push(node);
        }
      }
    });

    const globalEditsSet = new Set<SplatEdit>();
    scene.traverseVisible((node) => {
      if (node instanceof SplatEdit) {
        let ancestor = node.parent;
        while (ancestor != null && !(ancestor instanceof SplatMesh)) {
          ancestor = ancestor.parent;
        }
        if (ancestor == null) {
          // Not part of a SplatMesh so it's a global edit
          globalEditsSet.add(node);
        }
      }
    });
    const globalEdits = Array.from(globalEditsSet);

    for (const object of allGenerators) {
      try {
        object.frameUpdate?.({
          renderer,
          object,
          time: this.time,
          deltaTime: this.deltaTime,
          viewToWorld: this.viewToWorld,
          camera,
          renderSize,
          globalEdits,
          lodIndices:
            object instanceof SplatMesh ? lodInstances.get(object) : undefined,
        });
      } catch (error) {
        console.error("frameUpdate error", error);
        object.generator = undefined;
        object.generatorError = error;
      }
    }

    const visibleGenerators: SplatGenerator[] = [];
    scene.traverseVisible((node) => {
      if (node instanceof SplatGenerator) {
        if (!camera.layers || camera.layers.test(node.layers)) {
          visibleGenerators.push(node);
        }
      }
    });

    const splatCounts = visibleGenerators.map(
      (generator) => generator.numSplats,
    );
    const { maxSplats, mapping: baseCounts } =
      this.generateMapping(splatCounts);

    const previousMappings = previous.mapping.reduce((mappings, mapping) => {
      mappings.set(mapping.node, mapping);
      return mappings;
    }, new Map<SplatGenerator, GeneratorMapping>());

    this.mapping = [];
    this.numSplats = 0;

    baseCounts.forEach(({ base, count }, index) => {
      const node = visibleGenerators[index];
      const previousNode = previousMappings.get(node);
      if (previousNode && previousNode.count !== node.numSplats) {
        node.updateVersion();
        node.updateMappingVersion();
      }

      const generator = node.generator;
      if (generator && count > 0) {
        const { version, mappingVersion } = node;
        this.mapping.push({
          node,
          generator,
          version,
          mappingVersion,
          base,
          count,
        });
        this.numSplats = Math.max(this.numSplats, base + count);
      }
    });
    // const sameMapping = previous.hasCorrespondence(this.mapping);
    const { splatsUpdated, mappingUpdated } = previous.checkVersions(
      this.mapping,
    );
    this.version = previous.version + (splatsUpdated ? 1 : 0);
    this.mappingVersion = previous.mappingVersion + (mappingUpdated ? 1 : 0);

    return {
      sameMapping: !mappingUpdated,
      version: this.version,
      mappingVersion: this.mappingVersion,
      visibleGenerators,
      generate: () => {
        this.ensureGenerate({ maxSplats });

        for (const { node, base, count } of this.mapping) {
          const generator = node.generator;
          if (generator && count > 0) {
            this.generate({ generator, base, count, renderer });
          }
        }
      },
    };
  }

  // // Check if this accumulator has exactly the same generator mapping as
  // // the previous one. If so, we can reuse the Gsplat sort order.
  // hasCorrespondence(mapping: GeneratorMapping[]) {
  //   if (this.mapping.length !== mapping.length) {
  //     return false;
  //   }
  //   return this.mapping.every(({ node, mappingVersion, base, count }, i) => {
  //     const {
  //       node: otherNode,
  //       base: otherBase,
  //       count: otherCount,
  //       mappingVersion: otherMappingVersion,
  //     } = mapping[i];
  //     return (
  //       node === otherNode &&
  //       base === otherBase &&
  //       count === otherCount &&
  //       mappingVersion === otherMappingVersion
  //     );
  //   });
  // }

  // Check if this accumulator has exactly the same generator mapping as
  // the previous one. If so, we can reuse the Gsplat sort order.
  checkVersions(otherMapping: GeneratorMapping[]) {
    if (this.mapping.length !== otherMapping.length) {
      return { splatsUpdated: true, mappingUpdated: true };
    }
    const mappingUpdated = this.mapping.some((item, i) => {
      const other = otherMapping[i];
      return (
        item.node !== other.node ||
        item.base !== other.base ||
        item.count !== other.count ||
        item.mappingVersion !== other.mappingVersion
      );
    });
    if (mappingUpdated) {
      return { splatsUpdated: true, mappingUpdated: true };
    }
    const splatsUpdated = this.mapping.some((item, i) => {
      return item.version !== otherMapping[i].version;
    });
    return { splatsUpdated, mappingUpdated };
  }
}
