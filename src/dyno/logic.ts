import { BinaryOp, TrinaryOp, UnaryOp } from "./base";
import {
  type AllIntTypes,
  type BoolTypes,
  type IntTypes,
  type ScalarTypes,
  type SimpleTypes,
  type UintTypes,
  type ValueTypes,
  isBoolType,
  isIntType,
  isScalarType,
  isUintType,
  isVector2Type,
  isVector3Type,
} from "./types";
import { type DynoVal, valType } from "./value";

export const and = <T extends "bool" | AllIntTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<T> => new And({ a, b });
export const or = <T extends "bool" | AllIntTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<T> => new Or({ a, b });
export const xor = <T extends "bool" | AllIntTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<T> => new Xor({ a, b });
export const not = <T extends BoolTypes | AllIntTypes>(
  a: DynoVal<T>,
): DynoVal<T> => new Not({ a });

export const shr = <T extends IntTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<T> => new Shr({ a, b });

export const shl = <T extends IntTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<T> => new Shl({ a, b });

export const lessThan = <T extends ValueTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<CompareOutput<T>> => new LessThan({ a, b });
export const lessThanEqual = <T extends ValueTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<CompareOutput<T>> => new LessThanEqual({ a, b });
export const greaterThan = <T extends ValueTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<CompareOutput<T>> => new GreaterThan({ a, b });
export const greaterThanEqual = <T extends ValueTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<CompareOutput<T>> => new GreaterThanEqual({ a, b });
export const equal = <T extends ValueTypes | BoolTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<EqualOutput<T>> => new Equal({ a, b });
export const notEqual = <T extends ValueTypes | BoolTypes>(
  a: DynoVal<T>,
  b: DynoVal<T>,
): DynoVal<NotEqualOutput<T>> => new NotEqual({ a, b });

export const any = <T extends "bvec2" | "bvec3" | "bvec4">(
  a: DynoVal<T>,
): DynoVal<"bool"> => new Any({ a });
export const all = <T extends "bvec2" | "bvec3" | "bvec4">(
  a: DynoVal<T>,
): DynoVal<"bool"> => new All({ a });
export const select = <T extends SimpleTypes>(
  cond: DynoVal<"bool">,
  t: DynoVal<T>,
  f: DynoVal<T>,
): DynoVal<T> => new Select({ cond, t, f });

export const compXor = <T extends BoolTypes | AllIntTypes>(
  a: DynoVal<T>,
): DynoVal<CompXorOutput<T>> => new CompXor({ a });

export class And<T extends "bool" | AllIntTypes> extends BinaryOp<
  T,
  T,
  T,
  "and"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({ a, b, outTypeFunc: (aType: T, bType: T) => aType, outKey: "and" });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.and === "bool") {
        return [`${outputs.and} = ${inputs.a} && ${inputs.b};`];
      }
      return [`${outputs.and} = ${inputs.a} & ${inputs.b};`];
    };
  }
}

export class Or<T extends "bool" | AllIntTypes> extends BinaryOp<
  T,
  T,
  T,
  "or"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({ a, b, outTypeFunc: (aType: T, bType: T) => aType, outKey: "or" });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.or === "bool") {
        return [`${outputs.or} = ${inputs.a} || ${inputs.b};`];
      }
      return [`${outputs.or} = ${inputs.a} | ${inputs.b};`];
    };
  }
}

export class Xor<T extends "bool" | AllIntTypes> extends BinaryOp<
  T,
  T,
  T,
  "xor"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({ a, b, outTypeFunc: (aType: T, bType: T) => aType, outKey: "xor" });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.xor === "bool") {
        return [`${outputs.xor} = ${inputs.a} ^^ ${inputs.b};`];
      }
      return [`${outputs.xor} = ${inputs.a} ^ ${inputs.b};`];
    };
  }
}

export class Not<T extends BoolTypes | AllIntTypes> extends UnaryOp<
  T,
  T,
  "not"
> {
  constructor({ a }: { a: DynoVal<T> }) {
    super({ a, outTypeFunc: (aType: T) => aType, outKey: "not" });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.not === "bool") {
        return [`${outputs.not} = !${inputs.a};`];
      }
      return [`${outputs.not} = not(${inputs.a});`];
    };
  }
}

export class LessThan<T extends ValueTypes> extends BinaryOp<
  T,
  T,
  CompareOutput<T>,
  "lessThan"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({
      a,
      b,
      outTypeFunc: (aType: T, bType: T) => compareOutputType(aType, "lessThan"),
      outKey: "lessThan",
    });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.lessThan === "bool") {
        return [`${outputs.lessThan} = ${inputs.a} < ${inputs.b};`];
      }
      return [`${outputs.lessThan} = lessThan(${inputs.a}, ${inputs.b});`];
    };
  }
}

