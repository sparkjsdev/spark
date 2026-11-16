import { BinaryOp, Dyno, TrinaryOp, UnaryOp } from "./base.js";
import {
  type FloatTypes,
  type IntTypes,
  type MatFloatTypes,
  type SquareMatTypes,
  type UintTypes,
  type VectorElementType,
  type VectorTypes,
  isFloatType,
  isIntType,
  isUintType,
  vectorDim,
  vectorElementType,
} from "./types.js";
import {
  DynoOutput,
  type DynoVal,
  type DynoValue,
  type HasDynoOut,
  literalZero,
  valType,
} from "./value.js";

export const length = <A extends "vec2" | "vec3" | "vec4">(
  a: DynoVal<A>,
): DynoVal<"float"> => new Length({ a });
export const distance = <A extends "vec2" | "vec3" | "vec4">(
  a: DynoVal<A>,
  b: DynoVal<A>,
): DynoVal<"float"> => new Distance({ a, b });
export const dot = <A extends "vec2" | "vec3" | "vec4">(
  a: DynoVal<A>,
  b: DynoVal<A>,
): DynoVal<"float"> => new Dot({ a, b });
export const cross = (
  a: DynoVal<"vec3">,
  b: DynoVal<"vec3">,
): DynoVal<"vec3"> => new Cross({ a, b });
export const normalize = <A extends "vec2" | "vec3" | "vec4">(
  a: DynoVal<A>,
): DynoVal<A> => new Normalize({ a });
export const faceforward = <A extends "vec2" | "vec3" | "vec4">(
  a: DynoVal<A>,
  b: DynoVal<A>,
  c: DynoVal<A>,
): DynoVal<A> => new FaceForward({ a, b, c });
export const reflectVec = <A extends "vec2" | "vec3" | "vec4">(
  incident: DynoVal<A>,
  normal: DynoVal<A>,
): DynoVal<A> => new ReflectVec({ incident, normal });
export const refractVec = <A extends "vec2" | "vec3" | "vec4">(
  incident: DynoVal<A>,
  normal: DynoVal<A>,
  eta: DynoVal<"float">,
): DynoVal<A> => new RefractVec({ incident, normal, eta });
export const split = <V extends VectorTypes>(vector: DynoVal<V>): Split<V> =>
  new Split({ vector });
export const combine = <V extends VectorTypes, T extends VectorElementType<V>>({
  vector,
  vectorType,
  x,
  y,
  z,
  w,
  r,
  g,
  b,
  a,
}: {
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
}): DynoVal<V> => new Combine({ vector, vectorType, x, y, z, w, r, g, b, a });
export const projectH = <A extends "vec3" | "vec4">(
  a: DynoVal<A>,
): DynoVal<ProjectHOutput<A>> => new ProjectH({ a });
export const extendVec = <A extends "float" | "vec2" | "vec3">(
  a: DynoVal<A>,
  b: DynoVal<"float">,
): DynoVal<ExtendVecOutput<A>> => new ExtendVec({ a, b });
export const swizzle = <A extends VectorTypes, S extends SwizzleSelect>(
  a: DynoVal<A>,
  select: S,
): DynoVal<SwizzleOutput<A, SwizzleSelectLen<S>>> =>
  new Swizzle({ vector: a, select });
export const compMult = <A extends MatFloatTypes>(
  a: DynoVal<A>,
  b: DynoVal<A>,
): DynoVal<A> => new CompMult({ a, b });
export const outer = <
  A extends "vec2" | "vec3" | "vec4",
  B extends "vec2" | "vec3" | "vec4",
>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<OuterOutput<A, B>> => new Outer({ a, b });
export const transpose = <A extends MatFloatTypes>(
  a: DynoVal<A>,
): DynoVal<TransposeOutput<A>> => new Transpose({ a });
export const determinant = <A extends SquareMatTypes>(
  a: DynoVal<A>,
): DynoVal<"float"> => new Determinant({ a });
export const inverse = <A extends SquareMatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Inverse({ a });

