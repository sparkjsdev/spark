import { BinaryOp, TrinaryOp, UnaryOp } from './base';
import { AllIntTypes, BoolTypes, IntTypes, ScalarTypes, SimpleTypes, UintTypes, ValueTypes } from './types';
import { DynoVal } from './value';
export declare const and: <T extends "bool" | AllIntTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<T>;
export declare const or: <T extends "bool" | AllIntTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<T>;
export declare const xor: <T extends "bool" | AllIntTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<T>;
export declare const not: <T extends BoolTypes | AllIntTypes>(a: DynoVal<T>) => DynoVal<T>;
export declare const lessThan: <T extends ValueTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<CompareOutput<T>>;
export declare const lessThanEqual: <T extends ValueTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<CompareOutput<T>>;
export declare const greaterThan: <T extends ValueTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<CompareOutput<T>>;
export declare const greaterThanEqual: <T extends ValueTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<CompareOutput<T>>;
export declare const equal: <T extends ValueTypes | BoolTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<EqualOutput<T>>;
export declare const notEqual: <T extends ValueTypes | BoolTypes>(a: DynoVal<T>, b: DynoVal<T>) => DynoVal<NotEqualOutput<T>>;
export declare const any: <T extends "bvec2" | "bvec3" | "bvec4">(a: DynoVal<T>) => DynoVal<"bool">;
export declare const all: <T extends "bvec2" | "bvec3" | "bvec4">(a: DynoVal<T>) => DynoVal<"bool">;
export declare const select: <T extends SimpleTypes>(cond: DynoVal<"bool">, t: DynoVal<T>, f: DynoVal<T>) => DynoVal<T>;
export declare const compXor: <T extends BoolTypes | AllIntTypes>(a: DynoVal<T>) => DynoVal<CompXorOutput<T>>;
export declare class And<T extends "bool" | AllIntTypes> extends BinaryOp<T, T, T, "and"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class Or<T extends "bool" | AllIntTypes> extends BinaryOp<T, T, T, "or"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class Xor<T extends "bool" | AllIntTypes> extends BinaryOp<T, T, T, "xor"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class Not<T extends BoolTypes | AllIntTypes> extends UnaryOp<T, T, "not"> {
    constructor({ a }: {
        a: DynoVal<T>;
    });
}
export declare class LessThan<T extends ValueTypes> extends BinaryOp<T, T, CompareOutput<T>, "lessThan"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class LessThanEqual<T extends ValueTypes> extends BinaryOp<T, T, CompareOutput<T>, "lessThanEqual"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class GreaterThan<T extends ValueTypes> extends BinaryOp<T, T, CompareOutput<T>, "greaterThan"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class GreaterThanEqual<T extends ValueTypes> extends BinaryOp<T, T, CompareOutput<T>, "greaterThanEqual"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class Equal<T extends ValueTypes | BoolTypes> extends BinaryOp<T, T, EqualOutput<T>, "equal"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class NotEqual<T extends ValueTypes | BoolTypes> extends BinaryOp<T, T, NotEqualOutput<T>, "notEqual"> {
    constructor({ a, b }: {
        a: DynoVal<T>;
        b: DynoVal<T>;
    });
}
export declare class Any<T extends BoolTypes> extends UnaryOp<T, "bool", "any"> {
    constructor({ a }: {
        a: DynoVal<T>;
    });
}
export declare class All<T extends BoolTypes> extends UnaryOp<T, "bool", "all"> {
    constructor({ a }: {
        a: DynoVal<T>;
    });
}
export declare class Select<T extends SimpleTypes> extends TrinaryOp<"bool", T, T, T, "select"> {
    constructor({ cond, t, f, }: {
        cond: DynoVal<"bool">;
        t: DynoVal<T>;
        f: DynoVal<T>;
    });
}
type CompareOutput<T extends ValueTypes> = T extends ScalarTypes ? "bool" : T extends "ivec2" | "uvec2" | "vec2" ? "bvec2" : T extends "ivec3" | "uvec3" | "vec3" ? "bvec3" : T extends "ivec4" | "uvec4" | "vec4" ? "bvec4" : never;
type EqualOutput<A extends ValueTypes | BoolTypes> = A extends ScalarTypes ? "bool" : A extends BoolTypes ? A : A extends "ivec2" | "uvec2" | "vec2" ? "bvec2" : A extends "ivec3" | "uvec3" | "vec3" ? "bvec3" : A extends "ivec4" | "uvec4" | "vec4" ? "bvec4" : never;
type NotEqualOutput<A extends ValueTypes | BoolTypes> = EqualOutput<A>;
type CompXorOutput<A extends BoolTypes | AllIntTypes> = A extends BoolTypes ? "bool" : A extends IntTypes ? "int" : A extends UintTypes ? "uint" : never;
export declare class CompXor<T extends BoolTypes | AllIntTypes> extends UnaryOp<T, CompXorOutput<T>, "compXor"> {
    constructor({ a }: {
        a: DynoVal<T>;
    });
}
export {};
