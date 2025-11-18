import { Dyno } from './base';
import { Gsplat } from './splats';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const outputPackedSplat: (gsplat: DynoVal<typeof Gsplat>, rgbMinMaxLnScaleMinMax: DynoVal<"vec4">) => OutputPackedSplat;
export declare const outputExtendedSplat: (gsplat: DynoVal<typeof Gsplat>) => OutputExtendedSplat;
export declare const outputSplatDepth: (gsplat: DynoVal<typeof Gsplat>, viewCenter: DynoVal<"vec3">, viewDir: DynoVal<"vec3">, sortRadial: DynoVal<"bool">) => OutputSplatDepth;
export declare const outputRgba8: (rgba8: DynoVal<"vec4">) => OutputRgba8;
export declare class OutputPackedSplat extends Dyno<{
    gsplat: typeof Gsplat;
    rgbMinMaxLnScaleMinMax: "vec4";
}, {
    output: "uvec4";
}> implements HasDynoOut<"uvec4"> {
    constructor({ gsplat, rgbMinMaxLnScaleMinMax, }: {
        gsplat?: DynoVal<typeof Gsplat>;
        rgbMinMaxLnScaleMinMax?: DynoVal<"vec4">;
    });
    dynoOut(): DynoValue<"uvec4">;
}
export declare class OutputExtendedSplat extends Dyno<{
    gsplat: typeof Gsplat;
}, Record<string, never>> {
    constructor({ gsplat, }: {
        gsplat?: DynoVal<typeof Gsplat>;
    });
    dynoOut(): DynoValue<"uvec4">;
}
declare class OutputSplatDepth extends Dyno<{
    gsplat: typeof Gsplat;
    viewCenter: "vec3";
    viewDir: "vec3";
    sortRadial: "bool";
}, Record<string, never>> {
    constructor({ gsplat, viewCenter, viewDir, sortRadial, }: {
        gsplat: DynoVal<typeof Gsplat>;
        viewCenter: DynoVal<"vec3">;
        viewDir: DynoVal<"vec3">;
        sortRadial: DynoVal<"bool">;
    });
}
export declare class OutputRgba8 extends Dyno<{
    rgba8: "vec4";
}, {
    rgba8: "vec4";
}> implements HasDynoOut<"vec4"> {
    constructor({ rgba8 }: {
        rgba8?: DynoVal<"vec4">;
    });
    dynoOut(): DynoValue<"vec4">;
}
export {};
