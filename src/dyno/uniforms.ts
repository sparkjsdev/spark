import type { IUniform } from "three";
import { Dyno, dynoDeclare } from "./base.js";
import type { DynoJsType, DynoType } from "./types.js";
import { DynoOutput, type DynoValue, type HasDynoOut } from "./value.js";

export const uniform = <V extends DynoJsType<DynoType>>(
  key: string,
  type: DynoType,
  value: V,
) => new DynoUniform({ key, type, value });
export const dynoBool = (value = false, key?: string) =>
  new DynoBool({ key, value });
export const dynoUint = (value = 0, key?: string) =>
  new DynoUint({ key, value });
export const dynoInt = (value = 0, key?: string) => new DynoInt({ key, value });
export const dynoFloat = (value = 0.0, key?: string) =>
  new DynoFloat({ key, value });

export const dynoBvec2 = <V extends DynoJsType<"bvec2">>(
  value: V,
  key?: string,
) => new DynoBvec2({ key, value });
export const dynoUvec2 = <V extends DynoJsType<"uvec2">>(
  value: V,
  key?: string,
) => new DynoUvec2({ key, value });
export const dynoIvec2 = <V extends DynoJsType<"ivec2">>(
  value: V,
  key?: string,
) => new DynoIvec2({ key, value });
export const dynoVec2 = <V extends DynoJsType<"vec2">>(
  value: V,
  key?: string,
) => new DynoVec2({ key, value });

export const dynoBvec3 = <V extends DynoJsType<"bvec3">>(
  value: V,
  key?: string,
) => new DynoBvec3({ key, value });
export const dynoUvec3 = <V extends DynoJsType<"uvec3">>(
  value: V,
  key?: string,
) => new DynoUvec3({ key, value });
export const dynoIvec3 = <V extends DynoJsType<"ivec3">>(
  value: V,
  key?: string,
) => new DynoIvec3({ key, value });
export const dynoVec3 = <V extends DynoJsType<"vec3">>(
  value: V,
  key?: string,
) => new DynoVec3({ key, value });

export const dynoBvec4 = <V extends DynoJsType<"bvec4">>(
  value: V,
  key?: string,
) => new DynoBvec4({ key, value });
export const dynoUvec4 = <V extends DynoJsType<"uvec4">>(
  value: V,
  key?: string,
) => new DynoUvec4({ key, value });
export const dynoIvec4 = <V extends DynoJsType<"ivec4">>(
  value: V,
  key?: string,
) => new DynoIvec4({ key, value });
export const dynoVec4 = <V extends DynoJsType<"vec4">>(
  value: V,
  key?: string,
) => new DynoVec4({ key, value });

export const dynoMat2 = <V extends DynoJsType<"mat2">>(
  value: V,
  key?: string,
) => new DynoMat2({ key, value });
export const dynoMat2x2 = <V extends DynoJsType<"mat2x2">>(
  value: V,
  key?: string,
) => new DynoMat2x2({ key, value });
export const dynoMat2x3 = <V extends DynoJsType<"mat2x3">>(
  value: V,
  key?: string,
) => new DynoMat2x3({ key, value });
export const dynoMat2x4 = <V extends DynoJsType<"mat2x4">>(
  value: V,
  key?: string,
) => new DynoMat2x4({ key, value });

export const dynoMat3 = <V extends DynoJsType<"mat3">>(
  value: V,
  key?: string,
) => new DynoMat3({ key, value });
export const dynoMat3x2 = <V extends DynoJsType<"mat3x2">>(
  value: V,
  key?: string,
) => new DynoMat3x2({ key, value });
export const dynoMat3x3 = <V extends DynoJsType<"mat3x3">>(
  value: V,
  key?: string,
) => new DynoMat3x3({ key, value });
export const dynoMat3x4 = <V extends DynoJsType<"mat3x4">>(
  value: V,
  key?: string,
) => new DynoMat3x4({ key, value });

export const dynoMat4 = <V extends DynoJsType<"mat4">>(
  value: V,
  key?: string,
) => new DynoMat4({ key, value });
export const dynoMat4x2 = <V extends DynoJsType<"mat4x2">>(
  value: V,
  key?: string,
) => new DynoMat4x2({ key, value });
export const dynoMat4x3 = <V extends DynoJsType<"mat4x3">>(
  value: V,
  key?: string,
) => new DynoMat4x3({ key, value });
export const dynoMat4x4 = <V extends DynoJsType<"mat4x4">>(
  value: V,
  key?: string,
) => new DynoMat4x4({ key, value });

