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
} from "spark-internal-rs";
import type { SplatEncoding } from "./PackedSplats";

const rpcHandlers = {
  sortSplats16,
  sortSplats32,
  loadSplats,
  quickLod,
  initLodTree,
  disposeLodTree,
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
  baseUri,
  requestHeader,
  withCredentials,
  sendStatus,
}: {
  decoder: ChunkDecoder;
  fileBytes?: Uint8Array;
  url?: string;
  baseUri?: string;
  requestHeader?: Record<string, string>;
  withCredentials?: string;
  sendStatus: (data: unknown) => void;
}) {
  let decodeDuration = 0;

  if (fileBytes) {
    const start = performance.now();
    decoder.push(fileBytes);
    decodeDuration += performance.now() - start;
  } else if (url) {
    const basedUrl = new URL(url, baseUri);
    const request = new Request(basedUrl, {
      headers: requestHeader ? new Headers(requestHeader) : undefined,
      credentials: withCredentials ? "include" : "same-origin",
    });

    const response = await fetch(request);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch: ${response.status} ${response.statusText}`,
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

      const start = performance.now();
      decoder.push(value);
      decodeDuration += performance.now() - start;
    }
  } else {
    throw new Error("No url or fileBytes provided");
  }

  console.log(`Finalizing decoding splats from ${url}`);
  // Zero out decoding time while downloading
  decodeDuration = 0;
  const finishStart = performance.now();
  const decoded = decoder.finish();
  decodeDuration += performance.now() - finishStart;
  console.log(
    `Decoded final ${decoded.numSplats} splats in ${decodeDuration} ms`,
  );

  return decoded;
}

async function loadSplats(
  {
    url,
    baseUri,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    lod,
    lodBase,
    encoding,
    nonLod,
  }: {
    url?: string;
    baseUri?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: string;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    lod?: boolean;
    lodBase?: number;
    encoding?: unknown;
    nonLod?: boolean;
  },
  {
    sendStatus,
  }: {
    sendStatus: (data: unknown) => void;
  },
) {
  console.log(
    `Called loadSplats with lod=${lod}, lodBase=${lodBase}, encoding=${encoding}, nonLod=${nonLod}`,
  );

  type DecodedResult = {
    numSplats: number;
    packed: Uint32Array;
    sh1: Uint32Array;
    sh2: Uint32Array;
    sh3: Uint32Array;
    lodTree: Uint32Array;
    splatEncoding: SplatEncoding;
  };

  const toPackedResult = (packed: DecodedResult) => ({
    numSplats: packed.numSplats,
    packedArray: packed.packed,
    extra: {
      sh1: packed.sh1,
      sh2: packed.sh2,
      sh3: packed.sh3,
      lodTree: packed.lodTree,
    },
    splatEncoding: packed.splatEncoding,
  });

  if (!lod) {
    const decoder = decode_to_packedsplats(fileType, pathName ?? url);
    const decoded = await decodeBytesUrl({
      decoder,
      fileBytes,
      url,
      baseUri,
      requestHeader,
      withCredentials,
      sendStatus,
    });
    const result = toPackedResult(decoded as DecodedResult);
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
    baseUri,
    requestHeader,
    withCredentials,
    sendStatus,
  });

  if (decoded.has_lod()) {
    return {
      lodSplats: toPackedResult(decoded.to_packedsplats_lod() as DecodedResult),
    };
  }

  if (nonLod) {
    const initialConvertStart = performance.now();
    const packed = decoded.to_packedsplats();
    const initialConvertDuration = performance.now() - initialConvertStart;
    sendStatus({ orig: toPackedResult(packed as DecodedResult) });
  }

  const initialSplats = decoded.len();
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
  const lodStart = performance.now();
  decoded.quick_lod(base);
  const lodDuration = performance.now() - lodStart;
  console.log(
    `Quick LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`,
  );

  const convertStart = performance.now();
  const lodPacked = decoded.to_packedsplats_lod();
  const convertDuration = performance.now() - convertStart;
  console.log(`Convert to packedsplats in ${convertDuration} ms`);

  return { lodSplats: toPackedResult(lodPacked as DecodedResult) };
}

async function quickLod({
  numSplats,
  packedArray,
  extra,
  lodBase,
}: {
  numSplats: number;
  packedArray: Uint32Array;
  extra?: unknown;
  lodBase?: number;
}) {
  const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
  return quick_lod_packedsplats(numSplats, packedArray, extra as object, base);
}

function initLodTree({
  numSplats,
  lodTree,
}: {
  numSplats: number;
  lodTree: Uint32Array;
}) {
  const lodId = init_lod_tree(numSplats, lodTree);
  return { lodId };
}

function disposeLodTree({ lodId }: { lodId: number }) {
  dispose_lod_tree(lodId);
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

  // console.log(`traverseLodTrees: maxSplats=${maxSplats}, pixelScaleLimit=${pixelScaleLimit}, fovXdegrees=${fovXdegrees}, fovYdegrees=${fovYdegrees}, outsideFoveate=${outsideFoveate}, behindFoveate=${behindFoveate}, lodIds=${lodIds.length}, viewToObjects=${viewToObjects.length}`);
  const instanceIndices = traverse_lod_trees(
    maxSplats,
    pixelScaleLimit,
    fovXdegrees,
    fovYdegrees,
    lodIds,
    viewToObjects,
    lodScales,
    outsideFoveates,
    behindFoveates,
  ) as { numSplats: number; indices: Uint32Array }[];

  const indices = keyInstances.reduce(
    (indices, [key, _instance], index) => {
      indices[key] = instanceIndices[index];
      return indices;
    },
    {} as Record<string, { numSplats: number; indices: Uint32Array }>,
  );
  // console.log(`traverseLodTrees: instanceIndices=${instanceIndices.length}`);
  return { keyIndices: indices };
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
