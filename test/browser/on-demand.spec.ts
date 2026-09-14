import { expect, test } from "@playwright/test";
import {
  FIXTURES,
  expectNoErrors,
  harness,
  holdRequests,
  openHarness,
  waitForSnapshot,
} from "./helpers";

// Dirty-flag / on-demand rendering matrix (D1, D2, D3, D5).
//
// "on-demand mode" = no animation loop; SparkRenderer.onDirty schedules exactly
// one render() via requestAnimationFrame. Each test is written as the desired
// behavior: the scene must converge without the application calling render()
// on its own.

test("D1: paged chunk landing triggers a render in on-demand mode", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "ondemand",
    maxPages: 8,
    lodSplatCount: 30000,
  });
  const h = harness(page);

  await h.addPaged("A", FIXTURES.chunked);
  // The application renders exactly once; everything else must come from onDirty
  await h.render();

  const converged = await waitForSnapshot(
    page,
    (s) =>
      s.activeSplats > 0 &&
      s.pager.lodTreeUpdates === 0 &&
      s.pager.mapped.length >= 1 &&
      (s.meshes.A.pagedNumSplats ?? 0) > 0,
    {
      label: "paged mesh displayed via onDirty-driven renders",
      timeoutMs: 15_000,
    },
  ).catch(async (error) => {
    const s = await h.snapshot();
    throw new Error(
      `${error.message}\nrenders=${s.renders} dirtyEvents=${s.dirtyEvents} pagerUpdates=${s.pagerUpdates} lodTreeUpdates=${s.pager.lodTreeUpdates} mapped=${JSON.stringify(s.pager.mapped)}`,
    );
  });

  expect(converged.renders).toBeGreaterThan(1);
  await expect
    .poll(() => h.countLitPixels(), { timeout: 10_000 })
    .toBeGreaterThan(50);
  expectNoErrors(opened, await h.snapshot());
});

test("D1b: on-demand pipeline keeps converging after camera moves", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "ondemand",
    maxPages: 8,
    lodSplatCount: 40000,
  });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  await h.render();
  await waitForSnapshot(page, (s) => s.activeSplats > 0, {
    label: "initial display",
    timeoutMs: 15_000,
  });

  // Move the camera close to one blob; new chunks become relevant and must be
  // fetched + displayed without further application renders (only one here).
  await h.moveCamera([1.5, 1.0, -2.5], [1.5, 1.0, -4]);
  const before = await h.snapshot();
  await h.render();

  const after = await waitForSnapshot(
    page,
    (s) =>
      s.pager.lodTreeUpdates === 0 &&
      s.pager.fetched === 0 &&
      s.pager.fetchers.length === 0 &&
      s.renders > before.renders + 1 &&
      !s.lodDirty,
    { label: "converged after camera move", timeoutMs: 15_000 },
  );
  expect(after.activeSplats).toBeGreaterThan(0);
  // The pipeline drains on its own (only onDirty-driven renders happen here):
  // nothing stays queued that would need an application render to be consumed.
  expect(await h.waitIdle({ timeoutMs: 10_000 })).toBe(true);
  expect(await h.isBusy()).toBe(false);
  expectNoErrors(opened, await h.snapshot());
});

test("D2: SplatMesh async initialization triggers a render in on-demand mode", async ({
  page,
}) => {
  const opened = await openHarness(page, { mode: "ondemand" });
  const h = harness(page);

  // Hold the PLY so that initialization completes only after the pipeline has
  // gone quiet (initial render + sort-completion render are done).
  const gate = await holdRequests(page, "**/fixture-small.ply");
  await h.addMesh("P", FIXTURES.smallPly, { position: [0, 0, -2] });
  await h.render();
  await gate.waitHeld(1);
  const quiet = await h.waitQuiet({ settleMs: 300, timeoutMs: 10_000 });
  expect(quiet.filter((r) => !r.startsWith("init:"))).toEqual([]);
  const before = await h.snapshot();
  expect(before.meshes.P.initialized).toBe(false);

  await gate.releaseAll();
  await h.awaitInitialized("P");

  const after = await waitForSnapshot(
    page,
    (s) => s.activeSplats > 0 && s.renders > before.renders,
    { label: "mesh displayed after initialization", timeoutMs: 5_000 },
  ).catch(async (error) => {
    const s = await h.snapshot();
    throw new Error(
      `${error.message}\nrenders before=${before.renders} after=${s.renders}, activeSplats=${s.activeSplats}, initialized=${s.meshes.P.initialized}`,
    );
  });
  expect(after.meshes.P.numSplats).toBeGreaterThan(0);
  await gate.dispose();
  expectNoErrors(opened, await h.snapshot());
});

test("D2b: LoD (non-paged) SplatMesh initialization triggers a render in on-demand mode", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "ondemand",
    lodSplatCount: 30000,
  });
  const h = harness(page);

  const gate = await holdRequests(page, "**/out/fixture-lod.rad");
  await h.addMesh("L", FIXTURES.lodRad, { lod: true });
  await h.render();
  await gate.waitHeld(1);
  const quiet = await h.waitQuiet({ settleMs: 300, timeoutMs: 10_000 });
  expect(quiet.filter((r) => !r.startsWith("init:"))).toEqual([]);
  const before = await h.snapshot();

  await gate.releaseAll();
  await h.awaitInitialized("L");

  const after = await waitForSnapshot(
    page,
    (s) =>
      s.activeSplats > 0 &&
      s.renders > before.renders &&
      s.lodIds.some((l) => l.name === "L"),
    { label: "LoD mesh displayed after initialization", timeoutMs: 8_000 },
  ).catch(async (error) => {
    const s = await h.snapshot();
    throw new Error(
      `${error.message}\nrenders before=${before.renders} after=${s.renders}, activeSplats=${s.activeSplats}`,
    );
  });
  expect(after.meshes.L.numSplats).toBeGreaterThan(0);
  await gate.dispose();
  expectNoErrors(opened, await h.snapshot());
});

