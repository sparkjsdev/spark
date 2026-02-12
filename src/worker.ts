import init_wasm, {
  sort_splats,
  sort32_splats,
  decode_to_gsplatarray,
  decode_to_csplatarray,
  decode_to_packedsplats,
  new_lod_tree,
  new_shared_lod_tree,
  init_lod_tree,
  dispose_lod_tree,
  traverse_lod_trees,
  type ChunkDecoder,
  tiny_lod_packedsplats,
  bhatt_lod_packedsplats,
  update_lod_trees,
  decode_to_extsplats,
  tiny_lod_extsplats,
  bhatt_lod_extsplats,
  get_lod_tree_level,
  new_traverse_lod_trees,
} from "spark-worker-rs";
import type { ExtResult, PackedResult, SplatEncoding } from "./defines";

const rpcHandlers = {
  sortSplats16,
  sortSplats32,
  loadPackedSplats,
  loadExtSplats,
  tinyLodPackedSplats,
  qualityLodPackedSplats,
  tinyLodExtSplats,
  qualityLodExtSplats,
  newLodTree,
  newSharedLodTree,
  initLodTree,
  disposeLodTree,
  updateLodTrees,
  traverseLodTrees,
  getLodTreeLevel,
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

async function fetchRange({
  url,
  requestHeader,
  withCredentials,
  offset,
  bytes,
}: {
  url: string;
  requestHeader?: Record<string, string>;
  withCredentials?: string;
  offset?: number;
  bytes?: number;
}): Promise<Uint8Array> {
  const request = new Request(url, {
    headers: requestHeader ? new Headers(requestHeader) : undefined,
    credentials: withCredentials ? "include" : "same-origin",
  });
  if (offset !== undefined && bytes !== undefined) {
    request.headers.set("Range", `bytes=${offset}-${offset + bytes - 1}`);
  }
  const response = await fetch(request);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to fetch "${url}": ${response.status} ${response.statusText}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
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
  withCredentials?: boolean;
  sendStatus: (data: unknown) => void;
}) {
  if (fileBytes) {
    const CHUNK_SIZE = 1048576; // 1 MB
    for (let i = 0; i < fileBytes.length; i += CHUNK_SIZE) {
      decoder.push(
        fileBytes.subarray(i, Math.min(i + CHUNK_SIZE, fileBytes.length)),
      );
    }
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

function toPackedResult(packed: DecodedPackedResult): PackedResult {
  return {
    numSplats: packed.numSplats,
    packedArray: packed.packed,
    extra: {
      sh1: packed.sh1,
      sh2: packed.sh2,
      sh3: packed.sh3,
      lodTree: packed.lodTree,
    },
    splatEncoding: packed.splatEncoding,
  };
}

async function loadPackedSplats(
  {
    url,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    encoding,
    lod,
    lodBase,
    nonLod,
  }: {
    url?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    encoding?: SplatEncoding;
    lod?: boolean | "quality";
    lodBase?: number;
    nonLod?: boolean | "wait";
  },
  {
    sendStatus,
  }: {
    sendStatus: (data: unknown) => void;
  },
) {
  if (!lod) {
    const decoder = decode_to_packedsplats(fileType, pathName ?? url, encoding);
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

  const decoder = decode_to_csplatarray(fileType, pathName ?? url, encoding);
  const decoded = await decodeBytesUrl({
    decoder,
    fileBytes,
    url,
    requestHeader,
    withCredentials,
    sendStatus,
  });

  if (decoded.has_lod()) {
    const result = toPackedResult(
      decoded.to_packedsplats_lod() as DecodedPackedResult,
    );
    return { lodSplats: result };
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

  const lodStart = performance.now();
  if (lod === "quality") {
    const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.25));
    decoded.bhatt_lod(base);
  } else {
    const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
    decoded.tiny_lod(base, false);
  }
  const lodDuration = performance.now() - lodStart;

  console.log(
    `${lod === "quality" ? "Bhatt" : "Tiny"} LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`,
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

function toExtResult(packed: DecodedExtResult): ExtResult {
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
    withCredentials?: boolean;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    lod?: boolean | "quality";
    lodBase?: number;
    nonLod?: boolean | "wait";
  },
  {
    sendStatus,
  }: {
    sendStatus: (data: unknown) => void;
  },
) {
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

  const lodStart = performance.now();
  if (lod === "quality") {
    const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.75));
    decoded.bhatt_lod(base);
  } else {
    const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
    decoded.tiny_lod(base, false);
  }
  const lodDuration = performance.now() - lodStart;

  console.log(
    `${lod === "quality" ? "Bhatt" : "Tiny"} LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`,
  );

  const lodPacked = decoded.to_extsplats_lod();
  result.lodSplats = toExtResult(lodPacked as DecodedExtResult);
  return result;
}

async function tinyLodPackedSplats({
  numSplats,
  packedArray,
  extra,
  lodBase,
  rgba,
  encoding,
}: {
  numSplats: number;
  packedArray: Uint32Array;
  extra?: Record<string, unknown>;
  lodBase?: number;
  rgba?: Uint8Array;
  encoding: SplatEncoding;
}) {
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
  const lodStart = performance.now();
  const filter = false;
  const decoded = tiny_lod_packedsplats(
    numSplats,
    packedArray,
    extra as object,
    base,
    filter,
    rgba,
    encoding,
  );
  const lodDuration = performance.now() - lodStart;
  const result = toPackedResult(decoded as DecodedPackedResult);
  console.log(
    `Tiny LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`,
  );
  return result;
}

async function qualityLodPackedSplats({
  numSplats,
  packedArray,
  extra,
  lodBase,
  rgba,
  encoding,
}: {
  numSplats: number;
  packedArray: Uint32Array;
  extra?: Record<string, unknown>;
  lodBase?: number;
  rgba?: Uint8Array;
  encoding: SplatEncoding;
}) {
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.75));
  const lodStart = performance.now();
  const decoded = bhatt_lod_packedsplats(
    numSplats,
    packedArray,
    extra as object,
    base,
    rgba,
    encoding,
  );
  const lodDuration = performance.now() - lodStart;
  const result = toPackedResult(decoded as DecodedPackedResult);
  console.log(
    `Bhatt LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`,
  );
  return result;
}

