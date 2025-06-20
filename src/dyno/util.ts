import { Dyno, DynoBlock, unindent } from "./base";
import { float, vec2, vec3, vec4 } from "./convert";
import { mul } from "./math";
import { type ValueTypes, isIntType, isUintType, sameSizeUvec } from "./types";
import {
  DynoOutput,
  type DynoVal,
  type DynoValue,
  type HasDynoOut,
  dynoConst,
  valType,
} from "./value";
import { combine } from "./vecmat";

export const remapIndex = (
  index: DynoVal<"int">,
  from: DynoVal<"int">,
  to: DynoVal<"int">,
): DynoVal<"int"> => {
  return new DynoRemapIndex({ index, from, to });
};
export const pcgMix = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"uint"> => {
  return new PcgMix({ value });
};
export const pcgNext = (state: DynoVal<"uint">): DynoVal<"uint"> => {
  return new PcgNext({ state });
};
export const pcgHash = (state: DynoVal<"uint">): DynoVal<"uint"> => {
  return new PcgHash({ state });
};
export const hash = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"uint"> => {
  return new Hash({ value });
};
export const hash2 = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"uvec2"> => {
  return new Hash2({ value });
};
export const hash3 = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"uvec3"> => {
  return new Hash3({ value });
};
export const hash4 = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"uvec4"> => {
  return new Hash4({ value });
};
export const hashFloat = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"float"> => {
  return new HashFloat({ value });
};
export const hashVec2 = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"vec2"> => {
  return new HashVec2({ value });
};
export const hashVec3 = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"vec3"> => {
  return new HashVec3({ value });
};
export const hashVec4 = <T extends ValueTypes>(
  value: DynoVal<T>,
): DynoVal<"vec4"> => {
  return new HashVec4({ value });
};
export const normalizedDepth = (
  z: DynoVal<"float">,
  zNear: DynoVal<"float">,
  zFar: DynoVal<"float">,
): DynoVal<"float"> => {
  return new NormalizedDepth({ z, zNear, zFar }).outputs.depth;
};

export class DynoRemapIndex
  extends Dyno<{ from: "int"; to: "int"; index: "int" }, { index: "int" }>
  implements HasDynoOut<"int">
{
  constructor({
    from,
    to,
    index,
  }: { from: DynoVal<"int">; to: DynoVal<"int">; index: DynoVal<"int"> }) {
    super({
      inTypes: { from: "int", to: "int", index: "int" },
      outTypes: { index: "int" },
      inputs: { from, to, index },
      statements: ({ inputs, outputs }) => {
        return [
          `${outputs.index} = ${inputs.index} - ${inputs.from} + ${inputs.to};`,
        ];
      },
    });
  }

  dynoOut(): DynoValue<"int"> {
    return new DynoOutput(this, "index");
  }
}

export class PcgNext<T extends "uint" | "int" | "float">
  extends Dyno<{ state: T }, { state: "uint" }>
  implements HasDynoOut<"uint">
{
  constructor({ state }: { state: DynoVal<T> }) {
    const type = valType(state);
    super({
      inTypes: { state: type },
      outTypes: { state: "uint" },
      inputs: { state },
      globals: () => [
        unindent(`
          uint pcg_next(uint state) {
            return state * 747796405u + 2891336453u;
          }
        `),
      ],
      statements: ({ inputs, outputs }) => {
        const toUint =
          type === "uint"
            ? `${inputs.state}`
            : type === "int"
              ? `uint(${inputs.state})`
              : `floatBitsToUint(${inputs.state})`;
        return [`${outputs.state} = pcg_next(${toUint});`];
      },
    });
  }
  dynoOut(): DynoValue<"uint"> {
    return new DynoOutput(this, "state");
  }
}

export class PcgHash
  extends Dyno<{ state: "uint" }, { hash: "uint" }>
  implements HasDynoOut<"uint">
{
  constructor({ state }: { state: DynoVal<"uint"> }) {
    super({
      inTypes: { state: "uint" },
      outTypes: { hash: "uint" },
      inputs: { state },
      globals: () => [
        unindent(`
          uint pcg_hash(uint state) {
            uint hash = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
            return (hash >> 22u) ^ hash;
          }
        `),
      ],
      statements: ({ inputs, outputs }) => [
        `${outputs.hash} = pcg_hash(${inputs.state});`,
      ],
    });
  }
  dynoOut(): DynoValue<"uint"> {
    return new DynoOutput(this, "hash");
  }
}

export class PcgMix<T extends ValueTypes>
  extends Dyno<{ value: T }, { state: "uint" }>
  implements HasDynoOut<"uint">
{
  constructor({ value }: { value: DynoVal<T> }) {
    const type = valType(value);
    const tempType = sameSizeUvec(type);
    super({
      inTypes: { value: type },
      outTypes: { state: "uint" },
      inputs: { value },
      globals: () => [
        unindent(`
          uint pcg_mix(uint value) {
            return value;
          }
          uint pcg_mix(uvec2 value) {
            return value.x + 0x9e3779b9u * value.y;
          }
          uint pcg_mix(uvec3 value) {
            return value.x + 0x9e3779b9u * value.y + 0x85ebca6bu * value.z;
          }
          uint pcg_mix(uvec4 value) {
            return value.x + 0x9e3779b9u * value.y + 0x85ebca6bu * value.z + 0xc2b2ae35u * value.w;
          }
        `),
      ],
      statements: ({ inputs, outputs }) => {
        const toUvec = isUintType(type)
          ? `${inputs.value}`
          : isIntType(type)
            ? `${tempType}(${inputs.value})`
            : `floatBitsToUint(${inputs.value})`;
        return [
          `${tempType} bits = ${toUvec};`,
          `${outputs.state} = pcg_mix(bits);`,
        ];
      },
    });
  }
  dynoOut(): DynoValue<"uint"> {
    return new DynoOutput(this, "state");
  }
}

