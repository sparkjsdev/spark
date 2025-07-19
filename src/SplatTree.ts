import * as THREE from 'three'
import { SplatMesh } from './SplatMesh';


// delayedExecute function
const delayedExecute = (func: Function, fast?: boolean) => {
    return new Promise((resolve) => {
        window.setTimeout(() => {
            resolve(func ? func() : undefined);
        }, fast ? 1 : 50);
    });
};


// SplatTreeNode: Octree node
class SplatTreeNode {

    static idGen = 0; // node id generator
    min: THREE.Vector3; // min point of the node
    max: THREE.Vector3; // max point of the node
    boundingBox: THREE.Box3; // bounding box of the node
    center: THREE.Vector3; // center point of the node
    depth: number; // depth of the node
    children: SplatTreeNode[]; // children nodes
    data: { indexes: number[] }; // data of the node
    id: number; // id of the node

    constructor(min: THREE.Vector3, max: THREE.Vector3, depth: number, id: number) {
        this.min = new THREE.Vector3().copy(min);
        this.max = new THREE.Vector3().copy(max);
        this.boundingBox = new THREE.Box3(this.min, this.max);
        this.center = new THREE.Vector3().copy(this.max).sub(this.min).multiplyScalar(0.5).add(this.min);
        this.depth = depth;
        this.children = [];
        this.data = { indexes: [] };
        this.id = id || SplatTreeNode.idGen++;
    }

}
// SplatSubTree: Octree sub tree, contains root node, parameters, and associated SplatMesh
class SplatSubTree {
    maxDepth: number; // max depth of the sub tree
    maxCentersPerNode: number; // max centers per node of the sub tree
    sceneDimensions: THREE.Vector3; // dimensions of the scene
    sceneMin: THREE.Vector3; // min point of the scene
    sceneMax: THREE.Vector3; // max point of the scene
    rootNode: SplatTreeNode | null; // root node of the sub tree
    nodesWithIndexes: SplatTreeNode[]; // nodes with indexes
    splatMesh: SplatMesh | null; // associated SplatMesh

    constructor(maxDepth: number, maxCentersPerNode: number) {
        this.maxDepth = maxDepth;
        this.maxCentersPerNode = maxCentersPerNode;
        this.sceneDimensions = new THREE.Vector3();
        this.sceneMin = new THREE.Vector3();
        this.sceneMax = new THREE.Vector3();
        this.rootNode = null;
        this.nodesWithIndexes = [];
        this.splatMesh = null;
    }

