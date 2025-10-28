import init_wasm, {
  sort_splats,
  sort32_splats,
  decode_to_gsplatarray,
  decode_to_packedsplats,
  init_lod_tree,
  dispose_lod_tree,
  traverse_lod_trees,
} from "spark-internal-rs";

const rpcHandlers = {
  sortSplats16,
  sortSplats32,
  loadSplats,
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
  },
  {
    sendStatus,
  }: {
    sendStatus: (data: unknown) => void;
  },
) {
  const decoder = lod
    ? decode_to_gsplatarray(fileType, pathName ?? url)
    : decode_to_packedsplats(fileType, pathName ?? url);
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
      // if (lod) {
      //   console.log(`Pushing ${value.length} bytes to decoder`);
      // }
      decoder.push(value);
      // if (lod) {
      //   console.log(`- Done pushing ${value.length} bytes to decoder`);
      // }
      decodeDuration += performance.now() - start;
    }
  } else {
    throw new Error("No url or fileBytes provided");
  }

  console.log(`Finalizing decoding splats from ${url}`);
  const finishStart = performance.now();
  let decoded = decoder.finish();
  decodeDuration += performance.now() - finishStart;
  console.log(`Decoded ${decoded.numSplats} splats in ${decodeDuration} ms`);

  if (lod) {
    if (!decoded.has_lod()) {
      const initialSplats = decoded.len();
      const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
      const lodStart = performance.now();
      decoded.quick_lod(base);
      const lodDuration = performance.now() - lodStart;
      console.log(
        `Quick LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`,
      );
    }

    const convertStart = performance.now();
    decoded = decoded.to_packedsplats();
    const convertDuration = performance.now() - convertStart;
    console.log(`Convert to packedsplats in ${convertDuration} ms`);
  }

  return {
    numSplats: decoded.numSplats,
    packedArray: decoded.packed,
    extra: {
      sh1: decoded.sh1,
      sh2: decoded.sh2,
      sh3: decoded.sh3,
      lodTree: decoded.lodTree,
    },
    encoding: decoded.encoding,
  };
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
  outsideFoveate,
  behindFoveate,
  instances,
}: {
  maxSplats: number;
  pixelScaleLimit: number;
  fovXdegrees: number;
  fovYdegrees: number;
  outsideFoveate: number;
  behindFoveate: number;
  instances: Record<string, { lodId: number; viewToObjectCols: number[] }>;
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

  const instanceIndices = traverse_lod_trees(
    maxSplats,
    pixelScaleLimit,
    fovXdegrees,
    fovYdegrees,
    outsideFoveate,
    behindFoveate,
    lodIds,
    viewToObjects,
  ) as { numSplats: number; indices: Uint32Array }[];

  const indices = keyInstances.reduce(
    (indices, [key, _instance], index) => {
      indices[key] = instanceIndices[index];
      return indices;
    },
    {} as Record<string, { numSplats: number; indices: Uint32Array }>,
  );
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
