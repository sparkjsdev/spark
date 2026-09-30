/**
 * Interface for paged splats fetch logic.
 *
 * @note When a range is requested it can exceed the file size. Implementations
 *       are expected to return the bytes that exist and not throw in this case.
 * @note The PagedSplats assumes full control over the returned arrays and underlying buffers.
 *       Make sure to return copies and not views when the buffers are still needed afterwards.
 * @note While performing any of the fetches the `abortSignal` might indicate that the request
 *       has been aborted. Implementations can either run to completion or throw an `AbortError`.
 *       Any other thrown error in this situation is unexpected and logged as a warning.
 */
export interface PagedSplatsFetcher {
  fetchRange(
    abortSignal: AbortSignal,
    offset: number,
    bytes: number,
  ): Promise<Uint8Array>;

  fetchChunkFile(abortSignal: AbortSignal, chunk: string): Promise<Uint8Array>;
  fetchChunkById(abortSignal: AbortSignal, chunk: number): Promise<Uint8Array>;
}

export class FileBytesPagedSplatsFetcher implements PagedSplatsFetcher {
  private readonly fileBytes: Uint8Array;

  constructor(fileBytes: Uint8Array) {
    this.fileBytes = fileBytes;
  }

  async fetchRange(abortSignal: AbortSignal, offset: number, bytes: number) {
    if (offset < 0 || (offset > 0 && offset + bytes > this.fileBytes.length)) {
      throw new Error(
        `Invalid chunk offset or bytes: ${offset} + ${bytes} > ${this.fileBytes.length}`,
      );
    }

    return this.fileBytes.slice(offset, offset + bytes);
  }

  async fetchChunkFile(
    abortSignal: AbortSignal,
    chunk: string,
  ): Promise<Uint8Array> {
    throw new Error("Chunked RAD file not supported with fileBytes");
  }

  async fetchChunkById(
    abortSignal: AbortSignal,
    chunk: number,
  ): Promise<Uint8Array> {
    throw new Error("Chunked RAD file not supported with fileBytes");
  }
}

export class UrlPagedSplatsFetcher implements PagedSplatsFetcher {
  readonly rootUrl: string;
  readonly requestHeader: Record<string, string> | undefined;
  readonly withCredentials: boolean | undefined;

  constructor(
    rootUrl: string,
    requestHeader: Record<string, string> | undefined,
    withCredentials: boolean | undefined,
  ) {
    this.rootUrl = rootUrl;
    this.requestHeader = requestHeader;
    this.withCredentials = withCredentials;
  }

  async fetchRange(abortSignal: AbortSignal, offset: number, bytes: number) {
    return await this.fetchRangeImpl({
      url: this.rootUrl,
      requestHeader: this.requestHeader,
      withCredentials: this.withCredentials,
      signal: abortSignal,
      offset,
      bytes,
    });
  }

  async fetchChunkFile(
    abortSignal: AbortSignal,
    chunk: string,
  ): Promise<Uint8Array> {
    const resolvedRoot = new URL(this.rootUrl, window.location.href).toString();
    const chunkUrl = new URL(chunk, resolvedRoot).toString();
    return await this.fetchRangeImpl({
      url: chunkUrl,
      requestHeader: this.requestHeader,
      withCredentials: this.withCredentials,
      signal: abortSignal,
    });
  }

  async fetchChunkById(
    abortSignal: AbortSignal,
    chunk: number,
  ): Promise<Uint8Array> {
    const chunkUrl = this.rootUrl.replace(/-lod-0\./, `-lod-${chunk}.`);
    return await this.fetchRangeImpl({
      url: chunkUrl,
      requestHeader: this.requestHeader,
      withCredentials: this.withCredentials,
      signal: abortSignal,
    });
  }

  async fetchRangeImpl({
    url,
    requestHeader,
    withCredentials,
    offset,
    bytes,
    signal,
  }: {
    url: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    offset?: number;
    bytes?: number;
    signal?: AbortSignal;
  }): Promise<Uint8Array> {
    const request = new Request(url, {
      headers: requestHeader ? new Headers(requestHeader) : undefined,
      credentials: withCredentials ? "include" : "same-origin",
      signal,
    });
    if (offset !== undefined && bytes !== undefined) {
      request.headers.set("Range", `bytes=${offset}-${offset + bytes - 1}`);
    }
    const response = await fetch(request);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch "${url}": ${response.status} ${response.statusText}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
