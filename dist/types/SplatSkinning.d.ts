import { SplatMesh } from './SplatMesh';
import { DynoUniform, DynoVal, Gsplat } from './dyno';
import * as THREE from "three";
export type SplatSkinningOptions = {
    mesh: SplatMesh;
    numSplats?: number;
    numBones?: number;
};
export declare class SplatSkinning {
    mesh: SplatMesh;
    numSplats: number;
    skinData: Uint16Array;
    skinTexture: THREE.DataArrayTexture;
    numBones: number;
    boneData: Float32Array;
    boneTexture: THREE.DataTexture;
    uniform: DynoUniform<typeof GsplatSkinning, "skinning">;
    constructor(options: SplatSkinningOptions);
    modify(gsplat: DynoVal<typeof Gsplat>): DynoVal<typeof Gsplat>;
    setRestQuatPos(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3): void;
    setBoneQuatPos(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3): void;
    setSplatBones(splatIndex: number, boneIndices: THREE.Vector4, weights: THREE.Vector4): void;
    updateBones(): void;
}
export declare const GsplatSkinning: {
    type: "GsplatSkinning";
};
export declare const defineGsplatSkinning: string;
export declare const defineApplyGsplatSkinning: string;
