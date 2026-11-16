import {
  type AllFloatTypes,
  type AllIntTypes,
  type AllSignedTypes,
  type AllValueTypes,
  type BaseType,
  type BoolTypes,
  type FloatTypes,
  type IntTypes,
  type SignedTypes,
  type UintTypes,
  type ValueTypes,
  isAllFloatType,
  isFloatType,
  isIntType,
  isMat2,
  isMat3,
  isMat4,
  isUintType,
} from "./types.js";

export type AddOutput<
  A extends AllValueTypes,
  B extends AllValueTypes,
> = BaseType &
  (A extends B
    ? A
    : A extends "int"
      ? B extends IntTypes
        ? B
        : never
      : B extends "int"
        ? A extends IntTypes
          ? A
          : never
        : A extends "uint"
          ? B extends UintTypes
            ? B
            : never
          : B extends "uint"
            ? A extends UintTypes
              ? A
              : never
            : A extends "float"
              ? B extends AllFloatTypes
                ? B
                : never
              : B extends "float"
                ? A extends AllFloatTypes
                  ? A
                  : never
                : never);

export type SubOutput<
  A extends AllValueTypes,
  B extends AllValueTypes,
> = AddOutput<A, B>;

export type MulOutput<
  A extends AllValueTypes,
  B extends AllValueTypes,
> = BaseType &
  (A extends "int"
    ? B extends IntTypes
      ? B
      : never
    : B extends "int"
      ? A extends IntTypes
        ? A
        : never
      : A extends "uint"
        ? B extends UintTypes
          ? B
          : never
        : B extends "uint"
          ? A extends UintTypes
            ? A
            : never
          : A extends "float"
            ? B extends AllFloatTypes
              ? B
              : never
            : B extends "float"
              ? A extends AllFloatTypes
                ? A
                : never
              : A extends IntTypes
                ? B extends A
                  ? A
                  : never
                : B extends IntTypes
                  ? A extends B
                    ? A
                    : never
                  : A extends UintTypes
                    ? B extends A
                      ? A
                      : never
                    : B extends UintTypes
                      ? A extends B
                        ? A
                        : never
                      : // Vector * Matrix/Vector
                        A extends "vec2"
                        ? B extends "vec2" | "mat2" | "mat2x2"
                          ? "vec2"
                          : B extends "mat3x2"
                            ? "vec3"
                            : B extends "mat4x2"
                              ? "vec4"
                              : never
                        : A extends "vec3"
                          ? B extends "mat2x3"
                            ? "vec2"
                            : B extends "vec3" | "mat3" | "mat3x3"
                              ? "vec3"
                              : B extends "mat4x3"
                                ? "vec4"
                                : never
                          : A extends "vec4"
                            ? B extends "mat2x4"
                              ? "vec2"
                              : B extends "mat3x4"
                                ? "vec3"
                                : B extends "vec4" | "mat4" | "mat4x4"
                                  ? "vec4"
                                  : never
                            : // Matrix * Vector
                              B extends "vec2"
                              ? A extends "mat2" | "mat2x2"
                                ? "vec2"
                                : A extends "mat2x3"
                                  ? "vec3"
                                  : A extends "mat2x4"
                                    ? "vec4"
                                    : never
                              : B extends "vec3"
                                ? A extends "mat3x2"
                                  ? "vec2"
                                  : A extends "mat3" | "mat3x3"
                                    ? "vec3"
                                    : A extends "mat3x4"
                                      ? "vec4"
                                      : never
                                : B extends "vec4"
                                  ? A extends "mat4x2"
                                    ? "vec2"
                                    : A extends "mat4x3"
                                      ? "vec3"
                                      : A extends "mat4" | "mat4x4"
                                        ? "vec4"
                                        : never
                                  : // Matrix * Matrix: mat{Acols}x{Arows} * mat{Bcols}x{Brows} => mat{Bcols}x{Arows}
                                    A extends "mat2" | "mat2x2" // Acols = 2 => Brows = 2
                                    ? B extends "mat2" | "mat2x2"
                                      ? "mat2"
                                      : B extends "mat3x2"
                                        ? "mat3x2"
                                        : B extends "mat4x2"
                                          ? "mat4x2"
                                          : never
                                    : A extends "mat2x3" // Acols = 2 => Brows = 2
                                      ? B extends "mat2" | "mat2x2"
                                        ? "mat2x3"
                                        : B extends "mat3x2"
                                          ? "mat3"
                                          : B extends "mat4x2"
                                            ? "mat4x3"
                                            : never
                                      : A extends "mat2x4" // Acols = 2 => Brows = 2
                                        ? B extends "mat2" | "mat2x2"
                                          ? "mat2x4"
                                          : B extends "mat3x2"
                                            ? "mat3x4"
                                            : B extends "mat4x2"
                                              ? "mat4"
                                              : never
                                        : A extends "mat3x2" // Acols = 3 => Brows = 3
                                          ? B extends "mat2x3"
                                            ? "mat2"
                                            : B extends "mat3" | "mat3x3"
                                              ? "mat3x2"
                                              : B extends "mat4x3"
                                                ? "mat4x2"
                                                : never
                                          : A extends "mat3" | "mat3x3" // Acols = 3 => Brows = 3
                                            ? B extends "mat2x3"
                                              ? "mat2x3"
                                              : B extends "mat3" | "mat3x3"
                                                ? "mat3"
                                                : B extends "mat4x3"
                                                  ? "mat4x3"
                                                  : never
                                            : A extends "mat3x4" // Acols = 3 => Brows = 3
                                              ? B extends "mat2x3"
                                                ? "mat2x4"
                                                : B extends "mat3" | "mat3x3"
                                                  ? "mat3x4"
                                                  : B extends "mat4x3"
                                                    ? "mat4"
                                                    : never
                                              : A extends "mat4x2" // Acols = 4 => Brows = 4
                                                ? B extends "mat2x4"
                                                  ? "mat2"
                                                  : B extends "mat3x4"
                                                    ? "mat3x2"
                                                    : B extends
                                                          | "mat4"
                                                          | "mat4x4"
                                                      ? "mat4x2"
                                                      : never
                                                : A extends "mat4x3" // Acols = 4 => Brows = 4
                                                  ? B extends "mat2x4"
                                                    ? "mat2x3"
                                                    : B extends "mat3x4"
                                                      ? "mat3"
                                                      : B extends
                                                            | "mat4"
                                                            | "mat4x4"
                                                        ? "mat4x3"
                                                        : never
                                                  : A extends "mat4" | "mat4x4" // Acols = 4 => Brows = 4
                                                    ? B extends "mat2x4"
                                                      ? "mat2x4"
                                                      : B extends "mat3x4"
                                                        ? "mat3x4"
                                                        : B extends
                                                              | "mat4"
                                                              | "mat4x4"
                                                          ? "mat4"
                                                          : never
                                                    : never);

