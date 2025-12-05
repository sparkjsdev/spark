import init_wasm, { sort_splats, sort32_splats } from "spark-internal-rs";
import { type TransformRange, WASM_SPLAT_SORT } from "../defines";
import { type UnpackResult, createSplatEncoder } from "../encoding/encoder";
import { unpackAntiSplat } from "../formats/antisplat";
import { unpackKsplat } from "../formats/ksplat";
import {
  type PcSogsJson,
  type PcSogsV2Json,
  unpackPcSogs,
  unpackPcSogsZip,
} from "../formats/pcsogs";
import { unpackPly } from "../formats/ply";
import { unpackSpz } from "../formats/spz";
import { getArrayBuffers } from "../utils";
import { sort32Splats, sortDoubleSplats, sortSplatsCpu } from "./sort";

type RpcMethod<Args, Result> = { args: Args; result: Result };

type DecodeArgs = {
  fileBytes: Uint8Array<ArrayBuffer>;
  extraFiles?: Record<string, ArrayBuffer>;
  encoder: string;
  encoderOptions?: Record<string, unknown>;
};
type SortArgs<Readback> = {
  numSplats: number;
  maxSplats: number;
  readback: Readback;
  ordering: Uint32Array;
};
type SortResult<Readback = ArrayBufferLike> = {
  ordering: Uint32Array;
  readback: Readback;
  activeSplats: number;
};

export type RpcMethods = {
  decodePly: RpcMethod<DecodeArgs, UnpackResult>;
  decodeSpz: RpcMethod<DecodeArgs, UnpackResult>;
  decodeAntiSplat: RpcMethod<DecodeArgs, UnpackResult>;
  decodeKsplat: RpcMethod<DecodeArgs, UnpackResult>;
  decodePcSogs: RpcMethod<DecodeArgs, UnpackResult>;
  decodePcSogsZip: RpcMethod<DecodeArgs, UnpackResult>;
  sortDoubleSplats: RpcMethod<
    SortArgs<Uint16Array<ArrayBuffer>>,
    SortResult<Uint16Array<ArrayBuffer>>
  >;
  sort32Splats: RpcMethod<
    SortArgs<Uint32Array<ArrayBuffer>>,
    SortResult<Uint32Array<ArrayBuffer>>
  >;
  sortSplatsCpu: RpcMethod<
    {
      centers?: Float32Array<ArrayBuffer>;
      transforms: Array<TransformRange>;
      viewOrigin: [number, number, number];
      viewDir: [number, number, number];
      ordering: Uint32Array;
    },
    {
      ordering: Uint32Array;
      activeSplats: number;
    }
  >;
};

type RpcMessageEvent = MessageEvent<
  {
    [Method in keyof RpcMethods]: {
      name: Method;
      args: RpcMethods[Method]["args"];
      id: string;
    };
  }[keyof RpcMethods]
>;

// Worker local storage of splat centers for sorting
let splatCenters = new Float32Array();

/**
 * WebWorker for Spark's background CPU tasks, such as Gsplat file decoding
 * and sorting.
 */
async function onMessage(event: RpcMessageEvent) {
  // Unpack RPC function name, arguments, and ID from the main thread.
  const { name, args, id } = event.data;
  // console.log(`worker.onMessage(${id}, ${name}):`, args);

  // Initialize return result/error, to be filled out below.
  let result = undefined;
  let error = undefined;

  try {
    if (name === "sortSplatsCpu") {
      // Check if new centers are provided
      if (args.centers) {
        splatCenters = args.centers;
      }

      result = {
        id,
        ...sortSplatsCpu(
          splatCenters,
          args.transforms,
          args.viewOrigin,
          args.viewDir,
          args.ordering,
        ),
      };
    } else if (name === "sortDoubleSplats") {
      // Sort numSplats splats using the readback distance metric, which encodes
      // one float16 per splat (no unused high bytes like for sortSplats).
      const { numSplats, readback, ordering } = args;
      if (WASM_SPLAT_SORT) {
        result = {
          id,
          readback,
          ordering,
          activeSplats: sort_splats(numSplats, readback, ordering),
        };
      } else {
        result = {
          id,
          readback,
          ...sortDoubleSplats({ numSplats, readback, ordering }),
        };
      }
    } else if (name === "sort32Splats") {
      const { maxSplats, numSplats, readback, ordering } = args;
      // Benchmark sort
      // benchmarkSort(numSplats, readback, ordering);
      if (WASM_SPLAT_SORT) {
        result = {
          id,
          readback,
          ordering,
          activeSplats: sort32_splats(numSplats, readback, ordering),
        };
      } else {
        result = {
          id,
          readback,
          ...sort32Splats({ maxSplats, numSplats, readback, ordering }),
        };
      }
    } else if (name.startsWith("decode")) {
      // All decodeXyz functions follow the same signature
      const { fileBytes, extraFiles, encoder, encoderOptions } = args;
      const splatEncoder = createSplatEncoder(encoder, encoderOptions);

      let decoded: UnpackResult;
      switch (name) {
        case "decodePly":
          decoded = await unpackPly(fileBytes, splatEncoder);
          break;
        case "decodeSpz":
          decoded = await unpackSpz(fileBytes, splatEncoder);
          break;
        case "decodeAntiSplat":
          decoded = unpackAntiSplat(fileBytes, splatEncoder);
          break;
        case "decodeKsplat":
          decoded = unpackKsplat(fileBytes, splatEncoder);
          break;
        case "decodePcSogs": {
          const json = JSON.parse(new TextDecoder().decode(fileBytes)) as
            | PcSogsJson
            | PcSogsV2Json;
          decoded = await unpackPcSogs(json, extraFiles ?? {}, splatEncoder);
          break;
        }
        case "decodePcSogsZip":
          decoded = await unpackPcSogsZip(fileBytes, splatEncoder);
          break;
        default:
          throw new Error(`Unknown decode name: ${name}`);
      }
      result = {
        id,
        numSplats: decoded.numSplats,
        unpacked: decoded.unpacked,
      };
    } else {
      throw new Error(`Unknown name: ${name}`);
    }
  } catch (e) {
    error = e;
    console.error(error);
  }

  // Send the result or error back to the main thread, making sure to transfer any ArrayBuffers
  self.postMessage(
    { id, result, error },
    { transfer: getArrayBuffers(result) },
  );
}

// Buffer to queue any messages received while initializing, for example
// early messages to unpack a Gsplat file while still initializing the WASM code.
const messageBuffer: MessageEvent[] = [];

function bufferMessage(event: MessageEvent) {
  messageBuffer.push(event);
}

async function initialize() {
  // Hold any messages received while initializing
  self.addEventListener("message", bufferMessage);

  await init_wasm();

  self.removeEventListener("message", bufferMessage);
  self.addEventListener("message", onMessage);

  // Process any buffered messages
  for (const event of messageBuffer) {
    onMessage(event);
  }
  messageBuffer.length = 0;
}

initialize().catch(console.error);
