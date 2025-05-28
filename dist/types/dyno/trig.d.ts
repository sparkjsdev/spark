import { BinaryOp, UnaryOp } from './base';
import { FloatTypes } from './types';
import { DynoVal } from './value';
export declare const radians: <A extends FloatTypes>(degrees: DynoVal<A>) => DynoVal<A>;
export declare const degrees: <A extends FloatTypes>(radians: DynoVal<A>) => DynoVal<A>;
export declare const sin: <A extends FloatTypes>(radians: DynoVal<A>) => DynoVal<A>;
export declare const cos: <A extends FloatTypes>(radians: DynoVal<A>) => DynoVal<A>;
export declare const tan: <A extends FloatTypes>(radians: DynoVal<A>) => DynoVal<A>;
export declare const asin: <A extends FloatTypes>(sin: DynoVal<A>) => DynoVal<A>;
export declare const acos: <A extends FloatTypes>(cos: DynoVal<A>) => DynoVal<A>;
export declare const atan: <A extends FloatTypes>(tan: DynoVal<A>) => DynoVal<A>;
export declare const atan2: <A extends FloatTypes>(y: DynoVal<A>, x: DynoVal<A>) => DynoVal<A>;
export declare const sinh: <A extends FloatTypes>(x: DynoVal<A>) => DynoVal<A>;
export declare const cosh: <A extends FloatTypes>(x: DynoVal<A>) => DynoVal<A>;
export declare const tanh: <A extends FloatTypes>(x: DynoVal<A>) => DynoVal<A>;
export declare const asinh: <A extends FloatTypes>(x: DynoVal<A>) => DynoVal<A>;
export declare const acosh: <A extends FloatTypes>(x: DynoVal<A>) => DynoVal<A>;
export declare const atanh: <A extends FloatTypes>(x: DynoVal<A>) => DynoVal<A>;
export declare class Radians<A extends FloatTypes> extends UnaryOp<A, A, "radians"> {
    constructor({ degrees }: {
        degrees: DynoVal<A>;
    });
}
export declare class Degrees<A extends FloatTypes> extends UnaryOp<A, A, "degrees"> {
    constructor({ radians }: {
        radians: DynoVal<A>;
    });
}
export declare class Sin<A extends FloatTypes> extends UnaryOp<A, A, "sin"> {
    constructor({ radians }: {
        radians: DynoVal<A>;
    });
}
export declare class Cos<A extends FloatTypes> extends UnaryOp<A, A, "cos"> {
    constructor({ radians }: {
        radians: DynoVal<A>;
    });
}
export declare class Tan<A extends FloatTypes> extends UnaryOp<A, A, "tan"> {
    constructor({ radians }: {
        radians: DynoVal<A>;
    });
}
export declare class Asin<A extends FloatTypes> extends UnaryOp<A, A, "asin"> {
    constructor({ sin }: {
        sin: DynoVal<A>;
    });
}
export declare class Acos<A extends FloatTypes> extends UnaryOp<A, A, "acos"> {
    constructor({ cos }: {
        cos: DynoVal<A>;
    });
}
export declare class Atan<A extends FloatTypes> extends UnaryOp<A, A, "atan"> {
    constructor({ tan }: {
        tan: DynoVal<A>;
    });
}
export declare class Atan2<A extends FloatTypes> extends BinaryOp<A, A, A, "atan2"> {
    constructor({ y, x }: {
        y: DynoVal<A>;
        x: DynoVal<A>;
    });
}
export declare class Sinh<A extends FloatTypes> extends UnaryOp<A, A, "sinh"> {
    constructor({ x }: {
        x: DynoVal<A>;
    });
}
export declare class Cosh<A extends FloatTypes> extends UnaryOp<A, A, "cosh"> {
    constructor({ x }: {
        x: DynoVal<A>;
    });
}
export declare class Tanh<A extends FloatTypes> extends UnaryOp<A, A, "tanh"> {
    constructor({ x }: {
        x: DynoVal<A>;
    });
}
export declare class Asinh<A extends FloatTypes> extends UnaryOp<A, A, "asinh"> {
    constructor({ x }: {
        x: DynoVal<A>;
    });
}
export declare class Acosh<A extends FloatTypes> extends UnaryOp<A, A, "acosh"> {
    constructor({ x }: {
        x: DynoVal<A>;
    });
}
export declare class Atanh<A extends FloatTypes> extends UnaryOp<A, A, "atanh"> {
    constructor({ x }: {
        x: DynoVal<A>;
    });
}