export class LessThanEqual<T extends ValueTypes> extends BinaryOp<
  T,
  T,
  CompareOutput<T>,
  "lessThanEqual"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({
      a,
      b,
      outTypeFunc: (aType: T, bType: T) =>
        compareOutputType(aType, "lessThanEqual"),
      outKey: "lessThanEqual",
    });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.lessThanEqual === "bool") {
        return [`${outputs.lessThanEqual} = ${inputs.a} <= ${inputs.b};`];
      }
      return [
        `${outputs.lessThanEqual} = lessThanEqual(${inputs.a}, ${inputs.b});`,
      ];
    };
  }
}

export class GreaterThan<T extends ValueTypes> extends BinaryOp<
  T,
  T,
  CompareOutput<T>,
  "greaterThan"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({
      a,
      b,
      outTypeFunc: (aType: T, bType: T) =>
        compareOutputType(aType, "greaterThan"),
      outKey: "greaterThan",
    });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.greaterThan === "bool") {
        return [`${outputs.greaterThan} = ${inputs.a} > ${inputs.b};`];
      }
      return [
        `${outputs.greaterThan} = greaterThan(${inputs.a}, ${inputs.b});`,
      ];
    };
  }
}

export class GreaterThanEqual<T extends ValueTypes> extends BinaryOp<
  T,
  T,
  CompareOutput<T>,
  "greaterThanEqual"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({
      a,
      b,
      outTypeFunc: (aType: T, bType: T) =>
        compareOutputType(aType, "greaterThanEqual"),
      outKey: "greaterThanEqual",
    });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.greaterThanEqual === "bool") {
        return [`${outputs.greaterThanEqual} = ${inputs.a} >= ${inputs.b};`];
      }
      return [
        `${outputs.greaterThanEqual} = greaterThanEqual(${inputs.a}, ${inputs.b});`,
      ];
    };
  }
}

export class Equal<T extends ValueTypes | BoolTypes> extends BinaryOp<
  T,
  T,
  EqualOutput<T>,
  "equal"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({ a, b, outTypeFunc: equalOutputType<T>, outKey: "equal" });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.equal === "bool") {
        return [`${outputs.equal} = ${inputs.a} == ${inputs.b};`];
      }
      return [`${outputs.equal} = equal(${inputs.a}, ${inputs.b});`];
    };
  }
}

export class NotEqual<T extends ValueTypes | BoolTypes> extends BinaryOp<
  T,
  T,
  NotEqualOutput<T>,
  "notEqual"
> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({ a, b, outTypeFunc: notEqualOutputType<T>, outKey: "notEqual" });
    this.statements = ({ inputs, outputs }) => {
      if (this.outTypes.notEqual === "bool") {
        return [`${outputs.notEqual} = ${inputs.a} != ${inputs.b};`];
      }
      return [`${outputs.notEqual} = notEqual(${inputs.a}, ${inputs.b});`];
    };
  }
}

export class Any<T extends BoolTypes> extends UnaryOp<T, "bool", "any"> {
  constructor({ a }: { a: DynoVal<T> }) {
    super({ a, outTypeFunc: (aType: T) => "bool", outKey: "any" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.any} = any(${inputs.a});`];
    };
  }
}

export class All<T extends BoolTypes> extends UnaryOp<T, "bool", "all"> {
  constructor({ a }: { a: DynoVal<T> }) {
    super({ a, outTypeFunc: (aType: T) => "bool", outKey: "all" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.all} = all(${inputs.a});`];
    };
  }
}

export class Select<T extends SimpleTypes> extends TrinaryOp<
  "bool",
  T,
  T,
  T,
  "select"
> {
  constructor({
    cond,
    t,
    f,
  }: { cond: DynoVal<"bool">; t: DynoVal<T>; f: DynoVal<T> }) {
    super({
      a: cond,
      b: t,
      c: f,
      outKey: "select",
      outTypeFunc: (aType: "bool", bType: T, cType: T) => bType,
    });
    this.statements = ({ inputs, outputs }) => {
      const { a: cond, b: t, c: f } = inputs;
      return [`${outputs.select} = (${cond}) ? (${t}) : (${f});`];
    };
  }
}

type CompareOutput<T extends ValueTypes> = T extends ScalarTypes
  ? "bool"
  : T extends "ivec2" | "uvec2" | "vec2"
    ? "bvec2"
    : T extends "ivec3" | "uvec3" | "vec3"
      ? "bvec3"
      : T extends "ivec4" | "uvec4" | "vec4"
        ? "bvec4"
        : never;

