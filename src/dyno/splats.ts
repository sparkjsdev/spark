import { Dyno, UnaryOp, unindent, unindentLines } from "./base";
import {
  DynoOutput,
  type DynoVal,
  type DynoValue,
  type HasDynoOut,
} from "./value";

export const Gsplat = { type: "Gsplat" } as { type: "Gsplat" };
export const TPackedSplats = { type: "PackedSplats" } as {
  type: "PackedSplats";
};

export const numPackedSplats = (
  packedSplats: DynoVal<typeof TPackedSplats>,
): DynoVal<"int"> => new NumPackedSplats({ packedSplats });
export const readPackedSplat = (
  packedSplats: DynoVal<typeof TPackedSplats>,
  index: DynoVal<"int">,
): DynoVal<typeof Gsplat> => new ReadPackedSplat({ packedSplats, index });
export const readPackedSplatRange = (
  packedSplats: DynoVal<typeof TPackedSplats>,
  index: DynoVal<"int">,
  base: DynoVal<"int">,
  count: DynoVal<"int">,
): DynoVal<typeof Gsplat> =>
  new ReadPackedSplatRange({ packedSplats, index, base, count });
export const splitGsplat = (gsplat: DynoVal<typeof Gsplat>) =>
  new SplitGsplat({ gsplat });
export const combineGsplat = ({
  gsplat,
  flags,
  index,
  center,
  scales,
  quaternion,
  rgba,
  rgb,
  opacity,
  x,
  y,
  z,
  r,
  g,
  b,
}: {
  gsplat?: DynoVal<typeof Gsplat>;
  flags?: DynoVal<"uint">;
  index?: DynoVal<"int">;
  center?: DynoVal<"vec3">;
  scales?: DynoVal<"vec3">;
  quaternion?: DynoVal<"vec4">;
  rgba?: DynoVal<"vec4">;
  rgb?: DynoVal<"vec3">;
  opacity?: DynoVal<"float">;
  x?: DynoVal<"float">;
  y?: DynoVal<"float">;
  z?: DynoVal<"float">;
  r?: DynoVal<"float">;
  g?: DynoVal<"float">;
  b?: DynoVal<"float">;
}): DynoVal<typeof Gsplat> => {
  return new CombineGsplat({
    gsplat,
    flags,
    index,
    center,
    scales,
    quaternion,
    rgba,
    rgb,
    opacity,
    x,
    y,
    z,
    r,
    g,
    b,
  });
};
export const gsplatNormal = (gsplat: DynoVal<typeof Gsplat>): DynoVal<"vec3"> =>
  new GsplatNormal({ gsplat });

export const transformGsplat = (
  gsplat: DynoVal<typeof Gsplat>,
  {
    scale,
    rotate,
    translate,
    recolor,
  }: {
    scale?: DynoVal<"float">;
    rotate?: DynoVal<"vec4">;
    translate?: DynoVal<"vec3">;
    recolor?: DynoVal<"vec4">;
  },
): DynoVal<typeof Gsplat> => {
  return new TransformGsplat({ gsplat, scale, rotate, translate, recolor });
};

export const defineGsplat = unindent(`
  struct Gsplat {
    vec3 center;
    uint flags;
    vec3 scales;
    int index;
    vec4 quaternion;
    vec4 rgba;
  };
  const uint GSPLAT_FLAG_ACTIVE = 1u << 0u;

  bool isGsplatActive(uint flags) {
    return (flags & GSPLAT_FLAG_ACTIVE) != 0u;
  }
`);

export const definePackedSplats = unindent(`
  struct PackedSplats {
    usampler2DArray texture;
    int numSplats;
    vec4 rgbMinMaxLnScaleMinMax;
  };
`);

export class NumPackedSplats extends UnaryOp<
  typeof TPackedSplats,
  "int",
  "numSplats"
