// Shared configuration between pager-fuzz.spec.ts and regressions.spec.ts so
// that a pinned seed replays exactly the run that found it.

export const FUZZ_HARNESS = {
  mode: "manual" as const,
  maxPages: 4,
  lodSplatCount: 40000,
  numLodFetchers: 2,
  lodDisposeTimeoutMs: 150,
};

export function formatFuzzFailure(result: {
  seed: number;
  violations: string[];
  errors: string[];
  trace: string[];
  skippedChecks: string[];
}) {
  return [
    `seed ${result.seed}`,
    "violations:",
    ...result.violations.map((v) => `  ${v}`),
    "errors:",
    ...result.errors.map((e) => `  ${e}`),
    "skipped checks:",
    ...result.skippedChecks.map((s) => `  ${s}`),
    "trace:",
    ...result.trace.map((t) => `  ${t}`),
  ].join("\n");
}
