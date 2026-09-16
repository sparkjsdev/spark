import {
  isMatrix2,
  isMatrix3,
  isMatrix4,
  isQuaternion,
  isVector2,
  isVector3,
  isVector4,
} from "../threeGuards";
import type { Dyno, IOTypes } from "./base";
import {
  type DynoJsType,
  type DynoType,
  type SimpleTypes,
  isAllFloatType,
  isBoolType,
  isIntType,
  isUintType,
  numberAsFloat,
  numberAsInt,
  numberAsUint,
} from "./types";

export type DynoVal<T extends DynoType> = DynoValue<T> | HasDynoOut<T>;

export function valType<T extends DynoType>(val: DynoVal<T>): T {
  if (val instanceof DynoValue) {
    return val.type;
  }
  const value = val.dynoOut();
  return value.type;
}

export interface HasDynoOut<T extends DynoType> {
  dynoOut(): DynoValue<T>;
}

export class DynoValue<T extends DynoType> {
  type: T;
  // This field prevents TypeScript structural matching on objects with a "type" field
  private __isDynoValue = true;

  constructor(type: T) {
    this.type = type;
  }
}

export class DynoOutput<
  T extends DynoType,
  InTypes extends IOTypes,
  OutTypes extends IOTypes,
> extends DynoValue<T> {
  dyno: Dyno<InTypes, OutTypes>;
  key: string;

  constructor(dyno: Dyno<InTypes, OutTypes>, key: string) {
    super(dyno.outTypes[key] as T);
    this.dyno = dyno;
    this.key = key;
  }
}

export class DynoLiteral<T extends DynoType> extends DynoValue<T> {
  literal: string;

  constructor(type: T, literal: string) {
    super(type);
    this.literal = literal;
  }

  getLiteral(): string {
    return this.literal;
  }
}

export function dynoLiteral<T extends DynoType>(
  type: T,
  literal: string,
): DynoLiteral<T> {
  return new DynoLiteral(type, literal);
}

export class DynoConst<T extends DynoType> extends DynoLiteral<T> {
  value: DynoJsType<T>;

  constructor(type: T, value: DynoJsType<T>) {
    super(type, "");
    this.value = value;
  }

