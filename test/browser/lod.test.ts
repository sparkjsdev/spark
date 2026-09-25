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

// Changing the LoD budget while the LoD callback is mid-flight sets lodDirty,
// but driveLod() finds the worker busy and skips it, and the callback has
// already requested its render. When it finishes nothing asks for another
// frame, so the new budget waits for an unrelated render. The callback must
// request one itself.
test("applies a LoD budget change made while the LoD callback is busy", async ({
  harnessPage,
}) => {
  const png = await harnessPage.evaluate(async () => {
    const h = window.harness;
    const spark = h.createSpark({ lodSplatCount: 10_000 });
    h.createCamera({ fov: 60, position: [0, 0, 7] });
    h.addSplatMesh({
      url: "/test/browser/fixtures/furry-logo-pedestal-lod.rad",
      quaternion: [1, 0, 0, 0],
    });
    await h.settle();

    // Pause the LoD callback just before cleanup.
    const cleanup = h.holdHook("lod.beforeCleanup");
    h.requestRender();
    await cleanup.reached;

    // A render with the new budget flags lodDirty but finds the worker busy.
    spark.lodSplatCount = 100_000;
    h.requestRender();
    await h.waitUntil(() => spark.lodDirty);

    // Spark must re-drive LoD on its own: settle without requesting a render,
    // and accept a stalled lodDirty so the stale image is what fails the test.
    cleanup.release();
    await h.settle({ requestRender: false, ignorePendingLod: true });
    return h.getPixels();
  });

  expect(pngBuffer(png)).toMatchSnapshot("lod-100K.png");
});
