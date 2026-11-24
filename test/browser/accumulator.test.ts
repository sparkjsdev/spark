import { expect, pngBuffer, test } from "./harness.fixture.js";

test("rendering is identical before and after trimming accumulators", async ({
  harnessPage,
}) => {
  const png = await harnessPage.evaluate(async () => {
    const h = window.harness;
    const spark = h.createSpark();
    h.createCamera({ fov: 60, position: [0, 0, 7] });
    h.addSplatMesh({
      url: "/test/browser/fixtures/furry-logo-pedestal.spz",
      quaternion: [1, 0, 0, 0],
    });
    spark.current.ensureGenerate({ maxSplats: 500_000 });
    for (const acc of spark.accumulators) {
      acc.ensureGenerate({ maxSplats: 500_000 });
    }
    await h.settle();

    spark.trimAccumulators();
    await h.settle();

    return h.getPixels();
  });

  expect(pngBuffer(png)).toMatchSnapshot("basic.png");
});
