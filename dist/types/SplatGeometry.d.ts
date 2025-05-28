import * as THREE from "three";
export declare class SplatGeometry extends THREE.InstancedBufferGeometry {
    ordering: Uint32Array;
    attribute: THREE.InstancedBufferAttribute;
    constructor(ordering: Uint32Array, activeSplats: number);
    update(ordering: Uint32Array, activeSplats: number): void;
}
