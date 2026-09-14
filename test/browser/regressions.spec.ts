import { expect, test } from "@playwright/test";
import { FUZZ_HARNESS, formatFuzzFailure } from "./fuzz-shared";
import {
  FIXTURES,
  expectInvariants,
  expectNoErrors,
  harness,
  openHarness,
} from "./helpers";

// Fuzz seeds that produced invariant violations against the pre-fix pager.
// Each entry pins the exact harness configuration and step count of the run
// that found it so the same interleaving is replayed.
//
//   seed 12 / 17 (120 steps): pages stayed mapped for PagedSplats whose LoD
//   tree had been disposed (a chunk fetch landed after cleanupLodTrees ->
//   pager.removeSplats), and the run never reached idle afterwards.
const PINNED: { seed: number; steps: number }[] = [
  { seed: 12, steps: 120 },
  { seed: 17, steps: 120 },
];

for (const { seed, steps } of PINNED) {
  test(`fuzz regression seed ${seed} (${steps} steps)`, async ({ page }) => {
    test.setTimeout(180_000);
    const opened = await openHarness(page, FUZZ_HARNESS);
    const result = await page.evaluate(
      ([s, n, url]) =>
        window.harness.fuzz({ seed: s, steps: n, url, budgetMs: 120_000 }),
      [seed, steps, FIXTURES.chunked] as const,
    );
    const benign = (e: string) => /GL_|performance warning/i.test(e);
    expect(
      result.violations,
      `${formatFuzzFailure(result)}\npageErrors: ${opened.pageErrors.join("; ")}`,
    ).toEqual([]);
    expect(
      result.errors.filter((e) => !benign(e)),
      formatFuzzFailure(result),
    ).toEqual([]);
    expect(opened.pageErrors).toEqual([]);
    expect(result.finalCleanupOk).toBe(true);
  });
}

// cleanupLodTrees compared lastTouched (stamped at the start of updateLod)
// against performance.now() at the end of the async LoD callback. With a
// short lodDisposeTimeoutMs the tree of a mesh that was visible this very
// frame looked stale and was disposed, then re-created next frame (flicker).
test("lodDisposeTimeoutMs 0 never disposes the LoD tree of a visible mesh", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "manual",
    maxPages: 8,
    lodSplatCount: 40000,
    numLodFetchers: 1,
    lodDisposeTimeoutMs: 0,
  });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  expect(await h.renderUntilIdle({ timeoutMs: 30_000 })).toBe(true);

  const s0 = await h.snapshot();
  const initial = s0.lodIds.find((l) => l.name === "A");
  expect(initial, "A has a LoD tree after converging").toBeDefined();
  expect(s0.meshes.A.pagedNumSplats ?? 0).toBeGreaterThan(0);

  // Keep rendering with A visible: its record must survive every callback
  // with the same lodId (no dispose / re-init churn).
  for (let i = 0; i < 20; i++) {
    await h.render();
    await page.waitForTimeout(40);
    const s = await h.snapshot();
    const record = s.lodIds.find((l) => l.name === "A");
    expect(record?.lodId, `frame ${i}: A's tree`).toBe(initial?.lodId);
  }
  expect(await h.renderUntilIdle({ timeoutMs: 15_000 })).toBe(true);
  const s1 = await h.snapshot();
  expect(s1.lodIds.find((l) => l.name === "A")?.lodId).toBe(initial?.lodId);
  expect(s1.meshes.A.pagedNumSplats ?? 0).toBeGreaterThan(0);
  await expectInvariants(page);

  // Once removed, a zero timeout disposes the tree on the next callback and
  // returns every page to the pool.
  await h.remove("A");
  expect(await h.renderUntilIdle({ timeoutMs: 15_000 })).toBe(true);
  const s2 = await h.snapshot();
  expect(s2.lodIds).toEqual([]);
  expect(s2.pager.mapped.filter((m) => m.name === "A")).toEqual([]);
  expect(s2.pager.freelist.length).toBe(s2.pager.maxPages);
  await expectInvariants(page);
  expectNoErrors(opened, s2);
});

// Overlapping frames: a mesh removed in frame N (whose callback is still
// running) and re-added in frame N+1 gets a fresh lastTouched from N+1's
// updateLod, but callback N's cleanup only knew frame N's lodMeshes. It must
// consult the latest visibility rather than dispose the now-visible tree.
test("cleanup does not dispose a tree made visible again while the callback ran", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "manual",
    maxPages: 8,
    lodSplatCount: 40000,
    numLodFetchers: 1,
    lodDisposeTimeoutMs: 0,
  });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  expect(await h.renderUntilIdle({ timeoutMs: 30_000 })).toBe(true);
  const initial = (await h.snapshot()).lodIds.find((l) => l.name === "A");
  expect(initial).toBeDefined();

  // Frame N: A removed; its callback parks right before cleanup.
  await h.hooks.hold("lod.beforeCleanup");
  await h.remove("A");
  await h.render();
  await h.hooks.waitHeld("lod.beforeCleanup", 1);

  // Frame N+1 (callback skipped, worker busy): A is visible again and its
  // record is re-stamped.
  await h.readd("A");
  await h.render();
  await page.waitForTimeout(50);

  // Resume callback N's cleanup with the zero timeout.
  await h.hooks.unhold("lod.beforeCleanup");
  await h.hooks.release("lod.beforeCleanup", 1);
  await page.waitForTimeout(200);

  const after = (await h.snapshot()).lodIds.find((l) => l.name === "A");
  expect(after?.lodId, "A's tree survived cleanup").toBe(initial?.lodId);

  expect(await h.renderUntilIdle({ timeoutMs: 15_000 })).toBe(true);
  const s = await h.snapshot();
  expect(s.lodIds.find((l) => l.name === "A")?.lodId).toBe(initial?.lodId);
  expect(s.meshes.A.pagedNumSplats ?? 0).toBeGreaterThan(0);
  await expectInvariants(page);
  expectNoErrors(opened, s);
});
