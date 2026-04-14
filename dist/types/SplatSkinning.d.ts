import { SplatMesh } from './SplatMesh';
import { CovSplat, DynoUniform, DynoVal, Gsplat } from './dyno';
import * as THREE from "three";
export declare enum SplatSkinningMode {
    DUAL_QUATERNION = "dual_quaternion",
    LINEAR_BLEND = "linear_blend"
}
export type SplatSkinningOptions = {
    mesh: SplatMesh;
    numSplats?: number;
    numBones?: number;
    mode?: SplatSkinningMode;
};
export declare class SplatSkinning {
    mesh: SplatMesh;
    numSplats: number;
    mode: SplatSkinningMode;
    skinData: Uint16Array<ArrayBuffer>;
    skinTexture: THREE.DataArrayTexture;
    numBones: number;
    boneData: Float32Array;
    boneTexture: THREE.DataTexture;
    boneRestQuatPosScale: {
        quat: THREE.Quaternion;
        pos: THREE.Vector3;
        scale: THREE.Vector3;
    }[];
    boneRestInvMats: THREE.Matrix4[];
    uniform: DynoUniform<typeof GsplatSkinning, "skinning">;
    constructor(options: SplatSkinningOptions);
    modify(gsplat: DynoVal<typeof Gsplat>): DynoVal<typeof Gsplat>;
    modifyCov(covsplat: DynoVal<typeof CovSplat>): DynoVal<typeof CovSplat>;
    setRestQuatPos(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3): void;
    getRestQuatPos(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3): void;
    setRestQuatPosScale(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3, scale: THREE.Vector3): void;
    getRestQuatPosScale(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3, scale: THREE.Vector3): void;
    setRestMatrix(boneIndex: number, matrix: THREE.Matrix4): void;
    getRestMatrix(boneIndex: number, matrix: THREE.Matrix4): void;
    setBoneQuatPos(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3): void;
    setBoneQuatPosScale(boneIndex: number, quat: THREE.Quaternion, pos: THREE.Vector3, scale: THREE.Vector3): void;
    setBoneMatrix(boneIndex: number, matrix: THREE.Matrix4): void;
    setSplatBones(splatIndex: number, boneIndices: THREE.Vector4, weights: THREE.Vector4): void;
    updateBones(): void;
    private static UNIT_SCALE;
    private static relQuat;
    private static relPos;
    private static dual;
    private static skinMat;
}
export declare const GsplatSkinning: {
    type: "GsplatSkinning";
};
export declare const defineGsplatSkinning: string;
export declare const defineApplyGsplatSkinning: string;
export declare const defineApplyCovSplatDQSkinning: string;
export declare const defineApplyCovSplatLBSkinning: string;