export class Length<A extends "vec2" | "vec3" | "vec4"> extends UnaryOp<
  A,
  "float",
  "length"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outTypeFunc: (aType) => "float", outKey: "length" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.length} = length(${inputs.a});`,
    ];
  }
}

export class Distance<A extends "vec2" | "vec3" | "vec4"> extends BinaryOp<
  A,
  A,
  "float",
  "distance"
> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<A> }) {
    super({ a, b, outKey: "distance", outTypeFunc: (aType, bType) => "float" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.distance} = distance(${inputs.a}, ${inputs.b});`,
    ];
  }
}

export class Dot<A extends "vec2" | "vec3" | "vec4"> extends BinaryOp<
  A,
  A,
  "float",
  "dot"
> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<A> }) {
    super({ a, b, outKey: "dot", outTypeFunc: (aType, bType) => "float" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.dot} = dot(${inputs.a}, ${inputs.b});`,
    ];
  }
}

export class Cross extends BinaryOp<"vec3", "vec3", "vec3", "cross"> {
  constructor({ a, b }: { a: DynoVal<"vec3">; b: DynoVal<"vec3"> }) {
    super({ a, b, outKey: "cross", outTypeFunc: (aType, bType) => "vec3" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.cross} = cross(${inputs.a}, ${inputs.b});`,
    ];
  }
}

export class Normalize<A extends "vec2" | "vec3" | "vec4"> extends UnaryOp<
  A,
  A,
  "normalize"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outTypeFunc: (aType) => aType, outKey: "normalize" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.normalize} = normalize(${inputs.a});`,
    ];
  }
}

type ProjectHOutput<A extends "vec3" | "vec4"> = A extends "vec3"
  ? "vec2"
  : A extends "vec4"
    ? "vec3"
    : never;

function projectHOutputType<A extends "vec3" | "vec4">(
  type: A,
): ProjectHOutput<A> {
  if (type === "vec3") {
    return "vec2" as ProjectHOutput<A>;
  }
  if (type === "vec4") {
    return "vec3" as ProjectHOutput<A>;
  }
  throw new Error("Invalid type");
}

export class ProjectH<A extends "vec3" | "vec4"> extends UnaryOp<
  A,
  ProjectHOutput<A>,
  "projected"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({
      a,
      outTypeFunc: (aType) => projectHOutputType(aType),
      outKey: "projected",
    });
    this.statements = ({ inputs, outputs }) => {
      if (this.inTypes.a === "vec3") {
        return [`${outputs.projected} = ${inputs.a}.xy / ${inputs.a}.z;`];
      }
      if (this.inTypes.a === "vec4") {
        return [`${outputs.projected} = ${inputs.a}.xyz / ${inputs.a}.w;`];
      }
      throw new Error("Invalid type");
    };
  }
}

type ExtendVecOutput<A extends "float" | "vec2" | "vec3"> = A extends "float"
  ? "vec2"
  : A extends "vec2"
    ? "vec3"
    : A extends "vec3"
      ? "vec4"
      : never;

function extendVecOutputType<A extends "float" | "vec2" | "vec3">(
  type: A,
): ExtendVecOutput<A> {
  if (type === "float") return "vec2" as ExtendVecOutput<A>;
  if (type === "vec2") return "vec3" as ExtendVecOutput<A>;
  if (type === "vec3") return "vec4" as ExtendVecOutput<A>;
  throw new Error("Invalid type");
}

export class ExtendVec<A extends "float" | "vec2" | "vec3"> extends BinaryOp<
  A,
  "float",
  ExtendVecOutput<A>,
  "extend"
> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<"float"> }) {
    const type = valType(a);
    const outType = extendVecOutputType(type);
    super({ a, b, outKey: "extend", outTypeFunc: () => outType });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.extend} = ${outType}(${inputs.a}, ${inputs.b});`,
    ];
  }
}

export class FaceForward<A extends "vec2" | "vec3" | "vec4"> extends TrinaryOp<
  A,
  A,
  A,
  A,
  "forward"