export type DivOutput<
  A extends AllValueTypes,
  B extends AllValueTypes,
> = AddOutput<A, B>;

export type IModOutput<
  A extends AllIntTypes,
  B extends AllIntTypes,
> = BaseType &
  (A extends B
    ? A
    : A extends "int"
      ? B extends IntTypes
        ? B
        : never
      : B extends "int"
        ? A extends IntTypes
          ? A
          : never
        : A extends "uint"
          ? B extends UintTypes
            ? B
            : never
          : B extends "uint"
            ? A extends UintTypes
              ? A
              : never
            : never);

export type ModOutput<A extends FloatTypes, B extends FloatTypes> = BaseType &
  (A extends B ? A : B extends "float" ? A : never);

export type PowOutput<A extends FloatTypes, B extends FloatTypes> = BaseType &
  (A extends B ? A : never);

export type MinOutput<A extends ValueTypes, B extends ValueTypes> = BaseType &
  (A extends B
    ? A
    : B extends "float"
      ? A extends FloatTypes
        ? A
        : never
      : B extends "int"
        ? A extends IntTypes
          ? A
          : never
        : B extends "uint"
          ? A extends UintTypes
            ? A
            : never
          : never);
export type MaxOutput<A extends ValueTypes, B extends ValueTypes> = MinOutput<
  A,
  B
