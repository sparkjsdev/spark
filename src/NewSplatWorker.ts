import BundledWorker from "./newWorker?worker&inline";
import { getArrayBuffers } from "./utils";

type PromiseRecord = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  onStatus?: (data: unknown) => void;
};

export class NewSplatWorker {
  worker: Worker;
  queue: (() => void)[] | null = null;
  messages: Record<number, PromiseRecord> = {};
  static currentId = 0;

  constructor() {
    this.worker = new BundledWorker();
    this.worker.onmessage = (event) => this.onMessage(event);
  }

  onMessage(event: MessageEvent) {
    const { id, result, error, status } = event.data;
    const promise = this.messages[id];
    if (promise) {
      if (error) {
        delete this.messages[id];
        promise.reject(error);
      } else if (result) {
        delete this.messages[id];
        promise.resolve(result);
      } else if (status) {
        promise.onStatus?.(status);
      }
    }
  }

  tryExclusive<T>(callback: (worker: NewSplatWorker) => Promise<T>) {
    return this.queue == null ? this.exclusive(callback) : null;
  }

  async exclusive<T>(
    callback: (worker: NewSplatWorker) => Promise<T>,
  ): Promise<T> {
    const queue = this.queue;
    if (queue != null) {
      await new Promise((resolve) => {
        queue.push(() => resolve(undefined));
      });
    } else {
      this.queue = [];
    }

    try {
      return await callback(this);
    } finally {
      if (this.queue != null) {
        if (this.queue.length === 0) {
          this.queue = null;
        } else {
          const waiter = this.queue.shift() as () => void;
          waiter();
        }
      }
    }
  }

  async call(
    name: string,
    args: unknown,
    options: { onStatus?: (data: unknown) => void } = {},
  ): Promise<unknown> {
    const id = ++NewSplatWorker.currentId;
    const promise = new Promise((resolve, reject) => {
      this.messages[id] = { resolve, reject, onStatus: options.onStatus };
    });
    this.worker.postMessage(
      { id, name, args },
      { transfer: getArrayBuffers(args) },
    );
    return await promise;
  }
}

export class NewSplatWorkerPool {
  maxWorkers;
  numWorkers = 0;
  freelist: NewSplatWorker[] = [];
  queue: ((worker: NewSplatWorker) => void)[] = [];

  constructor(maxWorkers = 4) {
    this.maxWorkers = maxWorkers;
  }

  async withWorker<T>(
    callback: (worker: NewSplatWorker) => Promise<T>,
  ): Promise<T> {
    const worker = await this.allocWorker();
    try {
      return await callback(worker);
    } finally {
      this.freeWorker(worker);
    }
  }

  async allocWorker(): Promise<NewSplatWorker> {
    const worker = this.freelist.pop();
    if (worker) {
      return worker;
    }

    if (this.numWorkers < this.maxWorkers) {
      const worker = new NewSplatWorker();
      this.numWorkers += 1;
      return worker;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  freeWorker(worker: NewSplatWorker) {
    if (this.numWorkers > this.maxWorkers) {
      // Worker no longer needed
      this.numWorkers -= 1;
      return;
    }

    const waiter = this.queue.shift();
    if (waiter) {
      waiter(worker);
      return;
    }

    this.freelist.push(worker);
  }
}

export const workerPool = new NewSplatWorkerPool();
