import * as THREE from "three";

import { PackedSplats } from "./PackedSplats";
import type {
  GsplatGenerator,
  SplatGenerator,
  SplatModifier,
} from "./SplatGenerator";

// SplatAccumulator helps manage the generation of splats from multiple
// SplatGenerators, keeping track of the splat mapping, coordinate system,
// and reference count.

// A GeneratorMapping describes a Gsplat range that was generated, including
// which generator and its version number.
export type GeneratorMapping = {
  node: SplatGenerator;
  generator?: GsplatGenerator;
  version: number;
  base: number;
  count: number;
};

export class SplatAccumulator {
  splats = new PackedSplats();
  // The transform from Accumulator coordinate system to world coordinates.
  toWorld = new THREE.Matrix4();
  // An array of all Gsplat mappings that were used for generation
  mapping: GeneratorMapping[] = [];
  // Number of SparkViewpoints (or other) that reference this accumulator, used
  // to figure out when it can be recycled for use
  refCount = 0;

  // Incremented every time the splats are updated/generated.
  splatsVersion = -1;
  // Incremented every time the splat mapping/layout is updated.
  // Splat sort order can be reused between equivalent mapping versions.
  mappingVersion = -1;

  ensureGenerate(maxSplats: number) {
    if (this.splats.ensureGenerate(maxSplats)) {
      // If we had to resize our PackedSplats then clear all previous mappings
      this.mapping = [];
    }
  }

  // Generate all Gsplats from an array of generators
  generateSplats({
    renderer,
    modifier,
    generators,
    forceUpdate,
    originToWorld,
  }: {
    renderer: THREE.WebGLRenderer;
    modifier: SplatModifier;
    generators: GeneratorMapping[];
    forceUpdate?: boolean;
    originToWorld: THREE.Matrix4;
  }) {
    // Create a lookup from last SplatGenerator
    const mapping = this.mapping.reduce((map, record) => {
      map.set(record.node, record);
      return map;
    }, new Map<SplatGenerator, GeneratorMapping>());

    // Run generators that are different from existing mapping
    let updated = 0;
    let numSplats = 0;
    for (const { node, generator, version, base, count } of generators) {
      const current = mapping.get(node);
      if (
        forceUpdate ||
        generator !== current?.generator ||
        version !== current?.version ||
        base !== current?.base ||
        count !== current?.count
      ) {
        // Something is different from before so we should generate these Gsplats
        if (generator && count > 0) {
          const modGenerator = modifier.apply(generator);
          try {
            this.splats.generate({
              generator: modGenerator,
              base,
              count,
              renderer,
            });
          } catch (error) {
            node.generator = undefined;
            node.generatorError = error;
          }
          updated += 1;
        }
      }
      numSplats = Math.max(numSplats, base + count);
    }

    this.splats.numSplats = numSplats;
    this.toWorld.copy(originToWorld);
    this.mapping = generators;
    return updated !== 0;
  }

  // Check if this accumulator has exactly the same generator mapping as
  // the previous one. If so, we can reuse the Gsplat sort order.
  hasCorrespondence(other: SplatAccumulator) {
    if (this.mapping.length !== other.mapping.length) {
      return false;
    }
    return this.mapping.every(({ node, base, count }, i) => {
      const {
        node: otherNode,
        base: otherBase,
        count: otherCount,
      } = other.mapping[i];
      return node === otherNode && base === otherBase && count === otherCount;
    });
  }
}
