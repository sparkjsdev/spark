import { vi } from "vitest";

// Stub the wasm package, as only the TypeScript modules are tested here.

// The JS wrapper. Its init must return a promise. Add an export here as a
// vi.fn() when a test calls it, and set its result in the test.
vi.mock("spark-rs", () => ({ default: vi.fn(async () => ({})) }));

// The binary, compiled on load. An empty module: magic number and version 1.
vi.mock("spark-rs/spark_rs_bg.wasm?arraybuffer&base64", () => ({
  default: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
}));
