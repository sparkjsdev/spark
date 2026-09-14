// Seeded in-page fuzzer for the paged LoD pipeline. Runs inside the harness
// page (see harness.ts) so that every action, hook release and chunk-fetch
// release is chosen by one PRNG; the resulting trace is returned to the test.

import { PagedSplats } from "../../../src/index";
import type { Harness } from "./harness";

export interface FuzzOptions {
  seed: number;
  steps: number;
  /** Check invariants + drain every N steps */
  drainEvery?: number;
  maxMeshes?: number;
  /** Probability that a chunk fetch is held until explicitly released */
  holdFetchProbability?: number;
  /** Fixture URL for paged meshes */
  url: string;
  /** Wall-clock budget for the whole run (ms) */
  budgetMs?: number;
  /** Stop at the first violation (default true) */
  stopOnViolation?: boolean;
}

export interface FuzzResult {
  seed: number;
  stepsRun: number;
  trace: string[];
  violations: string[];
  errors: string[];
  drains: number;
  skippedChecks: string[];
  finalCleanupOk: boolean;
  durationMs: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOOK_NAMES = [
  "lod.afterInit",
  "lod.afterUpdateTrees",
  "lod.afterTraverse",
  "lod.beforeCleanup",
  "pager.fetched",
  "pager.beforeProcessFetched",
  "sort.afterReadback",
];

const CAMERAS: [[number, number, number], [number, number, number]][] = [
  [
    [0, 0, 0],
    [0, 0, -4],
  ],
  [
    [1.5, 1.0, -2.5],
    [1.5, 1.0, -4],
  ],
  [
    [-1.5, -1.0, -2.0],
    [-1.5, -1.0, -4],
  ],
  [
    [0, 3, 0],
    [0, 0, -4],
  ],
  [
    [0, 0, 4],
    [0, 0, -4],
  ],
];

const POSITIONS: [number, number, number][] = [
  [0, 0, 0],
  [0.5, 0.2, -0.5],
  [-0.5, -0.3, 0.5],
];

/** Intercepts chunk fetches so they can be held/released deterministically. */
export class FetchGate {
  held: { url: string; release: () => void }[] = [];
  active = false;
  shouldHold: () => boolean = () => false;
  private original?: typeof window.fetch;
  private pattern = /fixture-lod-\d+\.radc/;

