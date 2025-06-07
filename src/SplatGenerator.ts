import * as THREE from "three";
import type { SplatEdit } from "./SplatEdit";
import {
  type Dyno,
  DynoFloat,
  type DynoVal,
  DynoVec3,
  DynoVec4,
  Gsplat,
  dynoBlock,
  transformDir,
  transformGsplat,
  transformPos,
} from "./dyno";

// A GsplatGenerator is a dyno program that maps an index to a Gsplat's properties

export type GsplatGenerator = Dyno<{ index: "int" }, { gsplat: typeof Gsplat }>;

// A GsplatModifier is a dyno program that inputs a Gsplat, modifies, and outputs it

export type GsplatModifier = Dyno<
  { gsplat: typeof Gsplat },
  { gsplat: typeof Gsplat }
>;

// A SplatModifier is a utility class to apply a GsplatModifier to
// a GsplatGenerator pipeline, caching the combined result for efficiency.

export class SplatModifier {
  modifier: GsplatModifier;
  cache: Map<GsplatGenerator, GsplatGenerator>;

  constructor(modifier: GsplatModifier) {
    this.modifier = modifier;
    this.cache = new Map();
  }

  apply(generator: GsplatGenerator): GsplatGenerator {
    let modified = this.cache.get(generator);
    if (!modified) {
      modified = dynoBlock(
        { index: "int" },
        { gsplat: Gsplat },
        ({ index }) => {
          const { gsplat } = generator.apply({ index });
          return this.modifier.apply({ gsplat });
        },
      );
      this.cache.set(generator, modified);
    }
    return modified;
  }
}

// A SplatTransformer is a utility class to apply a transform to a Gsplat
// via a scale, rotation, and translation. Scale is a single float because
// anisotropic scaling of Gsplats is not supported.

export class SplatTransformer {
  scale: DynoFloat;
  rotate: DynoVec4<THREE.Quaternion>;
  translate: DynoVec3<THREE.Vector3>;

  // Create the dyno uniforms that parameterize the transform, setting them
  // to initial values that are different from any valid transform.
  constructor() {
    this.scale = new DynoFloat({ value: Number.NEGATIVE_INFINITY });
    this.rotate = new DynoVec4({
      value: new THREE.Quaternion(
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      ),
    });
    this.translate = new DynoVec3({
      value: new THREE.Vector3(
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      ),
    });
  }

  // Apply the transform to a Vec3 position in a dyno program.
  apply(position: DynoVal<"vec3">): DynoVal<"vec3"> {
    return transformPos(position, {
      scale: this.scale,
      rotate: this.rotate,
      translate: this.translate,
    });
  }

  applyDir(dir: DynoVal<"vec3">): DynoVal<"vec3"> {
    return transformDir(dir, {
      rotate: this.rotate,
    });
  }

  // Apply the transform to a Gsplat in a dyno program.
  applyGsplat(gsplat: DynoVal<typeof Gsplat>): DynoVal<typeof Gsplat> {
    return transformGsplat(gsplat, {
      scale: this.scale,
      rotate: this.rotate,
      translate: this.translate,
    });
  }

  // Update the uniforms to match the given transform matrix.
  updateFromMatrix(transform: THREE.Matrix4) {
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    transform.decompose(position, quaternion, scale);
    const newScale = (scale.x + scale.y + scale.z) / 3;

    let updated = false;
    if (newScale !== this.scale.value) {
      this.scale.value = newScale;
      updated = true;
    }
    if (!position.equals(this.translate.value)) {
      this.translate.value.copy(position);
      updated = true;
    }
    if (!quaternion.equals(this.rotate.value)) {
      this.rotate.value.copy(quaternion);
      updated = true;
    }
    return updated;
  }

  // Update this transform to match the object's to-world transform.
  update(object: THREE.Object3D): boolean {
    object.updateMatrixWorld();
    return this.updateFromMatrix(object.matrixWorld);
  }
}

// SplatGenerator is an Object3D that can be placed anywhere in the scene
// to generate Gsplats into the world for SparkRenderer. All Gsplats from
// SplatGenerators across the scene will be accumulated into a single
// SplatAccumulator, which are sorted and rendered together.
//
// Each SplatGenerator has two main properties:
// - numSplats: the number of Gsplats to generate
// - generator: a GsplatGenerator dyno program that maps a splat index
//   to a Gsplat's properties
// Each of these properties can be changed at anytime, however changing
// numSplats means we no longer have a correspondence between Gsplats
// in successive frames, meaning we can't reuse the previous Gsplat sort
// order. Similarly, changing the generator requires re-generating the
// shader program, which will trigger a GPU shader compilation the first
// time (possibly a perceptible "hickup" in the framerate) but is cached
// subsequence times if the generator is the same as one that was used previously.
//
// A SplatGenerator also has a custom frameUpdate function that is called
// on each execution, allowing you to update uniforms or other parameters that
// affect the generation. If the Gsplats are changed, you must call
// updateVersion() (alternatively, set needsUpdate to true) to trigger a
// re-generation of the Gsplats for this SplatGenerator.

export class SplatGenerator extends THREE.Object3D {
  numSplats: number;
  generator?: GsplatGenerator;
  generatorError?: unknown;
  frameUpdate?: ({
    object,
    time,
    deltaTime,
    viewToWorld,
    globalEdits,
  }: {
    object: SplatGenerator;
    time: number;
    deltaTime: number;
    viewToWorld: THREE.Matrix4;
    globalEdits: SplatEdit[];
  }) => void;
  version: number;

  constructor({
    numSplats,
    generator,
    construct,
    update,
  }: {
    numSplats?: number;
    generator?: GsplatGenerator;
    construct?: (object: SplatGenerator) => {
      generator?: GsplatGenerator;
      numSplats?: number;
      frameUpdate?: (object: SplatGenerator) => void;
    };
    update?: ({
      object,
      time,
      deltaTime,
      viewToWorld,
      globalEdits,
    }: {
      object: SplatGenerator;
      time: number;
      deltaTime: number;
      viewToWorld: THREE.Matrix4;
      globalEdits: SplatEdit[];
    }) => void;
  }) {
    super();

    this.numSplats = numSplats ?? 0;
    this.generator = generator;
    this.frameUpdate = update;
    this.version = 0;

    if (construct) {
      const constructed = construct(this);
      // If we returned something, update our properties
      Object.assign(this, constructed);
    }
  }

  updateVersion() {
    this.version += 1;
  }

  set needsUpdate(value: boolean) {
    if (value) {
      this.updateVersion();
    }
  }
}
