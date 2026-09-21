import type { SplatTransformer } from "../SplatGenerator";
import type { SplatMesh } from "../SplatMesh";
import { type DynoVal } from "../dyno";
export declare function makeDepthColorModifier(splatToView: SplatTransformer, minDepth: DynoVal<"float">, maxDepth: DynoVal<"float">, reverse: DynoVal<"bool">): import("../dyno").DynoBlock<{
    gsplat: {
        type: "Gsplat";
    };
}, {
    gsplat: {
        type: "Gsplat";
    };
}>;
export declare function setDepthColor(splats: SplatMesh, minDepth: number, maxDepth: number, reverse?: boolean): {
    minDepth: import("../dyno").DynoConst<"float">;
    maxDepth: import("../dyno").DynoConst<"float">;
    reverse: import("../dyno").DynoConst<"bool">;
};
