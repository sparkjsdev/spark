import { SplatEdit } from './SplatEdit';
import { Dyno, DynoFloat, DynoVal, DynoVec3, DynoVec4, Gsplat } from './dyno';
import * as THREE from "three";
export type GsplatGenerator = Dyno<{
    index: "int";
}, {
    gsplat: typeof Gsplat;
}>;
export type GsplatModifier = Dyno<{
    gsplat: typeof Gsplat;
}, {
    gsplat: typeof Gsplat;
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
export declare class SplatGenerator extends THREE.Object3D {
    numSplats: number;
    generator?: GsplatGenerator;
    generatorError?: unknown;
    frameUpdate?: ({ object, time, deltaTime, viewToWorld, globalEdits, }: {
        object: SplatGenerator;
        time: number;
        deltaTime: number;
        viewToWorld: THREE.Matrix4;
        globalEdits: SplatEdit[];
    }) => void;
    version: number;
    constructor({ numSplats, generator, construct, update, }: {
        numSplats?: number;
        generator?: GsplatGenerator;
        construct?: (object: SplatGenerator) => {
            generator?: GsplatGenerator;
            numSplats?: number;
            frameUpdate?: (object: SplatGenerator) => void;
        };
        update?: ({ object, time, deltaTime, viewToWorld, globalEdits, }: {
            object: SplatGenerator;
            time: number;
            deltaTime: number;
            viewToWorld: THREE.Matrix4;
            globalEdits: SplatEdit[];
        }) => void;
    });
    updateVersion(): void;
    set needsUpdate(value: boolean);
}
