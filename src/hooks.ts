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

// import.meta.env only exists under Vite/Vitest; plain Node has no env object.
const env = (import.meta as { env?: Record<string, unknown> }).env;

/** True only when built with SPARK_ENABLE_HOOKS=1. Gates every hook point. */
export const SPARK_ENABLE_HOOKS: boolean = env?.SPARK_ENABLE_HOOKS === "1";

let hook: SparkHook | undefined;

export function setSparkHook(newHook?: SparkHook) {
  hook = newHook;
}

export function sparkHook(name: string, context?: Record<string, unknown>) {
  return hook?.(name, context);
}
