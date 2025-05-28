export declare class SplatWorker {
    worker: Worker;
    messages: Record<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
    }>;
    messageIdNext: number;
    constructor();
    makeMessageId(): number;
    makeMessagePromiseId(): {
        id: number;
        promise: Promise<unknown>;
    };
    onMessage(event: MessageEvent): void;
    call(name: string, args: unknown): Promise<unknown>;
}
export declare function setWorkerPool(count?: number): void;
export declare function allocWorker(): Promise<SplatWorker>;
export declare function freeWorker(worker: SplatWorker): void;
export declare function withWorker<T>(callback: (worker: SplatWorker) => Promise<T>): Promise<T>;
