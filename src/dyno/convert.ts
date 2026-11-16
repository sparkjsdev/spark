import { UnaryOp } from "./base.js";
import { type SimpleTypes, typeLiteral } from "./types.js";
import type { DynoVal } from "./value.js";

export const bool = <T extends "bool" | "int" | "uint" | "float">(
  value: DynoVal<T>,
): DynoVal<"bool"> => new Bool({ value });
export const int = <T extends "bool" | "int" | "uint" | "float">(
  value: DynoVal<T>,
): DynoVal<"int"> => new Int({ value });
export const uint = <T extends "bool" | "int" | "uint" | "float">(
  value: DynoVal<T>,
): DynoVal<"uint"> => new Uint({ value });
export const float = <T extends "bool" | "int" | "uint" | "float">(
  value: DynoVal<T>,
): DynoVal<"float"> => new Float({ value });

export const bvec2 = <T extends "bool" | "bvec2" | "ivec2" | "uvec2" | "vec2">(
  value: DynoVal<T>,
): DynoVal<"bvec2"> => new BVec2({ value });
export const bvec3 = <T extends "bool" | "bvec3" | "ivec3" | "uvec3" | "vec3">(
  value: DynoVal<T>,
): DynoVal<"bvec3"> => new BVec3({ value });
export const bvec4 = <T extends "bool" | "bvec4" | "ivec4" | "uvec4" | "vec4">(
  value: DynoVal<T>,
): DynoVal<"bvec4"> => new BVec4({ value });

export const ivec2 = <T extends "int" | "bvec2" | "ivec2" | "uvec2" | "vec2">(
  value: DynoVal<T>,
): DynoVal<"ivec2"> => new IVec2({ value });
export const ivec3 = <T extends "int" | "bvec3" | "ivec3" | "uvec3" | "vec3">(
  value: DynoVal<T>,
): DynoVal<"ivec3"> => new IVec3({ value });
export const ivec4 = <T extends "int" | "bvec4" | "ivec4" | "uvec4" | "vec4">(
  value: DynoVal<T>,
): DynoVal<"ivec4"> => new IVec4({ value });

export const uvec2 = <T extends "uint" | "bvec2" | "ivec2" | "uvec2" | "vec2">(
  value: DynoVal<T>,
): DynoVal<"uvec2"> => new UVec2({ value });
export const uvec3 = <T extends "uint" | "bvec3" | "ivec3" | "uvec3" | "vec3">(
  value: DynoVal<T>,
): DynoVal<"uvec3"> => new UVec3({ value });
export const uvec4 = <T extends "uint" | "bvec4" | "ivec4" | "uvec4" | "vec4">(
  value: DynoVal<T>,
): DynoVal<"uvec4"> => new UVec4({ value });

export const vec2 = <
  T extends "float" | "bvec2" | "ivec2" | "uvec2" | "vec2" | "vec3" | "vec4",
>(
  value: DynoVal<T>,
): DynoVal<"vec2"> => new Vec2({ value });
export const vec3 = <
  T extends "float" | "bvec3" | "ivec3" | "uvec3" | "vec3" | "vec4",
>(
  value: DynoVal<T>,
): DynoVal<"vec3"> => new Vec3({ value });
export const vec4 = <T extends "float" | "bvec4" | "ivec4" | "uvec4" | "vec4">(
  value: DynoVal<T>,
): DynoVal<"vec4"> => new Vec4({ value });

export const mat2 = <T extends "float" | "mat2" | "mat3" | "mat4">(
  value: DynoVal<T>,
): DynoVal<"mat2"> => new Mat2({ value });
export const mat3 = <T extends "float" | "mat2" | "mat3" | "mat4">(
  value: DynoVal<T>,
): DynoVal<"mat3"> => new Mat3({ value });
export const mat4 = <T extends "float" | "mat2" | "mat3" | "mat4">(
  value: DynoVal<T>,
): DynoVal<"mat4"> => new Mat4({ value });

export const floatBitsToInt = (value: DynoVal<"float">): DynoVal<"int"> =>
  new FloatBitsToInt({ value });
export const floatBitsToUint = (value: DynoVal<"float">): DynoVal<"uint"> =>
  new FloatBitsToUint({ value });