>;
export type ClampOutput<A extends ValueTypes, B extends ValueTypes> = BaseType &
  (B extends "float"
    ? A extends FloatTypes
      ? A
      : never
    : B extends "int"
      ? A extends IntTypes
        ? A
        : never
      : B extends "uint"
        ? A extends UintTypes
          ? A
          : never
        : never);
export type MixOutput<
  A extends FloatTypes,
  T extends FloatTypes | BoolTypes,
> = BaseType &
  (T extends A
    ? A
    : T extends "float"
      ? A
      : T extends "bool"
        ? A extends "float"
          ? A
          : never
        : T extends "bvec2"
          ? A extends "vec2"
            ? A
            : never
          : T extends "bvec3"
            ? A extends "vec3"
              ? A
              : never
            : T extends "bvec4"
              ? A extends "vec4"
                ? A
                : never
              : never);
export type StepOutput<A extends FloatTypes, B extends FloatTypes> = BaseType &
  (A extends B ? B : A extends "float" ? B : never);
export type SmoothstepOutput<
  A extends FloatTypes,
  B extends FloatTypes,
  C extends FloatTypes,
> = BaseType &
  (A extends B ? (A extends C ? C : A extends "float" ? C : never) : never);

export type IsNanOutput<A extends FloatTypes> = BaseType &
  (A extends "float"
    ? "bool"
    : A extends "vec2"
      ? "bvec2"
      : A extends "vec3"
        ? "bvec3"
        : A extends "vec4"
          ? "bvec4"
          : never);
export type IsInfOutput<A extends FloatTypes> = IsNanOutput<A>;

// // Run-time type helper functions

export function addOutputType<A extends AllValueTypes, B extends AllValueTypes>(
  a: A,
  b: B,
  operation = "add",
): AddOutput<A, B> {
  const error = () => {
    throw new Error(`Invalid ${operation} types: ${a}, ${b}`);
  };
  // @ts-ignore
  if (a === b) return a as AddOutput<A, B>;
  if (a === "int") {
    if (isIntType(b)) return b as AddOutput<A, B>;
    error();
  }
  if (b === "int") {
    if (isIntType(a)) return a as AddOutput<A, B>;
    error();
  }
  if (a === "uint") {
    if (isUintType(b)) return b as AddOutput<A, B>;
    error();
  }
  if (b === "uint") {
    if (isUintType(a)) return a as AddOutput<A, B>;
    error();
  }
  if (a === "float") {
    if (isAllFloatType(b)) return b as AddOutput<A, B>;
    error();
  }
  if (b === "float") {
    if (isAllFloatType(a)) return a as AddOutput<A, B>;
    error();
  }
  throw new Error(`Invalid ${operation} types: ${a}, ${b}`);
}

export function subOutputType<A extends AllValueTypes, B extends AllValueTypes>(
  a: A,
  b: B,
): SubOutput<A, B> {
  return addOutputType(a, b, "sub");
}

