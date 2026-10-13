import { afterEach, describe, expect, test, vi } from "vitest";
import { PagedSplats } from "../../src/PagedSplats";
import {
  FileBytesPagedSplatsFetcher,
  type PagedSplatsFetcher,
  UrlPagedSplatsFetcher,
} from "../../src/PagedSplatsFetcher";
import { SplatFileType } from "../../src/defines";

const fileBytes = new Uint8Array(4);
const rootUrl = "https://assets.invalid/scene-lod-0.spz";
const customFetchSource = new (class implements PagedSplatsFetcher {
  fetchRange(
    abortSignal: AbortSignal,
    offset: number,
    bytes: number,
  ): Promise<Uint8Array> {
    return Promise.resolve(fileBytes);
  }
  fetchChunkFile(abortSignal: AbortSignal, chunk: string): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  fetchChunkById(abortSignal: AbortSignal, chunk: number): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
})();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PagedSplats constructor", () => {
  test("creates FileBytesPagedSplatsFetcher when fileBytes are provided", async () => {
    const pagedSplats = new PagedSplats({
      fileBytes,
      fileType: SplatFileType.RAD,
    });
    expect(pagedSplats.fetchSource).instanceOf(FileBytesPagedSplatsFetcher);
  });

  test("creates UrlPagedSplatsFetcher when rootUrl is provided", async () => {
    const pagedSplats = new PagedSplats({ rootUrl });
    expect(pagedSplats.fetchSource).instanceOf(UrlPagedSplatsFetcher);
  });

  test("uses fileBytes over fetchSource or rootUrl", async () => {
    const pagedSplats = new PagedSplats({
      fileBytes,
      fetchSource: customFetchSource,
      rootUrl,
      fileType: SplatFileType.RAD,
    });
    expect(pagedSplats.fetchSource).instanceOf(FileBytesPagedSplatsFetcher);
  });

  test("uses fetchSource over rootUrl", async () => {
    const pagedSplats = new PagedSplats({
      fetchSource: customFetchSource,
      rootUrl,
      fileType: SplatFileType.RAD,
    });
    expect(pagedSplats.fetchSource).toBe(customFetchSource);
  });

  test("throws if no source is provided", async () => {
    expect(() => new PagedSplats({})).toThrow(
      "No url, fileBytes or fetchSource provided",
    );
  });

  test("throws if file type can't be inferred", async () => {
    expect(() => new PagedSplats({ fileBytes })).toThrow(
      "Unable to determine file type",
    );
  });
});
