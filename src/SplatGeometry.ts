import * as THREE from "three";

// SplatGeometry is an internal class used by SparkRenderer to render a collection
// of Gsplats in a single draw call by extending THREE.InstancedBufferGeometry.
// Each Gsplat is drawn as two triangles, with the order of the Gsplats determined
// by the instance attribute "ordering".

export class SplatGeometry extends THREE.InstancedBufferGeometry {
  ordering: Uint32Array;
  attribute: THREE.InstancedBufferAttribute;

  constructor(ordering: Uint32Array, activeSplats: number) {
    super();

    this.ordering = ordering;

    this.setAttribute("position", new THREE.BufferAttribute(QUAD_VERTICES, 3));
    this.setIndex(new THREE.BufferAttribute(QUAD_INDICES, 1));

    // Hack to work around Three.js
    // @ts-ignore
    this._maxInstanceCount = ordering.length;
    this.instanceCount = activeSplats;

    this.attribute = new THREE.InstancedBufferAttribute(ordering, 1, false, 1);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    this.setAttribute("splatIndex", this.attribute);
  }

  update(ordering: Uint32Array, activeSplats: number) {
    this.ordering = ordering;
    this.attribute.array = ordering;
    this.instanceCount = activeSplats;
    this.attribute.addUpdateRange(0, activeSplats);
    this.attribute.needsUpdate = true;
  }
}

// Each instance draws to triangles covering a quad over coords (-1,-1,0)..(1,1,0)
const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
]);

const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