export function mulOutputType<A extends AllValueTypes, B extends AllValueTypes>(
  a: A,
  b: B,
): MulOutput<A, B> {
  const error = () => {
    throw new Error(`Invalid mul types: ${a}, ${b}`);
  };
  const result = (value: unknown) => value as MulOutput<A, B>;
  if (a === "int") {
    if (isIntType(b)) return result(b);
    error();
  }
  if (b === "int") {
    if (isIntType(a)) return result(a);
    error();
  }
  if (a === "uint") {
    if (isUintType(b)) return result(b);
    error();
  }
  if (b === "uint") {
    if (isUintType(a)) return result(a);
    error();
  }
  if (a === "float") {
    if (isAllFloatType(b)) return result(b);
    error();
  }
  if (b === "float") {
    if (isAllFloatType(a)) return result(a);
    error();
  }
  if (isIntType(a) || isUintType(a) || isIntType(b) || isUintType(b)) {
    // @ts-ignore
    if (a === b) return result(a);
    error();
  }
  // Vector * Matrix/Vector
  if (a === "vec2") {
    if (b === "vec2" || isMat2(b)) return result("vec2");
    if (b === "mat3x2") return result("vec3");
    if (b === "mat4x2") return result("vec4");
    error();
  }
  if (a === "vec3") {
    if (b === "mat2x3") return result("vec2");
    if (b === "vec3" || isMat3(b)) return result("vec3");
    if (b === "mat4x3") return result("vec4");
    error();
  }
  if (a === "vec4") {
    if (b === "mat2x4") return result("vec2");
    if (b === "mat3x4") return result("vec3");
    if (b === "vec4" || isMat4(b)) return result("vec4");
    error();
  }
  // Matrix * Vector
  if (b === "vec2") {
    if (isMat2(a)) return result("vec2");
    if (a === "mat2x3") return result("vec3");
    if (a === "mat2x4") return result("vec4");
    error();
  }
  if (b === "vec3") {
    if (a === "mat3x2") return result("vec2");
    if (isMat3(a)) return result("vec3");
    if (a === "mat3x4") return result("vec4");
    error();
  }
  if (b === "vec4") {
    if (a === "mat4x2") return result("vec2");
    if (a === "mat4x3") return result("vec3");
    if (isMat4(a)) return result("vec4");
    error();
  }
  // Matrix * Matrix: mat{Acols}x{Arows} * mat{Bcols}x{Brows} => mat{Bcols}x{Arows}
  if (isMat2(a)) {
    if (isMat2(b)) return result("mat2");
    if (b === "mat3x2") return result("mat3x2");
    if (b === "mat4x2") return result("mat4x2");
    error();
  }
  if (a === "mat2x3") {
    if (isMat2(b)) return result("mat2x3");
    if (b === "mat3x2") return result("mat3");
    if (b === "mat4x2") return result("mat4x3");
    error();
  }
  if (a === "mat2x4") {
    if (isMat2(b)) return result("mat2x4");
    if (b === "mat3x2") return result("mat3x4");
    if (b === "mat4x2") return result("mat4");
    error();
  }
  if (a === "mat3x2") {
    if (b === "mat2x3") return result("mat2");
    if (isMat3(b)) return result("mat3x2");
    if (b === "mat4x3") return result("mat4x2");
    error();
  }
  if (isMat3(a)) {
    if (b === "mat2x3") return result("mat2x3");
    if (isMat3(b)) return result("mat3");
    if (b === "mat4x3") return result("mat4x3");
    error();
  }
  if (a === "mat3x4") {
    if (b === "mat2x3") return result("mat2x4");
    if (isMat3(b)) return result("mat3x4");
    if (b === "mat4x3") return result("mat4");
    error();
  }
  if (a === "mat4x2") {
    if (b === "mat2x4") return result("mat2");
    if (b === "mat3x4") return result("mat3x2");
    if (isMat4(b)) return result("mat4x2");
    error();
  }
  if (a === "mat4x3") {
    if (b === "mat2x4") return result("mat2x3");
    if (b === "mat3x4") return result("mat3");
    if (isMat4(b)) return result("mat4x3");
    error();
  }
  if (isMat4(a)) {
    if (b === "mat2x4") return result("mat2x4");
    if (b === "mat3x4") return result("mat3x4");
    if (isMat4(b)) return result("mat4");
    error();
  }
  throw new Error(`Invalid mul types: ${a}, ${b}`);
}

export function divOutputType<A extends AllValueTypes, B extends AllValueTypes>(
  a: A,
  b: B,
): DivOutput<A, B> {
  return addOutputType(a, b, "div");
}

export function imodOutputType<A extends AllIntTypes, B extends AllIntTypes>(
  a: A,
  b: B,
): IModOutput<A, B> {
  // @ts-ignore
  if (a === b) return a as IModOutput<A, B>;
  if (a === "int") {
    if (isIntType(b)) return b as IModOutput<A, B>;
  } else if (b === "int") {
    if (isIntType(a)) return a as IModOutput<A, B>;
  } else if (a === "uint") {
    if (isUintType(b)) return b as IModOutput<A, B>;
  } else if (b === "uint") {
    if (isUintType(a)) return a as IModOutput<A, B>;
  }
  throw new Error(`Invalid imod types: ${a}, ${b}`);
}

export function modOutputType<A extends FloatTypes, B extends FloatTypes>(
  a: A,
  b: B,
): ModOutput<A, B> {
  // @ts-ignore
  if (a === b || b === "float") return a as ModOutput<A, B>;
  throw new Error(`Invalid mod types: ${a}, ${b}`);
}

