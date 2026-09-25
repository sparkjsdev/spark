import { afterEach, describe, expect, test, vi } from "vitest";
import { ExtSplats } from "../../src/ExtSplats";
import { PackedSplats } from "../../src/PackedSplats";
import { SplatMesh } from "../../src/SplatMesh";
import { PagedSplats } from "../../src/SplatPager";

const url = "https://assets.invalid/scene.spz";
const requestHeader = { Authorization: "Bearer token" };
const credentials = { withCredentials: true, requestHeader };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SplatMesh credentials", () => {
  test.each([
    ["PackedSplats", PackedSplats, {}],
    ["ExtSplats", ExtSplats, { extSplats: true }],
  ])("reach its %s", async (_, Splats, options) => {
    const reinitialize = vi
      .spyOn(Splats.prototype, "reinitialize")
      .mockImplementation(() => {});
    await new SplatMesh({ url, ...credentials, ...options }).initialized;
    expect(reinitialize).toHaveBeenCalledWith(
      expect.objectContaining(credentials),
    );
  });

  test("reach the PagedSplats it builds", () => {
    const { paged } = new SplatMesh({ url, paged: true, ...credentials });
    expect(paged?.withCredentials).toBe(true);
    expect(paged?.requestHeader).toEqual(requestHeader);
  });

  test("leave a PagedSplats passed in unchanged", () => {
    const paged = new PagedSplats({ rootUrl: url });
    const mesh = new SplatMesh({ url, paged, ...credentials });
    expect(mesh.paged).toBe(paged);
    expect(paged.withCredentials).toBeUndefined();
    expect(paged.requestHeader).toBeUndefined();
  });
});