export const dynoUsampler2D = <V extends DynoJsType<"usampler2D">>(
  value: V,
  key?: string,
) => new DynoUsampler2D({ key, value });
export const dynoIsampler2D = <V extends DynoJsType<"isampler2D">>(
  value: V,
  key?: string,
) => new DynoIsampler2D({ key, value });
export const dynoSampler2D = <V extends DynoJsType<"sampler2D">>(
  value: V,
  key?: string,
) => new DynoSampler2D({ key, value });

export const dynoUsampler2DArray = <V extends DynoJsType<"usampler2DArray">>(
  value: V,
  key?: string,
) => new DynoUsampler2DArray({ key, value });
export const dynoIsampler2DArray = <V extends DynoJsType<"isampler2DArray">>(
  key: string,
  value: V,
) => new DynoIsampler2DArray({ key, value });
export const dynoSampler2DArray = <V extends DynoJsType<"sampler2DArray">>(
  value: V,
  key?: string,
) => new DynoSampler2DArray({ key, value });

export const dynoUsampler3D = <V extends DynoJsType<"usampler3D">>(
  value: V,
  key?: string,
) => new DynoUsampler3D({ key, value });
export const dynoIsampler3D = <V extends DynoJsType<"isampler3D">>(
  value: V,
  key?: string,
) => new DynoIsampler3D({ key, value });
export const dynoSampler3D = <V extends DynoJsType<"sampler3D">>(
  value: V,
  key?: string,
) => new DynoSampler3D({ key, value });

export const dynoUsamplerCube = <V extends DynoJsType<"usamplerCube">>(
  value: V,
  key?: string,
) => new DynoUsamplerCube({ key, value });
export const dynoIsamplerCube = <V extends DynoJsType<"isamplerCube">>(
  value: V,
  key?: string,
) => new DynoIsamplerCube({ key, value });
export const dynoSamplerCube = <V extends DynoJsType<"samplerCube">>(
  value: V,
  key?: string,
) => new DynoSamplerCube({ key, value });

export const dynoSampler2DShadow = <V extends DynoJsType<"sampler2DShadow">>(
  value: V,
  key?: string,
) => new DynoSampler2DShadow({ key, value });
export const dynoSampler2DArrayShadow = <
  V extends DynoJsType<"sampler2DArrayShadow">,
>(
  value: V,
  key?: string,
) => new DynoSampler2DArrayShadow({ key, value });
export const dynoSamplerCubeShadow = <
  V extends DynoJsType<"samplerCubeShadow">,
>(
  value: V,
  key?: string,
) => new DynoSamplerCubeShadow({ key, value });

export class DynoUniform<
    T extends DynoType,
    K extends string = "value",
    V extends DynoJsType<T> = DynoJsType<T>,
  >
  extends Dyno<Record<string, never>, { [key in K]: T }>
  implements HasDynoOut<T>
{
  public type: T;
  public count?: number;
  public outKey: K;
  public value: V;
  public uniform: { value: V; type?: string };

  constructor({
    key,
    type,
    count,
    value,
    update,
    globals,
  }: {
    key?: K;
    type: T;
    count?: number;
    value: V;
    update?: (value: V) => V | undefined;
    globals?: ({
      inputs,
      outputs,
    }: { inputs: unknown; outputs: { [key in K]?: string } }) => string[];
  }) {
    key = (key ?? "value") as K;
    super({
      outTypes: { [key]: type } as { [key in K]: T },
      update: () => {
        if (update) {
          const value = update(this.value);
          if (value !== undefined) {
            this.value = value;
          }
        }
        this.uniform.value = this.value;
      },
      generate: ({ inputs, outputs }) => {
        const allGlobals = globals?.({ inputs, outputs }) ?? [];
        const uniforms: Record<string, IUniform> = {};
        const name = outputs[key];
        if (name) {
          allGlobals.push(`uniform ${dynoDeclare(name, type, count)};`);
          uniforms[name] = this.uniform;
        }
        return { globals: allGlobals, uniforms };
      },
    });
    this.type = type;
    this.count = count;
    this.value = value;
    this.uniform = { value };
    this.outKey = key;
  }

  dynoOut(): DynoValue<T> {
    return new DynoOutput(this, this.outKey);
  }
}