export const intBitsToFloat = (value: DynoVal<"int">): DynoVal<"float"> =>
  new IntBitsToFloat({ value });
export const uintBitsToFloat = (value: DynoVal<"uint">): DynoVal<"float"> =>
  new UintBitsToFloat({ value });

export const packSnorm2x16 = (value: DynoVal<"vec2">): DynoVal<"uint"> =>
  new PackSnorm2x16({ value });
export const unpackSnorm2x16 = (value: DynoVal<"uint">): DynoVal<"vec2"> =>
  new UnpackSnorm2x16({ value });
export const packUnorm2x16 = (value: DynoVal<"vec2">): DynoVal<"uint"> =>
  new PackUnorm2x16({ value });
export const unpackUnorm2x16 = (value: DynoVal<"uint">): DynoVal<"vec2"> =>
  new UnpackUnorm2x16({ value });

export const packHalf2x16 = (value: DynoVal<"vec2">): DynoVal<"uint"> =>
  new PackHalf2x16({ value });
export const unpackHalf2x16 = (value: DynoVal<"uint">): DynoVal<"vec2"> =>
  new UnpackHalf2x16({ value });

export const uintToRgba8 = (value: DynoVal<"uint">): DynoVal<"vec4"> =>
  new UintToRgba8({ value });

export class SimpleCast<
  Allowed extends SimpleTypes,
  OutType extends SimpleTypes,
  OutKey extends string,
> extends UnaryOp<Allowed, OutType, OutKey> {
  constructor({
    value,
    outType,
    outKey,
  }: { value: DynoVal<Allowed>; outType: OutType; outKey: OutKey }) {
    super({ a: value, outTypeFunc: () => outType, outKey });
    this.statements = ({ inputs, outputs }) => [
      `${outputs[outKey]} = ${typeLiteral(outType)}(${inputs.a});`,
    ];
  }
}

export class Bool extends SimpleCast<
  "bool" | "int" | "uint" | "float",
  "bool",
  "bool"
> {
  constructor({
    value,
  }: { value: DynoVal<"bool" | "int" | "uint" | "float"> }) {
    super({ value, outType: "bool", outKey: "bool" });
  }
}

export class Int extends SimpleCast<
  "bool" | "int" | "uint" | "float",
  "int",
  "int"
> {
  constructor({
    value,
  }: { value: DynoVal<"bool" | "int" | "uint" | "float"> }) {
    super({ value, outType: "int", outKey: "int" });
  }
}

export class Uint extends SimpleCast<
  "bool" | "int" | "uint" | "float",
  "uint",
  "uint"
> {
  constructor({
    value,
  }: { value: DynoVal<"bool" | "int" | "uint" | "float"> }) {
    super({ value, outType: "uint", outKey: "uint" });
  }
}

export class Float extends SimpleCast<
  "bool" | "int" | "uint" | "float",
  "float",
  "float"
> {
  constructor({
    value,
  }: { value: DynoVal<"bool" | "int" | "uint" | "float"> }) {
    super({ value, outType: "float", outKey: "float" });
  }
}

export class BVec2 extends SimpleCast<
  "bool" | "bvec2" | "ivec2" | "uvec2" | "vec2",
  "bvec2",
  "bvec2"
> {
  constructor({
    value,
  }: { value: DynoVal<"bool" | "bvec2" | "ivec2" | "uvec2" | "vec2"> }) {
    super({ value, outType: "bvec2", outKey: "bvec2" });
  }
}

export class BVec3 extends SimpleCast<
  "bool" | "bvec3" | "ivec3" | "uvec3" | "vec3",
  "bvec3",
  "bvec3"
> {
  constructor({
    value,
  }: { value: DynoVal<"bool" | "bvec3" | "ivec3" | "uvec3" | "vec3"> }) {
    super({ value, outType: "bvec3", outKey: "bvec3" });
  }
}

export class BVec4 extends SimpleCast<
  "bool" | "bvec4" | "ivec4" | "uvec4" | "vec4",
  "bvec4",
  "bvec4"
> {
  constructor({
    value,
  }: { value: DynoVal<"bool" | "bvec4" | "ivec4" | "uvec4" | "vec4"> }) {
    super({ value, outType: "bvec4", outKey: "bvec4" });
  }
}

