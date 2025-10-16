import init_wasm, {
  sort_splats,
  sort32_splats,
  lod_init,
  lod_dispose,
  lod_compute,
  simd_enabled,
  decode_to_gsplatarray,
  decode_to_packedsplats,
} from "spark-internal-rs";

const rpcHandlers = {
  sortSplats16,
  sortSplats32,
  loadSplats,
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
    ) => unknown | Promise<unknown>;
    if (!handler) {
      throw new Error(`Unknown worker RPC: ${name}`);
    }
    const result = await handler(args);
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

async function loadSplats({
  url,
  baseUri,
  headers,
  credentials,
  fileBytes,
  fileType,
  pathName,
  lod,
  lodBase,
  encoding,
}: {
  url?: string;
  baseUri?: string;
  headers?: Record<string, string>;
  credentials?: string;
  fileBytes?: Uint8Array;
  fileType?: string;
  pathName?: string;
  lod?: number;
  lodBase?: number;
  encoding?: unknown;
}) {
  const decoder = lod
    ? decode_to_gsplatarray(fileType, pathName ?? url)
    : decode_to_packedsplats(fileType, pathName ?? url);
  let decodeDuration = 0;

  if (fileBytes) {
    const start = performance.now();
    decoder.push(fileBytes);
    decodeDuration += performance.now() - start;
  } else if (url) {
    console.log("Fetching", url);
    console.log("location", location);

    const basedUrl = new URL(url, baseUri);
    const reqHeaders = headers ? new Headers(headers) : undefined;
    const reqCredentials = credentials ? "include" : "same-origin";
    const request = new Request(basedUrl, {
      headers: reqHeaders,
      credentials: reqCredentials,
    });

    const response = await fetch(request);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch: ${response.status} ${response.statusText}`,
      );
    }
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const start = performance.now();
      decoder.push(value);
      decodeDuration += performance.now() - start;
    }
  } else {
    throw new Error("No url or fileBytes provided");
  }

  const finishStart = performance.now();
  let decoded = decoder.finish();
  decodeDuration += performance.now() - finishStart;
  console.log(`Decoded ${decoded.numSplats} splats in ${decodeDuration} ms`);

  if (lod) {
    const initialSplats = decoded.len();
    const base = Math.max(1.1, Math.min(2.0, lodBase ?? 1.5));
    const lodStart = performance.now();
    decoded.quick_lod(base);
    const lodDuration = performance.now() - lodStart;
    console.log(
      `Quick LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`,
    );

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
    },
    encoding: decoded.encoding,
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
