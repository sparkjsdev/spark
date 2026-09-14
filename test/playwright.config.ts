import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the Vite dev server so that src/*.ts, GLSL and the
// inline worker are transformed on the fly, with real WebGL2 (SwiftShader),
// Web Workers and the spark-rs WASM module.
//
// This file lives under test/ so it is covered by test/tsconfig.json (Node
// types); `npm run test:browser` points Playwright at it.
const PORT = Number(process.env.SPARK_TEST_PORT ?? 8080);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export default defineConfig({
  testDir: "browser",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./browser/global-setup.ts",
  outputDir: path.join(repoRoot, "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 320, height: 320 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 320 },
        launchOptions: {
          args: [
            "--use-angle=swiftshader",
            "--ignore-gpu-blocklist",
            "--enable-unsafe-swiftshader",
            "--enable-webgl",
            "--use-gl=angle",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: repoRoot,
    url: `http://localhost:${PORT}/test/browser/pages/harness.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