    // convert worker sub tree node to main thread node
    static convertWorkerSubTreeNode(workerSubTreeNode: any) {
        const minVector = new THREE.Vector3().fromArray(workerSubTreeNode.min);
        const maxVector = new THREE.Vector3().fromArray(workerSubTreeNode.max);
        const convertedNode = new SplatTreeNode(minVector, maxVector, workerSubTreeNode.depth, workerSubTreeNode.id);
        if (workerSubTreeNode.data.indexes) {
            convertedNode.data = {
                'indexes': []
            };
            for (let index of workerSubTreeNode.data.indexes) {
                convertedNode.data.indexes.push(index);
            }
        }
        if (workerSubTreeNode.children && Array.isArray(workerSubTreeNode.children)) {
            for (let child of workerSubTreeNode.children) {
                // type assertion to avoid type error
                (convertedNode.children as SplatTreeNode[]).push(SplatSubTree.convertWorkerSubTreeNode(child));
            }
        }
        return convertedNode;
    }
    // convert worker sub tree object to main thread object
    static convertWorkerSubTree(workerSubTree: any, splatMesh: SplatMesh) {
        const convertedSubTree = new SplatSubTree(workerSubTree.maxDepth, workerSubTree.maxCentersPerNode);
        convertedSubTree.sceneMin = new THREE.Vector3().fromArray(workerSubTree.sceneMin);
        convertedSubTree.sceneMax = new THREE.Vector3().fromArray(workerSubTree.sceneMax);

        convertedSubTree.splatMesh = splatMesh;
        convertedSubTree.rootNode = SplatSubTree.convertWorkerSubTreeNode(workerSubTree.rootNode);

        // collect all leaves (with indexes)
        const visitLeavesFromNode = (node: SplatTreeNode, visitFunc: (node: SplatTreeNode) => void) => {
            if (node.children.length === 0) visitFunc(node);
            for (let child of node.children) {
                visitLeavesFromNode(child, visitFunc);
            }
        };

        convertedSubTree.nodesWithIndexes = [];
        visitLeavesFromNode(convertedSubTree.rootNode, (node) => {
            if (node.data && node.data.indexes && node.data.indexes.length > 0) {
                convertedSubTree.nodesWithIndexes.push(node);
            }
        });

        return convertedSubTree;
    }
}
// createSplatTreeWorker: Octree building logic for worker thread (string injection worker)
function createSplatTreeWorker(self: Worker) {

    let WorkerSplatTreeNodeIDGen = 0;

    class WorkerBox3 {
        min:number[]
        max:number[]

        constructor(min: number[], max: number[]) {
            this.min = [min[0], min[1], min[2]];
            this.max = [max[0], max[1], max[2]];
        }

        containsPoint(point: number[]) {
            return point[0] >= this.min[0] && point[0] <= this.max[0] &&
                   point[1] >= this.min[1] && point[1] <= this.max[1] &&
                   point[2] >= this.min[2] && point[2] <= this.max[2];
        }
    }

    class WorkerSplatSubTree {
        maxDepth:number
        maxCentersPerNode: number;
        sceneDimensions: number[];
        sceneMin: number[];
        sceneMax: number[];
        rootNode!: WorkerSplatTreeNode;
        addedIndexes: { [key: number]: boolean };
        nodesWithIndexes: WorkerSplatTreeNode[];
        splatMesh: SplatMesh | null;
        disposed: boolean;

        constructor(maxDepth: number, maxCentersPerNode: number) {
            this.maxDepth = maxDepth;
            this.maxCentersPerNode = maxCentersPerNode;
            this.sceneDimensions = [];
            this.sceneMin = [];
            this.sceneMax = [];
            this.addedIndexes = {};
            this.nodesWithIndexes = [];
            this.splatMesh = null;
            this.disposed = false;
        }

    }

    class WorkerSplatTreeNode {
        min: number[];
        max: number[];
        center: number[];
        depth: number;
        children: WorkerSplatTreeNode[];
        data: { indexes: number[] };
        id: number;

        constructor(min: number[], max: number[], depth: number, id?: number) {
            this.min = [min[0], min[1], min[2]];
            this.max = [max[0], max[1], max[2]];
            this.center = [(max[0] - min[0]) * 0.5 + min[0],
                           (max[1] - min[1]) * 0.5 + min[1],
                           (max[2] - min[2]) * 0.5 + min[2]];
            this.depth = depth;
            this.children = [];
            this.data = { indexes: [] };
            this.id = id || WorkerSplatTreeNodeIDGen++;
        }

    }

    function processSplatTreeNode(tree: WorkerSplatSubTree, node: WorkerSplatTreeNode, indexToCenter: number[], sceneCenters: Float32Array) {
        const splatCount = node.data?.indexes?.length ?? 0;

        if (splatCount < tree.maxCentersPerNode || node.depth > tree.maxDepth) {
            const newIndexes = [];
            for (let i = 0; i < node.data.indexes.length; i++) {
                if (!tree.addedIndexes[node.data.indexes[i]]) {
                    newIndexes.push(node.data.indexes[i]);
                    tree.addedIndexes[node.data.indexes[i]] = true;
                }
            }
            node.data.indexes = newIndexes;
            node.data.indexes.sort((a, b) => {
                if (a > b) return 1;
                else return -1;
            });
            tree.nodesWithIndexes.push(node);
            return;
        }

        const nodeDimensions = [node.max[0] - node.min[0],
                                node.max[1] - node.min[1],
                                node.max[2] - node.min[2]];
        const halfDimensions = [nodeDimensions[0] * 0.5,
                                nodeDimensions[1] * 0.5,
                                nodeDimensions[2] * 0.5];
        const nodeCenter = [node.min[0] + halfDimensions[0],
                            node.min[1] + halfDimensions[1],
                            node.min[2] + halfDimensions[2]];

        const childrenBounds = [
            // top section, clockwise from upper-left (looking from above, +Y)
            new WorkerBox3([nodeCenter[0] - halfDimensions[0], nodeCenter[1], nodeCenter[2] - halfDimensions[2]],
                           [nodeCenter[0], nodeCenter[1] + halfDimensions[1], nodeCenter[2]]),
            new WorkerBox3([nodeCenter[0], nodeCenter[1], nodeCenter[2] - halfDimensions[2]],
                           [nodeCenter[0] + halfDimensions[0], nodeCenter[1] + halfDimensions[1], nodeCenter[2]]),
            new WorkerBox3([nodeCenter[0], nodeCenter[1], nodeCenter[2]],
                           [nodeCenter[0] + halfDimensions[0], nodeCenter[1] + halfDimensions[1], nodeCenter[2] + halfDimensions[2]]),
            new WorkerBox3([nodeCenter[0] - halfDimensions[0], nodeCenter[1], nodeCenter[2]],
                           [nodeCenter[0], nodeCenter[1] + halfDimensions[1], nodeCenter[2] + halfDimensions[2]]),

            // bottom section, clockwise from lower-left (looking from above, +Y)
            new WorkerBox3([nodeCenter[0] - halfDimensions[0], nodeCenter[1] - halfDimensions[1], nodeCenter[2] - halfDimensions[2]],
                           [nodeCenter[0], nodeCenter[1], nodeCenter[2]]),
            new WorkerBox3([nodeCenter[0], nodeCenter[1] - halfDimensions[1], nodeCenter[2] - halfDimensions[2]],
                           [nodeCenter[0] + halfDimensions[0], nodeCenter[1], nodeCenter[2]]),
            new WorkerBox3([nodeCenter[0], nodeCenter[1] - halfDimensions[1], nodeCenter[2]],
                           [nodeCenter[0] + halfDimensions[0], nodeCenter[1], nodeCenter[2] + halfDimensions[2]]),
            new WorkerBox3([nodeCenter[0] - halfDimensions[0], nodeCenter[1] - halfDimensions[1], nodeCenter[2]],
                           [nodeCenter[0], nodeCenter[1], nodeCenter[2] + halfDimensions[2]]),
        ];

        const splatCounts: number[] = [];
        const baseIndexes: number[][] = [];
        for (let i = 0; i < childrenBounds.length; i++) {
            splatCounts[i] = 0;
            baseIndexes[i] = [];
        }

        const center = [0, 0, 0];
        for (let i = 0; i < splatCount; i++) {
            const splatGlobalIndex = node.data.indexes[i];
            const centerBase = indexToCenter[splatGlobalIndex];
            center[0] = sceneCenters[centerBase];
            center[1] = sceneCenters[centerBase + 1];
            center[2] = sceneCenters[centerBase + 2];
            for (let j = 0; j < childrenBounds.length; j++) {
                if (childrenBounds[j].containsPoint(center)) {
                    splatCounts[j]++;
                    baseIndexes[j].push(splatGlobalIndex);
                }
            }
        }
        

        for (let i = 0; i < childrenBounds.length; i++) {
            const childNode = new WorkerSplatTreeNode(childrenBounds[i].min, childrenBounds[i].max, node.depth + 1);
            childNode.data = {
                'indexes': baseIndexes[i]
            };  
            node.children.push(childNode);
        }

        node.data = { indexes: [] };
        for (let child of node.children) {
            processSplatTreeNode(tree, child, indexToCenter, sceneCenters);
        }

        // console.log('depth', node.depth, 'splatCount', splatCount, 'children:', splatCounts);
        return;
    };

    const buildSubTree = (sceneCenters: Float32Array, maxDepth: number, maxCentersPerNode: number) => {

        const sceneMin = [0, 0, 0];
        const sceneMax = [0, 0, 0];
        const indexes = [];
        const centerCount = Math.floor(sceneCenters.length / 4);
        for ( let i = 0; i < centerCount; i ++) {
            const base = i * 4;
            const x = sceneCenters[base];
            const y = sceneCenters[base + 1];
            const z = sceneCenters[base + 2];
            const index = Math.round(sceneCenters[base + 3]);
            if (i === 0 || x < sceneMin[0]) sceneMin[0] = x;
            if (i === 0 || x > sceneMax[0]) sceneMax[0] = x;
            if (i === 0 || y < sceneMin[1]) sceneMin[1] = y;
            if (i === 0 || y > sceneMax[1]) sceneMax[1] = y;
            if (i === 0 || z < sceneMin[2]) sceneMin[2] = z;
            if (i === 0 || z > sceneMax[2]) sceneMax[2] = z;
            indexes.push(index);
        }
        const subTree = new WorkerSplatSubTree(maxDepth, maxCentersPerNode);
        subTree.sceneMin = sceneMin;
        subTree.sceneMax = sceneMax;
        subTree.rootNode = new WorkerSplatTreeNode(subTree.sceneMin, subTree.sceneMax, 0);
        subTree.rootNode.data = {
            'indexes': indexes
        };
        // console.log('sceneMin', sceneMin, 'sceneMax', sceneMax);
        return subTree;
    };

    function createSplatTree(allCenters: Float32Array[], maxDepth: number, maxCentersPerNode: number) {
        const indexToCenter = [];
        for (let sceneCenters of allCenters) {
            const centerCount = Math.floor(sceneCenters.length / 4);
            for ( let i = 0; i < centerCount; i ++) {
                const base = i * 4;
                const index = Math.round(sceneCenters[base + 3]);
                indexToCenter[index] = base;
            }
        }
        const subTrees = [];
        for (let sceneCenters of allCenters) {
            const subTree = buildSubTree(sceneCenters, maxDepth, maxCentersPerNode);
            subTrees.push(subTree);
            processSplatTreeNode(subTree, subTree.rootNode, indexToCenter, sceneCenters);
        }
        self.postMessage({
            'subTrees': subTrees
        });
    }

    self.onmessage = (e) => {
        if (e.data.process) {
            createSplatTree(e.data.process.centers, e.data.process.maxDepth, e.data.process.maxCentersPerNode);
        }
    };
}

