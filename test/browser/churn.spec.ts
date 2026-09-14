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

// Pager table invariants under add/remove churn (P1a, P1b natural variant,
// P2, P5). All tests use the network seam (held chunk requests) rather than
// in-source hooks, so they reflect what real applications can hit.

/**
 * Reach the P1a state: mesh A has its root resident, a child chunk fetch is
 * held in flight, A is removed and its LoD tree disposed. Returns the gate.
 */
async function removedWhileChildFetchInFlight(
  page: import("@playwright/test").Page,
  name = "A",
) {
  const h = harness(page);
  const gate = await holdRequests(
    page,
    undefined,
    (url) => chunkIndexFromUrl(url) !== 0,
  );
  await h.addPaged(name, FIXTURES.chunked);

  // Root resident, LoD traversed, a child chunk requested (held by the gate)
  await waitForSnapshot(
    page,
    (s) =>
      s.pager.mapped.some((m) => m.name === name && m.chunk === 0) &&
      s.pager.fetchers.some((f) => f.name === name && f.chunk !== 0),
    {
      label: `${name}: root resident + child fetch in flight`,
      timeoutMs: 20_000,
    },
  );
  await gate.waitHeld(1);

  // Remove (not dispose) and wait for the LoD tree to be cleaned up
  await h.remove(name);
  await waitForSnapshot(
    page,
    (s) =>
      !s.lodIds.some((l) => l.name === name) &&
      !s.pager.mapped.some((m) => m.name === name),
    { label: `${name}: LoD tree disposed after remove`, timeoutMs: 10_000 },
  );
  // The held fetch is still in flight for the now-untracked PagedSplats
  const s = await h.snapshot();
  expect(s.pager.fetchers.some((f) => f.name === name)).toBe(true);
  return gate;
}

test("P1a: a chunk that lands for a removed mesh does not stay mapped", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "loop",
    maxPages: 8,
    lodSplatCount: 40000,
    numLodFetchers: 1,
    lodDisposeTimeoutMs: 200,
  });
  const h = harness(page);
  const gate = await removedWhileChildFetchInFlight(page, "A");

  // Let the stale fetch land and be seen by at least one LoD callback
  await gate.releaseAll();
  gate.passthrough();
  await waitForSnapshot(
    page,
    (s) =>
      s.pager.fetchers.length === 0 &&
      s.pager.fetched === 0 &&
      s.pager.lodTreeUpdates === 0,
    { label: "stale fetch completed and consumed", timeoutMs: 10_000 },
  );
  await page.waitForTimeout(500);

  // Desired: nothing owned by A remains in the page tables, pool fully free
  const s = await h.snapshot();
  expect(s.pager.mapped.filter((m) => m.name === "A")).toEqual([]);
  expect(s.pager.freelist.length).toBe(s.pager.maxPages);
  await expectInvariants(page);
  await gate.dispose();
  expectNoErrors(opened, s);
});

test("P1b (natural): re-adding a mesh after a stale chunk landed keeps pager and Rust tree consistent", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "loop",
    maxPages: 8,
    lodSplatCount: 40000,
    numLodFetchers: 1,
    lodDisposeTimeoutMs: 200,
  });
  const h = harness(page);
  const gate = await removedWhileChildFetchInFlight(page, "A");
  await gate.releaseAll();
  gate.passthrough();
  await waitForSnapshot(page, (s) => s.pager.fetchers.length === 0, {
    label: "stale fetch completed",
    timeoutMs: 10_000,
  });

  // Re-add the same mesh (same PagedSplats). A new LoD tree is created; every
  // chunk the pager believes resident must also be resident in that tree.
  await h.readd("A");
  await waitForSnapshot(
    page,
    (s) =>
      s.lodIds.some((l) => l.name === "A" && l.rootPage !== undefined) &&
      (s.meshes.A.pagedNumSplats ?? 0) > 0,
    { label: "A re-added and displayed", timeoutMs: 15_000 },
  );
  expect(await h.waitIdle({ timeoutMs: 15_000 })).toBe(true);
  const result = await expectInvariants(page);
  expect(result.skipped).toEqual([]);

  // And it must be able to become fully resident again (no chunk stuck as
  // "resident in pager, missing in Rust" which would never be re-fetched)
  const resident = await h.residentChunks("A");
  expect(Object.keys(resident).length).toBeGreaterThanOrEqual(2);
  await gate.dispose();
  expectNoErrors(opened, await h.snapshot());
});

