import { type Page, expect } from "@playwright/test";
import type { Harness, HarnessInitOptions } from "./pages/harness";

export type Snapshot = ReturnType<Harness["snapshot"]>;

export const FIXTURES = {
  /** Chunked LoD RAD: fixture-lod.rad + fixture-lod-<n>.radc (7 chunks) */
  chunked: "/test/fixtures/out/chunked/fixture-lod.rad",
  /** Single-file LoD RAD */
  lodRad: "/test/fixtures/out/fixture-lod.rad",
  /** Plain (non-LoD) PLY, 300K splats (slow to rasterize on SwiftShader) */
  ply: "/test/fixtures/out/fixture.ply",
  /** Plain (non-LoD) PLY, 20K splats */
  smallPly: "/test/fixtures/out/fixture-small.ply",
};

export const CHUNK_URL_GLOB = "**/fixture-lod-*.radc";

export interface OpenedHarness {
  page: Page;
  pageErrors: string[];
  consoleErrors: string[];
}

/** Navigate to the harness page and initialize it. */
export async function openHarness(
  page: Page,
  options: HarnessInitOptions = {},
): Promise<OpenedHarness> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/test/browser/pages/harness.html");
  await page.waitForFunction(() => window.harnessReady, null, {
    timeout: 30_000,
  });
  await page.evaluate((o) => window.harness.init(o), options);
  return { page, pageErrors, consoleErrors };
}

/** Thin typed wrappers around page.evaluate(window.harness.*) */
export function harness(page: Page) {
  return {
    snapshot: () => page.evaluate(() => window.harness.snapshot()),
    render: () => page.evaluate(() => window.harness.render()),
    renderN: (n: number) =>
      page.evaluate(async (count) => {
        for (let i = 0; i < count; i++) {
          window.harness.render();
          await new Promise((r) => requestAnimationFrame(r));
        }
      }, n),
    setMode: (mode: "loop" | "ondemand" | "manual") =>
      page.evaluate((m) => window.harness.setMode(m), mode),
    addPaged: (
      name: string,
      url: string = FIXTURES.chunked,
      opts: { position?: [number, number, number]; lodScale?: number } = {},
    ) =>
      page.evaluate(([n, u, o]) => window.harness.addPaged(n, u, o), [
        name,
        url,
        opts,
      ] as const),
    addMesh: (
      name: string,
      url: string,
      opts: { position?: [number, number, number]; lod?: boolean } = {},
    ) =>
      page.evaluate(([n, u, o]) => window.harness.addMesh(n, u, o), [
        name,
        url,
        opts,
      ] as const),
    remove: (name: string) =>
      page.evaluate((n) => window.harness.remove(n), name),
    readd: (name: string) =>
      page.evaluate((n) => window.harness.readd(n), name),
    dispose: (name: string) =>
      page.evaluate((n) => window.harness.dispose(n), name),
    destroy: (name: string) =>
      page.evaluate((n) => window.harness.destroy(n), name),
    setVisible: (name: string, visible: boolean) =>
      page.evaluate(([n, v]) => window.harness.setVisible(n, v), [
        name,
        visible,
      ] as const),
    setPosition: (name: string, position: [number, number, number]) =>
      page.evaluate(([n, p]) => window.harness.setPosition(n, p), [
        name,
        position,
      ] as const),
    moveCamera: (
      position: [number, number, number],
      lookAt?: [number, number, number],
    ) =>
      page.evaluate(([p, l]) => window.harness.moveCamera(p, l), [
        position,
        lookAt,
      ] as const),
    awaitInitialized: (name: string) =>
      page.evaluate((n) => window.harness.awaitInitialized(n), name),
    countLitPixels: () => page.evaluate(() => window.harness.countLitPixels()),
    residentChunks: (name: string) =>
      page.evaluate((n) => window.harness.residentChunks(n), name),
    waitIdle: (opts: { timeoutMs?: number; settleMs?: number } = {}) =>
      page.evaluate((o) => window.harness.waitIdle(o), opts),
    renderUntilIdle: (opts: { timeoutMs?: number; idleFrames?: number } = {}) =>
      page.evaluate((o) => window.harness.renderUntilIdle(o), opts),
    isBusy: () => page.evaluate(() => window.harness.isBusy()),
    waitQuiet: (
      opts: {
        settleMs?: number;
        timeoutMs?: number;
        ignoreLoop?: boolean;
      } = {},
    ) => page.evaluate((o) => window.harness.waitQuiet(o), opts),
    sleep: (ms: number) => page.evaluate((t) => window.harness.sleep(t), ms),
    checkInvariants: () =>
      page.evaluate(() => window.harness.checkInvariants()),
    hooks: {
      hold: (name: string) =>
        page.evaluate((n) => window.harness.hooks.hold(n), name),
      unhold: (name: string) =>
        page.evaluate((n) => window.harness.hooks.unhold(n), name),
      unholdAll: () => page.evaluate(() => window.harness.hooks.unholdAll()),
      release: (name?: string, count = 1) =>
        page.evaluate(([n, c]) => window.harness.hooks.release(n, c), [
          name,
          count,
        ] as const),
      releaseAll: () => page.evaluate(() => window.harness.hooks.releaseAll()),
      heldCount: (name?: string) =>
        page.evaluate((n) => window.harness.hooks.heldCount(n), name),
      heldNames: () => page.evaluate(() => window.harness.hooks.heldNames()),
      failNext: (name: string, message?: string, count = 1) =>
        page.evaluate(([n, m, c]) => window.harness.hooks.failNext(n, m, c), [
          name,
          message,
          count,
        ] as const),
      rejectHeld: (name: string, message?: string) =>
        page.evaluate(([n, m]) => window.harness.hooks.rejectHeld(n, m), [
          name,
          message,
        ] as const),
      /** Wait until at least `count` executions are parked at `name` */
      waitHeld: (name: string, count = 1, timeout = 15_000) =>
        page.waitForFunction(
          ([n, c]) => window.harness.hooks.heldCount(n) >= c,
          [name, count] as const,
          { timeout, polling: 10 },
        ),
      log: () => page.evaluate(() => window.harness.hooks.log),
    },
  };
}

