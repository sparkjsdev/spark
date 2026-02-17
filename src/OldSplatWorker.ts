import BundledWorker from "./oldWorker?worker&inline";
import { getTransferable } from "./utils.js";

// SplatWorker is an internal class that manages a WebWorker for executing
// longer running CPU tasks such as Gsplat file decoding and sorting.
// Although a SplatWorker can be created and used directly, the utility
// function withWorker() is recommended to allocate from a managed
// pool of SplatWorkers.

export class OldSplatWorker {
  worker: Worker;
  messages: Record<
    number,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  > = {};
  messageIdNext = 0;

  constructor() {
    // this.worker = new Worker(new URL("./worker", import.meta.url), { type: "module" });
    this.worker = new BundledWorker();
    this.worker.onmessage = (event) => this.onMessage(event);
  }

  makeMessageId(): number {
    return ++this.messageIdNext;
  }

  makeMessagePromiseId(): { id: number; promise: Promise<unknown> } {
    const id = this.makeMessageId();
    const promise = new Promise((resolve, reject) => {
      this.messages[id] = { resolve, reject };
    });
    return { id, promise };
  }

  onMessage(event: MessageEvent) {
    // console.log("SplatWorker.onMessage:", event);
    const { id, result, error } = event.data;
    // console.log(`SplatWorker.onMessage(${id}):`, result, error);
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

  // Invoke an RPC on the worker with the given name and arguments.
  // The normal usage of a worker is to run one activity at a time,
  // but this function allows for concurrent calls, tagging each request
  // with a unique message Id and awaiting a response to that same Id.
  // The method will automatically transfer any ArrayBuffers in the
  // arguments to the worker. If you'd like to transfer a copy of a
  // buffer then you must clone it before passing to this function.
  async call(name: string, args: unknown): Promise<unknown> {
    const { id, promise } = this.makeMessagePromiseId();
    // console.log(`SplatWorker.call(${name}):`, args);
    this.worker.postMessage(
      { name, args, id },
      { transfer: getTransferable(args) },
    );
    return promise;
  }
}

let maxWorkers = 4;

let numWorkers = 0;
const freeWorkers: OldSplatWorker[] = [];
const workerQueue: ((worker: OldSplatWorker) => void)[] = [];

// Set the maximum number of workers to allocate for the pool. (default: 4)
export function setWorkerPool(count = 4) {
  maxWorkers = count;
}

// Allocate a worker from the pool. If none are available and we are below the
// maximum, create a new one. Otherwise, add the request to a queue and wait
// for it to be fulfilled.
export async function allocWorker(): Promise<OldSplatWorker> {
  const worker = freeWorkers.shift();
  if (worker) {
    return worker;
  }

  if (numWorkers < maxWorkers) {
    const worker = new OldSplatWorker();
    numWorkers += 1;
    return worker;
  }

  return new Promise((resolve) => {
    workerQueue.push(resolve);
  });
}

// Return a worker to the pool. Pass the worker to any pending waiter.
export function freeWorker(worker: OldSplatWorker) {
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

// Allocate a worker from the pool and invoke the callback with the worker.
// When the callback completes, the worker will be returned to the pool.
export async function withWorker<T>(
  callback: (worker: OldSplatWorker) => Promise<T>,
): Promise<T> {
  const worker = await allocWorker();
  try {
    return await callback(worker);
  } finally {
    freeWorker(worker);
  }
}
