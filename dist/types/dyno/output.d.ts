import { Dyno } from './base';
import { Gsplat } from './splats';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const outputPackedSplat: (gsplat: DynoVal<typeof Gsplat>, rgbMinMaxLnScaleMinMax: DynoVal<"vec4">) => OutputPackedSplat;
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
