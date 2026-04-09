import assert from "node:assert";
import { DropIfBusyLodScheduler } from "../src/ILodScheduler.js";

const scheduler = new DropIfBusyLodScheduler();

let releaseFirstTask: (() => void) | undefined;
const firstTaskDone = new Promise<void>((resolve) => {
  releaseFirstTask = resolve;
});

const firstScheduled = scheduler.schedule(async () => {
  await firstTaskDone;
});
const secondScheduled = scheduler.schedule(async () => {});

assert.strictEqual(await secondScheduled, false);

releaseFirstTask?.();

assert.strictEqual(await firstScheduled, true);
assert.strictEqual(await scheduler.schedule(async () => {}), true);

console.log("✅ DropIfBusyLodScheduler behaves as expected!");