async function tinyLodExtSplats({
  numSplats,
  extArrays,
  extra,
  lodBase,
  rgba,
  encoding,
}: {
  numSplats: number;
  extArrays: [Uint32Array, Uint32Array];
  extra?: Record<string, unknown>;
  lodBase?: number;
  rgba?: Uint8Array;
  encoding: SplatEncoding;
}) {
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
  const lodStart = performance.now();
  const filter = false;
  const decoded = tiny_lod_extsplats(
    numSplats,
    extArrays[0],
    extArrays[1],
    extra as object,
    base,
    filter,
    rgba,
  );
  const lodDuration = performance.now() - lodStart;
  const result = toPackedResult(decoded as DecodedPackedResult);
  console.log(
    `Tiny LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`,
  );
  return result;
}

async function qualityLodExtSplats({
  numSplats,
  extArrays,
  extra,
  lodBase,
  rgba,
  encoding,
}: {
  numSplats: number;
  extArrays: [Uint32Array, Uint32Array];
  extra?: Record<string, unknown>;
  lodBase?: number;
  rgba?: Uint8Array;
  encoding: SplatEncoding;
}) {
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.75));
  const lodStart = performance.now();
  const decoded = bhatt_lod_extsplats(
    numSplats,
    extArrays[0],
    extArrays[1],
    extra as object,
    base,
    rgba,
  );
  const lodDuration = performance.now() - lodStart;
  const result = toExtResult(decoded as DecodedExtResult);
  console.log(
    `Bhatt LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`,
  );
  return result;
}

function newLodTree({
  capacity,
}: {
  capacity: number;
}) {
  const { lodId } = new_lod_tree(capacity) as { lodId: number };
  return { lodId };
}

function newSharedLodTree({
  lodId,
}: {
  lodId: number;
}) {
  const { lodId: newLodId } = new_shared_lod_tree(lodId) as { lodId: number };
  return { lodId: newLodId };
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

function updateLodTrees({
  ranges,
}: {
  ranges: {
    lodId: number;
    pageBase: number;
    chunkBase: number;
    count: number;
    lodTreeData?: Uint32Array;
  }[];
}) {
  const lodIds = new Uint32Array(ranges.map(({ lodId }) => lodId));
  const pageBases = new Uint32Array(ranges.map(({ pageBase }) => pageBase));
  const chunkBases = new Uint32Array(ranges.map(({ chunkBase }) => chunkBase));
  const counts = new Uint32Array(ranges.map(({ count }) => count));
  const lodTreeData = ranges.map(({ lodTreeData }) => lodTreeData);

  const result = update_lod_trees(
    lodIds,
    pageBases,
    chunkBases,
    counts,
    lodTreeData,
  );
  // console.log("updateLodTrees", result);
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
      rootPage?: number;
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
  const rootPages = new Uint32Array(
    keyInstances.map(([_key, instance]) => instance.rootPage ?? 0xffffffff),
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
  // const { instanceIndices, chunks } = traverse_lod_trees(
  //   maxSplats,
  //   pixelScaleLimit,
  //   fovXdegrees,
  //   fovYdegrees,
  //   lodIds,
  //   rootPages,
  //   viewToObjects,
  //   lodScales,
  //   outsideFoveates,
  //   behindFoveates,
  //   coneFov0s,
  //   coneFovs,
  //   coneFoveates,
  // ) as {
  //   instanceIndices: {
  //     lodId: number;
  //     numSplats: number;
  //     indices: Uint32Array;
  //   }[];
  //   chunks: [number, number][];
  // };
  // const pixelRatio = undefined;
  const result = new_traverse_lod_trees(
    maxSplats,
    pixelScaleLimit,
    lodIds,
    rootPages,
    viewToObjects,
    lodScales,
    behindFoveates,
    coneFoveates,
    coneFov0s,
    coneFovs,
  ) as {
    instanceIndices: {
      lodId: number;
      numSplats: number;
      indices: Uint32Array;
    }[];
    chunks: [number, number][];
    pixelRatio?: number;
  };
  const { instanceIndices, chunks, pixelRatio } = result;

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
    pixelRatio,
  };
}

function getLodTreeLevel({
  lodId,
  level,
}: {
  lodId: number;
  level: number;
}) {
  return get_lod_tree_level(lodId, level) as { indices: Uint32Array };
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
