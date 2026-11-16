import { describe, expect, test, vi } from "vitest";
import { ExtSplats } from "../../src/ExtSplats.js";
import { PackedSplats } from "../../src/PackedSplats.js";
import { PagedSplats } from "../../src/PagedSplats.js";
import { UrlPagedSplatsFetcher } from "../../src/PagedSplatsFetcher.js";
import { SplatMesh } from "../../src/SplatMesh.js";

const url = "https://assets.invalid/scene.spz";
const requestHeader = { Authorization: "Bearer token" };
const credentials = { withCredentials: true, requestHeader };

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
    expect(paged?.fetchSource).toBeInstanceOf(UrlPagedSplatsFetcher);
    const urlFetchSource = paged?.fetchSource as UrlPagedSplatsFetcher;
    expect(urlFetchSource.withCredentials).toBe(true);
    expect(urlFetchSource.requestHeader).toEqual(requestHeader);
  });

  test("leave a PagedSplats passed in unchanged", () => {
    const paged = new PagedSplats({ rootUrl: url });
    const mesh = new SplatMesh({ url, paged, ...credentials });
    expect(mesh.paged).toBe(paged);
    expect(paged.fetchSource).toBeInstanceOf(UrlPagedSplatsFetcher);
    const urlFetchSource = paged.fetchSource as UrlPagedSplatsFetcher;
    expect(urlFetchSource.withCredentials).toBeUndefined();
    expect(urlFetchSource.requestHeader).toBeUndefined();
  });
});
