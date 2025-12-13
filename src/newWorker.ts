import init_wasm, {
  sort_splats,
  sort32_splats,
  decode_to_gsplatarray,
  decode_to_packedsplats,
  init_lod_tree,
  dispose_lod_tree,
  traverse_lod_trees,
  type ChunkDecoder,
  quick_lod_packedsplats,
  insert_lod_trees,
  clear_lod_trees,
  traverse_bones,
  decode_to_extsplats,
} from "spark-internal-rs";
import type { SplatEncoding } from "./PackedSplats";

const rpcHandlers = {
  sortSplats16,
  sortSplats32,
  loadPackedSplats,
  loadExtSplats,
  quickLod,
  initLodTree,
  disposeLodTree,
  insertLodTrees,
  clearLodTrees,
  traverseLodTrees,
};

async function onMessage(event: MessageEvent) {
  const {
    id,
    name,
    args,
  }: { id: unknown; name: keyof typeof rpcHandlers; args: unknown } =
    event.data;
  try {
    const handler = rpcHandlers[name] as (
      args: unknown,
      options: { sendStatus: (data: unknown) => void },
    ) => unknown | Promise<unknown>;
    if (!handler) {
      throw new Error(`Unknown worker RPC: ${name}`);
    }

    const sendStatus = (data: unknown) => {
      self.postMessage(
        { id, status: data },
        { transfer: getArrayBuffers(data) },
      );
    };
    const result = await handler(args, { sendStatus });
    self.postMessage({ id, result }, { transfer: getArrayBuffers(result) });
  } catch (error) {
    console.warn(`Worker error: ${error}`);
    self.postMessage({ id, error }, { transfer: getArrayBuffers(error) });
  }
}

function sortSplats16({
  numSplats,
  readback,
  ordering,
}: {
  numSplats: number;
  readback: Uint16Array;
  ordering: Uint32Array;
}) {
  const activeSplats = sort_splats(numSplats, readback, ordering);
  return { activeSplats, readback, ordering };
}

function sortSplats32({
  numSplats,
  readback,
  ordering,
}: {
  numSplats: number;
  readback: Uint32Array;
  ordering: Uint32Array;
}) {
  const activeSplats = sort32_splats(numSplats, readback, ordering);
  return { activeSplats, readback, ordering };
}

