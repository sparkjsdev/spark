import { describe, expect, test } from "vitest";
import {
  decodeExtRgb,
  encodeExtRgb,
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

describe("encodeExtRgb", () => {
  // Magnitude steps per channel
  const STEPS = 255;
  // Lowest and highest ceilings
  const LOWEST_CEILING = 2 ** -15;
  const HIGHEST_CEILING = 2 ** 16;
  // Each input with the smallest ceiling that holds its largest channel
  const cases: [number[], number][] = [
    [[0.9, -0.6, -0.2], 1],
    [[0.999, -0.6, -0.2], 1],
    [[1.9, -1.2, -0.7], 2],
    [[0.04, -0.035, -0.01], 0.0625],
    [[0.5, -0.25, -0.1], 0.5],
    [[0.5000001, -0.3, -0.1], 1],
    [[5e-5, -4e-5, -1e-5], 2 * LOWEST_CEILING],
    [[0, 0, 0], LOWEST_CEILING],
    [[1e-6, -5e-7, -1e-7], LOWEST_CEILING],
    [[60000, -30000, -1000], HIGHEST_CEILING],
  ];
  // Also negated, and with the largest channel in each position
  const inputs = cases.flatMap(([rgb, ceiling]) =>
    [rgb, rgb.map((x) => -x)].flatMap(([a, b, c]) =>
      [
        [a, b, c],
        [c, a, b],
        [b, c, a],
      ].map((input) => ({ input, ceiling })),
    ),
  );
  test.each(inputs)(
    "decodes $input within half a step",
    ({ input, ceiling }) => {
      const { r, g, b } = decodeExtRgb(
        encodeExtRgb(input[0], input[1], input[2]),
      );
      const decoded = [r, g, b];
      for (let i = 0; i < 3; ++i) {
        expect(Math.abs(decoded[i] - input[i])).toBeLessThanOrEqual(
          ceiling / STEPS / 2,
        );
        if (decoded[i] !== 0) {
          expect(decoded[i] < 0).toBe(input[i] < 0);
        }
      }
    },
  );
});
