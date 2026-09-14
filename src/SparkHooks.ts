/**
 * Test/debug instrumentation for Spark's asynchronous pipelines.
 *
 * Spark has several concurrent asynchronous flows (splat sorting, LoD tree
 * updates/traversal, paged chunk fetching). To make their interleavings
 * deterministic in tests, the code calls `hooks.point(name)` at well-defined
 * async boundaries. In production `SparkRenderer.hooks` is undefined and these
 * calls compile down to a single undefined check with no extra microtask.
 *
 * A hook implementation may:
 * - return `undefined` to let execution continue immediately,
 * - return a `Promise` to hold execution at that point until it resolves,
 * - throw (or return a rejected promise) to inject a fault at that point.
 *
 * Hook point names currently emitted:
 * - `sort.start`, `sort.afterReadback`, `sort.afterWorker`
 * - `lod.start`, `lod.afterInit`, `lod.afterUpdateTrees`, `lod.afterTraverse`,
 *   `lod.beforeCleanup`
 * - `pager.fetched` (a chunk fetch+decode completed, before it is queued),
 *   `pager.beforeProcessFetched` (before queued chunks are assigned pages)
 */
export interface SparkHooks {
  point(name: string, info?: unknown): undefined | Promise<void>;
}

/**
 * Await a hook point if hooks are installed. Kept as a tiny helper so call
 * sites stay one line and production code performs no allocation.
 */
export function hookPoint(
  hooks: SparkHooks | undefined,
  name: string,
  info?: unknown,
): undefined | Promise<void> {
  return hooks ? hooks.point(name, info) : undefined;
}