async function decodeBytesUrl({
  decoder,
  fileBytes,
  url,
  requestHeader,
  withCredentials,
  sendStatus,
}: {
  decoder: ChunkDecoder;
  fileBytes?: Uint8Array;
  url?: string;
  requestHeader?: Record<string, string>;
  withCredentials?: string;
  sendStatus: (data: unknown) => void;
}) {
  if (fileBytes) {
    decoder.push(fileBytes);
  } else if (url) {
    const request = new Request(url, {
      headers: requestHeader ? new Headers(requestHeader) : undefined,
      credentials: withCredentials ? "include" : "same-origin",
    });

    const response = await fetch(request);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch "${url}": ${response.status} ${response.statusText}`,
      );
    }
    const reader = response.body.getReader();
    const contentLength = Number.parseInt(
      response.headers.get("Content-Length") || "0",
    );
    const total = Number.isNaN(contentLength) ? 0 : contentLength;
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      loaded += value.length;
      sendStatus({ loaded, total });

      decoder.push(value);
    }
  } else {
    throw new Error("No url or fileBytes provided");
  }

  const decoded = decoder.finish();
  return decoded;
}

type DecodedPackedResult = {
  numSplats: number;
  packed: Uint32Array;
  sh1?: Uint32Array;
  sh2?: Uint32Array;
  sh3?: Uint32Array;
  lodTree?: Uint32Array;
  splatEncoding: SplatEncoding;
};

function toPackedResult(packed: DecodedPackedResult) {
  return {
    numSplats: packed.numSplats,
    packedArray: packed.packed,
    extra: {
      sh1: packed.sh1,
      sh2: packed.sh2,
      sh3: packed.sh3,
      lodTree: packed.lodTree,
      boneWeights: undefined as Uint16Array | undefined,
    },
    splatEncoding: packed.splatEncoding,
  };
}

type LoadPackedSplatsResult = {
  lodSplats?: ReturnType<typeof toPackedResult>;
} & (ReturnType<typeof toPackedResult> | Record<never, never>) & {
    boneSplats?: ReturnType<typeof toPackedResult> & {
      childCounts: Uint32Array;
      childStarts: Uint32Array;
    };
  };

async function loadPackedSplats(
  {
    url,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    lod,
    lodBase,
    encoding,
    nonLod,
    maxBoneSplats,
    computeBoneWeights,
    minBoneOpacity,
  }: {
    url?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: string;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    lod?: boolean;
    lodBase?: number;
    encoding?: unknown;
    nonLod?: boolean | "wait";
    maxBoneSplats?: number;
    computeBoneWeights?: boolean;
    minBoneOpacity?: number;
  },
  {
    sendStatus,
  }: {
    sendStatus: (data: unknown) => void;
  },
): Promise<LoadPackedSplatsResult> {
  const options = {
    url,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    lod,
    lodBase,
    nonLod,
  };
  const result = await loadPackedSplatsInternal(options, { sendStatus });

  if (maxBoneSplats && result.lodSplats && result.lodSplats.extra.lodTree) {
    const { numSplats, packedArray } = result as ReturnType<
      typeof toPackedResult
    >;
    const {
      numSplats: numLodSplats,
      packedArray: lodPackedArray,
      extra: lodExtra,
      splatEncoding: lodSplatEncoding,
    } = result.lodSplats;

    console.log("Running traverse_bones", numLodSplats, maxBoneSplats);
    const bones = traverse_bones(
      numLodSplats,
      lodPackedArray,
      lodExtra,
      maxBoneSplats,
      numSplats ?? 0,
      packedArray,
      computeBoneWeights ?? false,
      minBoneOpacity ?? 0,
    ) as {
      numSplats: number;
      packed: Uint32Array;
      splatEncoding: SplatEncoding;
      childCounts: Uint32Array;
      childStarts: Uint32Array;
      boneWeights?: Uint16Array;
      lodBoneWeights?: Uint16Array;
    };
    console.log("traverse_bones", bones);

    if (bones.boneWeights && bones.boneWeights.length > 0) {
      (result as ReturnType<typeof toPackedResult>).extra.boneWeights =
        bones.boneWeights;
    }
    if (bones.lodBoneWeights && bones.lodBoneWeights.length > 0) {
      result.lodSplats.extra.boneWeights = bones.lodBoneWeights;
    }

    (result as LoadPackedSplatsResult).boneSplats = {
      ...toPackedResult(bones),
      childCounts: bones.childCounts,
      childStarts: bones.childStarts,
    };
  }
  return result;
}

async function loadPackedSplatsInternal(
  {
    url,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    lod,
    lodBase,
    nonLod,
  }: {
    url?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: string;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    lod?: boolean;
    lodBase?: number;
    nonLod?: boolean | "wait";
  },
  {
    sendStatus,
  }: {
    sendStatus: (data: unknown) => void;
  },
): Promise<LoadPackedSplatsResult> {
  if (!lod) {
    const decoder = decode_to_packedsplats(fileType, pathName ?? url);
    const decoded = await decodeBytesUrl({
      decoder,
      fileBytes,
      url,
      requestHeader,
      withCredentials,
      sendStatus,
    });
    const result = toPackedResult(decoded as DecodedPackedResult);
    if (result.splatEncoding.lodOpacity) {
      return { lodSplats: result };
    }
    return result;
  }

  const decoder = decode_to_gsplatarray(fileType, pathName ?? url);
  const decoded = await decodeBytesUrl({
    decoder,
    fileBytes,
    url,
    requestHeader,
    withCredentials,
    sendStatus,
  });

  if (decoded.has_lod()) {
    return {
      lodSplats: toPackedResult(
        decoded.to_packedsplats_lod() as DecodedPackedResult,
      ),
    };
  }

  const packed = decoded.to_packedsplats();
  let result:
    | (ReturnType<typeof toPackedResult> & {
        lodSplats?: ReturnType<typeof toPackedResult>;
      })
    | { lodSplats?: ReturnType<typeof toPackedResult> } = {};

  if (nonLod === true) {
    sendStatus({ orig: toPackedResult(packed as DecodedPackedResult) });
  } else if (nonLod === "wait") {
    // Wait until LoD computation is complete before resolving full PackedSplats result
    result = toPackedResult(packed as DecodedPackedResult);
  }

  const initialSplats = decoded.len();
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));

  const lodStart = performance.now();
  decoded.quick_lod(base, false);
  const lodDuration = performance.now() - lodStart;

  console.log(
    `Quick LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`,
  );

  const lodPacked = decoded.to_packedsplats_lod();
  result.lodSplats = toPackedResult(lodPacked as DecodedPackedResult);
  return result;
}

type DecodedExtResult = {
  numSplats: number;
  ext0: Uint32Array;
  ext1: Uint32Array;
  sh1?: Uint32Array;
  sh2?: Uint32Array;
  sh3a?: Uint32Array;
  sh3b?: Uint32Array;
  lodTree?: Uint32Array;
};

function toExtResult(packed: DecodedExtResult) {
  return {
    numSplats: packed.numSplats,
    extArrays: [packed.ext0, packed.ext1],
    extra: {
      sh1: packed.sh1,
      sh2: packed.sh2,
      sh3a: packed.sh3a,
      sh3b: packed.sh3b,
      lodTree: packed.lodTree,
    },
  };
}

type LoadExtSplatsResult = { lodSplats?: ReturnType<typeof toExtResult> } & (
  | ReturnType<typeof toExtResult>
  | Record<never, never>
);

async function loadExtSplats(
  {
    url,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    lod,
    lodBase,
    nonLod,
  }: {
    url?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: string;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    lod?: boolean;
    lodBase?: number;
    nonLod?: boolean | "wait";
  },
  {
    sendStatus,
  }: {
    sendStatus: (data: unknown) => void;
  },
): Promise<LoadExtSplatsResult> {
  if (!lod) {
    const decoder = decode_to_extsplats(fileType, pathName ?? url);
    const decoded = await decodeBytesUrl({
      decoder,
      fileBytes,
      url,
      requestHeader,
      withCredentials,
      sendStatus,
    });
    const result = toExtResult(decoded as DecodedExtResult);
    if (result.extra.lodTree) {
      return { lodSplats: result };
    }
    return result;
  }

  const decoder = decode_to_gsplatarray(fileType, pathName ?? url);
  const decoded = await decodeBytesUrl({
    decoder,
    fileBytes,
    url,
    requestHeader,
    withCredentials,
    sendStatus,
  });

  if (decoded.has_lod()) {
    return {
      lodSplats: toExtResult(decoded.to_extsplats_lod() as DecodedExtResult),
    };
  }

  const packed = decoded.to_extsplats();
  let result:
    | (ReturnType<typeof toExtResult> & {
        lodSplats?: ReturnType<typeof toExtResult>;
      })
    | { lodSplats?: ReturnType<typeof toExtResult> } = {};

  if (nonLod === true) {
    sendStatus({ orig: toExtResult(packed as DecodedExtResult) });
  } else if (nonLod === "wait") {
    // Wait until LoD computation is complete before resolving full PackedSplats result
    result = toExtResult(packed as DecodedExtResult);
  }

  const initialSplats = decoded.len();
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));

  const lodStart = performance.now();
  decoded.quick_lod(base, false);
  const lodDuration = performance.now() - lodStart;

  console.log(
    `Quick LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`,
  );

  const lodPacked = decoded.to_extsplats_lod();
  result.lodSplats = toExtResult(lodPacked as DecodedExtResult);
  return result;
}

async function quickLod({
  numSplats,
  packedArray,
  extra,
  lodBase,
  rgba,
}: {
  numSplats: number;
  packedArray: Uint32Array;
  extra?: Record<string, unknown>;
  lodBase?: number;
  rgba?: Uint8Array;
}) {
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
  const lodStart = performance.now();
  const decoded = quick_lod_packedsplats(
    numSplats,
    packedArray,
    extra as object,
    base,
    true,
    rgba,
  );
  const lodDuration = performance.now() - lodStart;
  const result = toPackedResult(decoded as DecodedPackedResult);
  console.log(
    `Quick LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`,
  );
  return result;
}

function initLodTree({
  numSplats,
  lodTree,
}: {
  numSplats: number;
  lodTree: Uint32Array;
}) {
  const { lodId, chunkToPage } = init_lod_tree(numSplats, lodTree) as {
    lodId: number;
    chunkToPage: Uint32Array;
  };
  return { lodId, chunkToPage };
}

function disposeLodTree({ lodId }: { lodId: number }) {
  dispose_lod_tree(lodId);
}

function insertLodTrees({
  ranges,
}: {
  ranges: {
    lodId: number;
    pageBase: number;
    chunkBase: number;
    count: number;
    lodTreeData: Uint32Array;
  }[];
}) {
  const lodIds = new Uint32Array(ranges.map(({ lodId }) => lodId));
  const pageBases = new Uint32Array(ranges.map(({ pageBase }) => pageBase));
  const chunkBases = new Uint32Array(ranges.map(({ chunkBase }) => chunkBase));
  const counts = new Uint32Array(ranges.map(({ count }) => count));
  const lodTreeData = ranges.map(({ lodTreeData }) => lodTreeData);

  const lodIdToChunkToPages = insert_lod_trees(
    lodIds,
    pageBases,
    chunkBases,
    counts,
    lodTreeData,
  ) as Record<number, Uint32Array>;
  return lodIdToChunkToPages;
}

function clearLodTrees({
  ranges,
}: {
  ranges: {
    lodId: number;
    pageBase: number;
    chunkBase: number;
    count: number;
  }[];
}) {
  const lodIds = new Uint32Array(ranges.map(({ lodId }) => lodId));
  const pageBases = new Uint32Array(ranges.map(({ pageBase }) => pageBase));
  const chunkBases = new Uint32Array(ranges.map(({ chunkBase }) => chunkBase));
  const counts = new Uint32Array(ranges.map(({ count }) => count));
  const lodIdToChunkToPages = clear_lod_trees(
    lodIds,
    pageBases,
    chunkBases,
    counts,
  ) as Record<number, Uint32Array>;
  return lodIdToChunkToPages;
}

function traverseLodTrees({
  maxSplats,
  pixelScaleLimit,
  fovXdegrees,
  fovYdegrees,
  instances,
}: {
  maxSplats: number;
  pixelScaleLimit: number;
  fovXdegrees: number;
  fovYdegrees: number;
  instances: Record<
    string,
    {
      lodId: number;
      viewToObjectCols: number[];
      lodScale: number;
      outsideFoveate: number;
      behindFoveate: number;
      coneFov0: number;
      coneFov: number;
      coneFoveate: number;
    }
  >;
}) {
  const keyInstances = Object.entries(instances);
  const lodIds = new Uint32Array(
    keyInstances.map(([_key, instance]) => instance.lodId),
  );
  const viewToObjects = new Float32Array(
    keyInstances.flatMap(([_key, instance]) => {
      if (instance.viewToObjectCols.length !== 16) {
        throw new Error("Incorrect array size for viewToObjectCols");
      }
      return instance.viewToObjectCols;
    }),
  );
  const lodScales = new Float32Array(
    keyInstances.map(([_key, instance]) => instance.lodScale),
  );
  const outsideFoveates = new Float32Array(
    keyInstances.map(([_key, instance]) => instance.outsideFoveate),
  );
  const behindFoveates = new Float32Array(
    keyInstances.map(([_key, instance]) => instance.behindFoveate),
  );
  const coneFov0s = new Float32Array(
    keyInstances.map(([_key, instance]) => instance.coneFov0),
  );
  const coneFovs = new Float32Array(
    keyInstances.map(([_key, instance]) => instance.coneFov),
  );
  const coneFoveates = new Float32Array(
    keyInstances.map(([_key, instance]) => instance.coneFoveate),
  );

  // console.log(`traverseLodTrees: maxSplats=${maxSplats}, pixelScaleLimit=${pixelScaleLimit}, fovXdegrees=${fovXdegrees}, fovYdegrees=${fovYdegrees}, outsideFoveate=${outsideFoveate}, behindFoveate=${behindFoveate}, lodIds=${lodIds.length}, viewToObjects=${viewToObjects.length}`);
  const { instanceIndices, chunks } = traverse_lod_trees(
    maxSplats,
    pixelScaleLimit,
    fovXdegrees,
    fovYdegrees,
    lodIds,
    viewToObjects,
    lodScales,
    outsideFoveates,
    behindFoveates,
    coneFov0s,
    coneFovs,
    coneFoveates,
  ) as {
    instanceIndices: {
      lodId: number;
      numSplats: number;
      indices: Uint32Array;
    }[];
    chunks: [number, number][];
  };

  const indices = keyInstances.reduce(
    (indices, [key, _instance], index) => {
      indices[key] = instanceIndices[index];
      return indices;
    },
    {} as Record<
      string,
      { lodId: number; numSplats: number; indices: Uint32Array }
    >,
  );
  // console.log(`traverseLodTrees: instanceIndices=${instanceIndices.length}`);
  // console.log(`traverseLodTrees: chunks=${chunks.length}`, JSON.stringify(chunks));
  return {
    keyIndices: indices,
    // chunks: chunks.map(([instIndex, chunk]) => [keyInstances[instIndex][0], chunk]),
    chunks,
  };
}

// Recursively finds all ArrayBuffers in an object and returns them as an array
// to use as transferable objects to send between workers.
function getArrayBuffers(ctx: unknown): Transferable[] {
  const buffers: ArrayBuffer[] = [];
  const seen = new Set();

  function traverse(obj: unknown) {
    if (obj && typeof obj === "object" && !seen.has(obj)) {
      seen.add(obj);

      if (obj instanceof ArrayBuffer) {
        buffers.push(obj);
      } else if (ArrayBuffer.isView(obj)) {
        // Handles TypedArrays and DataView
        buffers.push(obj.buffer as ArrayBuffer);
      } else if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        Object.values(obj).forEach(traverse);
      }
    }
  }

  traverse(ctx);
  return buffers;
}

async function initialize() {
  // Hold any messages received while initializing
  const pending: MessageEvent[] = [];
  const bufferMessage = (event: MessageEvent) => {
    pending.push(event);
  };
  self.addEventListener("message", bufferMessage);

  await init_wasm();

  self.removeEventListener("message", bufferMessage);
  self.addEventListener("message", onMessage);

  // Process any buffered messages
  for (const event of pending) {
    onMessage(event);
  }
  pending.length = 0;
}

initialize().catch(console.error);
