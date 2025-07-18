import { Dyno, unindentLines } from "./base";
import { Gsplat, defineGsplat } from "./splats";
import {
  DynoOutput,
  type DynoVal,
  type DynoValue,
  type HasDynoOut,
} from "./value";

export const outputPackedSplat = (gsplat: DynoVal<typeof Gsplat>) =>
  new OutputPackedSplat({ gsplat });
export const outputRgba8 = (rgba8: DynoVal<"vec4">) =>
  new OutputRgba8({ rgba8 });

export class OutputPackedSplat
  extends Dyno<{ gsplat: typeof Gsplat }, { output: "uvec4" }>
  implements HasDynoOut<"uvec4">
{
  constructor({ gsplat }: { gsplat?: DynoVal<typeof Gsplat> }) {
    super({
      inTypes: { gsplat: Gsplat },
      inputs: { gsplat },
      globals: () => [defineGsplat],
      statements: ({ inputs, outputs }) => {
        const { output } = outputs;
        if (!output) {
          return [];
        }
        const { gsplat } = inputs;
        if (gsplat) {
          return unindentLines(`
            if (isGsplatActive(${gsplat}.flags)) {
              uvec4[2] packed = packSplat(${gsplat}.center, ${gsplat}.scales, ${gsplat}.quaternion, ${gsplat}.rgba);
              ${output} = packed[0];
              ${output}2 = packed[1];
            } else {
              ${output} = uvec4(0u, 0u, 0u, 0u);
              ${output}2 = uvec4(0u, 0u, 0u, 0u);
            }
          `);
        }
        return [
          `${output} = uvec4(0u, 0u, 0u, 0u); ${output}2 = uvec4(0u, 0u, 0u, 0u);`,
        ];
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