function compareOutputType<T extends ValueTypes>(
  type: T,
  operator: string,
): CompareOutput<T> {
  if (isScalarType(type)) {
    return "bool" as CompareOutput<T>;
  }
  if (type === "ivec2" || type === "uvec2" || type === "vec2") {
    return "bvec2" as CompareOutput<T>;
  }
  if (type === "ivec3" || type === "uvec3" || type === "vec3") {
    return "bvec3" as CompareOutput<T>;
  }
  if (type === "ivec4" || type === "uvec4" || type === "vec4") {
    return "bvec4" as CompareOutput<T>;
  }
  throw new Error(`Invalid ${operator} type: ${type}`);
}

type EqualOutput<A extends ValueTypes | BoolTypes> = A extends ScalarTypes
  ? "bool"
  : A extends BoolTypes
    ? A
    : A extends "ivec2" | "uvec2" | "vec2"
      ? "bvec2"
      : A extends "ivec3" | "uvec3" | "vec3"
        ? "bvec3"
        : A extends "ivec4" | "uvec4" | "vec4"
          ? "bvec4"
          : never;

function equalOutputType<A extends ValueTypes | BoolTypes>(
  type: A,
  operator = "equal",
): EqualOutput<A> {
  if (isScalarType(type)) {
    return "bool" as EqualOutput<A>;
  }
  if (isBoolType(type)) {
    return type as EqualOutput<A>;
  }
  if (type === "ivec2" || type === "uvec2" || type === "vec2") {
    return "bvec2" as EqualOutput<A>;
  }
  if (type === "ivec3" || type === "uvec3" || type === "vec3") {
    return "bvec3" as EqualOutput<A>;
  }
  if (type === "ivec4" || type === "uvec4" || type === "vec4") {
    return "bvec4" as EqualOutput<A>;
  }
  throw new Error(`Invalid ${operator} type: ${type}`);
}

type NotEqualOutput<A extends ValueTypes | BoolTypes> = EqualOutput<A>;

function notEqualOutputType<A extends ValueTypes | BoolTypes>(
  type: A,
): NotEqualOutput<A> {
  return equalOutputType(type, "notEqual");
}

type CompXorOutput<A extends BoolTypes | AllIntTypes> = A extends BoolTypes
  ? "bool"
  : A extends IntTypes
    ? "int"
    : A extends UintTypes
      ? "uint"
      : never;

function compXorOutputType<A extends BoolTypes | AllIntTypes>(
  type: A,
): CompXorOutput<A> {
  if (isBoolType(type)) {
    return "bool" as CompXorOutput<A>;
  }
  if (isIntType(type)) {
    return "int" as CompXorOutput<A>;
  }
  if (isUintType(type)) {
    return "uint" as CompXorOutput<A>;
  }
  throw new Error(`Invalid compXor type: ${type}`);
}

export class CompXor<T extends BoolTypes | AllIntTypes> extends UnaryOp<
  T,
  CompXorOutput<T>,
  "compXor"
> {
  constructor({ a }: { a: DynoVal<T> }) {
    const outType = compXorOutputType(valType(a));
    super({ a, outTypeFunc: (aType: T) => outType, outKey: "compXor" });
    this.statements = ({ inputs, outputs }) => {
      if (isScalarType(this.outTypes.compXor)) {
        return [`${outputs.compXor} = ${inputs.a};`];
      }
      const components = isVector2Type(outType)
        ? ["x", "y"]
        : isVector3Type(outType)
          ? ["x", "y", "z"]
          : ["x", "y", "z", "w"];
      const operands = components.map((c) => `${inputs.a}.${c}`);
      const operator = isBoolType(outType) ? "^^" : "^";
      return [`${outputs.compXor} = ${operands.join(` ${operator} `)};`];
    };
  }
}

export class Shr<T extends IntTypes> extends BinaryOp<T, T, T, "shr"> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({ a, b, outTypeFunc: (aType: T, bType: T) => aType, outKey: "shr" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.shr} = ${inputs.a} >> ${inputs.b};`];
    };
  }
}

export class Shl<T extends IntTypes> extends BinaryOp<T, T, T, "shl"> {
  constructor({ a, b }: { a: DynoVal<T>; b: DynoVal<T> }) {
    super({ a, b, outTypeFunc: (aType: T, bType: T) => aType, outKey: "shl" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.shl} = ${inputs.a} << ${inputs.b};`];
    };
  }
}
