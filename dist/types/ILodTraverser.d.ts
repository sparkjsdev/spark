export interface LodInstance {
    instanceId: string;
    lodId: number;
    rootPage?: number;
    viewToObjectCols: number[];
    lodScale: number;
    behindFoveate: number;
    coneFov0: number;
    coneFov: number;
    coneFoveate: number;
}
export interface LodTraverseResult {
    keyIndices: Record<string, {
        lodId: number;
        numSplats: number;
        indices: Uint32Array;
    }>;
    chunks: [number, number][];
    pixelLimit?: number;
}
export interface ILodTraverser {
    init(): Promise<boolean>;
    newTree(capacity: number): Promise<number>;
    uploadTree(lodId: number, treeData: Uint32Array, numSplats: number): Promise<number>;
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
