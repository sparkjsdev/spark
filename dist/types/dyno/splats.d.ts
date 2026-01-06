import { Dyno, UnaryOp } from './base';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const Gsplat: {
    type: "Gsplat";
};
export declare const CovSplat: {
    type: "CovSplat";
};
export declare const TPackedSplats: {
    type: "PackedSplats";
};
export declare const TExtSplats: {
    type: "ExtSplats";
};
export declare const TCovSplats: {
    type: "CovSplats";
};
export declare const numPackedSplats: (packedSplats: DynoVal<typeof TPackedSplats>) => DynoVal<"int">;
export declare const readPackedSplat: (packedSplats: DynoVal<typeof TPackedSplats>, index: DynoVal<"int">) => DynoVal<typeof Gsplat>;
export declare const readPackedSplatRange: (packedSplats: DynoVal<typeof TPackedSplats>, index: DynoVal<"int">, base: DynoVal<"int">, count: DynoVal<"int">) => DynoVal<typeof Gsplat>;
export declare const numExtSplats: (extSplats: DynoVal<typeof TExtSplats>) => DynoVal<"int">;
export declare const readExtSplat: (extSplats: DynoVal<typeof TExtSplats>, index: DynoVal<"int">) => DynoVal<typeof Gsplat>;
export declare const numCovSplats: (covsplats: DynoVal<typeof TCovSplats>) => DynoVal<"int">;
export declare const readCovSplat: (covSplats: DynoVal<typeof TCovSplats>, index: DynoVal<"int">) => DynoVal<typeof CovSplat>;
export declare const gsplatToCovSplat: (gsplat: DynoVal<typeof Gsplat>) => DynoVal<typeof CovSplat>;
export declare const splitGsplat: (gsplat: DynoVal<typeof Gsplat>) => SplitGsplat;
export declare const combineGsplat: ({ gsplat, flags, index, center, scales, quaternion, rgba, rgb, opacity, x, y, z, r, g, b, }: {
    gsplat?: DynoVal<typeof Gsplat>;
    flags?: DynoVal<"uint">;
    index?: DynoVal<"int">;
    center?: DynoVal<"vec3">;
    scales?: DynoVal<"vec3">;
    quaternion?: DynoVal<"vec4">;
    rgba?: DynoVal<"vec4">;
    rgb?: DynoVal<"vec3">;
    opacity?: DynoVal<"float">;
    x?: DynoVal<"float">;
    y?: DynoVal<"float">;
    z?: DynoVal<"float">;
    r?: DynoVal<"float">;
    g?: DynoVal<"float">;
    b?: DynoVal<"float">;
}) => DynoVal<typeof Gsplat>;
export declare const gsplatNormal: (gsplat: DynoVal<typeof Gsplat>) => DynoVal<"vec3">;
export declare const transformGsplat: (gsplat: DynoVal<typeof Gsplat>, { scale, rotate, translate, recolor, }: {
    scale?: DynoVal<"float">;
    rotate?: DynoVal<"vec4">;
    translate?: DynoVal<"vec3">;
    recolor?: DynoVal<"vec4">;
}) => DynoVal<typeof Gsplat>;
export declare const defineGsplat: string;
export declare const defineCovSplat: string;
export declare const definePackedSplats: string;
export declare class NumPackedSplats extends UnaryOp<typeof TPackedSplats, "int", "numSplats"> {
    constructor({ packedSplats, }: {
        packedSplats: DynoVal<typeof TPackedSplats>;
    });
}
export declare class ReadPackedSplat extends Dyno<{
    packedSplats: typeof TPackedSplats;
    index: "int";
}, {
    gsplat: typeof Gsplat;
}> implements HasDynoOut<typeof Gsplat> {
    constructor({ packedSplats, index, }: {
        packedSplats?: DynoVal<typeof TPackedSplats>;
        index?: DynoVal<"int">;
    });
    dynoOut(): DynoValue<typeof Gsplat>;
}
export declare class ReadPackedSplatRange extends Dyno<{
    packedSplats: typeof TPackedSplats;
    index: "int";
    base: "int";
    count: "int";
}, {
    gsplat: typeof Gsplat;
}> implements HasDynoOut<typeof Gsplat> {
    constructor({ packedSplats, index, base, count, }: {
        packedSplats?: DynoVal<typeof TPackedSplats>;
        index?: DynoVal<"int">;
        base?: DynoVal<"int">;
        count?: DynoVal<"int">;
    });
    dynoOut(): DynoValue<typeof Gsplat>;
}
export declare const defineExtSplats: string;
export declare class NumExtSplats extends UnaryOp<typeof TExtSplats, "int", "numSplats"> {
    constructor({ extSplats }: {
        extSplats: DynoVal<typeof TExtSplats>;
    });
}
export declare class ReadExtSplat extends Dyno<{
    extSplats: typeof TExtSplats;
    index: "int";
}, {
    gsplat: typeof Gsplat;
}> implements HasDynoOut<typeof Gsplat> {
    constructor({ extSplats, index, }: {
        extSplats?: DynoVal<typeof TExtSplats>;
        index?: DynoVal<"int">;
    });
    dynoOut(): DynoValue<typeof Gsplat>;
}
export declare class NumCovSplats extends UnaryOp<typeof TCovSplats, "int", "numSplats"> {
    constructor({ covsplats }: {
        covsplats: DynoVal<typeof TCovSplats>;
    });
}
export declare class ReadCovSplat extends Dyno<{
    covSplats: typeof TCovSplats;
    index: "int";
}, {
    covsplat: typeof CovSplat;
}> implements HasDynoOut<typeof CovSplat> {
    constructor({ covSplats, index, }: {
        covSplats?: DynoVal<typeof TCovSplats>;
        index?: DynoVal<"int">;
    });
    dynoOut(): DynoValue<typeof CovSplat>;
}
export declare class GsplatToCovSplat extends Dyno<{
    gsplat: typeof Gsplat;
}, {
    covsplat: typeof CovSplat;
}> {
    constructor({ gsplat }: {
        gsplat?: DynoVal<typeof Gsplat>;
    });
    dynoOut(): DynoValue<typeof CovSplat>;
}
export declare class SplitGsplat extends Dyno<{
    gsplat: typeof Gsplat;
}, {
    flags: "uint";
    active: "bool";
    index: "int";
    center: "vec3";
    scales: "vec3";
    quaternion: "vec4";
    rgba: "vec4";
    rgb: "vec3";
    opacity: "float";
    x: "float";
    y: "float";
    z: "float";
    r: "float";
    g: "float";
    b: "float";
}> {
    constructor({ gsplat }: {
        gsplat?: DynoVal<typeof Gsplat>;
    });
}
export declare class CombineGsplat extends Dyno<{
    gsplat: typeof Gsplat;
    flags: "uint";
    index: "int";
    center: "vec3";
    scales: "vec3";
    quaternion: "vec4";
    rgba: "vec4";
    rgb: "vec3";
    opacity: "float";
    x: "float";
    y: "float";
    z: "float";
    r: "float";
    g: "float";
    b: "float";
}, {
    gsplat: typeof Gsplat;
}> implements HasDynoOut<typeof Gsplat> {
    constructor({ gsplat, flags, index, center, scales, quaternion, rgba, rgb, opacity, x, y, z, r, g, b, }: {
        gsplat?: DynoVal<typeof Gsplat>;
        flags?: DynoVal<"uint">;
        index?: DynoVal<"int">;
        center?: DynoVal<"vec3">;
        scales?: DynoVal<"vec3">;
        quaternion?: DynoVal<"vec4">;
        rgba?: DynoVal<"vec4">;
        rgb?: DynoVal<"vec3">;
        opacity?: DynoVal<"float">;
        x?: DynoVal<"float">;
        y?: DynoVal<"float">;
        z?: DynoVal<"float">;
        r?: DynoVal<"float">;
        g?: DynoVal<"float">;
        b?: DynoVal<"float">;
    });
    dynoOut(): DynoValue<typeof Gsplat>;
}
export declare const defineGsplatNormal: string;
export declare class GsplatNormal extends UnaryOp<typeof Gsplat, "vec3", "normal"> {
    constructor({ gsplat }: {
        gsplat: DynoVal<typeof Gsplat>;
    });
}
export declare class TransformGsplat extends Dyno<{
    gsplat: typeof Gsplat;
    scale: "float";
    rotate: "vec4";
    translate: "vec3";
    recolor: "vec4";
}, {
    gsplat: typeof Gsplat;
}> implements HasDynoOut<typeof Gsplat> {
    constructor({ gsplat, scale, rotate, translate, recolor, }: {
        gsplat?: DynoVal<typeof Gsplat>;
        scale?: DynoVal<"float">;
        rotate?: DynoVal<"vec4">;
        translate?: DynoVal<"vec3">;
        recolor?: DynoVal<"vec4">;
    });
    dynoOut(): DynoValue<typeof Gsplat>;
}
export declare const splitCovSplat: (covsplat: DynoVal<typeof CovSplat>) => SplitCovSplat;
export declare const combineCovSplat: ({ covsplat, flags, index, center, rgba, rgb, opacity, x, y, z, r, g, b, }: {
    covsplat?: DynoVal<typeof CovSplat>;
    flags?: DynoVal<"uint">;
    index?: DynoVal<"int">;
    center?: DynoVal<"vec3">;
    rgba?: DynoVal<"vec4">;
    rgb?: DynoVal<"vec3">;
    opacity?: DynoVal<"float">;
    x?: DynoVal<"float">;
    y?: DynoVal<"float">;
    z?: DynoVal<"float">;
    r?: DynoVal<"float">;
    g?: DynoVal<"float">;
    b?: DynoVal<"float">;
}) => DynoVal<typeof CovSplat>;
export declare class SplitCovSplat extends Dyno<{
    covsplat: typeof CovSplat;
}, {
    flags: "uint";
    active: "bool";
    index: "int";
    center: "vec3";
    rgba: "vec4";
    rgb: "vec3";
    opacity: "float";
    x: "float";
    y: "float";
    z: "float";
    r: "float";
    g: "float";
    b: "float";
}> {
    constructor({ covsplat }: {
        covsplat?: DynoVal<typeof CovSplat>;
    });
}
export declare class CombineCovSplat extends Dyno<{
    covsplat: typeof CovSplat;
    flags: "uint";
    index: "int";
    center: "vec3";
    rgba: "vec4";
    rgb: "vec3";
    opacity: "float";
    x: "float";
    y: "float";
    z: "float";
    r: "float";
    g: "float";
    b: "float";
}, {
    covsplat: typeof CovSplat;
}> implements HasDynoOut<typeof CovSplat> {
    constructor({ covsplat, flags, index, center, rgba, rgb, opacity, x, y, z, r, g, b, }: {
        covsplat?: DynoVal<typeof CovSplat>;
        flags?: DynoVal<"uint">;
        index?: DynoVal<"int">;
        center?: DynoVal<"vec3">;
        rgba?: DynoVal<"vec4">;
        rgb?: DynoVal<"vec3">;
        opacity?: DynoVal<"float">;
        x?: DynoVal<"float">;
        y?: DynoVal<"float">;
        z?: DynoVal<"float">;
        r?: DynoVal<"float">;
        g?: DynoVal<"float">;
        b?: DynoVal<"float">;
    });
    dynoOut(): DynoValue<typeof CovSplat>;
}
