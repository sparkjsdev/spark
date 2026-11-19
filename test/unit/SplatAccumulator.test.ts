import { expect, test } from "vitest";
import { SplatAccumulator } from "../../src/SplatAccumulator";
import type { CovSplatGenerator } from "../../src/SplatGenerator";
import { dynoBlock } from "../../src/dyno/base";
import { CovSplat } from "../../src/dyno/splats";

function covGenerator(): CovSplatGenerator {
  return dynoBlock({ index: "int" }, { covsplat: CovSplat }, () => ({}));
}

test.each([false, true])(
  "covSplats accumulator with extSplats %s builds a program for a covSplats mesh",
  (extSplats) => {
    const accumulator = new SplatAccumulator({ extSplats, covSplats: true });
    const { program } = accumulator.prepareProgramMaterial(
      undefined,
      covGenerator(),
    );
    expect(program).toBeTruthy();
  },
);
