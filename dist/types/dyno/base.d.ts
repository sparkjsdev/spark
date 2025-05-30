import { IUniform } from 'three';
import { DynoType } from './types';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare class Compilation {
    globals: Set<string>;
    statements: string[];
    uniforms: Record<string, IUniform>;
    declares: Set<string>;
    updaters: (() => void)[];
    sequence: number;
    indent: string;
    constructor({ indent }?: {
        indent?: string;
    });
    nextSequence(): number;
}
export type IOTypes = Record<string, DynoType>;
type GenerateContext<InTypes extends IOTypes, OutTypes extends IOTypes> = {
    inputs: {
        [K in keyof InTypes]?: string;
    };
    outputs: {
        [K in keyof OutTypes]?: string;
    };
    compile: Compilation;
};
export declare class Dyno<InTypes extends IOTypes, OutTypes extends IOTypes> {
    inTypes: InTypes;
    outTypes: OutTypes;
    inputs: {
        [K in keyof InTypes]?: DynoVal<InTypes[K]>;
    };
    update?: () => void;
    globals?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => string[];
    statements?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => string[];
    generate: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => {
        globals?: string[];
        statements?: string[];
        uniforms?: Record<string, IUniform>;
    };
    constructor({ inTypes, outTypes, inputs, update, globals, statements, generate, }: {
        inTypes?: InTypes;
        outTypes?: OutTypes;
        inputs?: {
            [K in keyof InTypes]?: DynoVal<InTypes[K]>;
        };
        update?: () => void;
        globals?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => string[];
        statements?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => string[];
        generate?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => {
            globals?: string[];
            statements?: string[];
            uniforms?: Record<string, IUniform>;
        };
    });
    get outputs(): {
        [K in keyof OutTypes]: DynoVal<OutTypes[K]>;
    };
    apply(inputs: {
        [K in keyof InTypes]?: DynoVal<InTypes[K]>;
    }): {
        [K in keyof OutTypes]: DynoVal<OutTypes[K]>;
    };
    compile({ inputs, outputs, compile, }: {
        inputs: {
            [K in keyof InTypes]?: string;
        };
        outputs: {
            [K in keyof OutTypes]?: string;
        };
        compile: Compilation;
    }): string[];
}
export type DynoBlockType<InTypes extends IOTypes, OutTypes extends IOTypes> = (inputs: {
    [K in keyof InTypes]?: DynoVal<InTypes[K]>;
}, outputs: {
    [K in keyof OutTypes]?: DynoVal<OutTypes[K]>;
}, { roots }: {
    roots: Dyno<InTypes, OutTypes>[];
}) => {
    [K in keyof OutTypes]?: DynoVal<OutTypes[K]>;
} | undefined;
export declare class DynoBlock<InTypes extends IOTypes, OutTypes extends IOTypes> extends Dyno<InTypes, OutTypes> {
    construct: DynoBlockType<InTypes, OutTypes>;
    constructor({ inTypes, outTypes, inputs, update, globals, construct, }: {
        inTypes?: InTypes;
        outTypes?: OutTypes;
        inputs?: {
            [K in keyof InTypes]?: DynoVal<InTypes[K]>;
        };
        update?: () => void;
        globals?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => string[];
        construct: DynoBlockType<InTypes, OutTypes>;
    });
    generateBlock({ inputs, outputs, compile, }: {
        inputs: {
            [K in keyof InTypes]?: string;
        };
        outputs: {
            [K in keyof OutTypes]?: string;
        };
        compile: Compilation;
    }): {
        statements: string[];
    };
}
export declare function dynoBlock<InTypes extends Record<string, DynoType>, OutTypes extends Record<string, DynoType>>(inTypes: InTypes, outTypes: OutTypes, construct: DynoBlockType<InTypes, OutTypes>, { update, globals }?: {
    update?: () => void;
    globals?: () => string[];
}): DynoBlock<InTypes, OutTypes>;
export declare function dyno<InTypes extends Record<string, DynoType>, OutTypes extends Record<string, DynoType>>({ inTypes, outTypes, inputs, update, globals, statements, generate, }: {
    inTypes: InTypes;
    outTypes: OutTypes;
    inputs?: {
        [K in keyof InTypes]?: DynoVal<InTypes[K]>;
    };
    update?: () => void;
    globals?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => string[];
    statements?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => string[];
    generate?: ({ inputs, outputs, compile, }: GenerateContext<InTypes, OutTypes>) => {
        globals?: string[];
        statements?: string[];
        uniforms?: Record<string, IUniform>;
    };
}): Dyno<InTypes, OutTypes>;
export declare function dynoDeclare(name: string, type: DynoType, count?: number): string;
export declare function unindentLines(s: string): string[];
export declare function unindent(s: string): string;
export declare class UnaryOp<A extends DynoType, OutType extends DynoType, OutKey extends string> extends Dyno<{
    a: A;
}, {
    [key in OutKey]: OutType;
}> implements HasDynoOut<OutType> {
    constructor({ a, outKey, outTypeFunc, }: {
        a: DynoVal<A>;
        outKey: OutKey;
        outTypeFunc: (aType: A) => OutType;
    });
    outKey: OutKey;
    dynoOut(): DynoValue<OutType>;
}
export declare class BinaryOp<A extends DynoType, B extends DynoType, OutType extends DynoType, OutKey extends string> extends Dyno<{
    a: A;
    b: B;
}, {
    [key in OutKey]: OutType;
}> implements HasDynoOut<OutType> {
    constructor({ a, b, outKey, outTypeFunc, }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
        outKey: OutKey;
        outTypeFunc: (aType: A, bType: B) => OutType;
    });
    outKey: OutKey;
    dynoOut(): DynoValue<OutType>;
}
export declare class TrinaryOp<A extends DynoType, B extends DynoType, C extends DynoType, OutType extends DynoType, OutKey extends string> extends Dyno<{
    a: A;
    b: B;
    c: C;
}, {
    [key in OutKey]: OutType;
}> implements HasDynoOut<OutType> {
    constructor({ a, b, c, outKey, outTypeFunc, }: {
        a: DynoVal<A>;
        b: DynoVal<B>;
        c: DynoVal<C>;
        outKey: OutKey;
        outTypeFunc: (aType: A, bType: B, cType: C) => OutType;
    });
    outKey: OutKey;
    dynoOut(): DynoValue<OutType>;
}
export {};
