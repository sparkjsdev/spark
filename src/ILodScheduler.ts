export interface ILodScheduler {
  schedule(task: () => Promise<void>): Promise<boolean>;
  dispose(): void;
}

/**
 * Default scheduler that preserves Spark's historical LOD behavior:
 * if a traversal job is already in flight, newer requests are skipped.
 */
export class DropIfBusyLodScheduler implements ILodScheduler {
  private running = false;

  async schedule(task: () => Promise<void>): Promise<boolean> {
    if (this.running) {
      return false;
    }

    this.running = true;
    try {
      await task();
      return true;
    } finally {
      this.running = false;
    }
  }

  dispose(): void {
    this.running = false;
  }
}
