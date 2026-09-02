import assert from "node:assert/strict";
import test from "node:test";
import { replaceU32DataTexture } from "../src/U32DataTexture.js";

test("replaces a sampled texture before disposing the older generation", () => {
  const first = replaceU32DataTexture(
    undefined,
    undefined,
    new Uint32Array(4),
    1,
  );
  let firstDisposed = false;
  first.texture.addEventListener("dispose", () => {
    firstDisposed = true;
  });

  const second = replaceU32DataTexture(
    first.texture,
    first.retired,
    new Uint32Array(4),
    1,
  );
  assert.notStrictEqual(second.texture, first.texture);
  assert.strictEqual(firstDisposed, false);
  assert.strictEqual(second.retired, first.texture);

  const third = replaceU32DataTexture(
    second.texture,
    second.retired,
    new Uint32Array(4),
    1,
  );
  assert.strictEqual(firstDisposed, true);
  assert.strictEqual(third.retired, second.texture);
});