test("D3: LoD callback that exits with lodDirty pending requests a render", async ({
  page,
}) => {
  const opened = await openHarness(page, {
    mode: "manual",
    maxPages: 8,
    lodSplatCount: 30000,
  });
  const h = harness(page);
  await h.addPaged("A", FIXTURES.chunked);
  expect(await h.renderUntilIdle({ timeoutMs: 30_000 })).toBe(true);

  // Switch to on-demand: from here on only onDirty may cause renders
  await h.setMode("ondemand");
  await h.hooks.hold("lod.beforeCleanup");

  // Camera move #1 -> render -> LoD callback traverses and parks at beforeCleanup
  await h.moveCamera([0.5, 0.2, -1.0], [0.5, 0.2, -4]);
  await h.render();
  await h.hooks.waitHeld("lod.beforeCleanup", 1);
  // Let the sort for camera #1 finish (otherwise updateInternal skips the
  // accumulator update because the mapping changed while sorting).
  await waitForSnapshot(
    page,
    (s) =>
      !s.sorting &&
      !s.sortDirty &&
      !s.inFlight.includes("renderScheduled") &&
      s.held.includes("lod.beforeCleanup"),
    { label: "sort settled while LoD callback parked", timeoutMs: 10_000 },
  );

  // Change a LoD-only parameter while the callback is parked and render once
  // (e.g. the app changed the splat budget). This does not move the camera, so
  // no sort is triggered that could mask the problem. The sync part of driveLod
  // sets lodDirty; tryExclusive is skipped because the worker is busy.
  await page.evaluate(() => {
    window.harness.spark.lodSplatCount = 12000;
  });
  await h.render();
  const parked = await h.snapshot();
  expect(parked.lodDirty).toBe(true);
  expect(parked.held).toEqual(["lod.beforeCleanup"]);
  expect(parked.sorting).toBe(false);
  const dirtyEventsBefore = parked.dirtyEvents;
  const activeBefore = parked.activeSplats;

  // Let the callback finish. Desired: it notices pending LoD work and calls
  // setDirty so the on-demand app re-renders and the LoD converges to the
  // new budget.
  await h.hooks.unhold("lod.beforeCleanup");
  await h.hooks.release("lod.beforeCleanup", 1);

  const after = await waitForSnapshot(
    page,
    (s) =>
      !s.lodDirty &&
      s.dirtyEvents > dirtyEventsBefore &&
      s.activeSplats < activeBefore &&
      s.activeSplats > 0,
    { label: "LoD re-traversed with the new splat budget", timeoutMs: 5_000 },
  ).catch(async (error) => {
    const s = await h.snapshot();
    throw new Error(
      `${error.message}\nlodDirty=${s.lodDirty} dirtyEvents before=${dirtyEventsBefore} after=${s.dirtyEvents} renders=${s.renders} activeSplats before=${activeBefore} after=${s.activeSplats} held=${s.held}`,
    );
  });
  expect(await h.waitIdle({ timeoutMs: 5_000 })).toBe(true);
  expectNoErrors(opened, after);
});

test("D5: a failed sort does not leave `sorting` stuck", async ({ page }) => {
  const opened = await openHarness(page, {
    mode: "manual",
    lodSplatCount: 30000,
  });
  const h = harness(page);
  await h.addMesh("P", FIXTURES.smallPly, { position: [0, 0, -2] });
  expect(await h.renderUntilIdle({ timeoutMs: 30_000 })).toBe(true);

  // Next sort fails after the worker returns
  await h.hooks.failNext("sort.afterWorker", "injected sort failure");
  await h.moveCamera([0.3, 0.1, 0.2], [0, 0, -4]);
  await h.render();
  // Wait for the failure to be recorded
  await waitForSnapshot(
    page,
    (s) => s.errors.some((e) => e.includes("injected sort failure")),
    { label: "sort failure surfaced", timeoutMs: 5_000 },
  );

  // Desired: sorting flag recovers and later frames sort again
  const recovered = await waitForSnapshot(page, (s) => !s.sorting, {
    label: "sorting flag cleared after failure",
    timeoutMs: 3_000,
  }).catch(async (error) => {
    const s = await h.snapshot();
    throw new Error(`${error.message}\nsorting=${s.sorting}`);
  });
  expect(recovered.sorting).toBe(false);

  // A mapping change (second mesh) must still be displayable
  await h.addMesh("Q", FIXTURES.smallPly, { position: [1, 0, -2] });
  await h.awaitInitialized("Q");
  const before = await h.snapshot();
  expect(await h.renderUntilIdle({ timeoutMs: 15_000 })).toBe(true);
  const after = await h.snapshot();
  expect(after.activeSplats).toBeGreaterThan(before.activeSplats);
  expect(after.sorting).toBe(false);

  // Only the injected failure may have been reported
  expect(
    after.errors.filter((e) => !e.includes("injected sort failure")),
  ).toEqual([]);
  expect(opened.pageErrors.filter((e) => !e.includes("injected"))).toEqual([]);
});
