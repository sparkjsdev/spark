import { expect, test, vi } from "vitest";
import { SplatWorkerPool } from "../../src/SplatWorker";

// A worker whose every call traps.
vi.mock("../../src/worker?worker&inline", () => ({
  default: class {
    onmessage?: (event: { data: unknown }) => void;
    terminate = vi.fn();
    postMessage({ id }: { id?: number }) {
      if (id !== undefined) {
        const error = new Error("unreachable");
        this.onmessage?.({ data: { id, error, trapped: true } });
      }
    }
  },
}));

test("the pool replaces a worker that trapped", async () => {
  const pool = new SplatWorkerPool(1);
  const trapped = await pool.allocWorker();
  const fileBytes = new Uint8Array();
  await expect(
    trapped.call("loadPackedSplats", { fileBytes }),
  ).rejects.toThrow();
  pool.freeWorker(trapped);

  expect(trapped.worker.terminate).toHaveBeenCalled();
  expect(await pool.allocWorker()).not.toBe(trapped);
  expect(pool.numWorkers).toBe(1);
});
