import type { ISortProvider } from "./ISortProvider";
import { SplatWorker } from "./SplatWorker";

/**
 * Default sort provider that delegates to the WASM worker.
 */
export class WorkerSortProvider implements ISortProvider {
  private worker: SplatWorker | null = null;

  private ensureWorker(): SplatWorker {
    if (!this.worker) {
      this.worker = new SplatWorker();
    }
    return this.worker;
  }

  async init(): Promise<boolean> {
    return true;
  }

  async sort(
    readback: Uint32Array,
    numSplats: number,
    ordering: Uint32Array,
  ): Promise<{ ordering: Uint32Array; activeSplats: number }> {
    const result = (await this.ensureWorker().call("sortSplats32", {
      numSplats,
      readback,
      ordering,
    })) as {
      readback: Uint32Array<ArrayBuffer>;
      ordering: Uint32Array;
      activeSplats: number;
    };
    return { ordering: result.ordering, activeSplats: result.activeSplats };
  }

  dispose(): void {
    if (this.worker) {
      this.worker.dispose();
      this.worker = null;
    }
  }
}
