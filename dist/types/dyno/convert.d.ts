import { UnaryOp } from './base';
import { SimpleTypes } from './types';
import { DynoVal } from './value';
export declare const bool: <T extends "bool" | "int" | "uint" | "float">(value: DynoVal<T>) => DynoVal<"bool">;
export declare const int: <T extends "bool" | "int" | "uint" | "float">(value: DynoVal<T>) => DynoVal<"int">;
export declare const uint: <T extends "bool" | "int" | "uint" | "float">(value: DynoVal<T>) => DynoVal<"uint">;
export declare const float: <T extends "bool" | "int" | "uint" | "float">(value: DynoVal<T>) => DynoVal<"float">;
export declare const bvec2: <T extends "bool" | "bvec2" | "ivec2" | "uvec2" | "vec2">(value: DynoVal<T>) => DynoVal<"bvec2">;
export declare const bvec3: <T extends "bool" | "bvec3" | "ivec3" | "uvec3" | "vec3">(value: DynoVal<T>) => DynoVal<"bvec3">;
export declare const bvec4: <T extends "bool" | "bvec4" | "ivec4" | "uvec4" | "vec4">(value: DynoVal<T>) => DynoVal<"bvec4">;
export declare const ivec2: <T extends "int" | "bvec2" | "ivec2" | "uvec2" | "vec2">(value: DynoVal<T>) => DynoVal<"ivec2">;
export declare const ivec3: <T extends "int" | "bvec3" | "ivec3" | "uvec3" | "vec3">(value: DynoVal<T>) => DynoVal<"ivec3">;
export declare const ivec4: <T extends "int" | "bvec4" | "ivec4" | "uvec4" | "vec4">(value: DynoVal<T>) => DynoVal<"ivec4">;
export declare const uvec2: <T extends "uint" | "bvec2" | "ivec2" | "uvec2" | "vec2">(value: DynoVal<T>) => DynoVal<"uvec2">;
export declare const uvec3: <T extends "uint" | "bvec3" | "ivec3" | "uvec3" | "vec3">(value: DynoVal<T>) => DynoVal<"uvec3">;
export declare const uvec4: <T extends "uint" | "bvec4" | "ivec4" | "uvec4" | "vec4">(value: DynoVal<T>) => DynoVal<"uvec4">;
export declare const vec2: <T extends "float" | "bvec2" | "ivec2" | "uvec2" | "vec2" | "vec3" | "vec4">(value: DynoVal<T>) => DynoVal<"vec2">;
export declare const vec3: <T extends "float" | "bvec3" | "ivec3" | "uvec3" | "vec3" | "vec4">(value: DynoVal<T>) => DynoVal<"vec3">;
export declare const vec4: <T extends "float" | "bvec4" | "ivec4" | "uvec4" | "vec4">(value: DynoVal<T>) => DynoVal<"vec4">;
export declare const mat2: <T extends "float" | "mat2" | "mat3" | "mat4">(value: DynoVal<T>) => DynoVal<"mat2">;
export declare const mat3: <T extends "float" | "mat2" | "mat3" | "mat4">(value: DynoVal<T>) => DynoVal<"mat3">;
export declare const mat4: <T extends "float" | "mat2" | "mat3" | "mat4">(value: DynoVal<T>) => DynoVal<"mat4">;
export declare const floatBitsToInt: (value: DynoVal<"float">) => DynoVal<"int">;
export declare const floatBitsToUint: (value: DynoVal<"float">) => DynoVal<"uint">;
export declare const intBitsToFloat: (value: DynoVal<"int">) => DynoVal<"float">;
export declare const uintBitsToFloat: (value: DynoVal<"uint">) => DynoVal<"float">;
export declare const packSnorm2x16: (value: DynoVal<"vec2">) => DynoVal<"uint">;
export declare const unpackSnorm2x16: (value: DynoVal<"uint">) => DynoVal<"vec2">;
export declare const packUnorm2x16: (value: DynoVal<"vec2">) => DynoVal<"uint">;
export declare const unpackUnorm2x16: (value: DynoVal<"uint">) => DynoVal<"vec2">;
export declare const packHalf2x16: (value: DynoVal<"vec2">) => DynoVal<"uint">;
export declare const unpackHalf2x16: (value: DynoVal<"uint">) => DynoVal<"vec2">;
export declare const uintToRgba8: (value: DynoVal<"uint">) => DynoVal<"vec4">;
export declare class SimpleCast<Allowed extends SimpleTypes, OutType extends SimpleTypes, OutKey extends string> extends UnaryOp<Allowed, OutType, OutKey> {
    constructor({ value, outType, outKey, }: {
        value: DynoVal<Allowed>;
        outType: OutType;
        outKey: OutKey;
    });
}
export declare class Bool extends SimpleCast<"bool" | "int" | "uint" | "float", "bool", "bool"> {
    constructor({ value, }: {
        value: DynoVal<"bool" | "int" | "uint" | "float">;
    });
}
export declare class Int extends SimpleCast<"bool" | "int" | "uint" | "float", "int", "int"> {
    constructor({ value, }: {
        value: DynoVal<"bool" | "int" | "uint" | "float">;
    });
}
export declare class Uint extends SimpleCast<"bool" | "int" | "uint" | "float", "uint", "uint"> {
    constructor({ value, }: {
        value: DynoVal<"bool" | "int" | "uint" | "float">;
    });
}
export declare class Float extends SimpleCast<"bool" | "int" | "uint" | "float", "float", "float"> {
    constructor({ value, }: {
        value: DynoVal<"bool" | "int" | "uint" | "float">;
    });
}
export declare class BVec2 extends SimpleCast<"bool" | "bvec2" | "ivec2" | "uvec2" | "vec2", "bvec2", "bvec2"> {
    constructor({ value, }: {
        value: DynoVal<"bool" | "bvec2" | "ivec2" | "uvec2" | "vec2">;
    });
}
export declare class BVec3 extends SimpleCast<"bool" | "bvec3" | "ivec3" | "uvec3" | "vec3", "bvec3", "bvec3"> {
    constructor({ value, }: {
        value: DynoVal<"bool" | "bvec3" | "ivec3" | "uvec3" | "vec3">;
    });
}
export declare class BVec4 extends SimpleCast<"bool" | "bvec4" | "ivec4" | "uvec4" | "vec4", "bvec4", "bvec4"> {
    constructor({ value, }: {
        value: DynoVal<"bool" | "bvec4" | "ivec4" | "uvec4" | "vec4">;
    });
}
export declare class IVec2 extends SimpleCast<"int" | "bvec2" | "ivec2" | "uvec2" | "vec2", "ivec2", "ivec2"> {
    constructor({ value, }: {
        value: DynoVal<"int" | "bvec2" | "ivec2" | "uvec2" | "vec2">;
    });
}
export declare class IVec3 extends SimpleCast<"int" | "bvec3" | "ivec3" | "uvec3" | "vec3", "ivec3", "ivec3"> {
    constructor({ value, }: {
        value: DynoVal<"int" | "bvec3" | "ivec3" | "uvec3" | "vec3">;
    });
}
export declare class IVec4 extends SimpleCast<"int" | "bvec4" | "ivec4" | "uvec4" | "vec4", "ivec4", "ivec4"> {
    constructor({ value, }: {
        value: DynoVal<"int" | "bvec4" | "ivec4" | "uvec4" | "vec4">;
    });
}
export declare class UVec2 extends SimpleCast<"uint" | "ivec2" | "bvec2" | "uvec2" | "vec2", "uvec2", "uvec2"> {
    constructor({ value, }: {
        value: DynoVal<"uint" | "ivec2" | "bvec2" | "uvec2" | "vec2">;
    });
}
export declare class UVec3 extends SimpleCast<"uint" | "ivec3" | "bvec3" | "uvec3" | "vec3", "uvec3", "uvec3"> {
    constructor({ value, }: {
        value: DynoVal<"uint" | "ivec3" | "bvec3" | "uvec3" | "vec3">;
    });
}
export declare class UVec4 extends SimpleCast<"uint" | "ivec4" | "bvec4" | "uvec4" | "vec4", "uvec4", "uvec4"> {
    constructor({ value, }: {
        value: DynoVal<"uint" | "ivec4" | "bvec4" | "uvec4" | "vec4">;
    });
}
export declare class Vec2 extends SimpleCast<"float" | "bvec2" | "ivec2" | "uvec2" | "vec2" | "vec3" | "vec4", "vec2", "vec2"> {
    constructor({ value, }: {
        value: DynoVal<"float" | "bvec2" | "ivec2" | "uvec2" | "vec2" | "vec3" | "vec4">;
    });
}
export declare class Vec3 extends SimpleCast<"float" | "bvec3" | "ivec3" | "uvec3" | "vec3" | "vec2" | "vec4", "vec3", "vec3"> {
    constructor({ value, }: {
        value: DynoVal<"float" | "bvec3" | "ivec3" | "uvec3" | "vec3" | "vec2" | "vec4">;
    });
}
export declare class Vec4 extends SimpleCast<"float" | "bvec4" | "ivec4" | "uvec4" | "vec4", "vec4", "vec4"> {
    constructor({ value, }: {
        value: DynoVal<"float" | "bvec4" | "ivec4" | "uvec4" | "vec4">;
    });
}
export declare class Mat2 extends SimpleCast<"float" | "mat2" | "mat3" | "mat4", "mat2", "mat2"> {
    constructor({ value, }: {
        value: DynoVal<"float" | "mat2" | "mat3" | "mat4">;
    });
}
export declare class Mat3 extends SimpleCast<"float" | "mat2" | "mat3" | "mat4", "mat3", "mat3"> {
    constructor({ value, }: {
        value: DynoVal<"float" | "mat2" | "mat3" | "mat4">;
    });
}
export declare class Mat4 extends SimpleCast<"float" | "mat2" | "mat3" | "mat4", "mat4", "mat4"> {
    constructor({ value, }: {
        value: DynoVal<"float" | "mat2" | "mat3" | "mat4">;
    });
}
export declare class FloatBitsToInt extends UnaryOp<"float", "int", "int"> {
    constructor({ value }: {
        value: DynoVal<"float">;
    });
}
export declare class FloatBitsToUint extends UnaryOp<"float", "uint", "uint"> {
    constructor({ value }: {
        value: DynoVal<"float">;
    });
}
export declare class IntBitsToFloat extends UnaryOp<"int", "float", "float"> {
    constructor({ value }: {
        value: DynoVal<"int">;
    });
}
export declare class UintBitsToFloat extends UnaryOp<"uint", "float", "float"> {
    constructor({ value }: {
        value: DynoVal<"uint">;
    });
}
export declare class PackSnorm2x16 extends UnaryOp<"vec2", "uint", "uint"> {
    constructor({ value }: {
        value: DynoVal<"vec2">;
    });
}
export declare class UnpackSnorm2x16 extends UnaryOp<"uint", "vec2", "vec2"> {
    constructor({ value }: {
        value: DynoVal<"uint">;
    });
}
export declare class PackUnorm2x16 extends UnaryOp<"vec2", "uint", "uint"> {
    constructor({ value }: {
        value: DynoVal<"vec2">;
    });
}
export declare class UnpackUnorm2x16 extends UnaryOp<"uint", "vec2", "vec2"> {
    constructor({ value }: {
        value: DynoVal<"uint">;
    });
}
export declare class PackHalf2x16 extends UnaryOp<"vec2", "uint", "uint"> {
    constructor({ value }: {
        value: DynoVal<"vec2">;
    });
}
export declare class UnpackHalf2x16 extends UnaryOp<"uint", "vec2", "vec2"> {
    constructor({ value }: {
        value: DynoVal<"uint">;
    });
}
export declare class UintToRgba8 extends UnaryOp<"uint", "vec4", "rgba8"> {
    constructor({ value }: {
        value: DynoVal<"uint">;
    });
}