export class DynoBool<K extends string> extends DynoUniform<
  "bool",
  K,
  boolean
> {
  constructor({
    key,
    value,
    update,
  }: {
    key?: K;
    value: boolean;
    update?: (value: boolean) => boolean | undefined;
  }) {
    super({ key, type: "bool", value, update });
  }
}

export class DynoUint<K extends string> extends DynoUniform<"uint", K, number> {
  constructor({
    key,
    value,
    update,
  }: {
    key?: K;
    value: number;
    update?: (value: number) => number | undefined;
  }) {
    super({ key, type: "uint", value, update });
  }
}

export class DynoInt<K extends string> extends DynoUniform<"int", K, number> {
  constructor({
    key,
    value,
    update,
  }: {
    key?: K;
    value: number;
    update?: (value: number) => number | undefined;
  }) {
    super({ key, type: "int", value, update });
  }
}

export class DynoFloat<K extends string = "value"> extends DynoUniform<
  "float",
  K,
  number
> {
  constructor({
    key,
    value,
    update,
  }: {
    key?: K;
    value: number;
    update?: (value: number) => number | undefined;
  }) {
    super({ key, type: "float", value, update });
  }
}

export class DynoBvec2<
  K extends string,
  V extends DynoJsType<"bvec2">,
> extends DynoUniform<"bvec2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "bvec2", value, update });
  }
}

export class DynoUvec2<
  K extends string,
  V extends DynoJsType<"uvec2">,
> extends DynoUniform<"uvec2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "uvec2", value, update });
  }
}

export class DynoIvec2<
  K extends string,
  V extends DynoJsType<"ivec2">,
> extends DynoUniform<"ivec2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "ivec2", value, update });
  }
}

export class DynoVec2<
  K extends string,
  V extends DynoJsType<"vec2">,
> extends DynoUniform<"vec2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "vec2", value, update });
  }
}

export class DynoBvec3<
  K extends string,
  V extends DynoJsType<"bvec3">,
> extends DynoUniform<"bvec3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "bvec3", value, update });
  }
}

export class DynoUvec3<
  V extends DynoJsType<"uvec3">,
  K extends string = "value",
> extends DynoUniform<"uvec3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "uvec3", value, update });
  }
}

export class DynoIvec3<
  V extends DynoJsType<"ivec3">,
  K extends string = "value",
> extends DynoUniform<"ivec3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "ivec3", value, update });
  }
}

export class DynoVec3<
  V extends DynoJsType<"vec3">,
  K extends string = "value",
> extends DynoUniform<"vec3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "vec3", value, update });
  }
}

export class DynoBvec4<
  K extends string,
  V extends DynoJsType<"bvec4">,
> extends DynoUniform<"bvec4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "bvec4", value, update });
  }
}

export class DynoUvec4<
  K extends string,
  V extends DynoJsType<"uvec4">,
> extends DynoUniform<"uvec4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "uvec4", value, update });
  }
}

export class DynoIvec4<
  K extends string,
  V extends DynoJsType<"ivec4">,
> extends DynoUniform<"ivec4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "ivec4", value, update });
  }
}

export class DynoVec4<
  V extends DynoJsType<"vec4">,
  K extends string = "value",
> extends DynoUniform<"vec4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "vec4", value, update });
  }
}

export class DynoMat2<
  K extends string,
  V extends DynoJsType<"mat2">,
> extends DynoUniform<"mat2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat2", value, update });
  }
}

export class DynoMat2x2<
  K extends string,
  V extends DynoJsType<"mat2x2">,
> extends DynoUniform<"mat2x2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat2x2", value, update });
  }
}

export class DynoMat2x3<
  K extends string,
  V extends DynoJsType<"mat2x3">,
> extends DynoUniform<"mat2x3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat2x3", value, update });
  }
}

export class DynoMat2x4<
  K extends string,
  V extends DynoJsType<"mat2x4">,
> extends DynoUniform<"mat2x4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat2x4", value, update });
  }
}

export class DynoMat3<
  K extends string,
  V extends DynoJsType<"mat3">,
> extends DynoUniform<"mat3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat3", value, update });
  }
}

export class DynoMat3x2<
  K extends string,
  V extends DynoJsType<"mat3x2">,