> {
  constructor({ a, b, c }: { a: DynoVal<A>; b: DynoVal<A>; c: DynoVal<A> }) {
    super({
      a,
      b,
      c,
      outKey: "forward",
      outTypeFunc: (aType, bType, cType) => aType,
    });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.forward} = faceforward(${inputs.a}, ${inputs.b}, ${inputs.c});`,
    ];
  }
}

export class ReflectVec<A extends "vec2" | "vec3" | "vec4"> extends BinaryOp<
  A,
  A,
  A,
  "reflection"
> {
  constructor({
    incident,
    normal,
  }: { incident: DynoVal<A>; normal: DynoVal<A> }) {
    super({
      a: incident,
      b: normal,
      outKey: "reflection",
      outTypeFunc: (aType, bType) => aType,
    });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.reflection} = reflect(${inputs.a}, ${inputs.b});`,
    ];
  }
}

export class RefractVec<A extends "vec2" | "vec3" | "vec4"> extends TrinaryOp<
  A,
  A,
  "float",
  A,
  "refraction"
> {
  constructor({
    incident,
    normal,
    eta,
  }: { incident: DynoVal<A>; normal: DynoVal<A>; eta: DynoVal<"float"> }) {
    super({
      a: incident,
      b: normal,
      c: eta,
      outKey: "refraction",
      outTypeFunc: (aType, bType, cType) => aType,
    });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.refraction} = refract(${inputs.a}, ${inputs.b}, ${inputs.c});`,
    ];
  }
}

export class CompMult<A extends MatFloatTypes> extends BinaryOp<
  A,
  A,
  A,
  "product"
> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<A> }) {
    super({ a, b, outKey: "product", outTypeFunc: (aType, bType) => aType });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.product} = matrixCompMult(${a}, ${b});`,
    ];
  }
}

type OuterOutput<
  A extends "vec2" | "vec3" | "vec4",
  B extends "vec2" | "vec3" | "vec4",
> = A extends "vec2"
  ? B extends "vec2"
    ? "mat2"
    : B extends "vec3"
      ? "mat3x2"
      : B extends "vec4"
        ? "mat4x2"
        : never
  : A extends "vec3"
    ? B extends "vec2"
      ? "mat2x3"
      : B extends "vec3"
        ? "mat3"
        : B extends "vec4"
          ? "mat4x3"
          : never
    : A extends "vec4"
      ? B extends "vec2"
        ? "mat2x4"
        : B extends "vec3"
          ? "mat3x4"
          : B extends "vec4"
            ? "mat4"
            : never
      : never;

function outerOutputType<
  A extends "vec2" | "vec3" | "vec4",
  B extends "vec2" | "vec3" | "vec4",
>(aType: A, bType: B): OuterOutput<A, B> {
  if (aType === "vec2") {
    if (bType === "vec2") return "mat2" as OuterOutput<A, B>;
    if (bType === "vec3") return "mat3x2" as OuterOutput<A, B>;
    if (bType === "vec4") return "mat4x2" as OuterOutput<A, B>;
  }
  if (aType === "vec3") {
    if (bType === "vec2") return "mat2x3" as OuterOutput<A, B>;
    if (bType === "vec3") return "mat3" as OuterOutput<A, B>;
    if (bType === "vec4") return "mat4x3" as OuterOutput<A, B>;
  }
  if (aType === "vec4") {
    if (bType === "vec2") return "mat2x4" as OuterOutput<A, B>;
    if (bType === "vec3") return "mat3x4" as OuterOutput<A, B>;
    if (bType === "vec4") return "mat4" as OuterOutput<A, B>;
  }
  throw new Error(`Invalid outer type: ${aType}, ${bType}`);
}

export class Outer<
  A extends "vec2" | "vec3" | "vec4",
  B extends "vec2" | "vec3" | "vec4",
