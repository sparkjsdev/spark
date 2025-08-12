import { PackedSplats, SplatEncoding } from './PackedSplats';
import { RgbaArray } from './RgbaArray';
import { SplatEdit } from './SplatEdit';
import { GsplatModifier, SplatGenerator, SplatTransformer } from './SplatGenerator';
import { SplatFileType } from './SplatLoader';
import { SplatSkinning } from './SplatSkinning';
import { DynoFloat, DynoUsampler2DArray, DynoVal, DynoVec4, Gsplat } from './dyno';
import * as THREE from "three";
export type SplatMeshOptions = {
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    packedSplats?: PackedSplats;
    maxSplats?: number;
    constructSplats?: (splats: PackedSplats) => Promise<void> | void;
    onLoad?: (mesh: SplatMesh) => Promise<void> | void;
    editable?: boolean;
    onFrame?: ({ mesh, time, deltaTime, }: {
        mesh: SplatMesh;
        time: number;
        deltaTime: number;
    }) => void;
    objectModifier?: GsplatModifier;
    worldModifier?: GsplatModifier;
    splatEncoding?: SplatEncoding;
};
export type SplatMeshContext = {
    transform: SplatTransformer;
    viewToWorld: SplatTransformer;
    worldToView: SplatTransformer;
    viewToObject: SplatTransformer;
    recolor: DynoVec4<THREE.Vector4>;
    time: DynoFloat;
    deltaTime: DynoFloat;
};
export declare class SplatMesh extends SplatGenerator {
    initialized: Promise<SplatMesh>;
    isInitialized: boolean;
    packedSplats: PackedSplats;
    recolor: THREE.Color;
    opacity: number;
    context: SplatMeshContext;
    onFrame?: ({ mesh, time, deltaTime, }: {
        mesh: SplatMesh;
        time: number;
        deltaTime: number;
    }) => void;
    objectModifier?: GsplatModifier;
    worldModifier?: GsplatModifier;
    enableViewToObject: boolean;
    enableViewToWorld: boolean;
    enableWorldToView: boolean;
    skinning: SplatSkinning | null;
    edits: SplatEdit[] | null;
    editable: boolean;
    private rgbaDisplaceEdits;
    splatRgba: RgbaArray | null;
    maxSh: number;
    constructor(options?: SplatMeshOptions);
    asyncInitialize(options: SplatMeshOptions): Promise<void>;
    static staticInitialized: Promise<void>;
    static isStaticInitialized: boolean;
    static dynoTime: DynoFloat<"value">;
    static staticInitialize(): Promise<void>;
    pushSplat(center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color): void;
    forEachSplat(callback: (index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => void): void;
    dispose(): void;
    getBoundingBox(centers_only?: boolean): THREE.Box3;
    constructGenerator(context: SplatMeshContext): void;
    updateGenerator(): void;
    update({ time, viewToWorld, deltaTime, globalEdits, }: {
        time: number;
        viewToWorld: THREE.Matrix4;
        deltaTime: number;
        globalEdits: SplatEdit[];
    }): void;
    raycast(raycaster: THREE.Raycaster, intersects: {
        distance: number;
        point: THREE.Vector3;
        object: THREE.Object3D;
    }[]): void;
    private ensureShTextures;
}
export declare function evaluateSH1(gsplat: DynoVal<typeof Gsplat>, sh1: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>, viewDir: DynoVal<"vec3">): DynoVal<"vec3">;
export declare function evaluateSH2(gsplat: DynoVal<typeof Gsplat>, sh2: DynoVal<"usampler2DArray">, viewDir: DynoVal<"vec3">): DynoVal<"vec3">;
export declare function evaluateSH3(gsplat: DynoVal<typeof Gsplat>, sh3: DynoVal<"usampler2DArray">, viewDir: DynoVal<"vec3">): DynoVal<"vec3">;
