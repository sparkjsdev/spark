/**
 * Called at each hook point with its name and optional context. Return a
 * promise to pause Spark at that point until it settles; return undefined to
 * continue without inserting an await.
 */
export type SparkHook = (name: string, context?: Record<string, unknown>) => void | Promise<void>;
/**
 * True only when built with SPARK_ENABLE_HOOKS=1. Gates every hook point.
 * Read as a direct `import.meta.env.<KEY>` so Vite replaces it with a literal
 * at build time and the hook code is compiled out of normal builds.
 */
export declare const SPARK_ENABLE_HOOKS: boolean;
export declare function setSparkHook(newHook?: SparkHook): void;
export declare function sparkHook(name: string, context?: Record<string, unknown>): void | Promise<void> | undefined;
