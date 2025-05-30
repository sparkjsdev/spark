import { Dyno } from './base';
import { AllSamplerTypes, IsamplerTypes, NormalSamplerTypes, Sampler2DArrayTypes, Sampler2DTypes, Sampler3DTypes, SamplerCubeTypes, SamplerShadowTypes, SamplerTypes, UsamplerTypes } from './types';
import { DynoVal, DynoValue, HasDynoOut } from './value';
export declare const textureSize: <T extends AllSamplerTypes>(texture: DynoVal<T>, lod?: DynoVal<"int">) => DynoVal<TextureSizeType<T>>;
export declare const texture: <T extends AllSamplerTypes>(texture: DynoVal<T>, coord: DynoVal<TextureCoordType<T>>, bias?: DynoVal<"float">) => DynoVal<TextureReturnType<T>>;
export declare const texelFetch: <T extends NormalSamplerTypes>(texture: DynoVal<T>, coord: DynoVal<TextureSizeType<T>>, lod?: DynoVal<"int">) => DynoVal<TextureReturnType<T>>;
export declare class TextureSize<T extends AllSamplerTypes> extends Dyno<{
    texture: T;
    lod: "int";
}, {
    size: TextureSizeType<T>;
}> implements HasDynoOut<TextureSizeType<T>> {
    constructor({ texture, lod }: {
        texture: DynoVal<T>;
        lod?: DynoVal<"int">;
    });
    dynoOut(): DynoValue<TextureSizeType<T>>;
}
export declare class Texture<T extends AllSamplerTypes> extends Dyno<{
    texture: T;
    coord: TextureCoordType<T>;
    bias: "float";
}, {
    sample: TextureReturnType<T>;
}> implements HasDynoOut<TextureReturnType<T>> {
    constructor({ texture, coord, bias, }: {
        texture: DynoVal<T>;
        coord: DynoVal<TextureCoordType<T>>;
        bias?: DynoVal<"float">;
    });
    dynoOut(): DynoValue<TextureReturnType<T>>;
}
export declare class TexelFetch<T extends NormalSamplerTypes> extends Dyno<{
    texture: T;
    coord: TextureSizeType<T>;
    lod: "int";
}, {
    texel: TextureReturnType<T>;
}> implements HasDynoOut<TextureReturnType<T>> {
    constructor({ texture, coord, lod, }: {
        texture: DynoVal<T>;
        coord: DynoVal<TextureSizeType<T>>;
        lod?: DynoVal<"int">;
    });
    dynoOut(): DynoValue<TextureReturnType<T>>;
}
type TextureSizeType<T extends AllSamplerTypes> = T extends Sampler2DTypes | SamplerCubeTypes ? "ivec2" : T extends Sampler3DTypes | Sampler2DArrayTypes ? "ivec3" : never;
type TextureCoordType<T extends AllSamplerTypes> = T extends Sampler2DTypes ? "vec2" : T extends Sampler3DTypes | Sampler2DArrayTypes | SamplerCubeTypes | Sampler2DArrayTypes ? "vec3" : T extends "samperCubeShadow" | "sampler2DArrayShadow" ? "vec4" : never;
type TextureReturnType<T extends AllSamplerTypes> = T extends SamplerTypes ? "vec4" : T extends UsamplerTypes ? "uvec4" : T extends IsamplerTypes ? "ivec4" : T extends SamplerShadowTypes ? "float" : never;
export {};
