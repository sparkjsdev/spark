// Generates deterministic synthetic splat fixtures for the browser tests.
//
//   test/fixtures/out/fixture.ply           plain 3DGS PLY (non-LoD)
//   test/fixtures/out/fixture-lod.rad       single-file LoD RAD (built by build-lod)
//   test/fixtures/out/chunked/fixture-lod.rad + fixture-lod-<n>.radc
//                                           chunked LoD RAD for paged loading
//
// Requires a Rust toolchain: the LoD files are produced by rust/build-lod.
// Usage: node test/fixtures/gen-fixture.mjs [--force]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(here, "out");
const chunkedDir = path.join(outDir, "chunked");

// ~300K splats -> ~5-6 chunks of 65536 after LoD nodes are added.
export const FIXTURE_SPLATS = 300_000;

// Small non-LoD PLY for tests that only need a regular mesh (SwiftShader is
// slow at rasterizing hundreds of thousands of splats).
export const FIXTURE_SMALL_SPLATS = 20_000;

export const FIXTURE_FILES = {
  ply: path.join(outDir, "fixture.ply"),
  smallPly: path.join(outDir, "fixture-small.ply"),
  lodRad: path.join(outDir, "fixture-lod.rad"),
  chunkedRad: path.join(chunkedDir, "fixture-lod.rad"),
};

// Small deterministic PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function writeSyntheticPly(filename, numSplats, seed = 1234) {
  const rand = rng(seed);
  const props = [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${numSplats}`,
    ...props.map((p) => `property float ${p}`),
    "end_header",
    "",
  ].join("\n");

  const stride = props.length * 4;
  const body = Buffer.alloc(numSplats * stride);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const SH_C0 = 0.28209479177387814;

  for (let i = 0; i < numSplats; i++) {
    // Points spread over a few blobs so the LoD tree has real structure and
    // the camera can see a subset of chunks at a time.
    const blob = i % 4;
    const bx = (blob & 1 ? 1 : -1) * 1.5;
    const by = (blob & 2 ? 1 : -1) * 1.0;
    const r = Math.sqrt(-2 * Math.log(1 - rand())) * 0.6;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const x = bx + r * Math.sin(phi) * Math.cos(theta);
    const y = by + r * Math.sin(phi) * Math.sin(theta);
    const z = -4 + r * Math.cos(phi);

    // Bright, saturated colors per blob so pixels are clearly non-black
    const cr = blob === 0 || blob === 3 ? 1.0 : 0.2;
    const cg = blob === 1 || blob === 3 ? 1.0 : 0.2;
    const cb = blob === 2 ? 1.0 : 0.2;

    const lnScale = Math.log(0.01 + rand() * 0.02);
    // Random unit quaternion
    const u1 = rand();
    const u2 = rand() * Math.PI * 2;
    const u3 = rand() * Math.PI * 2;
    const qw = Math.sqrt(1 - u1) * Math.sin(u2);
    const qx = Math.sqrt(1 - u1) * Math.cos(u2);
    const qy = Math.sqrt(u1) * Math.sin(u3);
    const qz = Math.sqrt(u1) * Math.cos(u3);

    const o = i * stride;
    const vals = [
      x,
      y,
      z,
      (cr - 0.5) / SH_C0,
      (cg - 0.5) / SH_C0,
      (cb - 0.5) / SH_C0,
      // logit(opacity) with opacity ~ 0.8
      Math.log(0.8 / 0.2),
      lnScale,
      lnScale,
      lnScale,
      qw,
      qx,
      qy,
      qz,
    ];
    for (let j = 0; j < vals.length; j++) {
      view.setFloat32(o + j * 4, vals[j], true);
    }
  }

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(
    filename,
    Buffer.concat([Buffer.from(header, "ascii"), body]),
  );
}

function runBuildLod(args, cwd) {
  const manifest = path.join(repoRoot, "rust/build-lod/Cargo.toml");
  execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      manifest,
      "--release",
      "--no-default-features",
      "--",
      ...args,
    ],
    { cwd, stdio: process.env.SPARK_FIXTURE_VERBOSE ? "inherit" : "pipe" },
  );
}

export function fixturesExist() {
  return Object.values(FIXTURE_FILES).every((f) => fs.existsSync(f));
}

export function generateFixtures({ force = false } = {}) {
  if (!force && fixturesExist()) {
    return FIXTURE_FILES;
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(chunkedDir, { recursive: true });

  writeSyntheticPly(FIXTURE_FILES.ply, FIXTURE_SPLATS);
  writeSyntheticPly(FIXTURE_FILES.smallPly, FIXTURE_SMALL_SPLATS, 4321);

  // Single-file LoD RAD next to the PLY: fixture.ply -> fixture-lod.rad
  runBuildLod(["--quick", "--rad", "--max-sh=0", FIXTURE_FILES.ply], outDir);

  // Chunked RAD in its own directory (build-lod writes chunks next to the input)
  const chunkedPly = path.join(chunkedDir, "fixture.ply");
  fs.copyFileSync(FIXTURE_FILES.ply, chunkedPly);
  runBuildLod(
    ["--quick", "--rad-chunked", "--max-sh=0", chunkedPly],
    chunkedDir,
  );
  fs.rmSync(chunkedPly);

  if (!fixturesExist()) {
    throw new Error("Fixture generation did not produce the expected files");
  }
  return FIXTURE_FILES;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const force = process.argv.includes("--force");
  const files = generateFixtures({ force });
  for (const [key, file] of Object.entries(files)) {
    console.log(
      `${key}: ${path.relative(repoRoot, file)} (${fs.statSync(file).size} bytes)`,
    );
  }
  const chunks = fs.readdirSync(chunkedDir).filter((f) => f.endsWith(".radc"));
  console.log(`chunks: ${chunks.length}`);
}
