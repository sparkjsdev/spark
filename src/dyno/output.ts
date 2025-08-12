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