export class IVec2 extends SimpleCast<
  "int" | "bvec2" | "ivec2" | "uvec2" | "vec2",
  "ivec2",
  "ivec2"
> {
  constructor({
    value,
  }: { value: DynoVal<"int" | "bvec2" | "ivec2" | "uvec2" | "vec2"> }) {
    super({ value, outType: "ivec2", outKey: "ivec2" });
  }
}

export class IVec3 extends SimpleCast<
  "int" | "bvec3" | "ivec3" | "uvec3" | "vec3",
  "ivec3",
  "ivec3"
> {
  constructor({
    value,
  }: { value: DynoVal<"int" | "bvec3" | "ivec3" | "uvec3" | "vec3"> }) {
    super({ value, outType: "ivec3", outKey: "ivec3" });
  }
}

export class IVec4 extends SimpleCast<
  "int" | "bvec4" | "ivec4" | "uvec4" | "vec4",
  "ivec4",
  "ivec4"
> {
  constructor({
    value,
  }: { value: DynoVal<"int" | "bvec4" | "ivec4" | "uvec4" | "vec4"> }) {
    super({ value, outType: "ivec4", outKey: "ivec4" });
  }
}

export class UVec2 extends SimpleCast<
  "uint" | "ivec2" | "bvec2" | "uvec2" | "vec2",
  "uvec2",
  "uvec2"
> {
  constructor({
    value,
  }: { value: DynoVal<"uint" | "ivec2" | "bvec2" | "uvec2" | "vec2"> }) {
    super({ value, outType: "uvec2", outKey: "uvec2" });
  }
}

export class UVec3 extends SimpleCast<
  "uint" | "ivec3" | "bvec3" | "uvec3" | "vec3",
  "uvec3",
  "uvec3"
> {
  constructor({
    value,
  }: { value: DynoVal<"uint" | "ivec3" | "bvec3" | "uvec3" | "vec3"> }) {
    super({ value, outType: "uvec3", outKey: "uvec3" });
  }
}

export class UVec4 extends SimpleCast<
  "uint" | "ivec4" | "bvec4" | "uvec4" | "vec4",
  "uvec4",
  "uvec4"
> {
  constructor({
    value,
  }: { value: DynoVal<"uint" | "ivec4" | "bvec4" | "uvec4" | "vec4"> }) {
    super({ value, outType: "uvec4", outKey: "uvec4" });
  }
}

export class Vec2 extends SimpleCast<
  "float" | "bvec2" | "ivec2" | "uvec2" | "vec2" | "vec3" | "vec4",
  "vec2",
  "vec2"
> {
  constructor({
    value,
  }: {
    value: DynoVal<
      "float" | "bvec2" | "ivec2" | "uvec2" | "vec2" | "vec3" | "vec4"
    >;
  }) {
    super({ value, outType: "vec2", outKey: "vec2" });
  }
}

export class Vec3 extends SimpleCast<
  "float" | "bvec3" | "ivec3" | "uvec3" | "vec3" | "vec2" | "vec4",
  "vec3",
  "vec3"
> {
  constructor({
    value,
  }: {
    value: DynoVal<
      "float" | "bvec3" | "ivec3" | "uvec3" | "vec3" | "vec2" | "vec4"
    >;
  }) {
    super({ value, outType: "vec3", outKey: "vec3" });
  }
}

export class Vec4 extends SimpleCast<
  "float" | "bvec4" | "ivec4" | "uvec4" | "vec4",
  "vec4",
  "vec4"
> {
  constructor({
    value,
  }: { value: DynoVal<"float" | "bvec4" | "ivec4" | "uvec4" | "vec4"> }) {
    super({ value, outType: "vec4", outKey: "vec4" });
  }
}

export class Mat2 extends SimpleCast<
  "float" | "mat2" | "mat3" | "mat4",
  "mat2",
  "mat2"
> {
  constructor({
    value,
  }: { value: DynoVal<"float" | "mat2" | "mat3" | "mat4"> }) {
    super({ value, outType: "mat2", outKey: "mat2" });
  }
}

export class Mat3 extends SimpleCast<
  "float" | "mat2" | "mat3" | "mat4",
  "mat3",
  "mat3"
> {
  constructor({
    value,
  }: { value: DynoVal<"float" | "mat2" | "mat3" | "mat4"> }) {
    super({ value, outType: "mat3", outKey: "mat3" });
  }
}

