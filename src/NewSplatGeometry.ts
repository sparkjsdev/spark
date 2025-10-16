import * as THREE from "three";

// SplatGeometry is an internal class used by SparkRenderer to render a collection
// of Gsplats in a single draw call by extending THREE.InstancedBufferGeometry.
// Each Gsplat is drawn as two triangles, with the order of the Gsplats determined
// by a texture lookup via gl_InstanceID.

export class NewSplatGeometry extends THREE.InstancedBufferGeometry {
  constructor() {
    super();
    this.setAttribute("position", new THREE.BufferAttribute(QUAD_VERTICES, 3));
    this.setIndex(new THREE.BufferAttribute(QUAD_INDICES, 1));
  }
}

// Each instance draws to triangles covering a quad over coords (-1,-1,0)..(1,1,0)
const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
]);

const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
