import { expect, pngBuffer, test } from "./harness.fixture.js";

for (const [lodSplatCount, snapshot] of [
  [10_000, "lod-10K.png"],
  [100_000, "lod-100K.png"],
] as const) {
  test(`renders LoD with lodSplatCount=${lodSplatCount}`, async ({
    harnessPage,
  }) => {
    const png = await harnessPage.evaluate(async (lodSplatCount) => {
      const h = window.harness;
      h.createSpark({ lodSplatCount });
      h.createCamera({ fov: 60, position: [0, 0, 7] });
      h.addSplatMesh({
        url: "/test/browser/fixtures/furry-logo-pedestal-lod.rad",
        quaternion: [1, 0, 0, 0],
      });
      await h.settle();
      return h.getPixels();
    }, lodSplatCount);

    expect(pngBuffer(png)).toMatchSnapshot(snapshot);
  });
}
