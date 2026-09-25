import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../..");

// Always start our own Vite (with SPARK_ENABLE_HOOKS) on a port of its own, so
// a developer's `npm run dev` on 8080 (or 8081 if Vite had to move it) is
// neither reused nor disturbed. Set SPARK_TEST_PORT if 8090 is taken.
const port = Number(process.env.SPARK_TEST_PORT ?? 8090);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
  workers: 1,
  timeout: 180_000,
  // On CI also write an HTML report for upload as a workflow artifact.
  reporter: process.env.CI
    ? [
        ["list"],
        [
          "html",
          {
            open: "never",
            outputFolder: path.join(import.meta.dirname, "playwright-report"),
          },
        ],
      ]
    : "list",
  expect: {
    toMatchSnapshot: {
      // Per-pixel comparison stays exact, but allow a scattering of differing
      // pixels: SwiftShader on Linux x64 vs macOS arm64 flips ~6-16 of 65,536.
      // Real regressions change thousands.
      threshold: 0,
      maxDiffPixelRatio: 0.001, // 65 pixels at 256x256
    },
  },
  use: {
    baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Force CPU-based WebGL2 via SwiftShader for deterministic rendering.
          args: [
            "--use-angle=swiftshader",
            "--use-gl=angle",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    // Run Vite from the repo root so it picks up vite.config.ts and serves src/.
    cwd: repoRoot,
    env: { SPARK_ENABLE_HOOKS: "1" },
    url: `${baseURL}/test/browser/harness.html`,
    reuseExistingServer: false,
  },
});
