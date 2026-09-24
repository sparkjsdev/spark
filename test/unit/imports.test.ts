import { describe, expect, test, vi } from "vitest";

// Stub the wasm package, as only the TypeScript modules are tested here.

// The JS wrapper. Its init must return a promise.
vi.mock("spark-rs", () => ({ default: vi.fn(async () => ({})) }));

// The binary, compiled on load. An empty module: magic number and version 1.
vi.mock("spark-rs/spark_rs_bg.wasm?arraybuffer&base64", () => ({
  default: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
}));

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
