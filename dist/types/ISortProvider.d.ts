export interface ISortProvider {
    init(): Promise<boolean>;
    preallocate?(maxSplats: number): void;
    sort(readback: Uint32Array, numSplats: number, ordering: Uint32Array): Promise<{
        ordering: Uint32Array;
        activeSplats: number;
    }>;
    dispose(): void;
}
