import { BinaryOp, Dyno, TrinaryOp, UnaryOp } from './base';
import { FloatTypes, IntTypes, MatFloatTypes, SquareMatTypes, UintTypes, VectorElementType, VectorTypes } from './types';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const length: <A extends "vec2" | "vec3" | "vec4">(a: DynoVal<A>) => DynoVal<"float">;
export declare const distance: <A extends "vec2" | "vec3" | "vec4">(a: DynoVal<A>, b: DynoVal<A>) => DynoVal<"float">;
export declare const dot: <A extends "vec2" | "vec3" | "vec4">(a: DynoVal<A>, b: DynoVal<A>) => DynoVal<"float">;
export declare const cross: (a: DynoVal<"vec3">, b: DynoVal<"vec3">) => DynoVal<"vec3">;
export declare const normalize: <A extends "vec2" | "vec3" | "vec4">(a: DynoVal<A>) => DynoVal<A>;
export declare const faceforward: <A extends "vec2" | "vec3" | "vec4">(a: DynoVal<A>, b: DynoVal<A>, c: DynoVal<A>) => DynoVal<A>;
export declare const reflectVec: <A extends "vec2" | "vec3" | "vec4">(incident: DynoVal<A>, normal: DynoVal<A>) => DynoVal<A>;
export declare const refractVec: <A extends "vec2" | "vec3" | "vec4">(incident: DynoVal<A>, normal: DynoVal<A>, eta: DynoVal<"float">) => DynoVal<A>;
export declare const split: <V extends VectorTypes>(vector: DynoVal<V>) => Split<V>;
export declare const combine: <V extends VectorTypes, T extends VectorElementType<V>>({ vector, vectorType, x, y, z, w, r, g, b, a, }: {
    vector?: DynoVal<V>;
    vectorType?: V;
    x?: DynoVal<T>;
    y?: DynoVal<T>;
    z?: DynoVal<T>;
    w?: DynoVal<T>;
    r?: DynoVal<T>;
    g?: DynoVal<T>;
    b?: DynoVal<T>;
    a?: DynoVal<T>;
}) => DynoVal<V>;
export declare const projectH: <A extends "vec3" | "vec4">(a: DynoVal<A>) => DynoVal<ProjectHOutput<A>>;
export declare const extendVec: <A extends "float" | "vec2" | "vec3">(a: DynoVal<A>, b: DynoVal<"float">) => DynoVal<ExtendVecOutput<A>>;
export declare const swizzle: <A extends VectorTypes, S extends SwizzleSelect>(a: DynoVal<A>, select: S) => DynoVal<SwizzleOutput<A, SwizzleSelectLen<S>>>;
export declare const compMult: <A extends MatFloatTypes>(a: DynoVal<A>, b: DynoVal<A>) => DynoVal<A>;
export declare const outer: <A extends "vec2" | "vec3" | "vec4", B extends "vec2" | "vec3" | "vec4">(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<OuterOutput<A, B>>;
export declare const transpose: <A extends MatFloatTypes>(a: DynoVal<A>) => DynoVal<TransposeOutput<A>>;
export declare const determinant: <A extends SquareMatTypes>(a: DynoVal<A>) => DynoVal<"float">;
export declare const inverse: <A extends SquareMatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare class Length<A extends "vec2" | "vec3" | "vec4"> extends UnaryOp<A, "float", "length"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Distance<A extends "vec2" | "vec3" | "vec4"> extends BinaryOp<A, A, "float", "distance"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<A>;
    });
}
export declare class Dot<A extends "vec2" | "vec3" | "vec4"> extends BinaryOp<A, A, "float", "dot"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<A>;
    });
}
export declare class Cross extends BinaryOp<"vec3", "vec3", "vec3", "cross"> {
    constructor({ a, b }: {
        a: DynoVal<"vec3">;
        b: DynoVal<"vec3">;
    });
}
export declare class Normalize<A extends "vec2" | "vec3" | "vec4"> extends UnaryOp<A, A, "normalize"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
type ProjectHOutput<A extends "vec3" | "vec4"> = A extends "vec3" ? "vec2" : A extends "vec4" ? "vec3" : never;
export declare class ProjectH<A extends "vec3" | "vec4"> extends UnaryOp<A, ProjectHOutput<A>, "projected"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
type ExtendVecOutput<A extends "float" | "vec2" | "vec3"> = A extends "float" ? "vec2" : A extends "vec2" ? "vec3" : A extends "vec3" ? "vec4" : never;
export declare class ExtendVec<A extends "float" | "vec2" | "vec3"> extends BinaryOp<A, "float", ExtendVecOutput<A>, "extend"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<"float">;
    });
}
export declare class FaceForward<A extends "vec2" | "vec3" | "vec4"> extends TrinaryOp<A, A, A, A, "forward"> {
    constructor({ a, b, c }: {
        a: DynoVal<A>;
        b: DynoVal<A>;
        c: DynoVal<A>;
    });
}
export declare class ReflectVec<A extends "vec2" | "vec3" | "vec4"> extends BinaryOp<A, A, A, "reflection"> {
    constructor({ incident, normal, }: {
        incident: DynoVal<A>;
        normal: DynoVal<A>;
    });
}
export declare class RefractVec<A extends "vec2" | "vec3" | "vec4"> extends TrinaryOp<A, A, "float", A, "refraction"> {
    constructor({ incident, normal, eta, }: {
        incident: DynoVal<A>;
        normal: DynoVal<A>;
        eta: DynoVal<"float">;
    });
}
export declare class CompMult<A extends MatFloatTypes> extends BinaryOp<A, A, A, "product"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<A>;
    });
}
type OuterOutput<A extends "vec2" | "vec3" | "vec4", B extends "vec2" | "vec3" | "vec4"> = A extends "vec2" ? B extends "vec2" ? "mat2" : B extends "vec3" ? "mat3x2" : B extends "vec4" ? "mat4x2" : never : A extends "vec3" ? B extends "vec2" ? "mat2x3" : B extends "vec3" ? "mat3" : B extends "vec4" ? "mat4x3" : never : A extends "vec4" ? B extends "vec2" ? "mat2x4" : B extends "vec3" ? "mat3x4" : B extends "vec4" ? "mat4" : never : never;
export declare class Outer<A extends "vec2" | "vec3" | "vec4", B extends "vec2" | "vec3" | "vec4"> extends BinaryOp<A, B, OuterOutput<A, B>, "outer"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
type TransposeOutput<A extends MatFloatTypes> = A extends SquareMatTypes ? A : A extends "mat2x3" ? "mat3x2" : A extends "mat2x4" ? "mat4x2" : A extends "mat3x2" ? "mat2x3" : A extends "mat3x4" ? "mat4x3" : A extends "mat4x2" ? "mat2x4" : A extends "mat4x3" ? "mat3x4" : never;
export declare class Transpose<A extends MatFloatTypes> extends UnaryOp<A, TransposeOutput<A>, "transpose"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Determinant<A extends SquareMatTypes> extends UnaryOp<A, "float", "det"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Inverse<A extends SquareMatTypes> extends UnaryOp<A, A, "inverse"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
type SplitOutTypes<A extends VectorTypes> = A extends "vec2" ? {
    x: "float";
    y: "float";
    r: "float";
    g: "float";
} : A extends "vec3" ? {
    x: "float";
    y: "float";
    z: "float";
    r: "float";
    g: "float";
    b: "float";
} : A extends "vec4" ? {
    x: "float";
    y: "float";
    z: "float";
    w: "float";
    r: "float";
    g: "float";
    b: "float";
    a: "float";
} : A extends "ivec2" ? {
    x: "int";
    y: "int";
    r: "int";
    g: "int";
} : A extends "ivec3" ? {
    x: "int";
    y: "int";
    z: "int";
    r: "int";
    g: "int";
    b: "int";
} : A extends "ivec4" ? {
    x: "int";
    y: "int";
    z: "int";
    w: "int";
    r: "int";
    g: "int";
    b: "int";
    a: "int";
} : A extends "uvec2" ? {
    x: "uint";
    y: "uint";
    r: "uint";
    g: "uint";
} : A extends "uvec3" ? {
    x: "uint";
    y: "uint";
    z: "uint";
    r: "uint";
    g: "uint";
    b: "uint";
} : A extends "uvec4" ? {
    x: "uint";
    y: "uint";
    z: "uint";
    w: "uint";
    r: "uint";
    g: "uint";
    b: "uint";
    a: "uint";
} : never;
export declare class Split<V extends VectorTypes> extends Dyno<{
    vector: V;
}, SplitOutTypes<V>> {
    constructor({ vector }: {
        vector: DynoVal<V>;
    });
}
export declare class Combine<V extends VectorTypes, T extends VectorElementType<V>> extends Dyno<SplitOutTypes<V> & {
    vector: V;
}, {
    vector: V;
}> implements HasDynoOut<V> {
    constructor({ vector, vectorType, x, y, z, w, r, g, b, a, }: {
        vector?: DynoVal<V>;
        vectorType?: V;
        x?: DynoVal<T>;
        y?: DynoVal<T>;
        z?: DynoVal<T>;
        w?: DynoVal<T>;
        r?: DynoVal<T>;
        g?: DynoVal<T>;
        b?: DynoVal<T>;
        a?: DynoVal<T>;
    });
    dynoOut(): DynoValue<V>;
}
type SwizzleOutput<A extends VectorTypes, Len extends number> = A extends FloatTypes ? Len extends 1 ? "float" : Len extends 2 ? "vec2" : Len extends 3 ? "vec3" : Len extends 4 ? "vec4" : never : A extends IntTypes ? Len extends 1 ? "int" : Len extends 2 ? "ivec2" : Len extends 3 ? "ivec3" : Len extends 4 ? "ivec4" : never : A extends UintTypes ? Len extends 1 ? "uint" : Len extends 2 ? "uvec2" : Len extends 3 ? "uvec3" : Len extends 4 ? "uvec4" : never : never;
type SwizzleSelectLen<S extends SwizzleSelect> = S extends Swizzle1Select ? 1 : S extends Swizzle2Select ? 2 : S extends Swizzle3Select ? 3 : S extends Swizzle4Select ? 4 : never;
type Swizzle1Select = `${"x" | "y" | "z" | "w"}|${"r" | "g" | "b" | "a"}`;
type Swizzle2Select = `${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}` | `${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}`;
type Swizzle3Select = `${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}` | `${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}`;
type Swizzle4Select = `${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}` | `${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}`;
type SwizzleSelect = Swizzle1Select | Swizzle2Select | Swizzle3Select | Swizzle4Select;
export declare class Swizzle<A extends VectorTypes, S extends SwizzleSelect> extends UnaryOp<A, SwizzleOutput<A, SwizzleSelectLen<S>>, "swizzle"> {
    constructor({ vector, select }: {
        vector: DynoVal<A>;
        select: S;
    });
}
export {};
