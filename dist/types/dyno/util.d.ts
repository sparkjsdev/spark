import { Dyno, DynoBlock } from './base';
import { ValueTypes } from './types';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const remapIndex: (index: DynoVal<"int">, from: DynoVal<"int">, to: DynoVal<"int">) => DynoVal<"int">;
export declare const pcgMix: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"uint">;
export declare const pcgNext: (state: DynoVal<"uint">) => DynoVal<"uint">;
export declare const pcgHash: (state: DynoVal<"uint">) => DynoVal<"uint">;
export declare const hash: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"uint">;
export declare const hash2: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"uvec2">;
export declare const hash3: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"uvec3">;
export declare const hash4: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"uvec4">;
export declare const hashFloat: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"float">;
export declare const hashVec2: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"vec2">;
export declare const hashVec3: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"vec3">;
export declare const hashVec4: <T extends ValueTypes>(value: DynoVal<T>) => DynoVal<"vec4">;
export declare class DynoRemapIndex extends Dyno<{
    from: "int";
    to: "int";
    index: "int";
}, {
    index: "int";
}> implements HasDynoOut<"int"> {
    constructor({ from, to, index, }: {
        from: DynoVal<"int">;
        to: DynoVal<"int">;
        index: DynoVal<"int">;
    });
    dynoOut(): DynoValue<"int">;
}
export declare class PcgNext<T extends "uint" | "int" | "float"> extends Dyno<{
    state: T;
}, {
    state: "uint";
}> implements HasDynoOut<"uint"> {
    constructor({ state }: {
        state: DynoVal<T>;
    });
    dynoOut(): DynoValue<"uint">;
}
export declare class PcgHash extends Dyno<{
    state: "uint";
}, {
    hash: "uint";
}> implements HasDynoOut<"uint"> {
    constructor({ state }: {
        state: DynoVal<"uint">;
    });
    dynoOut(): DynoValue<"uint">;
}
export declare class PcgMix<T extends ValueTypes> extends Dyno<{
    value: T;
}, {
    state: "uint";
}> implements HasDynoOut<"uint"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"uint">;
}
export declare class Hash<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "uint";
}> implements HasDynoOut<"uint"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"uint">;
}
export declare class Hash2<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "uvec2";
}> implements HasDynoOut<"uvec2"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"uvec2">;
}
export declare class Hash3<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "uvec3";
}> implements HasDynoOut<"uvec3"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"uvec3">;
}
export declare class Hash4<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "uvec4";
}> implements HasDynoOut<"uvec4"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"uvec4">;
}
export declare class HashFloat<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "float";
}> implements HasDynoOut<"float"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"float">;
}
export declare class HashVec2<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "vec2";
}> implements HasDynoOut<"vec2"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"vec2">;
}
export declare class HashVec3<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "vec3";
}> implements HasDynoOut<"vec3"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"vec3">;
}
export declare class HashVec4<T extends ValueTypes> extends DynoBlock<{
    value: T;
}, {
    hash: "vec4";
}> implements HasDynoOut<"vec4"> {
    constructor({ value }: {
        value: DynoVal<T>;
    });
    dynoOut(): DynoValue<"vec4">;
}
