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
    fetchRange(abortSignal: AbortSignal, offset: number, bytes: number): Promise<Uint8Array>;
    fetchChunkFile(abortSignal: AbortSignal, chunk: string): Promise<Uint8Array>;
    fetchChunkById(abortSignal: AbortSignal, chunk: number): Promise<Uint8Array>;
}
export declare class FileBytesPagedSplatsFetcher implements PagedSplatsFetcher {
    private readonly fileBytes;
    constructor(fileBytes: Uint8Array);
    fetchRange(abortSignal: AbortSignal, offset: number, bytes: number): Promise<Uint8Array<ArrayBuffer>>;
    fetchChunkFile(abortSignal: AbortSignal, chunk: string): Promise<Uint8Array>;
    fetchChunkById(abortSignal: AbortSignal, chunk: number): Promise<Uint8Array>;
}
export declare class UrlPagedSplatsFetcher implements PagedSplatsFetcher {
    readonly rootUrl: string;
    readonly requestHeader: Record<string, string> | undefined;
    readonly withCredentials: boolean | undefined;
    constructor(rootUrl: string, requestHeader: Record<string, string> | undefined, withCredentials: boolean | undefined);
    fetchRange(abortSignal: AbortSignal, offset: number, bytes: number): Promise<Uint8Array<ArrayBufferLike>>;
    fetchChunkFile(abortSignal: AbortSignal, chunk: string): Promise<Uint8Array>;
    fetchChunkById(abortSignal: AbortSignal, chunk: number): Promise<Uint8Array>;
    fetchRangeImpl({ url, requestHeader, withCredentials, offset, bytes, signal, }: {
        url: string;
        requestHeader?: Record<string, string>;
        withCredentials?: boolean;
        offset?: number;
        bytes?: number;
        signal?: AbortSignal;
    }): Promise<Uint8Array>;
}