function workerProcessCenters(splatTreeWorker: Worker, centers: Float32Array[], transferBuffers: Array<ArrayBuffer>, maxDepth: number, maxCentersPerNode: number) {
    splatTreeWorker.postMessage({
        'process': {
            'centers': centers,
            'maxDepth': maxDepth,
            'maxCentersPerNode': maxCentersPerNode
        }
    }, transferBuffers);
}

function checkAndCreateWorker() {
    const splatTreeWorker = new Worker(
        URL.createObjectURL(
            new Blob(['(', createSplatTreeWorker.toString(), ')(self)'], {
                type: 'application/javascript',
            }),
        ),
    );
    return splatTreeWorker;
}


// SplatTree: Octree tailored to splat data from a SplatMesh instance
export class SplatTree {
    maxDepth: number; // max depth of the octree
    maxCentersPerNode: number; // max centers per node of the octree
    subTrees: SplatSubTree[]; // sub trees of the octree
    splatMesh: SplatMesh | null; // associated SplatMesh
    disposed!: boolean; // whether the octree is disposed
    splatTreeWorker!: Worker | null; // worker for octree building

    constructor(maxDepth: number, maxCentersPerNode: number) {
        this.maxDepth = maxDepth;
        this.maxCentersPerNode = maxCentersPerNode;
        this.subTrees = [];
        this.splatMesh = null;
    }


