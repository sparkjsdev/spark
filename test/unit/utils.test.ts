import { describe, expect, test } from "vitest";
import {
  floatToUint8,
  setPackedSplatOpacity,
  unpackSplat,
} from "../../src/utils.js";

describe("floatToUint8", () => {
  test("returns integer 0 for float value 0", () => {
    expect(floatToUint8(0)).toBe(0);
  });
  test("returns integer 255 for float value 1", () => {
    expect(floatToUint8(1)).toBe(255);
  });
});

describe("setPackedSplatOpacity", () => {
  test("reads back the opacity it set with lodOpacity", () => {
    const encoding = { lodOpacity: true };
    for (const opacity of [0, 0.25, 1, 1.5, 2]) {
      const packed = new Uint32Array(4);
      setPackedSplatOpacity(packed, 0, opacity, encoding);
      expect(unpackSplat(packed, 0, encoding).opacity).toBeCloseTo(opacity, 2);
    }
  });
  test("reads back the opacity it set without an encoding", () => {
    for (const opacity of [0, 0.25, 1]) {
      const packed = new Uint32Array(4);
      setPackedSplatOpacity(packed, 0, opacity);
      expect(unpackSplat(packed, 0).opacity).toBeCloseTo(opacity, 2);
    }
  });
});
