import { describe, expect, test, vi } from "vitest";

// Each module must load on its own. The worker entry only runs in a Web Worker.
const modules = import.meta.glob([
  "../../src/**/*.ts",
  "!**/*.d.ts",
  "!../../src/worker.ts",
]);

describe("module imports", () => {
  test("finds the source modules", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  for (const [path, load] of Object.entries(modules)) {
    test(`${path} loads on its own`, async () => {
      vi.resetModules();
      await load();
    });
  }
});
