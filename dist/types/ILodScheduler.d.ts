export interface ILodScheduler {
    schedule(task: () => Promise<void>): Promise<boolean>;
    dispose(): void;
}
/**
 * Default scheduler that preserves Spark's historical LOD behavior:
 * if a traversal job is already in flight, newer requests are skipped.
 */
export declare class DropIfBusyLodScheduler implements ILodScheduler {
    private running;
    schedule(task: () => Promise<void>): Promise<boolean>;
    dispose(): void;
}