> extends DynoUniform<"mat3x2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat3x2", value, update });
  }
}

export class DynoMat3x3<
  K extends string,
  V extends DynoJsType<"mat3x3">,
> extends DynoUniform<"mat3x3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat3x3", value, update });
  }
}

export class DynoMat3x4<
  K extends string,
  V extends DynoJsType<"mat3x4">,
> extends DynoUniform<"mat3x4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat3x4", value, update });
  }
}

export class DynoMat4<
  K extends string,
  V extends DynoJsType<"mat4">,
> extends DynoUniform<"mat4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat4", value, update });
  }
}

export class DynoMat4x2<
  K extends string,
  V extends DynoJsType<"mat4x2">,
> extends DynoUniform<"mat4x2", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat4x2", value, update });
  }
}

export class DynoMat4x3<
  K extends string,
  V extends DynoJsType<"mat4x3">,
> extends DynoUniform<"mat4x3", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat4x3", value, update });
  }
}

export class DynoMat4x4<
  K extends string,
  V extends DynoJsType<"mat4x4">,
> extends DynoUniform<"mat4x4", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "mat4x4", value, update });
  }
}

export class DynoUsampler2D<
  K extends string,
  V extends DynoJsType<"usampler2D">,
> extends DynoUniform<"usampler2D", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "usampler2D", value, update });
  }
}

export class DynoIsampler2D<
  K extends string,
  V extends DynoJsType<"isampler2D">,
> extends DynoUniform<"isampler2D", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "isampler2D", value, update });
  }
}

export class DynoSampler2D<
  K extends string,
  V extends DynoJsType<"sampler2D">,
> extends DynoUniform<"sampler2D", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "sampler2D", value, update });
  }
}

export class DynoUsampler2DArray<
  K extends string,
  V extends DynoJsType<"usampler2DArray">,
> extends DynoUniform<"usampler2DArray", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "usampler2DArray", value, update });
  }
}

export class DynoIsampler2DArray<
  K extends string,
  V extends DynoJsType<"isampler2DArray">,
> extends DynoUniform<"isampler2DArray", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "isampler2DArray", value, update });
  }
}

export class DynoSampler2DArray<
  K extends string,
  V extends DynoJsType<"sampler2DArray">,
> extends DynoUniform<"sampler2DArray", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "sampler2DArray", value, update });
  }
}

export class DynoUsampler3D<
  K extends string,
  V extends DynoJsType<"usampler3D">,
> extends DynoUniform<"usampler3D", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "usampler3D", value, update });
  }
}

export class DynoIsampler3D<
  K extends string,
  V extends DynoJsType<"isampler3D">,
> extends DynoUniform<"isampler3D", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "isampler3D", value, update });
  }
}

export class DynoSampler3D<
  K extends string,
  V extends DynoJsType<"sampler3D">,
> extends DynoUniform<"sampler3D", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "sampler3D", value, update });
  }
}

export class DynoUsamplerCube<
  K extends string,
  V extends DynoJsType<"usamplerCube">,
> extends DynoUniform<"usamplerCube", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "usamplerCube", value, update });
  }
}

export class DynoIsamplerCube<
  K extends string,
  V extends DynoJsType<"isamplerCube">,
> extends DynoUniform<"isamplerCube", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "isamplerCube", value, update });
  }
}

export class DynoSamplerCube<
  K extends string,
  V extends DynoJsType<"samplerCube">,
> extends DynoUniform<"samplerCube", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "samplerCube", value, update });
  }
}

export class DynoSampler2DShadow<
  K extends string,
  V extends DynoJsType<"sampler2DShadow">,
> extends DynoUniform<"sampler2DShadow", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "sampler2DShadow", value, update });
  }
}

export class DynoSampler2DArrayShadow<
  K extends string,
  V extends DynoJsType<"sampler2DArrayShadow">,
> extends DynoUniform<"sampler2DArrayShadow", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "sampler2DArrayShadow", value, update });
  }
}

export class DynoSamplerCubeShadow<
  K extends string,
  V extends DynoJsType<"samplerCubeShadow">,
> extends DynoUniform<"samplerCubeShadow", K, V> {
  constructor({
    key,
    value,
    update,
  }: { key?: K; value: V; update?: (value: V) => V | undefined }) {
    super({ key, type: "samplerCubeShadow", value, update });
  }
}