  getLiteral(): string {
    const { type, value } = this;
    switch (type) {
      case "bool":
        return value ? "true" : "false";
      case "uint":
        return numberAsUint(value as number);
      case "int":
        return numberAsInt(value as number);
      case "float":
        return numberAsFloat(value as number);
      case "bvec2": {
        const v = value as [boolean, boolean];
        return `bvec2(${v[0]}, ${v[1]})`;
      }
      case "uvec2": {
        if (isVector2(value)) {
          return `uvec2(${numberAsUint(value.x)}, ${numberAsUint(value.y)})`;
        }
        const v = value as [number, number] | Uint32Array;
        return `uvec2(${numberAsUint(v[0])}, ${numberAsUint(v[1])})`;
      }
      case "ivec2": {
        if (isVector2(value)) {
          return `ivec2(${numberAsInt(value.x)}, ${numberAsInt(value.y)})`;
        }
        const v = value as [number, number] | Int32Array;
        return `ivec2(${numberAsInt(v[0])}, ${numberAsInt(v[1])})`;
      }
      case "vec2": {
        if (isVector2(value)) {
          return `vec2(${numberAsFloat(value.x)}, ${numberAsFloat(value.y)})`;
        }
        const v = value as [number, number] | Float32Array;
        return `vec2(${numberAsFloat(v[0])}, ${numberAsFloat(v[1])})`;
      }
      case "bvec3": {
        const v = value as [boolean, boolean, boolean];
        return `bvec3(${v[0]}, ${v[1]}, ${v[2]})`;
      }
      case "uvec3": {
        if (isVector3(value)) {
          return `uvec3(${numberAsUint(value.x)}, ${numberAsUint(value.y)}, ${numberAsUint(value.z)})`;
        }
        const v = value as [number, number, number] | Uint32Array;
        return `uvec3(${numberAsUint(v[0])}, ${numberAsUint(v[1])}, ${numberAsUint(v[2])})`;
      }
      case "ivec3": {
        if (isVector3(value)) {
          return `ivec3(${numberAsInt(value.x)}, ${numberAsInt(value.y)}, ${numberAsInt(value.z)})`;
        }
        const v = value as [number, number, number] | Int32Array;
        return `ivec3(${numberAsInt(v[0])}, ${numberAsInt(v[1])}, ${numberAsInt(v[2])})`;
      }
      case "vec3": {
        if (isVector3(value)) {
          return `vec3(${numberAsFloat(value.x)}, ${numberAsFloat(value.y)}, ${numberAsFloat(value.z)})`;
        }
        const v = value as [number, number, number] | Float32Array;
        return `vec3(${numberAsFloat(v[0])}, ${numberAsFloat(v[1])}, ${numberAsFloat(v[2])})`;
      }
      case "bvec4": {
        const v = value as [boolean, boolean, boolean, boolean];
        return `bvec4(${v[0]}, ${v[1]}, ${v[2]}, ${v[3]})`;
      }
      case "uvec4": {
        if (isVector4(value)) {
          return `uvec4(${numberAsUint(value.x)}, ${numberAsUint(value.y)}, ${numberAsUint(value.z)}, ${numberAsUint(value.w)})`;
        }
        const v = value as [number, number, number, number] | Uint32Array;
        return `uvec4(${numberAsUint(v[0])}, ${numberAsUint(v[1])}, ${numberAsUint(v[2])}, ${numberAsUint(v[3])})`;
      }
      case "ivec4": {
        if (isVector4(value)) {
          return `ivec4(${numberAsInt(value.x)}, ${numberAsInt(value.y)}, ${numberAsInt(value.z)}, ${numberAsInt(value.w)})`;
        }
        const v = value as [number, number, number, number] | Int32Array;
        return `ivec4(${numberAsInt(v[0])}, ${numberAsInt(v[1])}, ${numberAsInt(v[2])}, ${numberAsInt(v[3])})`;
      }
      case "vec4": {
        if (isVector4(value)) {
          return `vec4(${numberAsFloat(value.x)}, ${numberAsFloat(value.y)}, ${numberAsFloat(value.z)}, ${numberAsFloat(value.w)})`;
        }
        if (isQuaternion(value)) {
          return `vec4(${numberAsFloat(value.x)}, ${numberAsFloat(value.y)}, ${numberAsFloat(value.z)}, ${numberAsFloat(value.w)})`;
        }
        const v = value as [number, number, number, number] | Float32Array;
        return `vec4(${numberAsFloat(v[0])}, ${numberAsFloat(v[1])}, ${numberAsFloat(v[2])}, ${numberAsFloat(v[3])})`;
      }
      case "mat2":
      case "mat2x2": {
        const m = value as DynoJsType<"mat2">;
        const e = isMatrix2(m) ? m.elements : (value as Float32Array);
        const arg = new Array(4).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat2x3": {
        const e = value as DynoJsType<"mat2x3">;
        const arg = new Array(6).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat2x4": {
        const e = value as DynoJsType<"mat2x4">;
        const arg = new Array(8).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat3":
      case "mat3x3": {
        const m = value as DynoJsType<"mat3">;
        const e = isMatrix3(m) ? m.elements : (value as Float32Array);
        const arg = new Array(9).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat3x2": {
        const e = value as DynoJsType<"mat3x2">;
        const arg = new Array(6).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat3x4": {
        const e = value as DynoJsType<"mat3x4">;
        const arg = new Array(12).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat4":
      case "mat4x4": {
        const m = value as DynoJsType<"mat4">;
        const e = isMatrix4(m) ? m.elements : (value as Float32Array);
        const arg = new Array(16).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat4x2": {
        const e = value as DynoJsType<"mat4x2">;
        const arg = new Array(8).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      case "mat4x3": {
        const e = value as DynoJsType<"mat4x3">;
        const arg = new Array(12).fill(0).map((_, i) => numberAsFloat(e[i]));
        return `${type as string}(${arg.join(", ")})`;
      }
      default:
        throw new Error(`Type not implemented: ${String(type)}`);
    }
  }
}

export function dynoConst<T extends DynoType>(
  type: T,
  value: DynoJsType<T>,
): DynoConst<T> {
  return new DynoConst(type, value);
}

export function literalZero(type: SimpleTypes): string {
  const typeString = String(type);
  if (isBoolType(type)) {
    return `${typeString}(false)`;
  }
  if (isAllFloatType(type)) {
    return `${typeString}(0.0)`;
  }
  if (isIntType(type)) {
    return `${typeString}(0)`;
  }
  if (isUintType(type)) {
    return `${typeString}(0u)`;
  }
  throw new Error(`Type not implemented: ${typeString}`);
}

export function literalOne(type: SimpleTypes): string {
  const typeString = String(type);
  if (isBoolType(type)) {
    return `${typeString}(true)`;
  }
  if (isAllFloatType(type)) {
    return `${typeString}(1.0)`;
  }
  if (isIntType(type)) {
    return `${typeString}(1)`;
  }
  if (isUintType(type)) {
    return `${typeString}(1u)`;
  }
  throw new Error(`Type not implemented: ${typeString}`);
}

export function literalNegOne(type: SimpleTypes): string {
  const typeString = String(type);
  if (isBoolType(type)) {
    return `${typeString}(true)`;
  }
  if (isAllFloatType(type)) {
    return `${typeString}(-1.0)`;
  }
  if (isIntType(type)) {
    return `${typeString}(-1)`;
  }
  if (isUintType(type)) {
    return `${typeString}(0xFFFFFFFFu)`;
  }
  throw new Error(`Type not implemented: ${typeString}`);
}
