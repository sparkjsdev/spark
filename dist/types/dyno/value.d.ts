import { Dyno, IOTypes } from './base';
import { DynoJsType, DynoType, SimpleTypes } from './types';
export type DynoVal<T extends DynoType> = DynoValue<T> | HasDynoOut<T>;
export declare function valType<T extends DynoType>(val: DynoVal<T>): T;
export interface HasDynoOut<T extends DynoType> {
    dynoOut(): DynoValue<T>;
}
export declare class DynoValue<T extends DynoType> {
    type: T;
    private __isDynoValue;
    constructor(type: T);
}
export declare class DynoOutput<T extends DynoType, InTypes extends IOTypes, OutTypes extends IOTypes> extends DynoValue<T> {
    dyno: Dyno<InTypes, OutTypes>;
    key: string;
    constructor(dyno: Dyno<InTypes, OutTypes>, key: string);
}
export declare class DynoLiteral<T extends DynoType> extends DynoValue<T> {
    literal: string;
    constructor(type: T, literal: string);
    getLiteral(): string;
}
export declare function dynoLiteral<T extends DynoType>(type: T, literal: string): DynoLiteral<T>;
export declare class DynoConst<T extends DynoType> extends DynoLiteral<T> {
    value: DynoJsType<T>;
    constructor(type: T, value: DynoJsType<T>);
    getLiteral(): string;
}
export declare function dynoConst<T extends DynoType>(type: T, value: DynoJsType<T>): DynoConst<T>;
export declare function literalZero(type: SimpleTypes): string;
export declare function literalOne(type: SimpleTypes): string;
export declare function literalNegOne(type: SimpleTypes): string;
