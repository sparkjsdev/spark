import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "spark-package-consumer-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check via npm run test:package");
function run(executable, args, cwd = directory) {
  return execFileSync(executable, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
try {
  const [archive] = JSON.parse(
    run(
      process.execPath,
      [npmCli, "pack", "--json", "--pack-destination", directory],
      root,
    ),
  );
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "spark-package-consumer",
      private: true,
      type: "module",
    }),
  );
  writeFileSync(
    join(directory, "consumer.cjs"),
    `const assert = require('node:assert/strict');
const { SparkRenderer, utils } = require('@sparkjsdev/spark');
assert.equal(typeof SparkRenderer, 'function');
assert.equal(utils.toHalf(1), 15360);
`,
  );
  writeFileSync(
    join(directory, "consumer.mjs"),
    `import assert from 'node:assert/strict';
import { SparkRenderer, utils } from '@sparkjsdev/spark';
assert.equal(typeof SparkRenderer, 'function');
assert.equal(utils.toHalf(1), 15360);
`,
  );
  writeFileSync(
    join(directory, "consumer.ts"),
    `import * as THREE from 'three';
import { SparkRenderer, type SparkRendererOptions } from '@sparkjsdev/spark';
type IsAny<T> = 0 extends (1 & T) ? true : false;
const declarationsMustResolve: false = null as unknown as IsAny<typeof SparkRenderer>;
export function render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const options: SparkRendererOptions = { renderer };
  const spark: SparkRenderer = new SparkRenderer(options);
  const context: WebGLRenderingContext | WebGL2RenderingContext = spark.renderer.getContext();
  const result: void = spark.render(scene, camera);
  return { context, result };
}
`,
  );
  for (const [three, types] of [
    ["0.180.0", "0.180.0"],
    ["0.185.1", "0.185.4"],
  ]) {
    run(process.execPath, [
      npmCli,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      resolve(directory, archive.filename),
      `three@${three}`,
      `@types/three@${types}`,
      "typescript@5.8.3",
    ]);
    run(process.execPath, ["consumer.cjs"]);
    run(process.execPath, ["consumer.mjs"]);
    run(process.execPath, [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "--strict",
      "--target",
      "ES2020",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--skipLibCheck",
      "consumer.ts",
    ]);
    console.log(
      `Packed CommonJS, ESM and TypeScript consumer passed: Three.js ${three}; Node ${process.version}`,
    );
  }
  assert(archive.filename);
  rmSync(directory, { recursive: true, force: true });
} catch (error) {
  console.error(`Consumer reproduction retained at ${directory}`);
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  throw error;
}
