import * as THREE from "three";
import type { SplatData } from "./Splat";

/**
 * Dedicated geometry for rendering splats using instancing.
 * Each splat is drawn as two triangles, with the order determined by the
 * instance attribute "splatIndex".
 */
export class SplatGeometry extends THREE.InstancedBufferGeometry {
  attribute?: SplatIndexAttribute;

  constructor() {
    super();

    this.setAttribute("position", new THREE.BufferAttribute(QUAD_VERTICES, 3));
    this.setIndex(new THREE.BufferAttribute(QUAD_INDICES, 1));

    this.instanceCount = 0;

    this.boundingSphere = new THREE.Sphere();
    this.boundingBox = new THREE.Box3();
  }

  update(
    renderer: THREE.WebGLRenderer,
    ordering: Uint32Array,
    activeSplats: number,
  ) {
    if (!this.attribute) {
      this.attribute = new SplatIndexAttribute(renderer, ordering);
      this.setAttribute(
        "splatIndex",
        this.attribute as unknown as THREE.InstancedBufferAttribute,
      );
    }

    this.attribute.update(renderer, ordering, activeSplats);
    this.instanceCount = activeSplats;
  }

  updateBounds(splatData: SplatData) {
    if (!this.boundingSphere) {
      this.boundingSphere = new THREE.Sphere();
    }
    if (!this.boundingBox) {
      this.boundingBox = new THREE.Box3();
    }

    // Empty the bounding shapes
    this.boundingSphere.makeEmpty();
    this.boundingBox.makeEmpty();

    // Note: since the sphere is at the origin, simplify the calculation
    //       by only computing the max squared radius of the splats.
    let maxRadiusSquared = 0;
    splatData.iterateCenters((i, x, y, z) => {
      tempV3.set(x, y, z);
      maxRadiusSquared = Math.max(maxRadiusSquared, tempV3.lengthSq());
    });
    const radius = Math.sqrt(maxRadiusSquared);
    this.boundingSphere.radius = radius;

    // Determine the bounding box naively on the sphere
    this.boundingBox.min.set(-radius, -radius, -radius);
    this.boundingBox.max.set(radius, radius, radius);
  }
}

const tempV3 = new THREE.Vector3();

// Each instance draws to triangles covering a quad over coords (-1,-1,0)..(1,1,0)
const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
]);

const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/**
 * Dedicated GLBufferAttribute for the splat index to allow uploading the latest
 * values from the onBeforeRender hook to avoid 1-frame latency on sort results.
 */
export class SplatIndexAttribute extends THREE.GLBufferAttribute {
  public isInstancedBufferAttribute = true;
  public isGLInstancedBufferAttribute = true;
  public meshPerAttribute: number;
  public data: Uint32Array;

  constructor(renderer: THREE.WebGLRenderer, array: Uint32Array) {
    const gl = renderer.getContext();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, array, gl.DYNAMIC_DRAW);
    super(buffer, gl.UNSIGNED_INT, 1, 4, array.length);
    this.meshPerAttribute = 1;
    this.data = array;
  }

  update(renderer: THREE.WebGLRenderer, array: Uint32Array, count: number) {
    this.data = array;

    const gl = renderer.getContext();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, array, 0, count);
  }
}
