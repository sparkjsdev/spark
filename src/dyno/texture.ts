import { Dyno } from "./base.js";
import type {
  AllSamplerTypes,
  IsamplerTypes,
  NormalSamplerTypes,
  Sampler2DArrayTypes,
  Sampler2DTypes,
  Sampler3DTypes,
  SamplerCubeTypes,
  SamplerShadowTypes,
  SamplerTypes,
  UsamplerTypes,
} from "./types.js";
import {
  DynoOutput,
  type DynoVal,
  type DynoValue,
  type HasDynoOut,
  valType,
} from "./value.js";

export const textureSize = <T extends AllSamplerTypes>(
  texture: DynoVal<T>,
  lod?: DynoVal<"int">,
): DynoVal<TextureSizeType<T>> => new TextureSize<T>({ texture, lod });
export const texture = <T extends AllSamplerTypes>(
  texture: DynoVal<T>,
  coord: DynoVal<TextureCoordType<T>>,
  bias?: DynoVal<"float">,
): DynoVal<TextureReturnType<T>> => new Texture<T>({ texture, coord, bias });
export const texelFetch = <T extends NormalSamplerTypes>(
  texture: DynoVal<T>,
  coord: DynoVal<TextureSizeType<T>>,
  lod?: DynoVal<"int">,
): DynoVal<TextureReturnType<T>> => new TexelFetch<T>({ texture, coord, lod });

export class TextureSize<T extends AllSamplerTypes>
  extends Dyno<{ texture: T; lod: "int" }, { size: TextureSizeType<T> }>
  implements HasDynoOut<TextureSizeType<T>>
{
  constructor({ texture, lod }: { texture: DynoVal<T>; lod?: DynoVal<"int"> }) {
    const textureType = valType(texture);
    super({
      inTypes: { texture: textureType, lod: "int" },
      outTypes: { size: textureSizeType(textureType) },
      inputs: { texture, lod },
      statements: ({ inputs, outputs }) => [
        `${outputs.size} = textureSize(${inputs.texture}, ${inputs.lod ?? "0"});`,
      ],
    });
  }

  dynoOut(): DynoValue<TextureSizeType<T>> {
    return new DynoOutput(this, "size");
  }
}

export class Texture<T extends AllSamplerTypes>
  extends Dyno<
    { texture: T; coord: TextureCoordType<T>; bias: "float" },
    { sample: TextureReturnType<T> }
  >
  implements HasDynoOut<TextureReturnType<T>>
{
  constructor({
    texture,
    coord,
    bias,
  }: {
    texture: DynoVal<T>;
    coord: DynoVal<TextureCoordType<T>>;
    bias?: DynoVal<"float">;
  }) {
    const textureType = valType(texture);
    super({
      inTypes: {
        texture: textureType,
        coord: textureCoordType(textureType),
        bias: "float",
      },
      outTypes: { sample: textureReturnType(textureType) },
      inputs: { texture, coord, bias },
      statements: ({ inputs, outputs }) => [
        `${outputs.sample} = texture(${inputs.texture}, ${inputs.coord}${inputs.bias ? `, ${inputs.bias}` : ""});`,
      ],
    });
  }

  dynoOut(): DynoValue<TextureReturnType<T>> {
    return new DynoOutput(this, "sample");
  }
}

export class TexelFetch<T extends NormalSamplerTypes>
  extends Dyno<
    { texture: T; coord: TextureSizeType<T>; lod: "int" },
    { texel: TextureReturnType<T> }
  >
  implements HasDynoOut<TextureReturnType<T>>
{
  constructor({
    texture,
    coord,
    lod,
  }: {
    texture: DynoVal<T>;
    coord: DynoVal<TextureSizeType<T>>;
    lod?: DynoVal<"int">;
  }) {
    const textureType = valType(texture);
    super({
      inTypes: {
        texture: textureType,
        coord: textureSizeType(textureType),
        lod: "int",
      },
      outTypes: { texel: textureReturnType(textureType) },
      inputs: { texture, coord, lod },
      statements: ({ inputs, outputs }) => [
        `${outputs.texel} = texelFetch(${inputs.texture}, ${inputs.coord}, ${inputs.lod ?? "0"});`,
      ],
    });
  }

  dynoOut(): DynoValue<TextureReturnType<T>> {
    return new DynoOutput(this, "texel");
  }
}

type TextureSizeType<T extends AllSamplerTypes> = T extends
  | Sampler2DTypes
  | SamplerCubeTypes
  ? "ivec2"
  : T extends Sampler3DTypes | Sampler2DArrayTypes
    ? "ivec3"
    : never;

function textureSizeType<T extends AllSamplerTypes>(
  textureType: T,
): TextureSizeType<T> {
  switch (textureType) {
    case "sampler2D":
    case "usampler2D":
    case "isampler2D":
    case "samplerCube":
    case "usamplerCube":
    case "isamplerCube":
    case "sampler2DShadow":
    case "samplerCubeShadow":
      return "ivec2" as TextureSizeType<T>;
    case "sampler3D":
    case "usampler3D":
    case "isampler3D":
    case "sampler2DArray":
    case "usampler2DArray":
    case "isampler2DArray":
    case "sampler2DArrayShadow":
      return "ivec3" as TextureSizeType<T>;
    default:
      throw new Error(`Invalid texture type: ${textureType}`);
  }
}

type TextureCoordType<T extends AllSamplerTypes> = T extends Sampler2DTypes
  ? "vec2"
  : T extends
        | Sampler3DTypes
        | Sampler2DArrayTypes
        | SamplerCubeTypes
        | Sampler2DArrayTypes
    ? "vec3"
    : T extends "samperCubeShadow" | "sampler2DArrayShadow"
      ? "vec4"
      : never;

function textureCoordType<T extends AllSamplerTypes>(
  textureType: T,
): TextureCoordType<T> {
  switch (textureType) {
    case "sampler2D":
    case "usampler2D":
    case "isampler2D":
      return "vec2" as TextureCoordType<T>;
    case "sampler3D":
    case "usampler3D":
    case "isampler3D":
    case "samplerCube":
    case "usamplerCube":
    case "isamplerCube":
    case "sampler2DArray":
    case "usampler2DArray":
    case "isampler2DArray":
    case "sampler2DShadow":
      return "vec3" as TextureCoordType<T>;
    case "samplerCubeShadow":
    case "sampler2DArrayShadow":
      return "vec4" as TextureCoordType<T>;
    default:
      throw new Error(`Invalid texture type: ${textureType}`);
  }
}

type TextureReturnType<T extends AllSamplerTypes> = T extends SamplerTypes
  ? "vec4"
  : T extends UsamplerTypes
    ? "uvec4"
    : T extends IsamplerTypes
      ? "ivec4"
      : T extends SamplerShadowTypes
        ? "float"
        : never;

function textureReturnType<T extends AllSamplerTypes>(
  textureType: T,
): TextureReturnType<T> {
  switch (textureType) {
    case "sampler2D":
    case "sampler2DArray":
    case "sampler3D":
    case "samplerCube":
    case "sampler2DShadow":
      return "vec4" as TextureReturnType<T>;
    case "usampler2D":
    case "usampler2DArray":
    case "usampler3D":
    case "usamplerCube":
      return "uvec4" as TextureReturnType<T>;
    case "isampler2D":
    case "isampler2DArray":
    case "isampler3D":
    case "isamplerCube":
      return "ivec4" as TextureReturnType<T>;
    case "samplerCubeShadow":
    case "sampler2DArrayShadow":
      return "float" as TextureReturnType<T>;
    default:
      throw new Error(`Invalid texture type: ${textureType}`);
  }
}
