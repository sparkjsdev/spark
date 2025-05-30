import { BinaryOp, Dyno, TrinaryOp, UnaryOp } from './base';
import { AddOutput, ClampOutput, DivOutput, IModOutput, IsInfOutput, IsNanOutput, MaxOutput, MinOutput, MixOutput, ModOutput, MulOutput, SmoothstepOutput, StepOutput, SubOutput } from './mathTypes';
import { AllIntTypes, AllSignedTypes, AllValueTypes, BoolTypes, FloatTypes, SignedTypes, ValueTypes } from './types';
import { DynoVal } from './value';
export declare const add: <A extends AllValueTypes, B extends AllValueTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<AddOutput<A, B>>;
export declare const sub: <A extends AllValueTypes, B extends AllValueTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<SubOutput<A, B>>;
export declare const mul: <A extends AllValueTypes, B extends AllValueTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<MulOutput<A, B>>;
export declare const div: <A extends AllValueTypes, B extends AllValueTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<DivOutput<A, B>>;
export declare const imod: <A extends AllIntTypes, B extends AllIntTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<IModOutput<A, B>>;
export declare const mod: <A extends FloatTypes, B extends FloatTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<ModOutput<A, B>>;
export declare const modf: <A extends FloatTypes>(a: DynoVal<A>) => {
    fract: DynoVal<A>;
    integer: DynoVal<A>;
};
export declare const neg: <A extends AllSignedTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const abs: <A extends SignedTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const sign: <A extends SignedTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const floor: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const ceil: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const trunc: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const round: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const fract: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const pow: <A extends FloatTypes>(a: DynoVal<A>, b: DynoVal<A>) => DynoVal<A>;
export declare const exp: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const exp2: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const log: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const log2: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const sqr: <A extends ValueTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const sqrt: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const inversesqrt: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<A>;
export declare const min: <A extends ValueTypes, B extends ValueTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<MinOutput<A, B>>;
export declare const max: <A extends ValueTypes, B extends ValueTypes>(a: DynoVal<A>, b: DynoVal<B>) => DynoVal<MaxOutput<A, B>>;
export declare const clamp: <A extends ValueTypes, MinMax extends ValueTypes>(a: DynoVal<A>, min: DynoVal<MinMax>, max: DynoVal<MinMax>) => DynoVal<ClampOutput<A, MinMax>>;
export declare const mix: <A extends FloatTypes, T extends FloatTypes | BoolTypes>(a: DynoVal<A>, b: DynoVal<A>, t: DynoVal<T>) => DynoVal<MixOutput<A, T>>;
export declare const step: <A extends FloatTypes, B extends FloatTypes>(edge: DynoVal<A>, x: DynoVal<B>) => DynoVal<StepOutput<A, B>>;
export declare const smoothstep: <X extends FloatTypes, Edge extends X | "float">(edge0: DynoVal<Edge>, edge1: DynoVal<Edge>, x: DynoVal<X>) => DynoVal<SmoothstepOutput<Edge, Edge, X>>;
export declare const isNan: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<IsNanOutput<A>>;
export declare const isInf: <A extends FloatTypes>(a: DynoVal<A>) => DynoVal<IsInfOutput<A>>;
export declare class Add<A extends AllValueTypes, B extends AllValueTypes> extends BinaryOp<A, B, AddOutput<A, B>, "sum"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class Sub<A extends AllValueTypes, B extends AllValueTypes> extends BinaryOp<A, B, SubOutput<A, B>, "difference"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class Mul<A extends AllValueTypes, B extends AllValueTypes> extends BinaryOp<A, B, MulOutput<A, B>, "product"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class Div<A extends AllValueTypes, B extends AllValueTypes> extends BinaryOp<A, B, DivOutput<A, B>, "quotient"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class IMod<A extends AllIntTypes, B extends AllIntTypes> extends BinaryOp<A, B, IModOutput<A, B>, "remainder"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class Mod<A extends FloatTypes, B extends FloatTypes> extends BinaryOp<A, B, ModOutput<A, B>, "remainder"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class Modf<A extends FloatTypes> extends Dyno<{
    a: A;
}, {
    fract: A;
    integer: A;
}> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Neg<A extends AllSignedTypes> extends UnaryOp<A, A, "neg"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Abs<A extends SignedTypes> extends UnaryOp<A, A, "abs"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Sign<A extends SignedTypes> extends UnaryOp<A, A, "sign"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Floor<A extends FloatTypes> extends UnaryOp<A, A, "floor"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Ceil<A extends FloatTypes> extends UnaryOp<A, A, "ceil"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Trunc<A extends FloatTypes> extends UnaryOp<A, A, "trunc"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Round<A extends FloatTypes> extends UnaryOp<A, A, "round"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Fract<A extends FloatTypes> extends UnaryOp<A, A, "fract"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Pow<A extends FloatTypes> extends BinaryOp<A, A, A, "power"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<A>;
    });
}
export declare class Exp<A extends FloatTypes> extends UnaryOp<A, A, "exp"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Exp2<A extends FloatTypes> extends UnaryOp<A, A, "exp2"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Log<A extends FloatTypes> extends UnaryOp<A, A, "log"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Log2<A extends FloatTypes> extends UnaryOp<A, A, "log2"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Sqr<A extends ValueTypes> extends UnaryOp<A, A, "sqr"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Sqrt<A extends FloatTypes> extends UnaryOp<A, A, "sqrt"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class InverseSqrt<A extends FloatTypes> extends UnaryOp<A, A, "inversesqrt"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class Min<A extends ValueTypes, B extends ValueTypes> extends BinaryOp<A, B, MinOutput<A, B>, "min"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class Max<A extends ValueTypes, B extends ValueTypes> extends BinaryOp<A, B, MaxOutput<A, B>, "max"> {
    constructor({ a, b }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
    });
}
export declare class Clamp<A extends ValueTypes, MinMax extends ValueTypes> extends TrinaryOp<A, MinMax, MinMax, ClampOutput<A, MinMax>, "clamp"> {
    constructor({ a, min, max, }: {
        a: DynoVal<A>;
        min: DynoVal<MinMax>;
        max: DynoVal<MinMax>;
    });
}
export declare class Mix<A extends FloatTypes, T extends FloatTypes | BoolTypes> extends TrinaryOp<A, A, T, MixOutput<A, T>, "mix"> {
    constructor({ a, b, t }: {
        a: DynoVal<A>;
        b: DynoVal<A>;
        t: DynoVal<T>;
    });
}
export declare class Step<Edge extends FloatTypes, X extends FloatTypes> extends BinaryOp<Edge, X, StepOutput<Edge, X>, "step"> {
    constructor({ edge, x }: {
        edge: DynoVal<Edge>;
        x: DynoVal<X>;
    });
}
export declare class Smoothstep<X extends FloatTypes, Edge extends X | "float"> extends TrinaryOp<Edge, Edge, X, SmoothstepOutput<Edge, Edge, X>, "smoothstep"> {
    constructor({ edge0, edge1, x, }: {
        edge0: DynoVal<Edge>;
        edge1: DynoVal<Edge>;
        x: DynoVal<X>;
    });
}
export declare class IsNan<A extends FloatTypes> extends UnaryOp<A, IsNanOutput<A>, "isNan"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
export declare class IsInf<A extends FloatTypes> extends UnaryOp<A, IsInfOutput<A>, "isInf"> {
    constructor({ a }: {
        a: DynoVal<A>;
    });
}
