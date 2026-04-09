import { ISortProvider } from './ISortProvider';
/**
 * Default sort provider that delegates to the WASM worker.
 */
export declare class WorkerSortProvider implements ISortProvider {
    private worker;
    private ensureWorker;
    init(): Promise<boolean>;
    sort(readback: Uint32Array, numSplats: number, ordering: Uint32Array): Promise<{
        ordering: Uint32Array;
        activeSplats: number;
    }>;
    dispose(): void;
}
