import * as THREE from "three";
export declare class OldSplatGeometry extends THREE.InstancedBufferGeometry {
    ordering: Uint32Array;
    attribute: THREE.InstancedBufferAttribute;
    constructor(ordering: Uint32Array, activeSplats: number);
    update(ordering: Uint32Array, activeSplats: number): void;
}
