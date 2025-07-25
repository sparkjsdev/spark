import { PackedSplats, SplatEncoding } from './PackedSplats';
import { RgbaArray } from './RgbaArray';
import { SplatEdit } from './SplatEdit';
import { GsplatModifier, SplatGenerator, SplatTransformer } from './SplatGenerator';
import { SplatFileType } from './SplatLoader';
import { SplatTree } from './SplatTree';
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
    splatTree: SplatTree | null;
    baseSplatTree: SplatTree | null;
    disposed: boolean;
    constructor(options?: SplatMeshOptions);
    asyncInitialize(options: SplatMeshOptions): Promise<void>;
    static staticInitialized: Promise<void>;
    static isStaticInitialized: boolean;
    static dynoTime: DynoFloat<"value">;
    static staticInitialize(): Promise<void>;
    pushSplat(center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color): void;
    forEachSplat(callback: (index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => void): void;
    /**
     * Retrieves the color and opacity of a specific splat
     * @param index - The index of the splat to retrieve color from
     * @param out - Output vector to store the color (RGBA format)
     * @returns The output vector containing the splat's color and opacity
     */
    getSplatColor(index: number, out: THREE.Vector4): THREE.Vector4;
    /**
     * Retrieves the scale and rotation (quaternion) of a specific splat
     * @param index - The index of the splat to retrieve scale and rotation from
     * @param out - Output vector to store the scale (x, y, z components)
     * @param out2 - Output quaternion to store the rotation
     * @returns The output vector containing the splat's scale
     */
    getSplatScaleAndRotation(index: number, out: THREE.Vector3, out2: THREE.Quaternion): THREE.Vector3;
    /**
     * Gets the total number of splats in the mesh
     * @returns The total count of splats
     */
    getSplatCount(): number;
    /**
     * Gets the scene index for a specific splat
     * Currently returns 0 as a default implementation
     * @param index - The index of the splat
     * @returns The scene index (always 0 in this implementation)
     */
    getSceneIndexForSplat(index: number): number;
    /**
     * Gets the current scene object
     * @returns The current SplatMesh instance as the scene
     */
    getScene(): this;
    getSplatCenter(index: number, out: THREE.Vector3): THREE.Vector3;
    buildSplatTree(minAlphas?: number[], onSplatTreeIndexesUpload?: Function, onSplatTreeConstruction?: Function): Promise<void>;
    disposeSplatTree(): void;
    dispose(): void;
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