test("P2: evicting a mesh's root chunk does not leave a stale rootPage", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "loop",
    maxPages: 2,
    lodSplatCount: 40000,
    numLodFetchers: 1,
    lodDisposeTimeoutMs: 30_000,
  });
  const h = harness(page);

  await h.addPaged("M1", FIXTURES.chunked);
  await waitForSnapshot(
    page,
    (s) =>
      s.pager.mapped.filter((m) => m.name === "M1").length === 2 &&
      s.pager.fetchers.length === 0 &&
      s.pager.lodTreeUpdates === 0,
    { label: "M1 fills the 2-page pool", timeoutMs: 20_000 },
  );
  expect(await h.waitIdle({ timeoutMs: 20_000 })).toBe(true);

  // Hide M1 (stays within the dispose timeout) and add M2, whose chunks must
  // evict all of M1's pages including its root.
  await h.setVisible("M1", false);
  await h.addPaged("M2", FIXTURES.chunked);
  await waitForSnapshot(
    page,
    (s) =>
      s.pager.mapped.filter((m) => m.name === "M2").length === 2 &&
      s.pager.mapped.filter((m) => m.name === "M1").length === 0 &&
      s.pager.lodTreeUpdates === 0,
    { label: "M2 evicted all of M1's pages", timeoutMs: 20_000 },
  );
  expect(await h.waitIdle({ timeoutMs: 20_000 })).toBe(true);

  // Desired: M1's record no longer claims a root page (cross-checked against
  // the Rust tree's chunk_to_page[0] by checkInvariants).
  const s1 = await h.snapshot();
  const m1 = s1.lodIds.find((l) => l.name === "M1");
  expect(m1).toBeDefined();
  expect(m1?.rootPage).toBeUndefined();
  await expectInvariants(page);

  // Make M1 visible again: it must not render with a stale root page (foreign
  // data) while it has no resident pages.
  await h.setVisible("M1", true);
  let sawForeignRoot = false;
  const start = Date.now();
  while (Date.now() - start < 6_000) {
    const s = await h.snapshot();
    const resident = s.pager.mapped.filter((m) => m.name === "M1").length;
    if ((s.meshes.M1.pagedNumSplats ?? 0) > 0 && resident === 0) {
      sawForeignRoot = true;
      break;
    }
    if (resident > 0 && (s.meshes.M1.pagedNumSplats ?? 0) > 0) break;
    await page.waitForTimeout(50);
  }
  expect(sawForeignRoot, "M1 displayed splats with no resident pages").toBe(
    false,
  );
  await expectInvariants(page);
  expectNoErrors(opened, await h.snapshot());
});

test("P5: dispose() then re-adding the same mesh does not spin on aborted fetches", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "loop",
    maxPages: 8,
    lodSplatCount: 30000,
    numLodFetchers: 1,
  });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  await waitForSnapshot(page, (s) => (s.meshes.A.pagedNumSplats ?? 0) > 0, {
    label: "A displayed",
    timeoutMs: 20_000,
  });
  expect(await h.waitIdle({ timeoutMs: 10_000 })).toBe(true);

  // Application mistake / edge case: dispose then put the same object back
  await h.dispose("A");
  await h.readd("A");
  await page.waitForTimeout(1500);

  // Desired: the pager does not keep retrying fetches for a disposed
  // PagedSplats (each retry fails immediately with AbortError + backoff).
  let spinning = 0;
  for (let i = 0; i < 6; i++) {
    const s = await h.snapshot();
    if (s.pager.fetchers.some((f) => f.name === "A")) spinning++;
    await page.waitForTimeout(300);
  }
  const s = await h.snapshot();
  expect(spinning, "fetcher for disposed A observed in pager.fetchers").toBe(0);
  expect(s.meshes.A.pagedAborted).toBe(true);
  await expectInvariants(page);
  expectNoErrors(opened, s);
});
