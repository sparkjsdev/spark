import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import * as THREE from "three";

register(new URL("./glsl-loader.mjs", import.meta.url));

const { SparkRenderer } = await import("../src/SparkRenderer.js");

function makeRendererStub(): THREE.WebGLRenderer {
  return {
    getContext() {
      return {
        getExtension() {
          return null;
        },
      };
    },
  } as THREE.WebGLRenderer;
}

test("SparkRenderer.dispose releases its internal geometry", () => {
  const spark = new SparkRenderer({ renderer: makeRendererStub() });
  const geometry = spark.geometry;
  let disposeEvents = 0;

  geometry.addEventListener("dispose", () => {
    disposeEvents += 1;
  });

  spark.dispose();

  assert.equal(disposeEvents, 1);
});

test("SparkRenderer.dispose does not dispose geometry assigned from outside", () => {
  const spark = new SparkRenderer({ renderer: makeRendererStub() });
  const internalGeometry = spark.geometry;
  const externalGeometry = new THREE.BufferGeometry();
  let internalDisposeEvents = 0;
  let externalDisposeEvents = 0;

  internalGeometry.addEventListener("dispose", () => {
    internalDisposeEvents += 1;
  });
  externalGeometry.addEventListener("dispose", () => {
    externalDisposeEvents += 1;
  });

  spark.geometry = externalGeometry;
  spark.dispose();

  assert.equal(internalDisposeEvents, 1);
  assert.equal(externalDisposeEvents, 0);
});

test("SparkRenderer.dispose is safe to call twice", () => {
  const spark = new SparkRenderer({ renderer: makeRendererStub() });

  spark.dispose();

  assert.doesNotThrow(() => {
    spark.dispose();
  });
});
