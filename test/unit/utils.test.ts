import { describe, expect, test } from "vitest";
import { floatToUint8 } from "../../src/utils.js";

describe("floatToUint8", () => {
  test("returns integer 0 for float value 0", () => {
    expect(floatToUint8(0)).toBe(0);
  });
  test("returns integer 255 for float value 1", () => {
    expect(floatToUint8(1)).toBe(255);
  });
});
