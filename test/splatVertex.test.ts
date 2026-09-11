import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function assertSourceOrder(source: string, snippets: string[]) {
  let previousIndex = -1;
  for (const snippet of snippets) {
    const index = source.indexOf(snippet);
    assert.notEqual(index, -1, `Missing shader invariant: ${snippet}`);
    assert.ok(
      index > previousIndex,
      `Shader invariant is out of order: ${snippet}`,
    );
    previousIndex = index;
  }
}

test("splat vertex XY culling uses the final projected ellipse footprint", async () => {
  const source = await readFile(
    new URL("../src/shaders/splatVertex.glsl", import.meta.url),
    "utf8",
  );

  assertSourceOrder(source, [
    "adjustedStdDev = maxStdDev;",
    "if (abs(clipCenter.z) >= clipCenter.w)",
    "if (enable2DGS && any(zeroScales))",
    "vec2 scaledRenderSize = renderSize * focalAdjustment;",
    "if (isOrthographic)",
    "mat3 cov2D = transpose(J) * cov3D * J;",
    "a += preBlurAmount;",
    "a += fullBlurAmount;",
    "float eigen1 = eigenAvg + eigenDelta;",
    "float scale1 = min(maxPixelRadius, adjustedStdDev * sqrt(eigen1));",
    "vec2 axis1 = eigenVec1 * scale1;",
    "vec2 axis2 = eigenVec2 * scale2;",
    "vec2 ndcScale = 2.0 / scaledRenderSize;",
    "vec2 ndcExtent = abs(ndcScale) * sqrt(axis1 * axis1 + axis2 * axis2);",
    "vec2 ndcCullPadding = max(abs(ndcScale), vec2(1e-6));",
    "if (any(greaterThan(abs(ndcCenter.xy), vec2(clipXY) + ndcExtent + ndcCullPadding)))",
    "vec2 pixelOffset = position.x * axis1 + position.y * axis2;",
  ]);

  assert.doesNotMatch(source, /clipXY\s*\*\s*clipCenter\.w/);
});
