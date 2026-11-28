import * as THREE from "three";
import { describe, expect, test, vi } from "vitest";
import { ExtSplats } from "../../src/ExtSplats";
import { PackedSplats } from "../../src/PackedSplats";
import { PagedSplats } from "../../src/PagedSplats";
import { UrlPagedSplatsFetcher } from "../../src/PagedSplatsFetcher";
import { SplatMesh } from "../../src/SplatMesh";

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

describe("SplatMesh.getBoundingBox", () => {
  test.each([
    ["PackedSplats", PackedSplats, "packedSplats"],
    ["ExtSplats", ExtSplats, "extSplats"],
  ] as const)(
    "covers a mesh whose %s holds only LoD splats",
    async (_, Splats, option) => {
      const lodSplats = new Splats();
      for (const center of [
        new THREE.Vector3(-1, -2, -3),
        new THREE.Vector3(1, 2, 3),
      ]) {
        lodSplats.pushSplat(
          center,
          new THREE.Vector3(0.1, 0.1, 0.1),
          new THREE.Quaternion(),
          1,
          new THREE.Color(),
        );
      }
      const mesh = new SplatMesh({ [option]: new Splats({ lodSplats }) });
      await mesh.initialized;

      const box = mesh.getBoundingBox();
      expect(box.min.toArray()).toEqual([-1, -2, -3]);
      expect(box.max.toArray()).toEqual([1, 2, 3]);
    },
  );
  test("finds splats pushed into a mesh built without options", async () => {
    const mesh = new SplatMesh();
    for (const center of [
      new THREE.Vector3(-1, -2, -3),
      new THREE.Vector3(1, 2, 3),
    ]) {
      mesh.pushSplat(
        center,
        new THREE.Vector3(0.1, 0.1, 0.1),
        new THREE.Quaternion(),
        1,
        new THREE.Color(),
      );
    }
    await mesh.initialized;

    let count = 0;
    mesh.forEachSplat(() => count++);
    expect(count).toBe(2);
    const box = mesh.getBoundingBox();
    expect(box.min.toArray()).toEqual([-1, -2, -3]);
    expect(box.max.toArray()).toEqual([1, 2, 3]);
  });
});
