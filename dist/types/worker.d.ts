import { ExtResult, PackedResult, SplatEncoding } from './defines';
declare const rpcHandlers: {
    sortSplats16: typeof sortSplats16;
    sortSplats32: typeof sortSplats32;
    loadPackedSplats: typeof loadPackedSplats;
    loadExtSplats: typeof loadExtSplats;
    tinyLodPackedSplats: typeof tinyLodPackedSplats;
    qualityLodPackedSplats: typeof qualityLodPackedSplats;
    tinyLodExtSplats: typeof tinyLodExtSplats;
    qualityLodExtSplats: typeof qualityLodExtSplats;
    newLodTree: typeof newLodTree;
    newSharedLodTree: typeof newSharedLodTree;
    initLodTree: typeof initLodTree;
    disposeLodTree: typeof disposeLodTree;
    updateLodTrees: typeof updateLodTrees;
    traverseLodTrees: typeof traverseLodTrees;
    getLodTreeLevel: typeof getLodTreeLevel;
    nextChunk: typeof nextChunk;
};
export type rpcHandlers = typeof rpcHandlers;
declare function sortSplats16({ numSplats, readback, ordering, }: {
    numSplats: number;
    readback: Uint16Array<ArrayBuffer>;
    ordering: Uint32Array<ArrayBuffer>;
}): {
    activeSplats: number;
    readback: Uint16Array<ArrayBuffer>;
    ordering: Uint32Array<ArrayBuffer>;
};
declare function sortSplats32({ numSplats, readback, ordering, }: {
    numSplats: number;
    readback: Uint32Array<ArrayBuffer>;
    ordering: Uint32Array<ArrayBuffer>;
}): {
    activeSplats: number;
    readback: Uint32Array<ArrayBuffer>;
    ordering: Uint32Array<ArrayBuffer>;
};
declare function loadPackedSplats({ url, requestHeader, withCredentials, fileBytes, fileType, pathName, chunked, chunkedLength, encoding, lod, lodBase, lodAbove, nonLod, sh1Codes, sh2Codes, sh3Codes, }: {
    url?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    chunked?: boolean;
    chunkedLength?: number;
    encoding?: SplatEncoding;
    lod?: boolean | "quality";
    lodBase?: number;
    lodAbove?: number;
    nonLod?: boolean;
    sh1Codes?: Uint32Array;
    sh2Codes?: Uint32Array;
    sh3Codes?: Uint32Array;
}, { sendStatus, }: {
    sendStatus: (data: unknown) => void;
}): Promise<PackedResult | {
    lodSplats: PackedResult;
}>;
declare function loadExtSplats({ url, requestHeader, withCredentials, fileBytes, fileType, pathName, chunked, chunkedLength, lod, lodBase, lodAbove, nonLod, sh1Codes, sh2Codes, sh3Codes, }: {
    url?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    chunked?: boolean;
    chunkedLength?: number;
    lod?: boolean | "quality";
    lodBase?: number;
    lodAbove?: number;
    nonLod?: boolean;
    sh1Codes?: Uint32Array;
    sh2Codes?: Uint32Array;
    sh3Codes?: [Uint32Array, Uint32Array];
}, { sendStatus, }: {
    sendStatus: (data: unknown) => void;
}): Promise<ExtResult | {
    lodSplats: ExtResult;
}>;
declare function tinyLodPackedSplats({ numSplats, packedArray, extra, lodBase, rgba, encoding, }: {
    numSplats: number;
    packedArray: Uint32Array;
    extra?: Record<string, unknown>;
    lodBase?: number;
    rgba?: Uint8Array;
    encoding: SplatEncoding;
}): Promise<PackedResult>;
declare function qualityLodPackedSplats({ numSplats, packedArray, extra, lodBase, rgba, encoding, }: {
    numSplats: number;
    packedArray: Uint32Array;
    extra?: Record<string, unknown>;
    lodBase?: number;
    rgba?: Uint8Array;
    encoding: SplatEncoding;
}): Promise<PackedResult>;
declare function tinyLodExtSplats({ numSplats, extArrays, extra, lodBase, rgba, encoding, }: {
    numSplats: number;
    extArrays: [Uint32Array, Uint32Array];
    extra?: Record<string, unknown>;
    lodBase?: number;
    rgba?: Uint8Array;
    encoding: SplatEncoding;
}): Promise<ExtResult>;
declare function qualityLodExtSplats({ numSplats, extArrays, extra, lodBase, rgba, encoding, }: {
    numSplats: number;
    extArrays: readonly [Uint32Array, Uint32Array];
    extra?: Record<string, unknown>;
    lodBase?: number;
    rgba?: Uint8Array;
    encoding?: SplatEncoding;
}): Promise<ExtResult>;
declare function newLodTree({ capacity, }: {
    capacity: number;
}): {
    lodId: number;
};
declare function newSharedLodTree({ lodId, }: {
    lodId: number;
}): {
    lodId: number;
};
declare function initLodTree({ numSplats, lodTree, }: {
    numSplats: number;
    lodTree: Uint32Array;
}): {
    lodId: number;
    chunkToPage: Uint32Array<ArrayBufferLike>;
};
declare function disposeLodTree({ lodId }: {
    lodId: number;
}): void;
declare function updateLodTrees({ ranges, }: {
    ranges: {
        lodId: number;
        pageBase: number;
        chunkBase: number;
        count: number;
        lodTreeData?: Uint32Array;
    }[];
}): void;
declare function traverseLodTrees({ maxSplats, pixelScaleLimit, lastPixelLimit, instances, traverseMode, }: {
    maxSplats: number;
    pixelScaleLimit: number;
    lastPixelLimit?: number;
    instances: Record<string, {
        instanceId: string;
        lodId: number;
        rootPage?: number;
        viewToObjectCols: number[];
        lodScale: number;
        behindFoveate: number;
        coneFov0: number;
        coneFov: number;
        coneFoveate: number;
    }>;
    traverseMode: "dynamic" | "standard";
}): {
    keyIndices: Record<string, {
        lodId: number;
        numSplats: number;
        indices: Uint32Array;
    }>;
    chunks: [number, number][];
    pixelLimit: number | undefined;
};
declare function getLodTreeLevel({ lodId, level, }: {
    lodId: number;
    level: number;
}): {
    indices: Uint32Array;
};
declare function nextChunk({ chunk }: {
    chunk: Uint8Array;
}): Promise<void>;
export {};