  install() {
    if (this.original) return;
    this.original = window.fetch.bind(window);
    const original = this.original;
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString();
      if (this.active && this.pattern.test(url) && this.shouldHold()) {
        const signal =
          init?.signal ?? (input instanceof Request ? input.signal : null);
        await new Promise<void>((resolve, reject) => {
          const entry = {
            url,
            release: () => {
              const index = this.held.indexOf(entry);
              if (index >= 0) this.held.splice(index, 1);
              resolve();
            },
          };
          this.held.push(entry);
          signal?.addEventListener("abort", () => {
            const index = this.held.indexOf(entry);
            if (index >= 0) this.held.splice(index, 1);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return original(input, init);
    };
  }

  releaseAll() {
    const all = this.held.slice();
    for (const h of all) h.release();
    return all.length;
  }
}

export async function runFuzz(
  harness: Harness,
  options: FuzzOptions,
): Promise<FuzzResult> {
  const start = performance.now();
  const rand = mulberry32(options.seed);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const chance = (p: number) => rand() < p;
  const drainEvery = options.drainEvery ?? 12;
  const maxMeshes = options.maxMeshes ?? 4;
  const holdP = options.holdFetchProbability ?? 0.5;
  const budgetMs = options.budgetMs ?? 60_000;
  const stopOnViolation = options.stopOnViolation ?? true;

  const gate = new FetchGate();
  gate.install();
  gate.active = true;
  gate.shouldHold = () => chance(holdP);

  const trace: string[] = [];
  const violations: string[] = [];
  const skippedChecks: string[] = [];
  let drains = 0;
  let meshCounter = 0;
  const disposed = new Set<string>();
  const errorsBefore = harness.errors.length;

  const names = () => Array.from(harness.meshes.keys());
  const inScene = () => names().filter((n) => harness.inScene(n));
  const removed = () =>
    names().filter((n) => !harness.inScene(n) && !disposed.has(n));

  const log = (step: number, message: string) => {
    trace.push(`${step}: ${message}`);
  };

  const quickCheck = (step: number, label: string) => {
    const pager = harness.spark.pager;
    if (!pager) return;
    const live = new Set<PagedSplats>();
    for (const splats of harness.spark.lodIds.keys()) {
      if (splats instanceof PagedSplats) live.add(splats);
    }
    const errors = pager.checkInvariants(live);
    for (const error of errors) {
      violations.push(`step ${step} (${label}): ${error}`);
    }
  };

  const drain = async (step: number) => {
    drains += 1;
    log(step, "drain: release hooks + fetches, render until idle, full check");
    harness.hooks.unholdAll();
    harness.hooks.releaseAll();
    gate.active = false;
    gate.releaseAll();
    const idle = await harness.renderUntilIdle({ timeoutMs: 15_000 });
    if (!idle) {
      skippedChecks.push(`step ${step}: did not reach idle within 15s`);
    }
    const { errors, skipped } = await harness.checkInvariants();
    for (const error of errors)
      violations.push(`step ${step} (drain): ${error}`);
    for (const s of skipped) skippedChecks.push(`step ${step}: ${s}`);
    gate.active = true;
  };

  let step = 0;
  for (; step < options.steps; step++) {
    if (performance.now() - start > budgetMs) {
      log(step, "budget exhausted");
      break;
    }
    if (stopOnViolation && violations.length > 0) break;

    if (step > 0 && step % drainEvery === 0) {
      await drain(step);
      continue;
    }

    const r = rand();
    if (r < 0.1 && names().length - disposed.size < maxMeshes) {
      const name = `F${meshCounter++}`;
      const position = pick(POSITIONS);
      harness.addPaged(name, options.url, { position });
      log(step, `add ${name} at ${position.join(",")}`);
    } else if (r < 0.18 && inScene().length > 0) {
      const name = pick(inScene());
      harness.remove(name);
      log(step, `remove ${name}`);
    } else if (r < 0.26 && removed().length > 0) {
      const name = pick(removed());
      harness.readd(name);
      log(step, `readd ${name}`);
    } else if (r < 0.3 && names().length - disposed.size > 0) {
      const name = pick(names().filter((n) => !disposed.has(n)));
      harness.dispose(name);
      disposed.add(name);
      log(step, `dispose ${name}`);
    } else if (r < 0.36 && inScene().length > 0) {
      const name = pick(inScene());
      const visible = !harness.meshes.get(name)?.mesh.visible;
      harness.setVisible(name, visible);
      log(step, `visible ${name} ${visible}`);
    } else if (r < 0.44) {
      const [pos, look] = pick(CAMERAS);
      harness.moveCamera(pos, look);
      log(step, `camera ${pos.join(",")}`);
    } else if (r < 0.62) {
      const frames = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < frames; i++) {
        harness.render();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      log(step, `render x${frames}`);
    } else if (r < 0.72 && gate.held.length > 0) {
      const entry = pick(gate.held);
      entry.release();
      log(step, `release fetch ${entry.url.replace(/^.*\//, "")}`);
    } else if (r < 0.8 && harness.hooks.heldCount() > 0) {
      const name = pick(harness.hooks.heldNames());
      harness.hooks.release(name, 1);
      log(step, `release hook ${name}`);
    } else if (r < 0.86) {
      const name = pick(HOOK_NAMES);
      harness.hooks.hold(name);
      log(step, `hold ${name}`);
    } else if (r < 0.9) {
      const name = pick(HOOK_NAMES);
      harness.hooks.unhold(name);
      harness.hooks.release(name, 100);
      log(step, `unhold ${name}`);
    } else {
      const ms = Math.floor(rand() * 80);
      await harness.sleep(ms);
      log(step, `sleep ${ms}`);
    }

    // Give queued microtasks/timers a chance to run before checking
    await harness.sleep(0);
    quickCheck(step, trace[trace.length - 1]);
  }

  // Final drain and full cleanup: remove everything, wait past the dispose
  // timeout, and require the pool to be fully released.
  await drain(step);
  let finalCleanupOk = true;
  if (violations.length === 0 || !stopOnViolation) {
    for (const name of inScene()) harness.remove(name);
    log(step, "final: remove all meshes");
    harness.render();
    await harness.sleep(harness.spark.lodDisposeTimeoutMs + 50);
    const idle = await harness.renderUntilIdle({ timeoutMs: 15_000 });
    const s = harness.snapshot();
    const pager = harness.spark.pager;
    if (pager) {
      const state = pager.debugState();
      if (state.freelist.length !== state.maxPages || state.mapped.length > 0) {
        finalCleanupOk = false;
        violations.push(
          `final: pool not released (free ${state.freelist.length}/${state.maxPages}, mapped ${state.mapped.length})`,
        );
      }
    }
    if (s.lodIds.length > 0) {
      finalCleanupOk = false;
      violations.push(`final: lodIds not empty (${s.lodIds.length})`);
    }
    if (!idle) skippedChecks.push("final: did not reach idle");
    const { errors, skipped } = await harness.checkInvariants();
    for (const error of errors) violations.push(`final: ${error}`);
    for (const sk of skipped) skippedChecks.push(`final: ${sk}`);
  }

  gate.active = false;
  gate.releaseAll();

  return {
    seed: options.seed,
    stepsRun: step,
    trace,
    violations,
    errors: harness.errors.slice(errorsBefore),
    drains,
    skippedChecks,
    finalCleanupOk,
    durationMs: performance.now() - start,
  };
}