> extends BinaryOp<A, B, OuterOutput<A, B>, "outer"> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "outer", outTypeFunc: outerOutputType });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.outer} = outerProduct(${inputs.a}, ${inputs.b});`,
    ];
  }
}

type TransposeOutput<A extends MatFloatTypes> = A extends SquareMatTypes
  ? A
  : A extends "mat2x3"
    ? "mat3x2"
    : A extends "mat2x4"
      ? "mat4x2"
      : A extends "mat3x2"
        ? "mat2x3"
        : A extends "mat3x4"
          ? "mat4x3"
          : A extends "mat4x2"
            ? "mat2x4"
            : A extends "mat4x3"
              ? "mat3x4"
              : never;

function transposeOutputType<A extends MatFloatTypes>(
  type: A,
): TransposeOutput<A> {
  if (type === "mat2") return "mat2" as TransposeOutput<A>;
  if (type === "mat3") return "mat3" as TransposeOutput<A>;
  if (type === "mat4") return "mat4" as TransposeOutput<A>;
  if (type === "mat2x2") return "mat2x2" as TransposeOutput<A>;
  if (type === "mat2x3") return "mat3x2" as TransposeOutput<A>;
  if (type === "mat2x4") return "mat4x2" as TransposeOutput<A>;
  if (type === "mat3x2") return "mat2x3" as TransposeOutput<A>;
  if (type === "mat3x3") return "mat3x3" as TransposeOutput<A>;
  if (type === "mat3x4") return "mat4x3" as TransposeOutput<A>;
  if (type === "mat4x2") return "mat2x4" as TransposeOutput<A>;
  if (type === "mat4x3") return "mat3x4" as TransposeOutput<A>;
  if (type === "mat4x4") return "mat4x4" as TransposeOutput<A>;
  throw new Error(`Invalid transpose type: ${type}`);
}

export class Transpose<A extends MatFloatTypes> extends UnaryOp<
  A,
  TransposeOutput<A>,
  "transpose"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "transpose", outTypeFunc: transposeOutputType });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.transpose} = transpose(${inputs.a});`,
    ];
  }
}

export class Determinant<A extends SquareMatTypes> extends UnaryOp<
  A,
  "float",
  "det"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "det", outTypeFunc: (aType) => "float" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.det} = determinant(${inputs.a});`,
    ];
  }
}

export class Inverse<A extends SquareMatTypes> extends UnaryOp<
  A,
  A,
  "inverse"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "inverse", outTypeFunc: (aType) => aType });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.inverse} = inverse(${a});`,
    ];
  }
}

type SplitOutTypes<A extends VectorTypes> = A extends "vec2"
  ? { x: "float"; y: "float"; r: "float"; g: "float" }
  : A extends "vec3"
    ? { x: "float"; y: "float"; z: "float"; r: "float"; g: "float"; b: "float" }
    : A extends "vec4"
      ? {
          x: "float";
          y: "float";
          z: "float";
          w: "float";
          r: "float";
          g: "float";
          b: "float";
          a: "float";
        }
      : A extends "ivec2"
        ? { x: "int"; y: "int"; r: "int"; g: "int" }
        : A extends "ivec3"
          ? { x: "int"; y: "int"; z: "int"; r: "int"; g: "int"; b: "int" }
          : A extends "ivec4"
            ? {
                x: "int";
                y: "int";
                z: "int";
                w: "int";
                r: "int";
                g: "int";
                b: "int";
                a: "int";
              }
            : A extends "uvec2"
              ? { x: "uint"; y: "uint"; r: "uint"; g: "uint" }
              : A extends "uvec3"
                ? {
                    x: "uint";
                    y: "uint";
                    z: "uint";
                    r: "uint";
                    g: "uint";
                    b: "uint";
                  }
                : A extends "uvec4"
                  ? {
                      x: "uint";
                      y: "uint";
                      z: "uint";
                      w: "uint";
                      r: "uint";
                      g: "uint";
                      b: "uint";
                      a: "uint";
                    }
                  : never;