> {
  constructor({
    packedSplats,
  }: { packedSplats: DynoVal<typeof TPackedSplats> }) {
    super({ a: packedSplats, outKey: "numSplats", outTypeFunc: () => "int" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.numSplats} = ${inputs.a}.numSplats;`,
    ];
  }
}

const defineReadPackedSplat = unindent(`
  bool readPackedSplat(usampler2DArray texture, int numSplats, vec4 rgbMinMaxLnScaleMinMax, int index, out Gsplat gsplat) {
    if ((index >= 0) && (index < numSplats)) {
      uvec4 packed = texelFetch(texture, splatTexCoord(index), 0);
      unpackSplatEncoding(packed, gsplat.center, gsplat.scales, gsplat.quaternion, gsplat.rgba, rgbMinMaxLnScaleMinMax);
      return true;
    } else {
      return false;
    }
  }
`);

export class ReadPackedSplat
  extends Dyno<
    { packedSplats: typeof TPackedSplats; index: "int" },
    { gsplat: typeof Gsplat }
  >
  implements HasDynoOut<typeof Gsplat>
{
  constructor({
    packedSplats,
    index,
  }: { packedSplats?: DynoVal<typeof TPackedSplats>; index?: DynoVal<"int"> }) {
    super({
      inTypes: { packedSplats: TPackedSplats, index: "int" },
      outTypes: { gsplat: Gsplat },
      inputs: { packedSplats, index },
      globals: () => [defineGsplat, definePackedSplats, defineReadPackedSplat],
      statements: ({ inputs, outputs }) => {
        const { gsplat } = outputs;
        if (!gsplat) {
          return [];
        }
        const { packedSplats, index } = inputs;
        let statements: string[];
        if (packedSplats && index) {
          statements = unindentLines(`
            if (readPackedSplat(${packedSplats}.texture, ${packedSplats}.numSplats, ${packedSplats}.rgbMinMaxLnScaleMinMax, ${index}, ${gsplat})) {
              bool zeroSize = all(equal(${gsplat}.scales, vec3(0.0, 0.0, 0.0)));
              ${gsplat}.flags = zeroSize ? 0u : GSPLAT_FLAG_ACTIVE;
            } else {
              ${gsplat}.flags = 0u;
            }
          `);
        } else {
          statements = [`${gsplat}.flags = 0u;`];
        }
        statements.push(`${gsplat}.index = ${index ?? "0"};`);
        return statements;
      },
    });
  }

  dynoOut(): DynoValue<typeof Gsplat> {
    return new DynoOutput(this, "gsplat");
  }
}

export class ReadPackedSplatRange
  extends Dyno<
    {
      packedSplats: typeof TPackedSplats;
      index: "int";
      base: "int";
      count: "int";
    },
    { gsplat: typeof Gsplat }
  >
  implements HasDynoOut<typeof Gsplat>
{
  constructor({
    packedSplats,
    index,
    base,
    count,
  }: {
    packedSplats?: DynoVal<typeof TPackedSplats>;
    index?: DynoVal<"int">;
    base?: DynoVal<"int">;
    count?: DynoVal<"int">;
  }) {
    super({
      inTypes: {
        packedSplats: TPackedSplats,
        index: "int",
        base: "int",
        count: "int",
      },
      outTypes: { gsplat: Gsplat },
      inputs: { packedSplats, index, base, count },
      globals: () => [defineGsplat, definePackedSplats, defineReadPackedSplat],
      statements: ({ inputs, outputs }) => {
        const { gsplat } = outputs;
        if (!gsplat) {
          return [];
        }
        const { packedSplats, index, base, count } = inputs;
        let statements: string[];
        if (packedSplats && index && base && count) {
          statements = unindentLines(`
            ${gsplat}.flags = 0u;
            if ((${index} >= ${base}) && (${index} < (${base} + ${count}))) {
              if (readPackedSplat(${packedSplats}.texture, ${packedSplats}.numSplats, ${packedSplats}.rgbMinMaxLnScaleMinMax, ${index}, ${gsplat})) {
                bool zeroSize = all(equal(${gsplat}.scales, vec3(0.0, 0.0, 0.0)));
                ${gsplat}.flags = zeroSize ? 0u : GSPLAT_FLAG_ACTIVE;
              }
            }
          `);
        } else {
          statements = [`${gsplat}.flags = 0u;`];
        }
        statements.push(`${gsplat}.index = ${index ?? "0"};`);
        return statements;
      },
    });
  }

  dynoOut(): DynoValue<typeof Gsplat> {
    return new DynoOutput(this, "gsplat");
  }
}

export class SplitGsplat extends Dyno<
  { gsplat: typeof Gsplat },
  {
    flags: "uint";
    active: "bool";
    index: "int";
    center: "vec3";
    scales: "vec3";
    quaternion: "vec4";
    rgba: "vec4";
    rgb: "vec3";
    opacity: "float";
    x: "float";
    y: "float";
    z: "float";
    r: "float";
    g: "float";
    b: "float";
  }
> {
  constructor({ gsplat }: { gsplat?: DynoVal<typeof Gsplat> }) {
    super({
      inTypes: { gsplat: Gsplat },
      outTypes: {
        flags: "uint",
        active: "bool",
        index: "int",
        center: "vec3",
        scales: "vec3",
        quaternion: "vec4",
        rgba: "vec4",
        rgb: "vec3",
        opacity: "float",
        x: "float",
        y: "float",
        z: "float",
        r: "float",
        g: "float",
        b: "float",
      },
      inputs: { gsplat },
      globals: () => [defineGsplat],
      statements: ({ inputs, outputs }) => {
        const { gsplat } = inputs;
        const {
          flags,
          active,
          index,
          center,
          scales,
          quaternion,
          rgba,
          rgb,
          opacity,
          x,
          y,
          z,
          r,
          g,
          b,
        } = outputs;
        return [
          !flags ? null : `${flags} = ${gsplat ? `${gsplat}.flags` : "0u"};`,
          !active
            ? null
            : `${active} = isGsplatActive(${gsplat ? `${gsplat}.flags` : "0u"});`,
          !index ? null : `${index} = ${gsplat ? `${gsplat}.index` : "0"};`,
          !center
            ? null
            : `${center} = ${gsplat ? `${gsplat}.center` : "vec3(0.0, 0.0, 0.0)"};`,
          !scales
            ? null
            : `${scales} = ${gsplat ? `${gsplat}.scales` : "vec3(0.0, 0.0, 0.0)"};`,
          !quaternion
            ? null
            : `${quaternion} = ${gsplat ? `${gsplat}.quaternion` : "vec4(0.0, 0.0, 0.0, 1.0)"};`,
          !rgba
            ? null
            : `${rgba} = ${gsplat ? `${gsplat}.rgba` : "vec4(0.0, 0.0, 0.0, 0.0)"};`,
          !rgb
            ? null
            : `${rgb} = ${gsplat ? `${gsplat}.rgba.rgb` : "vec3(0.0, 0.0, 0.0)"};`,
          !opacity
            ? null
            : `${opacity} = ${gsplat ? `${gsplat}.rgba.a` : "0.0"};`,
          !x ? null : `${x} = ${gsplat ? `${gsplat}.center.x` : "0.0"};`,
          !y ? null : `${y} = ${gsplat ? `${gsplat}.center.y` : "0.0"};`,
          !z ? null : `${z} = ${gsplat ? `${gsplat}.center.z` : "0.0"};`,
          !r ? null : `${r} = ${gsplat ? `${gsplat}.rgba.r` : "0.0"};`,
          !g ? null : `${g} = ${gsplat ? `${gsplat}.rgba.g` : "0.0"};`,
          !b ? null : `${b} = ${gsplat ? `${gsplat}.rgba.b` : "0.0"};`,
        ].filter(Boolean) as string[];
      },
    });
  }
}

export class CombineGsplat
  extends Dyno<
    {
      gsplat: typeof Gsplat;
      flags: "uint";
      index: "int";
      center: "vec3";
      scales: "vec3";
      quaternion: "vec4";
      rgba: "vec4";
      rgb: "vec3";
      opacity: "float";
      x: "float";
      y: "float";
      z: "float";
      r: "float";
      g: "float";
      b: "float";
    },
    { gsplat: typeof Gsplat }
  >
  implements HasDynoOut<typeof Gsplat>
{
  constructor({
    gsplat,
    flags,
    index,
    center,
    scales,
    quaternion,
    rgba,
    rgb,
    opacity,
    x,
    y,
    z,
    r,
    g,
    b,
  }: {
    gsplat?: DynoVal<typeof Gsplat>;
    flags?: DynoVal<"uint">;
    index?: DynoVal<"int">;
    center?: DynoVal<"vec3">;
    scales?: DynoVal<"vec3">;
    quaternion?: DynoVal<"vec4">;
    rgba?: DynoVal<"vec4">;
    rgb?: DynoVal<"vec3">;
    opacity?: DynoVal<"float">;
    x?: DynoVal<"float">;
    y?: DynoVal<"float">;
    z?: DynoVal<"float">;
    r?: DynoVal<"float">;
    g?: DynoVal<"float">;
    b?: DynoVal<"float">;
  }) {
    super({
      inTypes: {
        gsplat: Gsplat,
        flags: "uint",
        index: "int",
        center: "vec3",
        scales: "vec3",
        quaternion: "vec4",
        rgba: "vec4",
        rgb: "vec3",
        opacity: "float",
        x: "float",
        y: "float",
        z: "float",
        r: "float",
        g: "float",
        b: "float",
      },
      outTypes: { gsplat: Gsplat },
      inputs: {
        gsplat,
        flags,
        index,
        center,
        scales,
        quaternion,
        rgba,
        rgb,
        opacity,
        x,
        y,
        z,
        r,
        g,
        b,
      },
      globals: () => [defineGsplat],
      statements: ({ inputs, outputs }) => {
        const { gsplat: outGsplat } = outputs;
        if (!outGsplat) {
          return [];
        }
        const {
          gsplat,
          flags,
          index,
          center,
          scales,
          quaternion,
          rgba,
          rgb,
          opacity,
          x,
          y,
          z,
          r,
          g,
          b,
        } = inputs;
        return [
          `${outGsplat}.flags = ${flags ?? (gsplat ? `${gsplat}.flags` : "0u")};`,
          `${outGsplat}.index = ${index ?? (gsplat ? `${gsplat}.index` : "0")};`,
          `${outGsplat}.center = ${center ?? (gsplat ? `${gsplat}.center` : "vec3(0.0, 0.0, 0.0)")};`,
          `${outGsplat}.scales = ${scales ?? (gsplat ? `${gsplat}.scales` : "vec3(0.0, 0.0, 0.0)")};`,
          `${outGsplat}.quaternion = ${quaternion ?? (gsplat ? `${gsplat}.quaternion` : "vec4(0.0, 0.0, 0.0, 1.0)")};`,
          `${outGsplat}.rgba = ${rgba ?? (gsplat ? `${gsplat}.rgba` : "vec4(0.0, 0.0, 0.0, 0.0)")};`,
          !rgb ? null : `${outGsplat}.rgba.rgb = ${rgb};`,
          !opacity ? null : `${outGsplat}.rgba.a = ${opacity};`,
          !x ? null : `${outGsplat}.center.x = ${x};`,
          !y ? null : `${outGsplat}.center.y = ${y};`,
          !z ? null : `${outGsplat}.center.z = ${z};`,
          !r ? null : `${outGsplat}.rgba.r = ${r};`,
          !g ? null : `${outGsplat}.rgba.g = ${g};`,
          !b ? null : `${outGsplat}.rgba.b = ${b};`,
        ].filter(Boolean) as string[];
      },
    });
  }

  dynoOut(): DynoValue<typeof Gsplat> {
    return new DynoOutput(this, "gsplat");
  }
}

export const defineGsplatNormal = unindent(`
  vec3 gsplatNormal(vec3 scales, vec4 quaternion) {
    float minScale = min(scales.x, min(scales.y, scales.z));
    vec3 normal;
    if (scales.z == minScale) {
      normal = vec3(0.0, 0.0, 1.0);
    } else if (scales.y == minScale) {
      normal = vec3(0.0, 1.0, 0.0);
    } else {
      normal = vec3(1.0, 0.0, 0.0);
    }
    return quatVec(quaternion, normal);
  }
`);

export class GsplatNormal extends UnaryOp<typeof Gsplat, "vec3", "normal"> {
  constructor({ gsplat }: { gsplat: DynoVal<typeof Gsplat> }) {
    super({ a: gsplat, outKey: "normal", outTypeFunc: () => "vec3" });
    this.globals = () => [defineGsplat, defineGsplatNormal];
    this.statements = ({ inputs, outputs }) => [
      `${outputs.normal} = gsplatNormal(${inputs.a}.scales, ${inputs.a}.quaternion);`,
    ];
  }
}

export class TransformGsplat
  extends Dyno<
    {
      gsplat: typeof Gsplat;
      scale: "float";
      rotate: "vec4";
      translate: "vec3";
      recolor: "vec4";
    },
    { gsplat: typeof Gsplat }
  >
  implements HasDynoOut<typeof Gsplat>
{
  constructor({
    gsplat,
    scale,
    rotate,
    translate,
    recolor,
  }: {
    gsplat?: DynoVal<typeof Gsplat>;
    scale?: DynoVal<"float">;
    rotate?: DynoVal<"vec4">;
    translate?: DynoVal<"vec3">;
    recolor?: DynoVal<"vec4">;
  }) {
    super({
      inTypes: {
        gsplat: Gsplat,
        scale: "float",
        rotate: "vec4",
        translate: "vec3",
        recolor: "vec4",
      },
      outTypes: { gsplat: Gsplat },
      inputs: { gsplat, scale, rotate, translate, recolor },
      globals: () => [defineGsplat],
      statements: ({ inputs, outputs, compile }) => {
        const { gsplat } = outputs;
        if (!gsplat || !inputs.gsplat) {
          return [];
        }
        const { scale, rotate, translate, recolor } = inputs;
        const indent = compile.indent;
        const statements = [
          `${gsplat} = ${inputs.gsplat};`,
          `if (isGsplatActive(${gsplat}.flags)) {`,

          scale ? `${indent}${gsplat}.center *= ${scale};` : null,
          rotate
            ? `${indent}${gsplat}.center = quatVec(${rotate}, ${gsplat}.center);`
            : null,
          translate ? `${indent}${gsplat}.center += ${translate};` : null,

          scale ? `${indent}${gsplat}.scales *= ${scale};` : null,

          rotate
            ? `${indent}${gsplat}.quaternion = quatQuat(${rotate}, ${gsplat}.quaternion);`
            : null,
          recolor ? `${indent}${gsplat}.rgba *= ${recolor};` : null,
          "}",
        ].filter(Boolean) as string[];
        return statements;
      },
    });
  }

  dynoOut(): DynoValue<typeof Gsplat> {
    return new DynoOutput(this, "gsplat");
  }
}
