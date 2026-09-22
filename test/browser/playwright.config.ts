import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const port = 8080;
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
      // SwiftShader renders are bit-exact between runs, so require an exact match:
      // per-pixel YIQ color distance (0..1) and number of differing pixels.
      maxDiffPixels: 0,
      threshold: 0,
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
    url: `${baseURL}/test/browser/harness.html`,
    reuseExistingServer: !process.env.CI,
  },
});
