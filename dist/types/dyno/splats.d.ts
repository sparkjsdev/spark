import { Dyno, UnaryOp } from './base';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const Gsplat: {
    type: "Gsplat";
};
export declare const TPackedSplats: {
    type: "PackedSplats";
};
export declare const numPackedSplats: (packedSplats: DynoVal<typeof TPackedSplats>) => DynoVal<"int">;
export declare const readPackedSplat: (packedSplats: DynoVal<typeof TPackedSplats>, index: DynoVal<"int">) => DynoVal<typeof Gsplat>;
export declare const readPackedSplatRange: (packedSplats: DynoVal<typeof TPackedSplats>, index: DynoVal<"int">, base: DynoVal<"int">, count: DynoVal<"int">) => DynoVal<typeof Gsplat>;
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
