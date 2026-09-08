import { rpcHandlers } from './worker';
type PromiseRecord = {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    onStatus?: (data: unknown) => void;
};
export declare class SplatWorker {
    worker: Worker;
    queue: (() => void)[] | null;
    messages: Record<number, PromiseRecord>;
    static currentId: number;
    constructor();
    onMessage(event: MessageEvent): void;
    tryExclusive<T>(callback: (worker: SplatWorker) => Promise<T>): Promise<T> | null;
    exclusive<T>(callback: (worker: SplatWorker) => Promise<T>): Promise<T>;
    call<T extends keyof rpcHandlers, R extends ReturnType<rpcHandlers[T]>>(name: T, args: Parameters<rpcHandlers[T]>[0], options?: {
        onStatus?: (data: unknown) => void;
    }): Promise<R>;
    dispose(): void;
}
export declare class SplatWorkerPool {
    maxWorkers: number;
    numWorkers: number;
    freelist: SplatWorker[];
    queue: ((worker: SplatWorker) => void)[];
    constructor(maxWorkers?: number);
    withWorker<T>(callback: (worker: SplatWorker) => Promise<T>): Promise<T>;
    allocWorker(): Promise<SplatWorker>;
    freeWorker(worker: SplatWorker): void;
}
export declare const workerPool: SplatWorkerPool;
export {};
