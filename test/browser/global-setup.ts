import path from "node:path";
import { fileURLToPath } from "node:url";

// Generates the synthetic LoD fixtures (needs a Rust toolchain for build-lod)
// if they are not already present under test/fixtures/out/.
export default async function globalSetup() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const generator = path.resolve(here, "../fixtures/gen-fixture.mjs");
  const mod = (await import(generator)) as {
    generateFixtures: (opts?: { force?: boolean }) => Record<string, string>;
    fixturesExist: () => boolean;
  };
  if (!mod.fixturesExist()) {
    console.log(
      "[spark test] generating LoD fixtures with build-lod (requires Rust)...",
    );
  }
  mod.generateFixtures();
}
