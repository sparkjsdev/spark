import { Dyno } from './base';
import { DynoJsType, DynoType } from './types';
import { DynoValue, HasDynoOut } from './value';
export declare const uniform: <V extends DynoJsType<DynoType>>(key: string, type: DynoType, value: V) => DynoUniform<DynoType, string, V>;
export declare const dynoBool: (value?: boolean, key?: string) => DynoBool<string>;
export declare const dynoUint: (value?: number, key?: string) => DynoUint<string>;
export declare const dynoInt: (value?: number, key?: string) => DynoInt<string>;
export declare const dynoFloat: (value?: number, key?: string) => DynoFloat<string>;
export declare const dynoBvec2: <V extends DynoJsType<"bvec2">>(value: V, key?: string) => DynoBvec2<string, V>;
export declare const dynoUvec2: <V extends DynoJsType<"uvec2">>(value: V, key?: string) => DynoUvec2<string, V>;
export declare const dynoIvec2: <V extends DynoJsType<"ivec2">>(value: V, key?: string) => DynoIvec2<string, V>;
export declare const dynoVec2: <V extends DynoJsType<"vec2">>(value: V, key?: string) => DynoVec2<string, V>;
export declare const dynoBvec3: <V extends DynoJsType<"bvec3">>(value: V, key?: string) => DynoBvec3<string, V>;
export declare const dynoUvec3: <V extends DynoJsType<"uvec3">>(value: V, key?: string) => DynoUvec3<V, string>;
export declare const dynoIvec3: <V extends DynoJsType<"ivec3">>(value: V, key?: string) => DynoIvec3<V, string>;
export declare const dynoVec3: <V extends DynoJsType<"vec3">>(value: V, key?: string) => DynoVec3<V, string>;
export declare const dynoBvec4: <V extends DynoJsType<"bvec4">>(value: V, key?: string) => DynoBvec4<string, V>;
export declare const dynoUvec4: <V extends DynoJsType<"uvec4">>(value: V, key?: string) => DynoUvec4<string, V>;
export declare const dynoIvec4: <V extends DynoJsType<"ivec4">>(value: V, key?: string) => DynoIvec4<string, V>;
export declare const dynoVec4: <V extends DynoJsType<"vec4">>(value: V, key?: string) => DynoVec4<V, string>;
export declare const dynoMat2: <V extends DynoJsType<"mat2">>(value: V, key?: string) => DynoMat2<string, V>;
export declare const dynoMat2x2: <V extends DynoJsType<"mat2x2">>(value: V, key?: string) => DynoMat2x2<string, V>;
export declare const dynoMat2x3: <V extends DynoJsType<"mat2x3">>(value: V, key?: string) => DynoMat2x3<string, V>;
export declare const dynoMat2x4: <V extends DynoJsType<"mat2x4">>(value: V, key?: string) => DynoMat2x4<string, V>;
export declare const dynoMat3: <V extends DynoJsType<"mat3">>(value: V, key?: string) => DynoMat3<string, V>;
export declare const dynoMat3x2: <V extends DynoJsType<"mat3x2">>(value: V, key?: string) => DynoMat3x2<string, V>;
export declare const dynoMat3x3: <V extends DynoJsType<"mat3x3">>(value: V, key?: string) => DynoMat3x3<string, V>;
export declare const dynoMat3x4: <V extends DynoJsType<"mat3x4">>(value: V, key?: string) => DynoMat3x4<string, V>;
export declare const dynoMat4: <V extends DynoJsType<"mat4">>(value: V, key?: string) => DynoMat4<string, V>;
export declare const dynoMat4x2: <V extends DynoJsType<"mat4x2">>(value: V, key?: string) => DynoMat4x2<string, V>;
export declare const dynoMat4x3: <V extends DynoJsType<"mat4x3">>(value: V, key?: string) => DynoMat4x3<string, V>;
export declare const dynoMat4x4: <V extends DynoJsType<"mat4x4">>(value: V, key?: string) => DynoMat4x4<string, V>;
export declare const dynoUsampler2D: <V extends DynoJsType<"usampler2D">>(value: V, key?: string) => DynoUsampler2D<string, V>;
export declare const dynoIsampler2D: <V extends DynoJsType<"isampler2D">>(value: V, key?: string) => DynoIsampler2D<string, V>;
export declare const dynoSampler2D: <V extends DynoJsType<"sampler2D">>(value: V, key?: string) => DynoSampler2D<string, V>;
export declare const dynoUsampler2DArray: <V extends DynoJsType<"usampler2DArray">>(value: V, key?: string) => DynoUsampler2DArray<string, V>;
export declare const dynoIsampler2DArray: <V extends DynoJsType<"isampler2DArray">>(key: string, value: V) => DynoIsampler2DArray<string, V>;
export declare const dynoSampler2DArray: <V extends DynoJsType<"sampler2DArray">>(value: V, key?: string) => DynoSampler2DArray<string, V>;
export declare const dynoUsampler3D: <V extends DynoJsType<"usampler3D">>(value: V, key?: string) => DynoUsampler3D<string, V>;
export declare const dynoIsampler3D: <V extends DynoJsType<"isampler3D">>(value: V, key?: string) => DynoIsampler3D<string, V>;
export declare const dynoSampler3D: <V extends DynoJsType<"sampler3D">>(value: V, key?: string) => DynoSampler3D<string, V>;
export declare const dynoUsamplerCube: <V extends DynoJsType<"usamplerCube">>(value: V, key?: string) => DynoUsamplerCube<string, V>;
export declare const dynoIsamplerCube: <V extends DynoJsType<"isamplerCube">>(value: V, key?: string) => DynoIsamplerCube<string, V>;
export declare const dynoSamplerCube: <V extends DynoJsType<"samplerCube">>(value: V, key?: string) => DynoSamplerCube<string, V>;
export declare const dynoSampler2DShadow: <V extends DynoJsType<"sampler2DShadow">>(value: V, key?: string) => DynoSampler2DShadow<string, V>;
export declare const dynoSampler2DArrayShadow: <V extends DynoJsType<"sampler2DArrayShadow">>(value: V, key?: string) => DynoSampler2DArrayShadow<string, V>;
export declare const dynoSamplerCubeShadow: <V extends DynoJsType<"samplerCubeShadow">>(value: V, key?: string) => DynoSamplerCubeShadow<string, V>;
export declare class DynoUniform<T extends DynoType, K extends string = "value", V extends DynoJsType<T> = DynoJsType<T>> extends Dyno<Record<string, never>, {
    [key in K]: T;
}> implements HasDynoOut<T> {
    type: T;
    count?: number;
    outKey: K;
    value: V;
    uniform: {
        value: V;
        type?: string;
    };
    constructor({ key, type, count, value, update, globals, }: {
        key?: K;
        type: T;
        count?: number;
        value: V;
        update?: (value: V) => V | undefined;
        globals?: ({ inputs, outputs, }: {
            inputs: unknown;
            outputs: {
                [key in K]?: string;
            };
        }) => string[];
    });
    dynoOut(): DynoValue<T>;
}
export declare class DynoBool<K extends string> extends DynoUniform<"bool", K, boolean> {
    constructor({ key, value, update, }: {
        key?: K;
        value: boolean;
        update?: (value: boolean) => boolean | undefined;
    });
}
export declare class DynoUint<K extends string> extends DynoUniform<"uint", K, number> {
    constructor({ key, value, update, }: {
        key?: K;
        value: number;
        update?: (value: number) => number | undefined;
    });
}
export declare class DynoInt<K extends string> extends DynoUniform<"int", K, number> {
    constructor({ key, value, update, }: {
        key?: K;
        value: number;
        update?: (value: number) => number | undefined;
    });
}
export declare class DynoFloat<K extends string = "value"> extends DynoUniform<"float", K, number> {
    constructor({ key, value, update, }: {
        key?: K;
        value: number;
        update?: (value: number) => number | undefined;
    });
}
export declare class DynoBvec2<K extends string, V extends DynoJsType<"bvec2">> extends DynoUniform<"bvec2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoUvec2<K extends string, V extends DynoJsType<"uvec2">> extends DynoUniform<"uvec2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoIvec2<K extends string, V extends DynoJsType<"ivec2">> extends DynoUniform<"ivec2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoVec2<K extends string, V extends DynoJsType<"vec2">> extends DynoUniform<"vec2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoBvec3<K extends string, V extends DynoJsType<"bvec3">> extends DynoUniform<"bvec3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoUvec3<V extends DynoJsType<"uvec3">, K extends string = "value"> extends DynoUniform<"uvec3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoIvec3<V extends DynoJsType<"ivec3">, K extends string = "value"> extends DynoUniform<"ivec3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoVec3<V extends DynoJsType<"vec3">, K extends string = "value"> extends DynoUniform<"vec3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoBvec4<K extends string, V extends DynoJsType<"bvec4">> extends DynoUniform<"bvec4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoUvec4<K extends string, V extends DynoJsType<"uvec4">> extends DynoUniform<"uvec4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoIvec4<K extends string, V extends DynoJsType<"ivec4">> extends DynoUniform<"ivec4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoVec4<V extends DynoJsType<"vec4">, K extends string = "value"> extends DynoUniform<"vec4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat2<K extends string, V extends DynoJsType<"mat2">> extends DynoUniform<"mat2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat2x2<K extends string, V extends DynoJsType<"mat2x2">> extends DynoUniform<"mat2x2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat2x3<K extends string, V extends DynoJsType<"mat2x3">> extends DynoUniform<"mat2x3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat2x4<K extends string, V extends DynoJsType<"mat2x4">> extends DynoUniform<"mat2x4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat3<K extends string, V extends DynoJsType<"mat3">> extends DynoUniform<"mat3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat3x2<K extends string, V extends DynoJsType<"mat3x2">> extends DynoUniform<"mat3x2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat3x3<K extends string, V extends DynoJsType<"mat3x3">> extends DynoUniform<"mat3x3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat3x4<K extends string, V extends DynoJsType<"mat3x4">> extends DynoUniform<"mat3x4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat4<K extends string, V extends DynoJsType<"mat4">> extends DynoUniform<"mat4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat4x2<K extends string, V extends DynoJsType<"mat4x2">> extends DynoUniform<"mat4x2", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat4x3<K extends string, V extends DynoJsType<"mat4x3">> extends DynoUniform<"mat4x3", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoMat4x4<K extends string, V extends DynoJsType<"mat4x4">> extends DynoUniform<"mat4x4", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoUsampler2D<K extends string, V extends DynoJsType<"usampler2D">> extends DynoUniform<"usampler2D", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoIsampler2D<K extends string, V extends DynoJsType<"isampler2D">> extends DynoUniform<"isampler2D", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoSampler2D<K extends string, V extends DynoJsType<"sampler2D">> extends DynoUniform<"sampler2D", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoUsampler2DArray<K extends string, V extends DynoJsType<"usampler2DArray">> extends DynoUniform<"usampler2DArray", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoIsampler2DArray<K extends string, V extends DynoJsType<"isampler2DArray">> extends DynoUniform<"isampler2DArray", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoSampler2DArray<K extends string, V extends DynoJsType<"sampler2DArray">> extends DynoUniform<"sampler2DArray", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoUsampler3D<K extends string, V extends DynoJsType<"usampler3D">> extends DynoUniform<"usampler3D", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoIsampler3D<K extends string, V extends DynoJsType<"isampler3D">> extends DynoUniform<"isampler3D", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoSampler3D<K extends string, V extends DynoJsType<"sampler3D">> extends DynoUniform<"sampler3D", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoUsamplerCube<K extends string, V extends DynoJsType<"usamplerCube">> extends DynoUniform<"usamplerCube", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoIsamplerCube<K extends string, V extends DynoJsType<"isamplerCube">> extends DynoUniform<"isamplerCube", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoSamplerCube<K extends string, V extends DynoJsType<"samplerCube">> extends DynoUniform<"samplerCube", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoSampler2DShadow<K extends string, V extends DynoJsType<"sampler2DShadow">> extends DynoUniform<"sampler2DShadow", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoSampler2DArrayShadow<K extends string, V extends DynoJsType<"sampler2DArrayShadow">> extends DynoUniform<"sampler2DArrayShadow", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
export declare class DynoSamplerCubeShadow<K extends string, V extends DynoJsType<"samplerCubeShadow">> extends DynoUniform<"samplerCubeShadow", K, V> {
    constructor({ key, value, update, }: {
        key?: K;
        value: V;
        update?: (value: V) => V | undefined;
    });
}