    dispose() {
        this.diposeSplatTreeWorker();
        this.disposed = true;
    }

    diposeSplatTreeWorker() {
        if (this.splatTreeWorker) this.splatTreeWorker.terminate();
        this.splatTreeWorker = null;
    };

    /**
     * Build SplatTree (octree) from a SplatMesh instance.
     *
     * @param {SplatMesh} splatMesh SplatMesh instance to build octree from
     * @param {function} filterFunc Optional, filter out unwanted splats (points), return true to keep
     * @param {function} onIndexesUpload Callback when uploading splat centers to worker (start/end)
     * @param {function} onSplatTreeConstruction Callback when worker is building local splat tree (start/end)
     * @return {Promise<void>} Promise that resolves when octree building is complete
     */
    processSplatMesh(
        splatMesh: SplatMesh,
        filterFunc: (index: number) => boolean = () => true,
        onIndexesUpload?: (isUploading: boolean) => void,
        onSplatTreeConstruction?: (isBuilding: boolean) => void
    ): Promise<void> {
        // if no worker, create one for octree building
        if (!this.splatTreeWorker) this.splatTreeWorker = checkAndCreateWorker();

        this.splatMesh = splatMesh; 
        this.subTrees = [];
        const center = new THREE.Vector3();

        // tool function: collect all splat centers for a scene
        // splatOffset: global starting index, splatCount: number of splats in the scene
        const addCentersForScene = (splatOffset: number, splatCount: number) => {
            // each splat has 4 floats (x, y, z, index)
            const sceneCenters = new Float32Array(splatCount * 4);
            let addedCount = 0;
            for (let i = 0; i < splatCount; i++) {
                // if (i < 100) console.log('center', center.x, center.y, center.z);
                const globalSplatIndex = i + splatOffset;
                // filter out unwanted splats
                if (filterFunc(globalSplatIndex)) {
                    // get splat center
                    splatMesh.getSplatCenter(globalSplatIndex, center);
                    const addBase = addedCount * 4;
                    sceneCenters[addBase] = center.x;
                    sceneCenters[addBase + 1] = center.y;
                    sceneCenters[addBase + 2] = center.z;
                    sceneCenters[addBase + 3] = globalSplatIndex;
                    addedCount++;
                }
            }
            // console.log('sceneCenters',sceneCenters)
            return sceneCenters;
        };

        return new Promise((resolve) => {

            const checkForEarlyExit = () => {
                if (this.disposed) {
                    this.diposeSplatTreeWorker();
                    resolve();
                    return true;
                }
                return false;
            };
            
            // notify external "upload indexes" start
            if (onIndexesUpload) onIndexesUpload(false);

            delayedExecute(() => {

                if (checkForEarlyExit()) return;

                const allCenters: Float32Array[] = [];
                // add centers for single scene
                const sceneCenters = addCentersForScene(0, splatMesh.getSplatCount());
                allCenters.push(sceneCenters);

                // worker process completed callback
                if (this.splatTreeWorker) {
                        this.splatTreeWorker.onmessage = (e) => {

                            if (checkForEarlyExit()) return;

                            if (e.data && e.data.subTrees) {

                            // notify external "build octree" start
                            if (onSplatTreeConstruction) onSplatTreeConstruction(false);

                            delayedExecute(() => {

                                if (checkForEarlyExit()) return;

                                // convert worker returned sub tree structure to main thread object
                                for (let workerSubTree of e.data.subTrees) {
                                    const convertedSubTree = SplatSubTree.convertWorkerSubTree(workerSubTree, splatMesh);
                                    this.subTrees.push(convertedSubTree);
                                }
                                // release worker after building
                                this.diposeSplatTreeWorker();

                                // notify external "build octree" end
                                if (onSplatTreeConstruction) onSplatTreeConstruction(true);

                                // finally resolve
                                delayedExecute(() => {
                                    resolve();
                                });

                            });
                        }
                    };
                }

                // really start uploading data to worker
                delayedExecute(() => {
                    if (checkForEarlyExit()) return;
                    if (onIndexesUpload) onIndexesUpload(true);
                    // pass all scene centers data to worker
                    const transferBuffers = allCenters.map((array) => array.buffer);
                    workerProcessCenters(this.splatTreeWorker as Worker, allCenters, transferBuffers, this.maxDepth, this.maxCentersPerNode);
                });

            });

        });

    };

    // count leaves
    countLeaves() {

        let leafCount = 0;
        this.visitLeaves(() => {
            leafCount++;
        });

        return leafCount;
    }

    // visit leaves
    visitLeaves(visitFunc: (node: SplatTreeNode) => void) {

        const visitLeavesFromNode = (node: SplatTreeNode, visitFunc: (node: SplatTreeNode) => void) => {
            if (node.children.length === 0) visitFunc(node);
            for (let child of node.children) {
                visitLeavesFromNode(child, visitFunc);
            }
        };

        for (let subTree of this.subTrees) {
            visitLeavesFromNode(subTree.rootNode as unknown as SplatTreeNode, visitFunc);
        }
    }

}
