import { DynoUniform, DynoVal, Gsplat } from './dyno';
import * as THREE from "three";
export declare enum SplatEditSdfType {
    ALL = "all",
    PLANE = "plane",
    SPHERE = "sphere",
    BOX = "box",
    ELLIPSOID = "ellipsoid",
    CYLINDER = "cylinder",
    CAPSULE = "capsule",
    INFINITE_CONE = "infinite_cone"
}
export declare enum SplatEditRgbaBlendMode {
    MULTIPLY = "multiply",
    SET_RGB = "set_rgb",
    ADD_RGBA = "add_rgba"
}
export type SplatEditSdfOptions = {
    type?: SplatEditSdfType;
    invert?: boolean;
    opacity?: number;
    color?: THREE.Color;
    displace?: THREE.Vector3;
    radius?: number;
};
export declare class SplatEditSdf extends THREE.Object3D {
    type: SplatEditSdfType;
    invert: boolean;
    opacity: number;
    color: THREE.Color;
    displace: THREE.Vector3;
    radius: number;
    constructor(options?: SplatEditSdfOptions);
}
export type SplatEditOptions = {
    name?: string;
    rgbaBlendMode?: SplatEditRgbaBlendMode;
    sdfSmooth?: number;
    softEdge?: number;
    invert?: boolean;
    sdfs?: SplatEditSdf[];
};
export declare class SplatEdit extends THREE.Object3D {
    ordering: number;
    rgbaBlendMode: SplatEditRgbaBlendMode;
    sdfSmooth: number;
    softEdge: number;
    invert: boolean;
    sdfs: SplatEditSdf[] | null;
    static nextOrdering: number;
    constructor(options?: SplatEditOptions);
    addSdf(sdf: SplatEditSdf): void;
    removeSdf(sdf: SplatEditSdf): void;
}
export declare class SplatEdits {
    maxSdfs: number;
    numSdfs: number;
    sdfData: Uint32Array;
    sdfFloatData: Float32Array;
    sdfTexture: THREE.DataTexture;
    dynoSdfArray: DynoUniform<typeof SdfArray, "sdfArray">;
    maxEdits: number;
    numEdits: number;
    editData: Uint32Array;
    editFloatData: Float32Array;
    dynoNumEdits: DynoUniform<"int", "numEdits">;
    dynoEdits: DynoUniform<"uvec4", "edits">;
    constructor({ maxSdfs, maxEdits }: {
        maxSdfs?: number;
        maxEdits?: number;
    });
    private newSdfTexture;
    private newEdits;
    private ensureCapacity;
    private updateEditData;
    private updateEditFloatData;
    private encodeEdit;
    private updateSdfData;
    private updateSdfFloatData;
    private encodeSdf;
    update(edits: {
        edit: SplatEdit;
        sdfs: SplatEditSdf[];
    }[]): {
        updated: boolean;
        dynoUpdated: boolean;
    };
    modify(gsplat: DynoVal<typeof Gsplat>): DynoVal<typeof Gsplat>;
}
export declare const SdfArray: {
    type: "SdfArray";
};
export declare const defineSdfArray: string;
export declare const defineEdit: string;
