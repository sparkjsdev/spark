import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { ExtSplats } from "../src/ExtSplats.js";
import { PackedSplats } from "../src/PackedSplats.js";
import {
  decodeExtSplat,
  encodeExt3Rgb,
  encodeExtSh12Rgb,
  encodeSh1Rgb,
  encodeSh2Rgb,
  encodeSh3Rgb,
  unpackSplat,
} from "../src/utils.js";

function coefficients(length: number, scale = 1) {
  return Float32Array.from(
    { length },
    (_, index) => (((index * 7) % 13) / 6 - 1) * scale,
  );
}

function extendedCoefficients(length: number) {
  const componentScale = [1, -0.5, 0.25];
  return Float32Array.from({ length }, (_, index) => {
    const coefficient = Math.floor(index / 3);
    return 2 ** ((coefficient % 4) - 1) * componentScale[index % 3];
  });
}

function assertArraysClose(
  actual: Float32Array | undefined,
  expected: Float32Array,
  tolerance: number,
) {
  assert.ok(actual);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; ++i) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tolerance,
      `coefficient ${i}: expected ${expected[i]}, got ${actual[i]}`,
    );
  }
}

test("decodes packed SH1 through SH3", () => {
  const encoding = { sh1Max: 2, sh2Max: 3, sh3Max: 4 };
  const sh1 = coefficients(9, encoding.sh1Max);
  const sh2 = coefficients(15, encoding.sh2Max);
  const sh3 = coefficients(21, encoding.sh3Max);
  const extra = {
    sh1: new Uint32Array(2),
    sh2: new Uint32Array(4),
    sh3: new Uint32Array(4),
  };
  encodeSh1Rgb(extra.sh1, 0, sh1, encoding);
  encodeSh2Rgb(extra.sh2, 0, sh2, encoding);
  encodeSh3Rgb(extra.sh3, 0, sh3, encoding);

  const decoded = unpackSplat(
    new Uint32Array(4),
    0,
    encoding,
    extra,
  ).sphericalHarmonics;
  assertArraysClose(decoded.sh1, sh1, encoding.sh1Max / 63 + 1e-6);
  assertArraysClose(decoded.sh2, sh2, encoding.sh2Max / 127 + 1e-6);
  assertArraysClose(decoded.sh3, sh3, encoding.sh3Max / 31 + 1e-6);
});

test("decodes extended SH1 through SH3", () => {
  const sh1 = extendedCoefficients(9);
  const sh2 = extendedCoefficients(15);
  const sh3 = extendedCoefficients(21);
  const extra = {
    sh1: new Uint32Array(4),
    sh2: new Uint32Array(4),
    sh3a: new Uint32Array(4),
    sh3b: new Uint32Array(4),
  };
  encodeExtSh12Rgb(extra.sh1, extra.sh2, 0, sh1, sh2);
  encodeExt3Rgb(extra.sh3a, extra.sh3b, 0, sh3);

  const decoded = decodeExtSplat(
    [new Uint32Array(4), new Uint32Array(4)],
    0,
    extra,
  ).sphericalHarmonics;
  assertArraysClose(decoded.sh1, sh1, 0.02);
  assertArraysClose(decoded.sh2, sh2, 0.02);
  assertArraysClose(decoded.sh3, sh3, 0.02);
});

test("unpackSplat omits unavailable SH bands", () => {
  const decoded = unpackSplat(
    new Uint32Array(4),
    0,
    undefined,
    {},
  ).sphericalHarmonics;
  assert.deepEqual(decoded, {
    sh1: undefined,
    sh2: undefined,
    sh3: undefined,
  });
});

const center = new THREE.Vector3(1, 2, 3);
const scales = new THREE.Vector3(0.1, 0.2, 0.3);
const quaternion = new THREE.Quaternion();
const color = new THREE.Color(0.25, 0.5, 0.75);

test("PackedSplats writes callback SH changes back through setSplat", () => {
  const encoding = { sh1Max: 2, sh2Max: 3, sh3Max: 4 };
  const splats = new PackedSplats({ maxSplats: 1, splatEncoding: encoding });
  splats.pushSplat(center, scales, quaternion, 0.8, color, {
    sh1: coefficients(9, encoding.sh1Max),
    sh2: coefficients(15, encoding.sh2Max),
    sh3: coefficients(21, encoding.sh3Max),
  });

  splats.forEachSplat(
    (index, nextCenter, nextScales, nextQuaternion, opacity, nextColor, sh) => {
      sh.sh1?.fill(0);
      sh.sh2?.fill(0);
      sh.sh3?.fill(0);
      splats.setSplat(
        index,
        nextCenter,
        nextScales,
        nextQuaternion,
        opacity,
        nextColor,
        sh,
      );
    },
  );

  const sh = splats.getSplat(0).sphericalHarmonics;
  assert.deepEqual(sh.sh1, new Float32Array(9));
  assert.deepEqual(sh.sh2, new Float32Array(15));
  assert.deepEqual(sh.sh3, new Float32Array(21));
});

test("PackedSplats preserves SH bands omitted from setSplat", () => {
  const splats = new PackedSplats({ maxSplats: 1 });
  const originalSh2 = coefficients(15);
  splats.pushSplat(center, scales, quaternion, 0.8, color, {
    sh1: coefficients(9),
    sh2: originalSh2,
  });
  const unpacked = splats.getSplat(0);
  splats.setSplat(
    0,
    unpacked.center,
    unpacked.scales,
    unpacked.quaternion,
    unpacked.opacity,
    unpacked.color,
    { sh1: new Float32Array(9) },
  );

  assertArraysClose(
    splats.getSplat(0).sphericalHarmonics.sh2,
    originalSh2,
    1 / 127 + 1e-6,
  );
});

test("ExtSplats writes callback SH changes back through setSplat", () => {
  const splats = new ExtSplats({ maxSplats: 1 });
  splats.pushSplat(center, scales, quaternion, 0.8, color, {
    sh1: extendedCoefficients(9),
    sh2: extendedCoefficients(15),
    sh3: extendedCoefficients(21),
  });

  splats.forEachSplat(
    (index, nextCenter, nextScales, nextQuaternion, opacity, nextColor, sh) => {
      sh.sh1?.fill(0);
      sh.sh2?.fill(0);
      sh.sh3?.fill(0);
      splats.setSplat(
        index,
        nextCenter,
        nextScales,
        nextQuaternion,
        opacity,
        nextColor,
        sh,
      );
    },
  );

  const sh = splats.getSplat(0).sphericalHarmonics;
  assert.deepEqual(sh.sh1, new Float32Array(9));
  assert.deepEqual(sh.sh2, new Float32Array(15));
  assert.deepEqual(sh.sh3, new Float32Array(21));
});

test("pushSplat creates missing lower SH bands", () => {
  const packed = new PackedSplats({ maxSplats: 1 });
  packed.pushSplat(center, scales, quaternion, 0.8, color, {
    sh3: coefficients(21),
  });
  assert.equal(packed.getNumSh(), 3);
  assert.deepEqual(
    packed.getSplat(0).sphericalHarmonics.sh1,
    new Float32Array(9),
  );

  const extended = new ExtSplats({ maxSplats: 1 });
  extended.pushSplat(center, scales, quaternion, 0.8, color, {
    sh3: extendedCoefficients(21),
  });
  assert.equal(extended.getNumSh(), 3);
  assert.deepEqual(
    extended.getSplat(0).sphericalHarmonics.sh2,
    new Float32Array(15),
  );
});
