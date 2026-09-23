import { expect, pngBuffer, test } from "./harness.fixture.js";

// Same scenes as lod.test.ts, streamed from a chunked RAD with `paged: true`.
// Once fully paged in, the render should match the non-paged LoD snapshots.
for (const [lodSplatCount, snapshot] of [
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

    expect(pngBuffer(png)).toMatchSnapshot(snapshot);
  });
}

// One page of splat memory shared by two paged meshes, so whichever mesh is
// shown last owns the page. Show left, then swap to right: right's root chunk
// evicts left's. Swap back to left with fetching disabled: its root is gone,
// so it must render nothing. (Before the fix it kept pointing at the evicted
// page and drew right's data as a large stray splat.) Re-enable fetching and
// left recovers to its original render.
test("re-shows a paged mesh whose root page was evicted", async ({
  harnessPage,
}) => {
  const { leftAlone, evicted, recovered } = await harnessPage.evaluate(
    async () => {
      const h = window.harness;
      const spark = h.createSpark({
        lodSplatCount: 10_000,
        maxPagedSplats: 65536 /* 1 page */,
        lodCleanupTimeoutMs: Number.POSITIVE_INFINITY,
      });
      const camera = h.createCamera({ fov: 60, position: [0, 0, 9] });
      const url = "/test/browser/fixtures/chunked/furry-logo-pedestal-lod.rad";
      const left = h.addSplatMesh({
        url,
        paged: true,
        quaternion: [1, 0, 0, 0],
        position: [-2, 0, 0],
      });
      const right = h.addSplatMesh({
        url,
        paged: true,
        quaternion: [1, 0, 0, 0],
        position: [2, 0, 0],
        visible: false,
      });
      await h.settle();
      const leftAlone = h.getPixels();

      // right's root chunk takes the only page, evicting left's root chunk
      left.visible = false;
      right.visible = true;
      await h.settle();

      spark.enableLodFetching = false;
      right.visible = false;
      left.visible = true;
      await h.settle();
      const evicted = h.getPixels();

      // Re-enabling fetching alone schedules nothing; the next LoD update
      // (here, the camera moving) refetches left's root chunk.
      spark.enableLodFetching = true;
      camera.position.x += 1.0;
      await h.settle();
      camera.position.x -= 1.0;
      await h.settle();
      const recovered = h.getPixels();

      return { leftAlone, evicted, recovered };
    },
  );

  expect(pngBuffer(leftAlone)).toMatchSnapshot("paged-lod-left-alone.png");
  // Reference is an empty frame; a failure here means a foreign splat was drawn.
  expect(pngBuffer(evicted)).toMatchSnapshot("paged-lod-blank.png");
  expect(pngBuffer(recovered)).toMatchSnapshot("paged-lod-left-alone.png");
});

// The two tests below use the same scene as the 10K loop test above, so a
// correctly recovered mesh matches lod-10K.png. lodCleanupTimeoutMs: 0 makes
// the LoD tree of a hidden mesh get cleaned up on the very next frame.

// A chunk request is held back while the mesh is hidden and its tree cleaned
// up. When the chunk finally lands there is no tree for it, so the pager must
// drop it. If it paged the chunk in anyway, the pager would believe the root
// chunk is resident and never fetch it again: re-showing the mesh would render
// nothing, forever.
test("drops a chunk that lands after its LoD tree was cleaned up", async ({
  harnessPage,
}) => {
  const png = await harnessPage.evaluate(async () => {
    const h = window.harness;
    h.createSpark({ lodSplatCount: 10_000, lodCleanupTimeoutMs: 0 });
    h.createCamera({ fov: 60, position: [0, 0, 7] });

    const chunk0 = await h.holdRequest("**/furry-logo-pedestal-lod-0.radc");
    const mesh = h.addSplatMesh({
      url: "/test/browser/fixtures/chunked/furry-logo-pedestal-lod.rad",
      paged: true,
      quaternion: [1, 0, 0, 0],
    });
    // Tree created and chunk 0 requested (held back).
    await h.settle({ waitForFetches: false });

    // Hidden: the tree is cleaned up while chunk 0 is still in flight.
    mesh.visible = false;
    await h.settle({ waitForFetches: false });

    // Chunk 0 lands with no tree to go to.
    await chunk0.release();
    await h.settle();

    mesh.visible = true;
    await h.settle();
    return h.getPixels();
  });

  expect(pngBuffer(png)).toMatchSnapshot("lod-10K.png");
});

// Same setup, but the chunk lands while Spark is paused between consuming
// pager updates and cleaning up the tree, so its insert and upload are queued
// when the tree goes away. Cleanup must purge them. If it did not, re-showing
// the mesh would apply the stale insert to the new tree and render from a page
// the pager considers free: with fetching disabled the mesh must stay blank.
test("purges queued updates when a LoD tree is cleaned up mid-callback", async ({
  harnessPage,
}) => {
  const { evicted, recovered } = await harnessPage.evaluate(async () => {
    const h = window.harness;
    const spark = h.createSpark({
      lodSplatCount: 10_000,
      lodCleanupTimeoutMs: 0,
    });
    const camera = h.createCamera({ fov: 60, position: [0, 0, 7] });
    const chunk0 = await h.holdRequest("**/furry-logo-pedestal-lod-0.radc");
    const mesh = h.addSplatMesh({
      url: "/test/browser/fixtures/chunked/furry-logo-pedestal-lod.rad",
      paged: true,
      quaternion: [1, 0, 0, 0],
    });
    await h.settle({ waitForFetches: false });

    // Hide the mesh and pause Spark right before it cleans up the tree.
    const cleanup = h.holdHook("lod.beforeCleanup");
    mesh.visible = false;
    h.requestRender();
    await cleanup.reached;

    // Chunk 0 lands and is queued for the paused callback.
    await chunk0.release();
    await h.waitUntil(() => spark.pager?.hasQueued() ?? false);

    // Cleanup runs (as a microtask, before any render), then the mesh is
    // re-added with fetching off so only stale state could make it render.
    cleanup.release();
    spark.enableLodFetching = false;
    mesh.visible = true;
    await h.settle();
    const evicted = h.getPixels();

    // Fetching back on, a camera move triggers the LoD update that refetches.
    spark.enableLodFetching = true;
    camera.position.x += 1.0;
    await h.settle();
    camera.position.x -= 1.0;
    await h.settle();
    const recovered = h.getPixels();
    return { evicted, recovered };
  });

  expect(pngBuffer(evicted)).toMatchSnapshot("paged-lod-blank.png");
  expect(pngBuffer(recovered)).toMatchSnapshot("lod-10K.png");
});