function splitOutTypes<A extends VectorTypes>(type: A): SplitOutTypes<A> {
  const result = (value: unknown) => value as SplitOutTypes<A>;
  switch (type) {
    case "vec2":
      return result({ x: "float", y: "float", r: "float", g: "float" });
    case "vec3":
      return result({
        x: "float",
        y: "float",
        z: "float",
        r: "float",
        g: "float",
        b: "float",
      });
    case "vec4":
      return result({
        x: "float",
        y: "float",
        z: "float",
        w: "float",
        r: "float",
        g: "float",
        b: "float",
        a: "float",
      });
    case "ivec2":
      return result({ x: "int", y: "int", r: "int", g: "int" });
    case "ivec3":
      return result({
        x: "int",
        y: "int",
        z: "int",
        r: "int",
        g: "int",
        b: "int",
      });
    case "ivec4":
      return result({
        x: "int",
        y: "int",
        z: "int",
        w: "int",
        r: "int",
        g: "int",
        b: "int",
        a: "int",
      });
    case "uvec2":
      return result({ x: "uint", y: "uint", r: "uint", g: "uint" });
    case "uvec3":
      return result({
        x: "uint",
        y: "uint",
        z: "uint",
        r: "uint",
        g: "uint",
        b: "uint",
      });
    case "uvec4":
      return result({
        x: "uint",
        y: "uint",
        z: "uint",
        w: "uint",
        r: "uint",
        g: "uint",
        b: "uint",
        a: "uint",
      });
    default:
      throw new Error(`Invalid vector type: ${type}`);
  }
}

export class Split<V extends VectorTypes> extends Dyno<
  { vector: V },
  SplitOutTypes<V>
> {
  constructor({ vector }: { vector: DynoVal<V> }) {
    const type = valType(vector);
    const inTypes = { vector: type };
    const outTypes = splitOutTypes(inTypes.vector);
    super({ inTypes, outTypes, inputs: { vector } });
    this.statements = ({ inputs, outputs }) => {
      const { x, y, z, w, r, g, b, a } = outputs as unknown as Record<
        string,
        string
      >;
      const { vector } = inputs;
      return [
        x ? `${x} = ${vector}.x;` : null,
        y ? `${y} = ${vector}.y;` : null,
        z ? `${z} = ${vector}.z;` : null,
        w ? `${w} = ${vector}.w;` : null,
        r ? `${r} = ${vector}.r;` : null,
        g ? `${g} = ${vector}.g;` : null,
        b ? `${b} = ${vector}.b;` : null,
        a ? `${a} = ${vector}.a;` : null,
      ].filter(Boolean) as string[];
    };
  }
}

export class Combine<V extends VectorTypes, T extends VectorElementType<V>>
  extends Dyno<SplitOutTypes<V> & { vector: V }, { vector: V }>
  implements HasDynoOut<V>
{
  constructor({
    vector,
    vectorType,
    x,
    y,
    z,
    w,
    r,
    g,
    b,
    a,
  }: {
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
  }) {
    if (!vector && !vectorType) {
      throw new Error("Either vector or vectorType must be provided");
    }
    const vType = vectorType ?? valType(vector as DynoVal<V>);
    const elType = vectorElementType(vType);
    const dim = vectorDim(vType);

    const inTypes = {
      vector: vType,
      x: elType,
      y: elType,
      r: elType,
      g: elType,
    } as unknown as SplitOutTypes<V> & { vector: V };
    const inputs = { vector, x, y, r, g };
    if (dim >= 3) {
      Object.assign(inTypes, { z: elType, b: elType });
      Object.assign(inputs, { z, b });
    }
    if (dim >= 4) {
      Object.assign(inTypes, { w: elType, a: elType });
      Object.assign(inputs, { w, a });
    }
    // @ts-ignore
    super({ inTypes, outTypes: { vector: vType }, inputs });
    this.statements = ({ inputs, outputs }) => {
      const { vector } = outputs;
      const {
        vector: input,
        x,
        y,
        z,
        w,
        r,
        g,
        b,
        a,
      } = inputs as Record<string, string>;
      const statements = [
        `${vector}.x = ${x ?? r ?? (input ? `${input}.x` : literalZero(elType))};`,
        `${vector}.y = ${y ?? g ?? (input ? `${input}.y` : literalZero(elType))};`,
      ];
      if (dim >= 3)
        statements.push(
          `${vector}.z = ${z ?? b ?? (input ? `${input}.z` : literalZero(elType))};`,
        );
      if (dim >= 4)
        statements.push(
          `${vector}.w = ${w ?? a ?? (input ? `${input}.w` : literalZero(elType))};`,
        );
      return statements;
    };
  }

  dynoOut(): DynoValue<V> {
    return new DynoOutput<V, SplitOutTypes<V> & { vector: V }, { vector: V }>(
      this,
      "vector",
    );
  }
}