/** Poll a snapshot-derived predicate until true or timeout. */
export async function waitForSnapshot(
  page: Page,
  predicate: (s: Snapshot) => boolean,
  { timeoutMs = 15_000, intervalMs = 50, label = "condition" } = {},
): Promise<Snapshot> {
  const start = Date.now();
  let last: Snapshot | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(() => window.harness.snapshot());
    if (predicate(last)) return last;
    await page.waitForTimeout(intervalMs);
  }
  throw new Error(
    `Timed out waiting for ${label}. Last snapshot: ${JSON.stringify(last, null, 1)}`,
  );
}

/** Assert no page errors / console errors / harness-captured errors. */
export function expectNoErrors(opened: OpenedHarness, snapshot: Snapshot) {
  expect(opened.pageErrors, "pageerror").toEqual([]);
  expect(
    snapshot.errors.filter((e) => !isBenignError(e)),
    "harness errors",
  ).toEqual([]);
}

function isBenignError(message: string) {
  // Chrome/SwiftShader occasionally logs GL performance warnings as errors
  return /GL_|performance warning|GPU stall/i.test(message);
}

export async function expectInvariants(page: Page) {
  const result = await page.evaluate(() => window.harness.checkInvariants());
  expect(result.errors, "invariants").toEqual([]);
  return result;
}

/**
 * Hold chunk requests matching `glob`. Returns a controller to release them
 * (individually, in order, or all at once), or fail them.
 */
export async function holdRequests(
  page: Page,
  glob = CHUNK_URL_GLOB,
  filter: (url: string) => boolean = () => true,
) {
  type Held = {
    url: string;
    go: () => Promise<void>;
    fail: () => Promise<void>;
  };
  const held: Held[] = [];
  let holding = true;
  const waiters: (() => void)[] = [];

  await page.route(glob, async (route) => {
    const url = route.request().url();
    if (!holding || !filter(url)) {
      await route.continue();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      held.push({
        url,
        go: async () => {
          await route.continue();
          resolve();
        },
        fail: async () => {
          await route.abort();
          reject(new Error("aborted by test"));
        },
      });
      for (const w of waiters.splice(0)) w();
    }).catch(() => {});
  });

  const controller = {
    held,
    heldUrls: () => held.map((h) => h.url),
    /** wait until at least `count` requests are held */
    async waitHeld(count = 1, timeoutMs = 15_000) {
      const start = Date.now();
      while (held.length < count) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `Timed out waiting for ${count} held requests (have ${held.length}: ${held.map((h) => h.url).join(", ")})`,
          );
        }
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
    },
    async releaseOne(match?: (url: string) => boolean) {
      const index = match ? held.findIndex((h) => match(h.url)) : 0;
      if (index < 0 || index >= held.length) return undefined;
      const [h] = held.splice(index, 1);
      await h.go();
      return h.url;
    },
    async releaseAll() {
      const all = held.splice(0);
      for (const h of all) await h.go();
      return all.map((h) => h.url);
    },
    async failAll() {
      const all = held.splice(0);
      for (const h of all) await h.fail();
    },
    /** stop holding new requests (already-held ones stay held) */
    passthrough() {
      holding = false;
    },
    resume() {
      holding = true;
    },
    async dispose() {
      holding = false;
      await controller.releaseAll();
      await page.unroute(glob);
    },
  };
  return controller;
}

export function chunkIndexFromUrl(url: string): number {
  const match = /fixture-lod-(\d+)\.radc/.exec(url);
  return match ? Number(match[1]) : -1;
}
