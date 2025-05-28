import { Dyno } from './base';
import { DynoVal } from './value';
export declare const transformPos: (position: DynoVal<"vec3">, { scale, scales, rotate, translate, }: {
    scale?: DynoVal<"float">;
    scales?: DynoVal<"vec3">;
    rotate?: DynoVal<"vec4">;
    translate?: DynoVal<"vec3">;
}) => DynoVal<"vec3">;
export declare const transformDir: (dir: DynoVal<"vec3">, { scale, scales, rotate, }: {
    scale?: DynoVal<"float">;
    scales?: DynoVal<"vec3">;
    rotate?: DynoVal<"vec4">;
}) => DynoVal<"vec3">;
export declare const transformQuat: (quaternion: DynoVal<"vec4">, { rotate }: {
    rotate?: DynoVal<"vec4">;
}) => DynoVal<"vec4">;
export declare class TransformPosition extends Dyno<{
    position: "vec3";
    scale: "float";
    scales: "vec3";
    rotate: "vec4";
    translate: "vec3";
}, {
    position: "vec3";
}> {
    constructor({ position, scale, scales, rotate, translate, }: {
        position?: DynoVal<"vec3">;
        scale?: DynoVal<"float">;
        scales?: DynoVal<"vec3">;
        rotate?: DynoVal<"vec4">;
        translate?: DynoVal<"vec3">;
    });
}
export declare class TransformDir extends Dyno<{
    dir: "vec3";
    scale: "float";
    scales: "vec3";
    rotate: "vec4";
}, {
    dir: "vec3";
}> {
    constructor({ dir, scale, scales, rotate, }: {
        dir?: DynoVal<"vec3">;
        scale?: DynoVal<"float">;
        scales?: DynoVal<"vec3">;
        rotate?: DynoVal<"vec4">;
    });
}
export declare class TransformQuaternion extends Dyno<{
    quaternion: "vec4";
    rotate: "vec4";
}, {
    quaternion: "vec4";
}> {
    constructor({ quaternion, rotate, }: {
        quaternion?: DynoVal<"vec4">;
        rotate?: DynoVal<"vec4">;
    });
}
