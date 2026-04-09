import type {
  ILodTraverser,
  LodInstance,
  LodTraverseResult,
} from "./ILodTraverser";
import { SplatWorker } from "./SplatWorker";

/**
 * Default LOD traverser that delegates to the WASM worker.
 */
export class WorkerLodTraverser implements ILodTraverser {
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

  async newTree(capacity: number): Promise<number> {
    const { lodId } = (await this.ensureWorker().call("newLodTree", {
      capacity,
    })) as { lodId: number };
    return lodId;
  }

  async uploadTree(
    _lodId: number,
    lodTree: Uint32Array,
    numSplats: number,
  ): Promise<number> {
    const { lodId } = (await this.ensureWorker().call("initLodTree", {
      numSplats,
      lodTree: lodTree.slice(),
    })) as { lodId: number };
    return lodId;
  }

  async newSharedTree(lodId: number): Promise<number> {
    const result = (await this.ensureWorker().call("newSharedLodTree", {
      lodId,
    })) as { lodId: number };
    return result.lodId;
  }

  async updateTrees(
    ranges: {
      lodId: number;
      pageBase: number;
      chunkBase: number;
      count: number;
      lodTreeData?: Uint32Array;
    }[],
  ): Promise<void> {
    await this.ensureWorker().call("updateLodTrees", { ranges });
  }

  async traverse(
    instances: Record<string, LodInstance>,
    maxSplats: number,
    pixelScaleLimit: number,
    lastPixelLimit?: number,
  ): Promise<LodTraverseResult> {
    return (await this.ensureWorker().call("traverseLodTrees", {
      maxSplats,
      pixelScaleLimit,
      lastPixelLimit,
      instances,
    })) as LodTraverseResult;
  }

  async removeTree(lodId: number): Promise<void> {
    await this.ensureWorker().call("disposeLodTree", { lodId });
  }

  async getLodTreeLevel(
    lodId: number,
    level: number,
  ): Promise<{ indices: Uint32Array }> {
    return (await this.ensureWorker().call("getLodTreeLevel", {
      lodId,
      level,
    })) as { indices: Uint32Array };
  }

  dispose(): void {
    if (this.worker) {
      this.worker.dispose();
      this.worker = null;
    }
  }
}
