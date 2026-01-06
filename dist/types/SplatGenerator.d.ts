import { SplatEdit } from './SplatEdit';
import { CovSplat, Dyno, DynoFloat, DynoMat3, DynoVal, DynoVec3, DynoVec4, Gsplat } from './dyno';
import * as THREE from "three";
export type GsplatGenerator = Dyno<{
    index: "int";
}, {
    gsplat: typeof Gsplat;
}>;
export type CovSplatGenerator = Dyno<{
    index: "int";
}, {
    covsplat: typeof CovSplat;
}>;
export type GsplatModifier = Dyno<{
    gsplat: typeof Gsplat;
}, {
    gsplat: typeof Gsplat;
}>;
export type CovSplatModifier = Dyno<{
    covsplat: typeof CovSplat;
}, {
    covsplat: typeof CovSplat;
}>;
export declare class SplatModifier {
    modifier: GsplatModifier;
    cache: Map<GsplatGenerator, GsplatGenerator>;
    constructor(modifier: GsplatModifier);
    apply(generator: GsplatGenerator): GsplatGenerator;
}
export declare class SplatTransformer {
    scale: DynoFloat;
    rotate: DynoVec4<THREE.Quaternion>;
    translate: DynoVec3<THREE.Vector3>;
    constructor();
    apply(position: DynoVal<"vec3">): DynoVal<"vec3">;
    applyDir(dir: DynoVal<"vec3">): DynoVal<"vec3">;
    applyGsplat(gsplat: DynoVal<typeof Gsplat>): DynoVal<typeof Gsplat>;
    updateFromMatrix(transform: THREE.Matrix4): boolean;
    update(object: THREE.Object3D): boolean;
}
export declare class CovSplatTransformer {
    basis: DynoMat3<"basis", THREE.Matrix3>;
    offset: DynoVec3<THREE.Vector3>;
    constructor();
    apply(position: DynoVal<"vec3">): DynoVal<"vec3">;
    applyDir(dir: DynoVal<"vec3">): DynoVal<"vec3">;
    applyCovSplat(covsplat: DynoVal<typeof CovSplat>): DynoVal<typeof CovSplat>;
    updateFromMatrix(transform: THREE.Matrix4): boolean;
    update(object: THREE.Object3D): boolean;
}
export interface FrameUpdateContext {
    renderer: THREE.WebGLRenderer;
    object: SplatGenerator;
    time: number;
    deltaTime: number;
    viewToWorld: THREE.Matrix4;
    camera?: THREE.Camera;
    renderSize?: THREE.Vector2;
    globalEdits: SplatEdit[];
    lodIndices?: {
        numSplats: number;
        texture: THREE.DataTexture;
    };
}
export declare class SplatGenerator extends THREE.Object3D {
    numSplats: number;
    generator?: GsplatGenerator;
    covGenerator?: CovSplatGenerator;
    generatorError?: unknown;
    covGeneratorError?: unknown;
    frameUpdate?: (context: FrameUpdateContext) => void;
    version: number;
    mappingVersion: number;
    constructor({ numSplats, generator, covGenerator, construct, update, }: {
        numSplats?: number;
        generator?: GsplatGenerator;
        covGenerator?: CovSplatGenerator;
        construct?: (object: SplatGenerator) => {
            generator?: GsplatGenerator;
            covGenerator?: CovSplatGenerator;
            numSplats?: number;
            frameUpdate?: (context: FrameUpdateContext) => void;
        };
        update?: (context: FrameUpdateContext) => void;
    });
    updateVersion(): void;
    updateMappingVersion(): void;
    set needsUpdate(value: boolean);
}
