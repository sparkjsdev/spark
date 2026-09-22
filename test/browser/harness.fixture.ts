import {
  type ConsoleMessage,
  type Page,
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

    await page.goto("/test/browser/harness.html");
    await Promise.race([
      page.waitForFunction(() => window.harness),
      firstError,
    ]);

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

export { expect };
