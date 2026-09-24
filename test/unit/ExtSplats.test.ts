import { afterEach, describe, expect, test, vi } from "vitest";
import { ExtSplats } from "../../src/ExtSplats";
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

describe("ExtSplats credentials", () => {
  test("sets both options on its loader", async () => {
    const loader = spyOnLoad();
    await new ExtSplats({ url, withCredentials: true, requestHeader })
      .initialized;
    expect(loader().withCredentials).toBe(true);
    expect(loader().requestHeader).toEqual(requestHeader);
  });

  test("keeps the loader defaults when the options are unset", async () => {
    const loader = spyOnLoad();
    await new ExtSplats({ url }).initialized;
    expect(loader().withCredentials).toBe(false);
    expect(loader().requestHeader).toEqual({});
  });
});
