type PromiseRecord = {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    onStatus?: (data: unknown) => void;
};
export declare class NewSplatWorker {
    worker: Worker;
    queue: (() => void)[] | null;
    messages: Record<number, PromiseRecord>;
    static currentId: number;
    constructor();
    onMessage(event: MessageEvent): void;
    tryExclusive<T>(callback: (worker: NewSplatWorker) => Promise<T>): Promise<T> | null;
    exclusive<T>(callback: (worker: NewSplatWorker) => Promise<T>): Promise<T>;
    call(name: string, args: unknown, options?: {
        onStatus?: (data: unknown) => void;
    }): Promise<unknown>;
    dispose(): void;
}
export declare class NewSplatWorkerPool {
    maxWorkers: number;
    numWorkers: number;
    freelist: NewSplatWorker[];
    queue: ((worker: NewSplatWorker) => void)[];
    constructor(maxWorkers?: number);
    withWorker<T>(callback: (worker: NewSplatWorker) => Promise<T>): Promise<T>;
    allocWorker(): Promise<NewSplatWorker>;
    freeWorker(worker: NewSplatWorker): void;
}
export declare const workerPool: NewSplatWorkerPool;
export {};
