import { afterEach, describe, expect, test, vi } from "vitest";
import {
  FileBytesPagedSplatsFetcher,
  UrlPagedSplatsFetcher,
} from "../../src/PagedSplatsFetcher";

const fileBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
const rootUrl = "https://assets.invalid/path/to/splats.rad";
const spzRootUrl = "https://assets.invalid/splats-lod-0.spz";
const abortSignal = new AbortController().signal;

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, data: Uint8Array | undefined) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `status code ${status}`,
      body: data,
      arrayBuffer: () => Promise.resolve(data),
    }) as unknown as Promise<Response>;
  });
}

function mockLocation(url: string) {
  globalThis.location = new URL(url) as unknown as Location;
}

describe("FileBytesPagedSplatsFetcher", () => {
  test("returns requested range", async () => {
    const fetcher = new FileBytesPagedSplatsFetcher(fileBytes);

    const bytes = await fetcher.fetchRange(abortSignal, 1, 3);
    expect(bytes).toEqual(new Uint8Array([0x01, 0x02, 0x03]));
  });

  test("returns available bytes when range exceeds file", async () => {
    const fetcher = new FileBytesPagedSplatsFetcher(fileBytes);

    const bytes = await fetcher.fetchRange(abortSignal, 0, 12);
    expect(bytes).toEqual(fileBytes);
  });

  test("throws on fetchChunkFile and fetchChunkById", async () => {
    const fetcher = new FileBytesPagedSplatsFetcher(fileBytes);

    await expect(() =>
      fetcher.fetchChunkFile(abortSignal, "dummy"),
    ).rejects.toThrow();
    await expect(() =>
      fetcher.fetchChunkById(abortSignal, 1),
    ).rejects.toThrow();
  });
});

describe("UrlPagedSplatsFetcher", () => {
  test("makes http range request when fetching range", async () => {
    const fetcher = new UrlPagedSplatsFetcher(rootUrl, {}, false);

    const fetch = mockFetch(206, fileBytes);
    const bytes = await fetcher.fetchRange(abortSignal, 0, 64);

    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(Request));
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.headers.get("Range")).toBe("bytes=0-63");
    expect(request.credentials).toBe("same-origin");
    expect(bytes).toEqual(fileBytes);
  });

  test("sets credentials to 'include' when withCredentials is true", async () => {
    const fetcher = new UrlPagedSplatsFetcher(rootUrl, {}, true);

    const fetch = mockFetch(206, fileBytes);
    await fetcher.fetchRange(abortSignal, 0, 64);

    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(Request));
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.credentials).toBe("include");
  });

  test("includes custom headers", async () => {
    const fetcher = new UrlPagedSplatsFetcher(
      rootUrl,
      { "X-Custom-Header": "some-value" },
      true,
    );

    const fetch = mockFetch(206, fileBytes);
    await fetcher.fetchRange(abortSignal, 0, 64);

    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(Request));
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.headers.get("X-Custom-Header")).toBe("some-value");
  });

  test("throws if response was not ok", async () => {
    const fetcher = new UrlPagedSplatsFetcher(rootUrl, {}, true);

    mockFetch(503, fileBytes);
    await expect(() =>
      fetcher.fetchRange(abortSignal, 0, 64),
    ).rejects.toThrow();
  });

  test("request chunk by file name relative to rootUrl", async () => {
    const fetcher = new UrlPagedSplatsFetcher(rootUrl, {}, false);

    const fetch = mockFetch(206, fileBytes);
    mockLocation("https://site.invalid/");
    await fetcher.fetchChunkFile(abortSignal, "../chunks/01/splats.radc");

    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(Request));
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toBe(
      "https://assets.invalid/path/chunks/01/splats.radc",
    );
  });

  test("request chunk by file name relative to rootUrl relative to window location", async () => {
    const fetcher = new UrlPagedSplatsFetcher("../splats.rad", {}, false);

    const fetch = mockFetch(206, fileBytes);
    mockLocation("https://site.invalid/base/app/index.html");
    await fetcher.fetchChunkFile(abortSignal, "chunks/01/splats.radc");

    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(Request));
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toBe("https://site.invalid/base/chunks/01/splats.radc");
  });

  test("request chunk by id", async () => {
    const fetcher = new UrlPagedSplatsFetcher(spzRootUrl, {}, false);

    const fetch = mockFetch(206, fileBytes);
    await fetcher.fetchChunkById(abortSignal, 42);

    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(Request));
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toBe("https://assets.invalid/splats-lod-42.spz");
  });
});
