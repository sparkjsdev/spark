import { afterEach, describe, expect, test, vi } from "vitest";
import { PackedSplats } from "../../src/PackedSplats";
import { SplatLoader } from "../../src/SplatLoader";

const url = "https://assets.invalid/scene.spz";
const requestHeader = { Authorization: "Bearer token" };

afterEach(() => {
  vi.restoreAllMocks();
});

// Returns the loader a load goes through, as it was when the load started.
function spyOnLoad() {
  const load = vi
    .spyOn(SplatLoader.prototype, "loadInternalAsync")
    .mockResolvedValue(undefined as never);
  return () => load.mock.contexts[0] as SplatLoader;
}

describe("PackedSplats credentials", () => {
  test("sets both options on its loader", async () => {
    const loader = spyOnLoad();
    await new PackedSplats({ url, withCredentials: true, requestHeader })
      .initialized;
    expect(loader().withCredentials).toBe(true);
    expect(loader().requestHeader).toEqual(requestHeader);
  });

  test("keeps the loader defaults when the options are unset", async () => {
    const loader = spyOnLoad();
    await new PackedSplats({ url }).initialized;
    expect(loader().withCredentials).toBe(false);
    expect(loader().requestHeader).toEqual({});
  });
});

// The WebGL upload reads getTextureSize(maxSplats) splats from packedArray.
describe("PackedSplats from a caller's packedArray", () => {
  const LAYER = 2048 * 2048;

  test("pads an array past one layer to whole layers, keeping every splat", () => {
    const n = LAYER + 3000;
    const packed = new Uint32Array(n * 4);
    packed[(n - 1) * 4] = 7;
    const splats = new PackedSplats({ packedArray: packed, numSplats: n });
    expect(splats.numSplats).toBe(n);
    expect(splats.maxSplats).toBe(2 * LAYER);
    expect(splats.packedArray?.length).toBe(2 * LAYER * 4);
    expect(splats.packedArray?.[(n - 1) * 4]).toBe(7);
  });

  test("pads a short array to whole rows instead of dropping the tail", () => {
    const splats = new PackedSplats({ packedArray: new Uint32Array(1000 * 4) });
    expect(splats.numSplats).toBe(1000);
    expect(splats.maxSplats).toBe(2048);
  });

  test("keeps an array that is already texture-sized", () => {
    const packed = new Uint32Array(2048 * 3 * 4);
    const splats = new PackedSplats({ packedArray: packed, numSplats: 5000 });
    expect(splats.packedArray).toBe(packed);
    expect(splats.numSplats).toBe(5000);
    expect(splats.maxSplats).toBe(2048 * 3);
  });
});
