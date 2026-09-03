import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { uploadU32DataTextureRows } from "../src/utils.js";

test("uploads a row chunk at its destination offset", () => {
  const calls: unknown[][] = [];
  const gl = {
    TEXTURE0: 0,
    TEXTURE_2D: 1,
    PIXEL_UNPACK_BUFFER: 2,
    UNPACK_FLIP_Y_WEBGL: 3,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 4,
    RGBA_INTEGER: 5,
    UNSIGNED_INT: 6,
    getParameter: () => false,
    bindBuffer: () => {},
    pixelStorei: () => {},
    texSubImage2D: (...args: unknown[]) => calls.push(args),
  };
  const renderer = {
    getContext: () => gl,
    properties: { get: () => ({ __webglTexture: {} }) },
    state: {
      activeTexture: () => {},
      bindTexture: () => {},
      unbindTexture: () => {},
    },
  };

  uploadU32DataTextureRows(
    renderer as unknown as THREE.WebGLRenderer,
    new THREE.Texture(),
    4096,
    4,
    new Uint32Array(4096 * 4 * 4),
    12,
  );

  assert.deepStrictEqual(calls[0]?.slice(2, 6), [0, 12, 4096, 4]);
});
