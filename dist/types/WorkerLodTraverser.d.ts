import { ILodTraverser, LodInstance, LodTraverseResult } from './ILodTraverser';
/**
 * Default LOD traverser that delegates to the WASM worker.
 */
export declare class WorkerLodTraverser implements ILodTraverser {
    private worker;
    private ensureWorker;
    init(): Promise<boolean>;
    newTree(capacity: number): Promise<number>;
    uploadTree(_lodId: number, lodTree: Uint32Array, numSplats: number): Promise<number>;
    newSharedTree(lodId: number): Promise<number>;
    updateTrees(ranges: {
        lodId: number;
        pageBase: number;
        chunkBase: number;
        count: number;
        lodTreeData?: Uint32Array;
    }[]): Promise<void>;
    traverse(instances: Record<string, LodInstance>, maxSplats: number, pixelScaleLimit: number, lastPixelLimit?: number): Promise<LodTraverseResult>;
    removeTree(lodId: number): Promise<void>;
    getLodTreeLevel(lodId: number, level: number): Promise<{
        indices: Uint32Array;
    }>;
    dispose(): void;
}
