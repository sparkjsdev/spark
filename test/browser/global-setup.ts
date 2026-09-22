import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FIXTURES = ["furry-logo-pedestal.spz"];

const repoRoot = path.resolve(import.meta.dirname, "../..");
const fixturesDir = path.join(import.meta.dirname, "fixtures");

type AssetEntry = { url: string; directory: string };

/** Run build-lod on `input`; it writes `<input>-lod.rad` (and chunks) next to the input. */
function buildLod(input: string, ...args: string[]) {
  console.log(`Building LoD fixture: build-lod ${args.join(" ")} ${input}`);
  execFileSync(
    "cargo",
    [
      "run",
      "--manifest-path",
      "rust/build-lod/Cargo.toml",
      "--release",
      // Skip the wgpu-backed SH clustering (unused here) on headless CI runners.
      ...(process.env.CI ? ["--no-default-features"] : []),
      "--",
      input,
      ...args,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

export default async function globalSetup() {
  const assets: Record<string, AssetEntry> = JSON.parse(
    await readFile(path.join(repoRoot, "examples/assets.json"), "utf8"),
  );
  await mkdir(fixturesDir, { recursive: true });

  for (const name of FIXTURES) {
    const filePath = path.join(fixturesDir, name);
    if (existsSync(filePath)) continue;

    const entry = assets[name];
    if (!entry) throw new Error(`Fixture ${name} not found in assets.json`);

    console.log(`Downloading fixture ${name} from ${entry.url}`);
    const response = await fetch(entry.url);
    if (!response.ok) {
      throw new Error(
        `Failed to download ${name}: ${response.status} ${response.statusText}`,
      );
    }
    await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  }

  const spz = path.join(fixturesDir, "furry-logo-pedestal.spz");
  if (!existsSync(path.join(fixturesDir, "furry-logo-pedestal-lod.rad"))) {
    buildLod(spz, "--quick");
  }

  // The chunked build shares the non-chunked output name, so build it in its
  // own directory from a copy of the input.
  const chunkedDir = path.join(fixturesDir, "chunked");
  const chunkedSpz = path.join(chunkedDir, "furry-logo-pedestal.spz");
  if (!existsSync(path.join(chunkedDir, "furry-logo-pedestal-lod.rad"))) {
    await mkdir(chunkedDir, { recursive: true });
    await copyFile(spz, chunkedSpz);
    buildLod(chunkedSpz, "--quick", "--rad-chunked");
  }
}
