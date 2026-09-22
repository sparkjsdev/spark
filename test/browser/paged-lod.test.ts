import { expect, test } from "./harness.fixture.js";

// Same scenes as lod.test.ts, streamed from a chunked RAD with `paged: true`.
// Once fully paged in, the render should match the non-paged LoD snapshots.
for (const [lodSplatCount, snapshot] of [
  [1_000, "lod-1K.png"],
  [10_000, "lod-10K.png"],
  [100_000, "lod-100K.png"],
] as const) {
  test(`renders paged LoD with lodSplatCount=${lodSplatCount}`, async ({
    harnessPage,
  }) => {
    const png = await harnessPage.evaluate(async (lodSplatCount) => {
      const h = window.harness;
      h.createSpark({ lodSplatCount });
      h.createCamera({ fov: 60, position: [0, 0, 7] });
      h.addSplatMesh({
        url: "/test/browser/fixtures/chunked/furry-logo-pedestal-lod.rad",
        paged: true,
        quaternion: [1, 0, 0, 0],
      });
      await h.settle();
      return h.getPixels();
    }, lodSplatCount);

    expect(Buffer.from(png.split(",")[1], "base64")).toMatchSnapshot(snapshot);
  });
}