export class Mat4 extends SimpleCast<
  "float" | "mat2" | "mat3" | "mat4",
  "mat4",
  "mat4"
> {
  constructor({
    value,
  }: { value: DynoVal<"float" | "mat2" | "mat3" | "mat4"> }) {
    super({ value, outType: "mat4", outKey: "mat4" });
  }
}

export class FloatBitsToInt extends UnaryOp<"float", "int", "int"> {
  constructor({ value }: { value: DynoVal<"float"> }) {
    super({ a: value, outKey: "int", outTypeFunc: () => "int" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.int} = floatBitsToInt(${inputs.a});`];
    };
  }
}

export class FloatBitsToUint extends UnaryOp<"float", "uint", "uint"> {
  constructor({ value }: { value: DynoVal<"float"> }) {
    super({ a: value, outKey: "uint", outTypeFunc: () => "uint" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.uint} = floatBitsToUint(${inputs.a});`];
    };
  }
}

export class IntBitsToFloat extends UnaryOp<"int", "float", "float"> {
  constructor({ value }: { value: DynoVal<"int"> }) {
    super({ a: value, outKey: "float", outTypeFunc: () => "float" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.float} = intBitsToFloat(${inputs.a});`];
    };
  }
}

export class UintBitsToFloat extends UnaryOp<"uint", "float", "float"> {
  constructor({ value }: { value: DynoVal<"uint"> }) {
    super({ a: value, outKey: "float", outTypeFunc: () => "float" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.float} = uintBitsToFloat(${inputs.a});`];
    };
  }
}

export class PackSnorm2x16 extends UnaryOp<"vec2", "uint", "uint"> {
  constructor({ value }: { value: DynoVal<"vec2"> }) {
    super({ a: value, outKey: "uint", outTypeFunc: () => "uint" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.uint} = packSnorm2x16(${inputs.a});`];
    };
  }
}

export class UnpackSnorm2x16 extends UnaryOp<"uint", "vec2", "vec2"> {
  constructor({ value }: { value: DynoVal<"uint"> }) {
    super({ a: value, outKey: "vec2", outTypeFunc: () => "vec2" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.vec2} = unpackSnorm2x16(${inputs.a});`];
    };
  }
}

export class PackUnorm2x16 extends UnaryOp<"vec2", "uint", "uint"> {
  constructor({ value }: { value: DynoVal<"vec2"> }) {
    super({ a: value, outKey: "uint", outTypeFunc: () => "uint" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.uint} = packUnorm2x16(${inputs.a});`];
    };
  }
}

export class UnpackUnorm2x16 extends UnaryOp<"uint", "vec2", "vec2"> {
  constructor({ value }: { value: DynoVal<"uint"> }) {
    super({ a: value, outKey: "vec2", outTypeFunc: () => "vec2" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.vec2} = unpackUnorm2x16(${inputs.a});`];
    };
  }
}

export class PackHalf2x16 extends UnaryOp<"vec2", "uint", "uint"> {
  constructor({ value }: { value: DynoVal<"vec2"> }) {
    super({ a: value, outKey: "uint", outTypeFunc: () => "uint" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.uint} = packHalf2x16(${inputs.a});`];
    };
  }
}

export class UnpackHalf2x16 extends UnaryOp<"uint", "vec2", "vec2"> {
  constructor({ value }: { value: DynoVal<"uint"> }) {
    super({ a: value, outKey: "vec2", outTypeFunc: () => "vec2" });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.vec2} = unpackHalf2x16(${inputs.a});`];
    };
  }
}

export class UintToRgba8 extends UnaryOp<"uint", "vec4", "rgba8"> {
  constructor({ value }: { value: DynoVal<"uint"> }) {
    super({ a: value, outKey: "rgba8", outTypeFunc: () => "vec4" });
    this.statements = ({ inputs, outputs }) => {
      return [
        `uvec4 uRgba = uvec4(${inputs.a} & 0xffu, (${inputs.a} >> 8u) & 0xffu, (${inputs.a} >> 16u) & 0xffu, (${inputs.a} >> 24u) & 0xffu);`,
        `${outputs.rgba8} = vec4(uRgba) / 255.0;`,
      ];
    };
  }
}
