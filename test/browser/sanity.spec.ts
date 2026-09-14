import { expect, test } from "@playwright/test";
import {
  FIXTURES,
  expectInvariants,
  expectNoErrors,
  harness,
  openHarness,
  waitForSnapshot,
} from "./helpers";

// Baseline: continuous rendering with a paged mesh must load, render pixels,
// keep the page tables consistent, and fully clean up after removal.
// This must be green before and after any fix.

test("WebGL2 + workers + WASM: paged mesh loads and renders in loop mode", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "loop",
    maxPages: 8,
    lodSplatCount: 60000,
    lodDisposeTimeoutMs: 300,
  });
  const h = harness(page);

  await h.addPaged("A", FIXTURES.chunked);

  const loaded = await waitForSnapshot(
    page,
    (s) => s.activeSplats > 0 && s.pager.mapped.length >= 2,
    { label: "paged mesh resident and active", timeoutMs: 30_000 },
  );
  expect(loaded.hasPager).toBe(true);
  expect(loaded.lodIds.find((l) => l.name === "A")?.rootPage).toBe(
    loaded.pager.mapped.find((m) => m.name === "A" && m.chunk === 0)?.page,
  );

  // Let fetching settle, then check pixels + invariants
  expect(await h.waitIdle({ timeoutMs: 30_000 })).toBe(true);
  const lit = await h.countLitPixels();
  expect(lit).toBeGreaterThan(100);

  const s1 = await h.snapshot();
  expect(s1.pager.mapped.length).toBeLessThanOrEqual(s1.pager.maxPages);
  expect(s1.pager.mapped.length).toBeGreaterThanOrEqual(2);
  await expectInvariants(page);
  expectNoErrors(opened, s1);

  // Remove the mesh; after the dispose timeout everything must be released
  await h.remove("A");
  const cleaned = await waitForSnapshot(
    page,
    (s) =>
      s.lodIds.length === 0 &&
      s.pager.freelist.length === s.pager.maxPages &&
      s.pager.mapped.length === 0,
    { label: "pager fully released after remove", timeoutMs: 15_000 },
  );
  expect(cleaned.activeSplats).toBe(0);
  const inv = await expectInvariants(page);
  expect(inv.skipped).toEqual([]);
  expectNoErrors(opened, cleaned);
});

test("non-paged LoD mesh and plain PLY load in loop mode", async ({ page }) => {
  const opened = await openHarness(page, {
    mode: "loop",
    lodSplatCount: 30000,
  });
  const h = harness(page);
  await h.addMesh("L", FIXTURES.lodRad, { lod: true });
  await h.addMesh("P", FIXTURES.smallPly, { position: [0, 0, -2] });

  const s = await waitForSnapshot(
    page,
    (s) =>
      s.meshes.L.initialized &&
      s.meshes.P.initialized &&
      s.activeSplats > 0 &&
      s.lodIds.some((l) => l.name === "L" && !l.paged),
    {
      label: "both meshes initialized and LoD tree created",
      timeoutMs: 30_000,
    },
  );
  expect(s.meshes.P.numSplats).toBeGreaterThan(0);
  await expect
    .poll(() => h.countLitPixels(), { timeout: 15_000 })
    .toBeGreaterThan(100);
  expectNoErrors(opened, await h.snapshot());
});
