import { expect, test } from "@playwright/test";
import { FUZZ_HARNESS, formatFuzzFailure } from "./fuzz-shared";
import { FIXTURES, openHarness } from "./helpers";

// Seeded random interleavings of {add, remove, re-add, dispose, toggle
// visibility, move camera, render, release held chunk fetch, hold/release
// hook points} with pager invariants checked after every step and a full
// pager <-> Rust cross-check at each drain. Failing seeds are reported with
// their action trace; pin them in regressions.spec.ts.
//
//   FUZZ_ITERS=20 FUZZ_SEED=1 npm run test:browser -- pager-fuzz

const iters = Number(process.env.FUZZ_ITERS ?? 3);
const baseSeed = Number(process.env.FUZZ_SEED ?? 1);
const steps = Number(process.env.FUZZ_STEPS ?? 60);

for (let i = 0; i < iters; i++) {
  const seed = baseSeed + i;
  test(`fuzz seed ${seed}`, async ({ page }) => {
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