export function modfOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function negOutputType<A extends AllSignedTypes>(a: A): A {
  return a;
}

export function absOutputType<A extends SignedTypes>(a: A): A {
  return a;
}

export function signOutputType<A extends SignedTypes>(a: A): A {
  return a;
}

export function floorOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function ceilOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function truncOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function roundOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function fractOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function powOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function expOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function exp2OutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function logOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function log2OutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function sqrOutputType<A extends ValueTypes>(a: A): A {
  return a;
}

export function sqrtOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function inversesqrtOutputType<A extends FloatTypes>(a: A): A {
  return a;
}

export function minOutputType<A extends ValueTypes, B extends ValueTypes>(
  a: A,
  b: B,
  operation = "min",
): MinOutput<A, B> {
  // @ts-ignore
  if (a === b) return a as MinOutput<A, B>;
  if (b === "float") {
    if (isFloatType(a)) return a as MinOutput<A, B>;
  } else if (b === "int") {
    if (isIntType(a)) return a as MinOutput<A, B>;
  } else if (b === "uint") {
    if (isUintType(a)) return a as MinOutput<A, B>;
  }
  throw new Error(`Invalid ${operation} types: ${a}, ${b}`);
}

export function maxOutputType<A extends ValueTypes, B extends ValueTypes>(
  a: A,
  b: B,
): MaxOutput<A, B> {
  return minOutputType(a, b, "max");
}

export function clampOutputType<A extends ValueTypes, B extends ValueTypes>(
  a: A,
  b: B,
  _c: B,
): ClampOutput<A, B> {
  if (b === "float") {
    if (isFloatType(a)) return a as ClampOutput<A, B>;
  } else if (b === "int") {
    if (isIntType(a)) return a as ClampOutput<A, B>;
  } else if (b === "uint") {
    if (isUintType(a)) return a as ClampOutput<A, B>;
  }
  throw new Error(`Invalid clamp types: ${a}, ${b}`);
}

export function mixOutputType<
  A extends FloatTypes,
  C extends FloatTypes | BoolTypes,
>(a: A, b: A, c: C): MixOutput<A, C> {
  // @ts-ignore
  if (c === a) return a as MixOutput<A, C>;
  if (c === "float") return a as MixOutput<A, C>;
  if (c === "bool" && a === "float") return a as MixOutput<A, C>;
  if (c === "bvec2" && a === "vec2") return a as MixOutput<A, C>;
  if (c === "bvec3" && a === "vec3") return a as MixOutput<A, C>;
  if (c === "bvec4" && a === "vec4") return a as MixOutput<A, C>;
  throw new Error(`Invalid mix types: ${a}, ${b}, ${c}`);
}

export function stepOutputType<A extends FloatTypes, B extends FloatTypes>(
  a: A,
  b: B,
): StepOutput<A, B> {
  // @ts-ignore
  if (a === b || b === "float") return b as StepOutput<A, B>;
  throw new Error(`Invalid step types: ${a}, ${b}`);
}

export function smoothstepOutputType<
  A extends FloatTypes,
  B extends FloatTypes,
  C extends FloatTypes,
>(a: A, b: B, c: C): SmoothstepOutput<A, B, C> {
  // @ts-ignore
  if (a === b) {
    if (a === c || a === "float") return c as SmoothstepOutput<A, B, C>;
  }
  throw new Error(`Invalid smoothstep types: ${a}, ${b}, ${c}`);
}

export function isNanOutputType<A extends FloatTypes>(
  a: A,
  operation = "isNan",
): IsNanOutput<A> {
  if (a === "float") return "bool" as IsNanOutput<A>;
  if (a === "vec2") return "bvec2" as IsNanOutput<A>;
  if (a === "vec3") return "bvec3" as IsNanOutput<A>;
  if (a === "vec4") return "bvec4" as IsNanOutput<A>;
  throw new Error(`Invalid ${operation} types: ${a}`);
}

export function isInfOutputType<A extends FloatTypes>(a: A): IsInfOutput<A> {
  return isNanOutputType(a, "isInf");
}
