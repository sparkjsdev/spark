import { Dyno } from './base';
import { CovSplat, Gsplat } from './splats';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const outputPackedSplat: (gsplat: DynoVal<typeof Gsplat>, rgbMinMaxLnScaleMinMax: DynoVal<"vec4">) => OutputPackedSplat;
export declare const outputCovSplat: (covsplat: DynoVal<typeof CovSplat>, rgbMinMaxLnScaleMinMax: DynoVal<"vec4">) => OutputCovSplat;
export declare const outputExtendedSplat: (gsplat: DynoVal<typeof Gsplat>) => OutputExtendedSplat;
export declare const outputExtCovSplat: (covsplat: DynoVal<typeof CovSplat>) => OutputExtCovSplat;
export declare const outputSplatDepth: (gsplat: DynoVal<typeof Gsplat>, viewCenter: DynoVal<"vec3">, viewDir: DynoVal<"vec3">, sortRadial: DynoVal<"bool">) => OutputSplatDepth;
export declare const outputCovSplatDepth: (covsplat: DynoVal<typeof CovSplat>, viewCenter: DynoVal<"vec3">, viewDir: DynoVal<"vec3">, sortRadial: DynoVal<"bool">) => OutputCovSplatDepth;
export declare const outputRgba8: (rgba8: DynoVal<"vec4">) => OutputRgba8;
export declare class OutputPackedSplat extends Dyno<{
    gsplat: typeof Gsplat;
    rgbMinMaxLnScaleMinMax: "vec4";
}, Record<string, never>> {
    constructor({ gsplat, rgbMinMaxLnScaleMinMax, }: {
        gsplat?: DynoVal<typeof Gsplat>;
        rgbMinMaxLnScaleMinMax?: DynoVal<"vec4">;
    });
}
export declare class OutputCovSplat extends Dyno<{
    covsplat: typeof CovSplat;
    rgbMinMaxLnScaleMinMax: "vec4";
}, Record<string, never>> {
    constructor({ covsplat, rgbMinMaxLnScaleMinMax, }: {
        covsplat?: DynoVal<typeof CovSplat>;
        rgbMinMaxLnScaleMinMax?: DynoVal<"vec4">;
    });
}
export declare class OutputExtendedSplat extends Dyno<{
    gsplat: typeof Gsplat;
}, Record<string, never>> {
    constructor({ gsplat, }: {
        gsplat?: DynoVal<typeof Gsplat>;
    });
}
export declare class OutputExtCovSplat extends Dyno<{
    covsplat: typeof CovSplat;
}, Record<string, never>> {
    constructor({ covsplat, }: {
        covsplat?: DynoVal<typeof CovSplat>;
    });
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
declare class OutputCovSplatDepth extends Dyno<{
    covsplat: typeof CovSplat;
    viewCenter: "vec3";
    viewDir: "vec3";
    sortRadial: "bool";
}, Record<string, never>> {
    constructor({ covsplat, viewCenter, viewDir, sortRadial, }: {
        covsplat: DynoVal<typeof CovSplat>;
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
