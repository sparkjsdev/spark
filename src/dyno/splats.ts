import { Dyno, UnaryOp, unindent, unindentLines } from "./base";
import {
  DynoOutput,
  type DynoVal,
  type DynoValue,
  type HasDynoOut,
} from "./value";

export const Gsplat = { type: "Gsplat" } as { type: "Gsplat" };
export const CovSplat = { type: "CovSplat" } as { type: "CovSplat" };
export const TPackedSplats = { type: "PackedSplats" } as {
  type: "PackedSplats";
};
export const TExtSplats = { type: "ExtSplats" } as {
  type: "ExtSplats";
};
export const TCovSplats = { type: "CovSplats" } as {
  type: "CovSplats";
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

export const numExtSplats = (
  extSplats: DynoVal<typeof TExtSplats>,
): DynoVal<"int"> => new NumExtSplats({ extSplats });
export const readExtSplat = (
  extSplats: DynoVal<typeof TExtSplats>,
  index: DynoVal<"int">,
): DynoVal<typeof Gsplat> => new ReadExtSplat({ extSplats, index });

export const numCovSplats = (
  covsplats: DynoVal<typeof TCovSplats>,
): DynoVal<"int"> => new NumCovSplats({ covsplats });
export const readCovSplat = (
  covSplats: DynoVal<typeof TCovSplats>,
  index: DynoVal<"int">,
): DynoVal<typeof CovSplat> => new ReadCovSplat({ covSplats, index });

export const gsplatToCovSplat = (
  gsplat: DynoVal<typeof Gsplat>,
): DynoVal<typeof CovSplat> => new GsplatToCovSplat({ gsplat });

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

export const defineCovSplat = unindent(`
  struct CovSplat {
    vec3 center;
    uint flags;
    vec4 rgba;
    vec3 xxyyzz;
    int index;
    vec3 xyxzyz;
  };

  bool isCovSplatActive(uint flags) {
    return (flags & GSPLAT_FLAG_ACTIVE) != 0u;
  }
`);

export const definePackedSplats = unindent(`
  struct PackedSplats {
    usampler2DArray textureArray;
    int numSplats;
    vec4 rgbMinMaxLnScaleMinMax;
    bool lodOpacity;
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

const defineReadPackedArray = unindent(`
  bool readPackedArray(usampler2DArray texture, int numSplats, vec4 rgbMinMaxLnScaleMinMax, int index, out Gsplat gsplat) {
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
      globals: () => [defineGsplat, definePackedSplats, defineReadPackedArray],
      statements: ({ inputs, outputs }) => {
        const { gsplat } = outputs;
        if (!gsplat) {
          return [];
        }
        const { packedSplats, index } = inputs;
        let statements: string[];
        if (packedSplats && index) {
          statements = unindentLines(`
            ${gsplat}.flags = 0u;
            if (readPackedArray(${packedSplats}.textureArray, ${packedSplats}.numSplats, ${packedSplats}.rgbMinMaxLnScaleMinMax, ${index}, ${gsplat})) {
              if (${packedSplats}.lodOpacity) {
                ${gsplat}.rgba.a = 2.0 * ${gsplat}.rgba.a;
              }
              bool zeroSize = all(equal(${gsplat}.scales, vec3(0.0, 0.0, 0.0)));
              ${gsplat}.flags = zeroSize ? 0u : GSPLAT_FLAG_ACTIVE;
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
      globals: () => [defineGsplat, definePackedSplats, defineReadPackedArray],
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
            if (readPackedArray(${packedSplats}.textureArray, ${packedSplats}.numSplats, ${packedSplats}.rgbMinMaxLnScaleMinMax, ${index}, ${gsplat})) {
              if (${packedSplats}.lodOpacity) {
                ${gsplat}.rgba.a = 2.0 * ${gsplat}.rgba.a;
              }
              bool zeroSize = all(equal(${gsplat}.scales, vec3(0.0, 0.0, 0.0)));
              ${gsplat}.flags = zeroSize ? 0u : GSPLAT_FLAG_ACTIVE;
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

export const defineExtSplats = unindent(`
  struct ExtSplats {
    usampler2DArray textureArray1;
    usampler2DArray textureArray2;
    int numSplats;
  };
`);

export class NumExtSplats extends UnaryOp<
  typeof TExtSplats,
  "int",
  "numSplats"
> {
  constructor({ extSplats }: { extSplats: DynoVal<typeof TExtSplats> }) {
    super({ a: extSplats, outKey: "numSplats", outTypeFunc: () => "int" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.numSplats} = ${inputs.a}.numSplats;`,
    ];
  }
}

const defineReadExtArrays = unindent(`
  void readExtArrays(usampler2DArray texture1, usampler2DArray texture2, int numSplats, int index, out Gsplat gsplat) {
    gsplat.flags = 0u;
    if ((index >= 0) && (index < numSplats)) {
      ivec3 coord = splatTexCoord(index);
      uvec4 packed1 = texelFetch(texture1, coord, 0);
      uvec4 packed2 = texelFetch(texture2, coord, 0);
      unpackSplatExt(packed1, packed2, gsplat.center, gsplat.scales, gsplat.quaternion, gsplat.rgba);
      gsplat.flags = all(equal(gsplat.scales, vec3(0.0, 0.0, 0.0))) ? 0u : GSPLAT_FLAG_ACTIVE;
      gsplat.index = index;
    }
  }
`);

export class ReadExtSplat
  extends Dyno<
    { extSplats: typeof TExtSplats; index: "int" },
    { gsplat: typeof Gsplat }
  >
  implements HasDynoOut<typeof Gsplat>
{
  constructor({
    extSplats,
    index,
  }: { extSplats?: DynoVal<typeof TExtSplats>; index?: DynoVal<"int"> }) {
    super({
      inTypes: { extSplats: TExtSplats, index: "int" },
      outTypes: { gsplat: Gsplat },
      inputs: { extSplats, index },
      globals: () => [defineGsplat, defineExtSplats, defineReadExtArrays],
      statements: ({ inputs, outputs }) => {
        const { gsplat } = outputs;
        if (!gsplat) {
          return [`${gsplat}.flags = 0u;`];
        }
        const { extSplats, index } = inputs;
        let statements: string[];
        if (extSplats && index) {
          return unindentLines(`
            readExtArrays(${extSplats}.textureArray1, ${extSplats}.textureArray2, ${extSplats}.numSplats, ${index}, ${gsplat});
          `);
        }
        return [`${gsplat}.flags = 0u;`];
      },
    });
  }

  dynoOut(): DynoValue<typeof Gsplat> {
    return new DynoOutput(this, "gsplat");
  }
}

export class NumCovSplats extends UnaryOp<
  typeof TCovSplats,
  "int",
  "numSplats"
> {
  constructor({ covsplats }: { covsplats: DynoVal<typeof TCovSplats> }) {
    super({ a: covsplats, outKey: "numSplats", outTypeFunc: () => "int" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.numSplats} = ${inputs.a}.numSplats;`,
    ];
  }
}

const defineReadCovArrays = unindent(`
  void readCovArrays(usampler2DArray texture1, usampler2DArray texture2, int numSplats, int index, out CovSplat covsplat) {
    covsplat.flags = 0u;
    if ((index >= 0) && (index < numSplats)) {
      ivec3 coord = splatTexCoord(index);
      uvec4 packed1 = texelFetch(texture1, coord, 0);
      uvec4 packed2 = texelFetch(texture2, coord, 0);
      unpackSplatExt(packed1, packed2, covsplat.center, covsplat.rgba, covsplat.xxyyzz, covsplat.xyxzyz);
      covsplat.flags = (all(equal(covsplat.xxyyzz, vec3(0.0))) && all(equal(covsplat.xyxzyz, vec3(0.0)))) ? 0u : GSPLAT_FLAG_ACTIVE;
      gsplat.index = index;
    }
  }
`);

export class ReadCovSplat
  extends Dyno<
    { covSplats: typeof TCovSplats; index: "int" },
    { covsplat: typeof CovSplat }
  >
  implements HasDynoOut<typeof CovSplat>
{
  constructor({
    covSplats,
    index,
  }: { covSplats?: DynoVal<typeof TCovSplats>; index?: DynoVal<"int"> }) {
    super({
      inTypes: { covSplats: TCovSplats, index: "int" },
      outTypes: { covsplat: CovSplat },
      inputs: { covSplats, index },
      globals: () => [defineGsplat, defineCovSplat, defineReadCovArrays],
      statements: ({ inputs, outputs }) => {
        const { covsplat } = outputs;
        if (!covsplat) {
          return [`${covsplat}.flags = 0u;`];
        }
        const { covSplats, index } = inputs;
        let statements: string[];
        if (covSplats && index) {
          return unindentLines(`
            readCovArrays(${covSplats}.textureArray, ${covSplats}.numSplats, ${index}, ${covsplat});
          `);
        }
        return [`${covsplat}.flags = 0u;`];
      },
    });
  }

  dynoOut(): DynoValue<typeof CovSplat> {
    return new DynoOutput(this, "covsplat");
  }
}

export class GsplatToCovSplat extends Dyno<
  { gsplat: typeof Gsplat },
  { covsplat: typeof CovSplat }
> {
  constructor({ gsplat }: { gsplat?: DynoVal<typeof Gsplat> }) {
    super({
      inTypes: { gsplat: Gsplat },
      outTypes: { covsplat: CovSplat },
      inputs: { gsplat },
      globals: () => [defineGsplat, defineCovSplat],
      statements: ({ inputs, outputs }) => {
        const { gsplat } = inputs;
        const { covsplat } = outputs;
        if (!gsplat) {
          return [`${covsplat}.flags = 0u;`];
        }

        return unindentLines(`
          ${covsplat}.flags = 0u;
          if (isGsplatActive(${gsplat}.flags)) {
            ${covsplat}.flags = ${gsplat}.flags;
            ${covsplat}.index = ${gsplat}.index;
            ${covsplat}.rgba = ${gsplat}.rgba;
            ${covsplat}.center = ${gsplat}.center;
            mat3 m = scaleQuaternionToMatrix(${gsplat}.scales, ${gsplat}.quaternion);
            m = m * transpose(m);
            ${covsplat}.xxyyzz = vec3(m[0][0], m[1][1], m[2][2]);
            ${covsplat}.xyxzyz = vec3(m[0][1], m[0][2], m[1][2]);
          }
        `);
      },
    });
  }

  dynoOut(): DynoValue<typeof CovSplat> {
    return new DynoOutput(this, "covsplat");
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

export const splitCovSplat = (covsplat: DynoVal<typeof CovSplat>) =>
  new SplitCovSplat({ covsplat });
export const combineCovSplat = ({
  covsplat,
  flags,
  index,
  center,
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
  covsplat?: DynoVal<typeof CovSplat>;
  flags?: DynoVal<"uint">;
  index?: DynoVal<"int">;
  center?: DynoVal<"vec3">;
  rgba?: DynoVal<"vec4">;
  rgb?: DynoVal<"vec3">;
  opacity?: DynoVal<"float">;
  x?: DynoVal<"float">;
  y?: DynoVal<"float">;
  z?: DynoVal<"float">;
  r?: DynoVal<"float">;
  g?: DynoVal<"float">;
  b?: DynoVal<"float">;
}): DynoVal<typeof CovSplat> => {
  return new CombineCovSplat({
    covsplat,
    flags,
    index,
    center,
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

export class SplitCovSplat extends Dyno<
  { covsplat: typeof CovSplat },
  {
    flags: "uint";
    active: "bool";
    index: "int";
    center: "vec3";
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
  constructor({ covsplat }: { covsplat?: DynoVal<typeof CovSplat> }) {
    super({
      inTypes: { covsplat: CovSplat },
      outTypes: {
        flags: "uint",
        active: "bool",
        index: "int",
        center: "vec3",
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
      inputs: { covsplat },
      globals: () => [defineCovSplat],
      statements: ({ inputs, outputs }) => {
        const { covsplat } = inputs;
        const {
          flags,
          active,
          index,
          center,
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
          !flags
            ? null
            : `${flags} = ${covsplat ? `${covsplat}.flags` : "0u"};`,
          !active
            ? null
            : `${active} = isCovSplatActive(${covsplat ? `${covsplat}.flags` : "0u"});`,
          !index ? null : `${index} = ${covsplat ? `${covsplat}.index` : "0"};`,
          !center
            ? null
            : `${center} = ${covsplat ? `${covsplat}.center` : "vec3(0.0, 0.0, 0.0)"};`,
          !rgba
            ? null
            : `${rgba} = ${covsplat ? `${covsplat}.rgba` : "vec4(0.0, 0.0, 0.0, 0.0)"};`,
          !rgb
            ? null
            : `${rgb} = ${covsplat ? `${covsplat}.rgba.rgb` : "vec3(0.0, 0.0, 0.0)"};`,
          !opacity
            ? null
            : `${opacity} = ${covsplat ? `${covsplat}.rgba.a` : "0.0"};`,
          !x ? null : `${x} = ${covsplat ? `${covsplat}.center.x` : "0.0"};`,
          !y ? null : `${y} = ${covsplat ? `${covsplat}.center.y` : "0.0"};`,
          !z ? null : `${z} = ${covsplat ? `${covsplat}.center.z` : "0.0"};`,
          !r ? null : `${r} = ${covsplat ? `${covsplat}.rgba.r` : "0.0"};`,
          !g ? null : `${g} = ${covsplat ? `${covsplat}.rgba.g` : "0.0"};`,
          !b ? null : `${b} = ${covsplat ? `${covsplat}.rgba.b` : "0.0"};`,
        ].filter(Boolean) as string[];
      },
    });
  }
}

export class CombineCovSplat
  extends Dyno<
    {
      covsplat: typeof CovSplat;
      flags: "uint";
      index: "int";
      center: "vec3";
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
    { covsplat: typeof CovSplat }
  >
  implements HasDynoOut<typeof CovSplat>
{
  constructor({
    covsplat,
    flags,
    index,
    center,
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
    covsplat?: DynoVal<typeof CovSplat>;
    flags?: DynoVal<"uint">;
    index?: DynoVal<"int">;
    center?: DynoVal<"vec3">;
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
        covsplat: CovSplat,
        flags: "uint",
        index: "int",
        center: "vec3",
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
      outTypes: { covsplat: CovSplat },
      inputs: {
        covsplat,
        flags,
        index,
        center,
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
      globals: () => [defineCovSplat],
      statements: ({ inputs, outputs }) => {
        const { covsplat: outCovSplat } = outputs;
        if (!outCovSplat) {
          return [];
        }
        const {
          covsplat,
          flags,
          index,
          center,
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
          `${outCovSplat}.flags = ${flags ?? (covsplat ? `${covsplat}.flags` : "0u")};`,
          `${outCovSplat}.index = ${index ?? (covsplat ? `${covsplat}.index` : "0")};`,
          `${outCovSplat}.center = ${center ?? (covsplat ? `${covsplat}.center` : "vec3(0.0, 0.0, 0.0)")};`,
          `${outCovSplat}.rgba = ${rgba ?? (covsplat ? `${covsplat}.rgba` : "vec4(0.0, 0.0, 0.0, 0.0)")};`,
          !rgb ? null : `${outCovSplat}.rgba.rgb = ${rgb};`,
          !opacity ? null : `${outCovSplat}.rgba.a = ${opacity};`,
          !x ? null : `${outCovSplat}.center.x = ${x};`,
          !y ? null : `${outCovSplat}.center.y = ${y};`,
          !z ? null : `${outCovSplat}.center.z = ${z};`,
          !r ? null : `${outCovSplat}.rgba.r = ${r};`,
          !g ? null : `${outCovSplat}.rgba.g = ${g};`,
          !b ? null : `${outCovSplat}.rgba.b = ${b};`,
          `${outCovSplat}.xxyyzz = ${covsplat ? `${covsplat}.xxyyzz` : "vec3(0.0, 0.0, 0.0)"};`,
          `${outCovSplat}.xyxzyz = ${covsplat ? `${covsplat}.xyxzyz` : "vec3(0.0, 0.0, 0.0)"};`,
        ].filter(Boolean) as string[];
      },
    });
  }

  dynoOut(): DynoValue<typeof CovSplat> {
    return new DynoOutput(this, "covsplat");
  }
}
