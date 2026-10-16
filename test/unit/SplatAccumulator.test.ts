import { expect, test } from "vitest";
import { SplatAccumulator } from "../../src/SplatAccumulator";
import type { CovSplatGenerator } from "../../src/SplatGenerator";
import { Dyno, dynoBlock } from "../../src/dyno/base";
import { CovSplat } from "../../src/dyno/splats";

function covGenerator(): CovSplatGenerator {
  return dynoBlock({ index: "int" }, { covsplat: CovSplat }, () => ({
    covsplat: new Dyno({
      outTypes: { covsplat: CovSplat },
      statements: ({ outputs }) => [
        `${outputs.covsplat}.flags = GSPLAT_FLAG_ACTIVE;`,
      ],
    }).outputs.covsplat,
  }));
}

// The packed covariance accumulator (covSplats without extSplats) builds its
// program from a covGenerator alone, as the extended one does.
test("packed covSplats accumulator accepts a covGenerator alone", () => {
  for (const extSplats of [false, true]) {
    const accumulator = new SplatAccumulator({ extSplats, covSplats: true });
    const { program } = accumulator.prepareProgramMaterial(
      undefined,
      covGenerator(),
    );
    expect(program).toBeTruthy();
  }
});
