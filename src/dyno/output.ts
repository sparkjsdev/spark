import * as THREE from "three";
import { Dyno, unindentLines } from "./base";
import { Gsplat, defineGsplat } from "./splats";
import {
  DynoOutput,
  type DynoVal,
  type DynoValue,
  type HasDynoOut,
} from "./value";

export const outputPackedSplat = (
  gsplat: DynoVal<typeof Gsplat>,
  rgbMinMaxLnScaleMinMax: DynoVal<"vec4">,
) => new OutputPackedSplat({ gsplat, rgbMinMaxLnScaleMinMax });

export const outputExtendedSplat = (gsplat: DynoVal<typeof Gsplat>) =>
  new OutputExtendedSplat({ gsplat });

export const outputSplatDepth = (
  gsplat: DynoVal<typeof Gsplat>,
  viewCenter: DynoVal<"vec3">,
  viewDir: DynoVal<"vec3">,
  sortRadial: DynoVal<"bool">,
) => new OutputSplatDepth({ gsplat, viewCenter, viewDir, sortRadial });

export const outputRgba8 = (rgba8: DynoVal<"vec4">) =>
  new OutputRgba8({ rgba8 });

export class OutputPackedSplat
  extends Dyno<
    { gsplat: typeof Gsplat; rgbMinMaxLnScaleMinMax: "vec4" },
    { output: "uvec4" }
  >
  implements HasDynoOut<"uvec4">
{
  constructor({
    gsplat,
    rgbMinMaxLnScaleMinMax,
  }: {
    gsplat?: DynoVal<typeof Gsplat>;
    rgbMinMaxLnScaleMinMax?: DynoVal<"vec4">;
  }) {
    super({
      inTypes: { gsplat: Gsplat, rgbMinMaxLnScaleMinMax: "vec4" },
      inputs: { gsplat, rgbMinMaxLnScaleMinMax },
      globals: () => [defineGsplat],
      statements: ({ inputs, outputs }) => {
        const { output } = outputs;
        if (!output) {
          return [];
        }
        const { gsplat, rgbMinMaxLnScaleMinMax } = inputs;
        if (gsplat) {
          return unindentLines(`
            if (isGsplatActive(${gsplat}.flags)) {
              ${output} = packSplatEncoding(${gsplat}.center, ${gsplat}.scales, ${gsplat}.quaternion, ${gsplat}.rgba, ${rgbMinMaxLnScaleMinMax});
            } else {
              ${output} = uvec4(0u, 0u, 0u, 0u);
            }
          `);
        }
        return [`${output} = uvec4(0u, 0u, 0u, 0u);`];
      },
    });
  }

  dynoOut(): DynoValue<"uvec4"> {
    return new DynoOutput(this, "output");
  }
}

export class OutputExtendedSplat extends Dyno<
  { gsplat: typeof Gsplat },
  Record<string, never>
> {
  constructor({
    gsplat,
  }: {
    gsplat?: DynoVal<typeof Gsplat>;
  }) {
    super({
      inTypes: { gsplat: Gsplat },
      inputs: { gsplat },
      globals: () => [defineGsplat],
      statements: ({ inputs }) => {
        const { gsplat } = inputs;
        if (gsplat) {
          return unindentLines(`
            if (isGsplatActive(${gsplat}.flags)) {
              packSplatExt(target, target2, ${gsplat}.center, ${gsplat}.scales, ${gsplat}.quaternion, ${gsplat}.rgba);
            } else {
              target = uvec4(0u);
              target2 = uvec4(0u);
            }
          `);
        }
        return ["target = uvec4(0u);", "target2 = uvec4(0u);"];
      },
    });
  }

  dynoOut(): DynoValue<"uvec4"> {
    return new DynoOutput(this, "output");
  }
}

class OutputSplatDepth extends Dyno<
  {
    gsplat: typeof Gsplat;
    viewCenter: "vec3";
    viewDir: "vec3";
    sortRadial: "bool";
  },
  Record<string, never>
> {
  constructor({
    gsplat,
    viewCenter,
    viewDir,
    sortRadial,
  }: {
    gsplat: DynoVal<typeof Gsplat>;
    viewCenter: DynoVal<"vec3">;
    viewDir: DynoVal<"vec3">;
    sortRadial: DynoVal<"bool">;
  }) {
    super({
      inTypes: {
        gsplat: Gsplat,
        viewCenter: "vec3",
        viewDir: "vec3",
        sortRadial: "bool",
      },
      inputs: { gsplat, viewCenter, viewDir, sortRadial },
      globals: () => [defineGsplat],
      statements: ({ inputs }) => {
        const { gsplat, viewCenter, viewDir, sortRadial } = inputs;
        if (gsplat && viewCenter && viewDir && sortRadial) {
          return unindentLines(`
            float metric = 1.0 / 0.0;
            if (isGsplatActive(${gsplat}.flags)) {
              vec3 center = ${gsplat}.center - ${viewCenter};
              if (${sortRadial}) {
                metric = length(center);
              } else {
                float bias = 100.0; // reduce popping
                metric = dot(center, ${viewDir}) + bias;
              }
            }
            target3 = floatToVec4(metric);
          `);
        }
        return [];
      },
    });
  }
}

export class OutputRgba8
  extends Dyno<{ rgba8: "vec4" }, { rgba8: "vec4" }>
  implements HasDynoOut<"vec4">
{
  constructor({ rgba8 }: { rgba8?: DynoVal<"vec4"> }) {
    super({
      inTypes: { rgba8: "vec4" },
      inputs: { rgba8 },
      statements: ({ inputs, outputs }) => [
        `target = ${inputs.rgba8 ?? "vec4(0.0, 0.0, 0.0, 0.0)"};`,
      ],
    });
  }

  dynoOut(): DynoValue<"vec4"> {
    return new DynoOutput(this, "rgba8");
  }
}
