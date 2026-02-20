export declare class OldSplatWorker {
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
export declare function allocWorker(): Promise<OldSplatWorker>;
export declare function freeWorker(worker: OldSplatWorker): void;
export declare function withWorker<T>(callback: (worker: OldSplatWorker) => Promise<T>): Promise<T>;
