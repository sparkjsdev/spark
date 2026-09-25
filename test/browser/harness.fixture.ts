import {
  type ConsoleMessage,
  type Page,
  type Route,
  test as base,
  expect,
} from "@playwright/test";

type Fixtures = {
  /** Every console message emitted by the page, in order. */
  consoleMessages: ConsoleMessage[];
  /** A page with the harness loaded; fails the test on page errors or console warnings/errors. */
  harnessPage: Page;
};

export const test = base.extend<Fixtures>({
  consoleMessages: async ({ page }, use) => {
    const messages: ConsoleMessage[] = [];
    page.on("console", (msg) => messages.push(msg));
    await use(messages);
  },

  harnessPage: async ({ page, consoleMessages }, use) => {
    const errors: Error[] = [];
    const firstError = new Promise<never>((_, reject) =>
      page.once("pageerror", reject),
    );
    page.on("pageerror", (error) => errors.push(error));

    await exposeHoldRequest(page);
    await page.goto("/test/browser/harness.html");
    await Promise.race([
      page.waitForFunction(() => window.harness),
      firstError,
    ]);
    expect(
      await page.evaluate(() => window.harness.hooksEnabled),
      "Vite must be started with SPARK_ENABLE_HOOKS=1 (see playwright.config.ts)",
    ).toBe(true);

    await use(page);

    expect(errors).toEqual([]);
    const problems = consoleMessages.filter(
      (msg) =>
        ["warning", "error"].includes(msg.type()) &&
        // Chromium GPU performance notices (e.g. "GPU stall due to ReadPixels")
        !msg.text().includes("GL Driver Message"),
    );
    expect(problems.map((msg) => `${msg.type()}: ${msg.text()}`)).toEqual([]);
  },
});

/**
 * Hold back the first request matching `url` until `release()` is called;
 * later matching requests pass through. `requested` resolves once the held
 * request has been issued.
 */
async function holdRequest(page: Page, url: string) {
  let held: Route | undefined;
  let onRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    onRequested = resolve;
  });
  await page.route(url, (route) => {
    if (held) return route.continue();
    held = route;
    onRequested();
  });
  return {
    requested,
    release: async () => {
      await requested;
      await held?.continue();
    },
  };
}

/**
 * Make holdRequest() callable from page code as `Harness.holdRequest()`.
 * Requests are intercepted in Node, so the page only sees an id per hold.
 */
async function exposeHoldRequest(page: Page) {
  const holds: Awaited<ReturnType<typeof holdRequest>>[] = [];
  await page.exposeFunction("__holdRequest", async (url: string) => {
    holds.push(await holdRequest(page, url));
    return holds.length - 1;
  });
  await page.exposeFunction(
    "__awaitRequested",
    (id: number) => holds[id].requested,
  );
  await page.exposeFunction("__releaseRequest", (id: number) =>
    holds[id].release(),
  );
}

/** Decode the PNG data URL returned by `Harness.getPixels()` for `toMatchSnapshot`. */
export function pngBuffer(dataUrl: string) {
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

export { expect };