export class Hash<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "uint" }>
  implements HasDynoOut<"uint">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "uint" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        let state = new PcgMix({ value: value }).outputs.state;
        state = new PcgNext({ state }).outputs.state;
        return new PcgHash({ state }).outputs;
      },
    });
  }
  dynoOut(): DynoValue<"uint"> {
    return new DynoOutput(this, "hash");
  }
}

export class Hash2<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "uvec2" }>
  implements HasDynoOut<"uvec2">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "uvec2" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        let state = new PcgMix({ value: value }).outputs.state;
        state = new PcgNext({ state }).outputs.state;
        const x = new PcgHash({ state }).outputs.hash;
        state = new PcgNext({ state }).outputs.state;
        const y = new PcgHash({ state }).outputs.hash;
        return { hash: combine({ vectorType: "uvec2", x, y }) };
      },
    });
  }
  dynoOut(): DynoValue<"uvec2"> {
    return new DynoOutput(this, "hash");
  }
}

export class Hash3<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "uvec3" }>
  implements HasDynoOut<"uvec3">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "uvec3" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        let state = new PcgMix({ value: value }).outputs.state;
        state = new PcgNext({ state }).outputs.state;
        const x = new PcgHash({ state }).outputs.hash;
        state = new PcgNext({ state }).outputs.state;
        const y = new PcgHash({ state }).outputs.hash;
        state = new PcgNext({ state }).outputs.state;
        const z = new PcgHash({ state }).outputs.hash;
        return { hash: combine({ vectorType: "uvec3", x, y, z }) };
      },
    });
  }
  dynoOut(): DynoValue<"uvec3"> {
    return new DynoOutput(this, "hash");
  }
}

export class Hash4<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "uvec4" }>
  implements HasDynoOut<"uvec4">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "uvec4" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        let state = new PcgMix({ value: value }).outputs.state;
        state = new PcgNext({ state }).outputs.state;
        const x = new PcgHash({ state }).outputs.hash;
        state = new PcgNext({ state }).outputs.state;
        const y = new PcgHash({ state }).outputs.hash;
        state = new PcgNext({ state }).outputs.state;
        const z = new PcgHash({ state }).outputs.hash;
        state = new PcgNext({ state }).outputs.state;
        const w = new PcgHash({ state }).outputs.hash;
        return { hash: combine({ vectorType: "uvec4", x, y, z, w }) };
      },
    });
  }
  dynoOut(): DynoValue<"uvec4"> {
    return new DynoOutput(this, "hash");
  }
}

export class HashFloat<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "float" }>
  implements HasDynoOut<"float">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "float" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        const word = hash(value);
        return { hash: mul(float(word), dynoConst("float", 1 / 2 ** 32)) };
      },
    });
  }
  dynoOut(): DynoValue<"float"> {
    return new DynoOutput(this, "hash");
  }
}

export class HashVec2<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "vec2" }>
  implements HasDynoOut<"vec2">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "vec2" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        const words = hash2(value);
        return { hash: mul(vec2(words), dynoConst("float", 1 / 2 ** 32)) };
      },
    });
  }
  dynoOut(): DynoValue<"vec2"> {
    return new DynoOutput(this, "hash");
  }
}

export class HashVec3<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "vec3" }>
  implements HasDynoOut<"vec3">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "vec3" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        const words = hash3(value);
        return { hash: mul(vec3(words), dynoConst("float", 1 / 2 ** 32)) };
      },
    });
  }
  dynoOut(): DynoValue<"vec3"> {
    return new DynoOutput(this, "hash");
  }
}

export class HashVec4<T extends ValueTypes>
  extends DynoBlock<{ value: T }, { hash: "vec4" }>
  implements HasDynoOut<"vec4">
{
  constructor({ value }: { value: DynoVal<T> }) {
    super({
      inTypes: { value: valType(value) },
      outTypes: { hash: "vec4" },
      inputs: { value },
      construct: ({ value }) => {
        if (!value) {
          throw new Error("value is required");
        }
        const words = hash4(value);
        return { hash: mul(vec4(words), dynoConst("float", 1 / 2 ** 32)) };
      },
    });
  }
  dynoOut(): DynoValue<"vec4"> {
    return new DynoOutput(this, "hash");
  }
}

export class NormalizedDepth
  extends Dyno<
    { z: "float"; zNear: "float"; zFar: "float" },
    { depth: "float" }
  >
  implements HasDynoOut<"float">
{
  constructor({
    z,
    zNear,
    zFar,
  }: { z: DynoVal<"float">; zNear: DynoVal<"float">; zFar: DynoVal<"float"> }) {
    super({
      inTypes: { z: "float", zNear: "float", zFar: "float" },
      outTypes: { depth: "float" },
      inputs: { z, zNear, zFar },
      statements: ({ inputs, outputs }) => [
        `float clamped = clamp(${inputs.z}, ${inputs.zNear}, ${inputs.zFar});`,
        `${outputs.depth} = (log2(clamped + 1.0) - log2(${inputs.zNear} + 1.0)) / (log2(${inputs.zFar} + 1.0) - log2(${inputs.zNear} + 1.0));`,
      ],
    });
  }

  dynoOut(): DynoValue<"float"> {
    return new DynoOutput(this, "depth");
  }
}
