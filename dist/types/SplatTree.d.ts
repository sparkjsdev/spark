import { SplatMesh } from './SplatMesh';
import * as THREE from 'three';
declare class SplatTreeNode {
    static idGen: number;
    min: THREE.Vector3;
    max: THREE.Vector3;
    boundingBox: THREE.Box3;
    center: THREE.Vector3;
    depth: number;
    children: SplatTreeNode[];
    data: {
        indexes: number[];
    };
    id: number;
    constructor(min: THREE.Vector3, max: THREE.Vector3, depth: number, id: number);
}
declare class SplatSubTree {
    maxDepth: number;
    maxCentersPerNode: number;
    sceneDimensions: THREE.Vector3;
    sceneMin: THREE.Vector3;
    sceneMax: THREE.Vector3;
    rootNode: SplatTreeNode | null;
    nodesWithIndexes: SplatTreeNode[];
    splatMesh: SplatMesh | null;
    constructor(maxDepth: number, maxCentersPerNode: number);
    static convertWorkerSubTreeNode(workerSubTreeNode: any): SplatTreeNode;
    static convertWorkerSubTree(workerSubTree: any, splatMesh: SplatMesh): SplatSubTree;
}
export declare class SplatTree {
    maxDepth: number;
    maxCentersPerNode: number;
    subTrees: SplatSubTree[];
    splatMesh: SplatMesh | null;
    disposed: boolean;
    splatTreeWorker: Worker | null;
    constructor(maxDepth: number, maxCentersPerNode: number);
    dispose(): void;
    diposeSplatTreeWorker(): void;
    /**
     * Build SplatTree (octree) from a SplatMesh instance.
     *
     * @param {SplatMesh} splatMesh SplatMesh instance to build octree from
     * @param {function} filterFunc Optional, filter out unwanted splats (points), return true to keep
     * @param {function} onIndexesUpload Callback when uploading splat centers to worker (start/end)
     * @param {function} onSplatTreeConstruction Callback when worker is building local splat tree (start/end)
     * @return {Promise<void>} Promise that resolves when octree building is complete
     */
    processSplatMesh(splatMesh: SplatMesh, filterFunc?: (index: number) => boolean, onIndexesUpload?: (isUploading: boolean) => void, onSplatTreeConstruction?: (isBuilding: boolean) => void): Promise<void>;
    countLeaves(): number;
    visitLeaves(visitFunc: (node: SplatTreeNode) => void): void;
}
export {};
