// Optional await points for deterministic testing. Hook points are compiled
// out unless the build sets SPARK_ENABLE_HOOKS=1 (exposed via envPrefix in
// vite.config.ts); the browser tests start their dev server with it set.

/**
 * Called at each hook point with its name and optional context. Return a
 * promise to pause Spark at that point until it settles; return undefined to
 * continue without inserting an await.
 */
export type SparkHook = (
  name: string,
  context?: Record<string, unknown>,
) => void | Promise<void>;

/**
 * True only when built with SPARK_ENABLE_HOOKS=1. Gates every hook point.
 * Read as a direct `import.meta.env.<KEY>` so Vite replaces it with a literal
 * at build time and the hook code is compiled out of normal builds.
 */
export const SPARK_ENABLE_HOOKS: boolean =
  import.meta.env.SPARK_ENABLE_HOOKS === "1";

let hook: SparkHook | undefined;

export function setSparkHook(newHook?: SparkHook) {
  hook = newHook;
}

export function sparkHook(name: string, context?: Record<string, unknown>) {
  return hook?.(name, context);
}
