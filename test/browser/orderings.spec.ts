import { expect, test } from "@playwright/test";
import {
  FIXTURES,
  chunkIndexFromUrl,
  expectInvariants,
  expectNoErrors,
  harness,
  holdRequests,
  openHarness,
  waitForSnapshot,
} from "./helpers";

// Targeted interleavings using in-source hook points (P1b via hooks, P6) and
// pool-pressure / worker hardening checks (P3, R1).

test("P1b (hooks): a chunk landing between consume and cleanup of the callback that disposes its tree is not applied to a re-created tree", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "manual",
    maxPages: 8,
    lodSplatCount: 40000,
    numLodFetchers: 1,
    lodDisposeTimeoutMs: 200,
  });
  const h = harness(page);
  const gate = await holdRequests(
    page,
    undefined,
    (url) => chunkIndexFromUrl(url) !== 0,
  );

  // Render until the root is resident and a child fetch is held
  await h.addPaged("A", FIXTURES.chunked);
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    await h.render();
    await page.waitForTimeout(60);
    const s = await h.snapshot();
    if (
      s.pager.mapped.some((m) => m.name === "A" && m.chunk === 0) &&
      s.pager.fetchers.some((f) => f.name === "A" && f.chunk !== 0)
    ) {
      break;
    }
  }
  await gate.waitHeld(1);

  // Remove A, render once so it is no longer touched, wait past the timeout
  await h.remove("A");
  await h.render();
  await page.waitForTimeout(400);

  // Park the callback that will dispose A right before cleanup
  await h.hooks.hold("lod.beforeCleanup");
  await h.render();
  await h.hooks.waitHeld("lod.beforeCleanup", 1);

  // While parked (after consumeLodTreeUpdates ran), let the child chunk land:
  // it gets a page and queues an insert update for A.
  await gate.releaseAll();
  gate.passthrough();
  await waitForSnapshot(
    page,
    (s) =>
      s.pager.fetchers.length === 0 &&
      s.pager.lodTreeUpdates >= 1 &&
      s.pager.mapped.some((m) => m.name === "A" && m.chunk !== 0),
    { label: "stale chunk landed while callback parked", timeoutMs: 10_000 },
  );

  // Resume: cleanup disposes A's tree and frees its pages
  await h.hooks.unhold("lod.beforeCleanup");
  await h.hooks.release("lod.beforeCleanup", 1);
  await waitForSnapshot(
    page,
    (s) => !s.lodIds.some((l) => l.name === "A") && s.inFlight.length === 0,
    { label: "A's LoD tree disposed", timeoutMs: 5_000 },
  );

  // Pending pager updates must not reference pages that are no longer mapped
  const afterDispose = await h.snapshot();
  expect(afterDispose.pager.mapped.filter((m) => m.name === "A")).toEqual([]);
  await expectInvariants(page);

  // Re-add A: the new tree must only learn about chunks the pager has mapped
  await h.readd("A");
  expect(await h.renderUntilIdle({ timeoutMs: 30_000 })).toBe(true);
  const result = await expectInvariants(page);
  expect(result.skipped).toEqual([]);
  await gate.dispose();
  expectNoErrors(opened, await h.snapshot());
});

test("P3: fetched chunks are never dropped when the pool is full", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "loop",
    maxPages: 3,
    lodSplatCount: 250000,
    numLodFetchers: 3,
  });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  await waitForSnapshot(
    page,
    (s) => s.pager.mapped.length === s.pager.maxPages,
    { label: "pool full", timeoutMs: 30_000 },
  );
  // Sustained pressure: the traverse wants more chunks than there are pages
  await page.waitForTimeout(6_000);
  const s = await h.snapshot();
  expect(s.pagerDrops, "fetched chunks dropped for lack of pages").toBe(0);
  expect(s.pager.mapped.length).toBeLessThanOrEqual(s.pager.maxPages);
  await expectInvariants(page);
  expectNoErrors(opened, s);
});

test("P6: disposing a paged mesh during a traverse does not recreate its indices texture", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "loop",
    maxPages: 8,
    lodSplatCount: 30000,
  });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  await waitForSnapshot(page, (s) => (s.meshes.A.pagedNumSplats ?? 0) > 0, {
    label: "A displayed",
    timeoutMs: 20_000,
  });

  await h.hooks.hold("lod.afterTraverse");
  // Loop mode: the next callback with lodDirty parks after the traverse.
  // Force one by nudging the camera.
  await h.moveCamera([0.2, 0.1, 0.0]);
  await h.hooks.waitHeld("lod.afterTraverse", 1);

  await h.dispose("A");
  const disposed = await h.snapshot();
  expect(disposed.meshes.A.pagedHasIndicesTexture).toBe(false);
  expect(disposed.meshes.A.pagedAborted).toBe(true);

  await h.hooks.unhold("lod.afterTraverse");
  await h.hooks.release("lod.afterTraverse", 1);
  await page.waitForTimeout(500);

  const after = await h.snapshot();
  expect(after.meshes.A.pagedHasIndicesTexture).toBe(false);
  expectNoErrors(opened, after);
});

test("R1 (gated hardening): unknown lodId in a worker call rejects without poisoning the worker", async ({
  page,
}) => {
  await openHarness(page, { mode: "manual" });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  await h.render();
  await waitForSnapshot(page, (s) => s.hasPager, {
    label: "pager created",
    timeoutMs: 10_000,
  });

  const outcome = await page.evaluate(async () => {
    const results: { first: string; second: string } = {
      first: "",
      second: "",
    };
    try {
      await window.harness.lodWorkerCall("updateLodTrees", {
        ranges: [{ lodId: 999999, pageBase: 0, chunkBase: 0, count: 65536 }],
      });
      results.first = "resolved";
    } catch (error) {
      results.first = `rejected: ${String((error as Error)?.message ?? error)}`;
    }
    try {
      const ids = await window.harness.lodWorkerCall<{ lodIds: number[] }>(
        "getLodTreeIds",
        {},
      );
      results.second = `resolved: ${ids.lodIds.length} trees`;
    } catch (error) {
      results.second = `rejected: ${String((error as Error)?.message ?? error)}`;
    }
    return results;
  });
  expect(outcome.first).toMatch(/^rejected/);
  expect(outcome.second).toMatch(/^resolved/);
});