type SwizzleOutput<
  A extends VectorTypes,
  Len extends number,
> = A extends FloatTypes
  ? Len extends 1
    ? "float"
    : Len extends 2
      ? "vec2"
      : Len extends 3
        ? "vec3"
        : Len extends 4
          ? "vec4"
          : never
  : A extends IntTypes
    ? Len extends 1
      ? "int"
      : Len extends 2
        ? "ivec2"
        : Len extends 3
          ? "ivec3"
          : Len extends 4
            ? "ivec4"
            : never
    : A extends UintTypes
      ? Len extends 1
        ? "uint"
        : Len extends 2
          ? "uvec2"
          : Len extends 3
            ? "uvec3"
            : Len extends 4
              ? "uvec4"
              : never
      : never;

type SwizzleSelectLen<S extends SwizzleSelect> = S extends Swizzle1Select
  ? 1
  : S extends Swizzle2Select
    ? 2
    : S extends Swizzle3Select
      ? 3
      : S extends Swizzle4Select
        ? 4
        : never;

function swizzleOutputType<A extends VectorTypes, S extends SwizzleSelect>(
  type: A,
  swizzle: S,
): SwizzleOutput<A, SwizzleSelectLen<S>> {
  let result = null;
  if (isFloatType(type)) {
    result =
      swizzle.length === 1
        ? "float"
        : swizzle.length === 2
          ? "vec2"
          : swizzle.length === 3
            ? "vec3"
            : swizzle.length === 4
              ? "vec4"
              : null;
  } else if (isIntType(type)) {
    result =
      swizzle.length === 1
        ? "int"
        : swizzle.length === 2
          ? "ivec2"
          : swizzle.length === 3
            ? "ivec3"
            : swizzle.length === 4
              ? "ivec4"
              : null;
  } else if (isUintType(type)) {
    result =
      swizzle.length === 1
        ? "uint"
        : swizzle.length === 2
          ? "uvec2"
          : swizzle.length === 3
            ? "uvec3"
            : swizzle.length === 4
              ? "uvec4"
              : null;
  }
  if (result == null) {
    throw new Error(`Invalid swizzle: ${swizzle}`);
  }
  return result as SwizzleOutput<A, SwizzleSelectLen<S>>;
}

type Swizzle1Select = `${"x" | "y" | "z" | "w"}|${"r" | "g" | "b" | "a"}`;
type Swizzle2Select =
  | `${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}`
  | `${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}`;
type Swizzle3Select =
  | `${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}`
  | `${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}`;
type Swizzle4Select =
  | `${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}${"x" | "y" | "z" | "w"}`
  | `${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}${"r" | "g" | "b" | "a"}`;
type SwizzleSelect =
  | Swizzle1Select
  | Swizzle2Select
  | Swizzle3Select
  | Swizzle4Select;

export class Swizzle<
  A extends VectorTypes,
  S extends SwizzleSelect,
> extends UnaryOp<A, SwizzleOutput<A, SwizzleSelectLen<S>>, "swizzle"> {
  constructor({ vector, select }: { vector: DynoVal<A>; select: S }) {
    super({
      a: vector,
      outKey: "swizzle",
      outTypeFunc: (aType) => swizzleOutputType<A, S>(aType, select),
    });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.swizzle} = ${inputs.a}.${select};`,
    ];
  }
}
