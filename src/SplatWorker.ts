import { getArrayBuffers } from "./utils.js";
import type { RpcMethods } from "./worker/worker.js";
import BundledWorker from "./worker/worker.js?worker&inline";

/**
 * SplatWorker is an internal class that manages a WebWorker for executing
 * longer running CPU tasks such as Gsplat file decoding and sorting.
 * Although a SplatWorker can be created and used directly, the utility
 * function withWorker() is recommended to allocate from a managed
 * pool of SplatWorkers.
 */
export class SplatWorker {
  private worker: Worker;
  private messages: Record<
    number,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  > = {};
  private messageIdNext = 0;

  constructor() {
    this.worker = new BundledWorker();
    this.worker.onmessage = (event) => this.onMessage(event);
  }

  private makeMessageId(): number {
    return ++this.messageIdNext;
  }

  private makeMessagePromiseId(): { id: number; promise: Promise<unknown> } {
    const id = this.makeMessageId();
    const promise = new Promise((resolve, reject) => {
      this.messages[id] = { resolve, reject };
    });
    return { id, promise };
  }

  private onMessage(event: MessageEvent) {
    const { id, result, error } = event.data;
    const handler = this.messages[id];
    if (handler) {
      delete this.messages[id];
      if (error) {
        handler.reject(error);
      } else {
        handler.resolve(result);
      }
    }
  }

  /**
   * Invoke an RPC on the worker with the given name and arguments.
   * The normal usage of a worker is to run one activity at a time,
   * but this function allows for concurrent calls, tagging each request
   * with a unique message Id and awaiting a response to that same Id.
   * The method will automatically transfer any ArrayBuffers in the
   * arguments to the worker. If you'd like to transfer a copy of a
   * buffer then you must clone it before passing to this function.
   *
   * @param name Name of the RPC call
   * @param args
   */
  async call<Method extends keyof RpcMethods>(
    name: Method,
    args: RpcMethods[Method]["args"],
  ): Promise<RpcMethods[Method]["result"]> {
    const { id, promise } = this.makeMessagePromiseId();
    this.worker.postMessage(
      { name, args, id },
      { transfer: getArrayBuffers(args) },
    );
    return promise as Promise<RpcMethods[Method]["result"]>;
  }
}

let maxWorkers = 4;

let numWorkers = 0;
const freeWorkers: SplatWorker[] = [];
const workerQueue: ((worker: SplatWorker) => void)[] = [];

/**
 * Set the maximum number of workers to allocate for the pool.
 * @param count Number of workers (default: 4)
 */
export function setWorkerPool(count: number) {
  maxWorkers = count;
}

/**
 * Allocate a worker from the pool. If none are available and we are below the
 * maximum, create a new one. Otherwise, add the request to a queue and wait
 * for it to be fulfilled.
 * @returns
 */
export async function allocWorker(): Promise<SplatWorker> {
  const worker = freeWorkers.shift();
  if (worker) {
    return worker;
  }

  if (numWorkers < maxWorkers) {
    const worker = new SplatWorker();
    numWorkers += 1;
    return worker;
  }

  return new Promise((resolve) => {
    workerQueue.push(resolve);
  });
}

/**
 * Return a worker to the pool. Pass the worker to any pending waiter.
 * @param worker The worker to return
 */
function freeWorker(worker: SplatWorker) {
  if (numWorkers > maxWorkers) {
    // Worker no longer needed
    numWorkers -= 1;
    return;
  }

  const waiter = workerQueue.shift();
  if (waiter) {
    waiter(worker);
    return;
  }

  freeWorkers.push(worker);
}

/**
 * Allocate a worker from the pool and invoke the callback with the worker.
 * In case the worker is used for a single RPC, consider using the withWorkerCall
 * shorthand.
 * @param callback The callback to call
 * @returns Promise that resolves when the callback completes
 */
export async function withWorker<T>(
  callback: (worker: SplatWorker) => Promise<T>,
): Promise<T> {
  const worker = await allocWorker();
  try {
    return await callback(worker);
  } finally {
    freeWorker(worker);
  }
}

export async function withWorkerCall<Method extends keyof RpcMethods>(
  name: Method,
  args: RpcMethods[Method]["args"],
): Promise<RpcMethods[Method]["result"]> {
  return await withWorker((worker) => worker.call(name, args));
}
