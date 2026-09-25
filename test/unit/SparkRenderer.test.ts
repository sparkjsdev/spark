import * as THREE from "three";
import { expect, test } from "vitest";
import { SparkRenderer } from "../../src/SparkRenderer";
import { SplatGenerator } from "../../src/SplatGenerator";
import { Dyno, dynoBlock } from "../../src/dyno/base";
import { Gsplat } from "../../src/dyno/splats";

const stubRenderer = {
  info: { render: { frame: 0 } },
  xr: { enabled: false, isPresenting: false },
  getContext: () => ({ getExtension: () => null }),
  getRenderTarget: () => null,
  getActiveCubeFace: () => 0,
  getActiveMipmapLevel: () => 0,
  setRenderTarget: () => {},
  getDrawingBufferSize: (size: THREE.Vector2) => size.set(1, 1),
  readRenderTargetPixelsAsync: async () => {},
  render: () => {},
  properties: new WeakMap(),
} as unknown as THREE.WebGLRenderer;

function splatGenerator(numSplats: number) {
  const generator = dynoBlock({ index: "int" }, { gsplat: Gsplat }, () => ({
    gsplat: new Dyno({
      outTypes: { gsplat: Gsplat },
      statements: ({ outputs }) => [
        `${outputs.gsplat}.flags = GSPLAT_FLAG_ACTIVE;`,
      ],
    }).outputs.gsplat,
  }));
  return new SplatGenerator({ numSplats, generator });
}

type Sort = { mappingVersion: number; version: number };

// Runs every pending promise step. Nothing the renderer does here waits on a
// timer, so one turn of the event loop is enough.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

// A renderer on a still scene, with each sort held at the sort worker.
async function setup(...meshes: THREE.Object3D[]) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const spark = new SparkRenderer({ renderer: stubRenderer, enableLod: false });
  spark.readPause = 0;
  scene.add(spark, camera, ...meshes);

  const sorts: Sort[] = [];
  const replies: (() => void)[] = [];
  spark.sortWorker = {
    // Called right after the sort's readback, so current is what it read.
    call: (_: string, args: { numSplats: number }) => {
      const { mappingVersion, version } = spark.current;
      sorts.push({ mappingVersion, version });
      return new Promise((resolve) =>
        replies.push(() => resolve({ ...args, activeSplats: args.numSplats })),
      );
    },
  } as unknown as typeof spark.sortWorker;

  const frame = async () => {
    stubRenderer.info.render.frame += 1;
    spark.onBeforeRender(stubRenderer, scene, camera);
    await flushPromises();
  };
  // Finishes the held sort and renders frames until a frame starts no sort.
  const finishSorts = async () => {
    do {
      replies.shift()?.();
      await flushPromises();
      await frame();
    } while (spark.sorting);
  };

  await finishSorts();
  sorts.length = 0;
  return { spark, camera, sorts, frame, finishSorts };
}

// A camera move during a sort asks for another sort. If a new mapping then
// appears, the new mapping must be sorted next.
test("a new mapping that appears during a sort is sorted next", async () => {
  const mesh = splatGenerator(64);
  const { spark, camera, sorts, frame, finishSorts } = await setup(mesh);
  const m0 = spark.display.mappingVersion;

  camera.position.x += 1;
  await frame();
  camera.position.x += 1;
  await frame();
  mesh.updateMappingVersion();
  await frame();

  await finishSorts();
  expect(sorts.map((s) => s.mappingVersion)).toEqual([m0, m0 + 1]);
});

// Hiding and showing a mesh during a sort must not lose the sort that a
// content change asked for. The camera stays still, as a move would ask again.
test("with a still camera, a mapping that changes back during a sort keeps its sort", async () => {
  const mesh = splatGenerator(64);
  const other = splatGenerator(32);
  const { spark, sorts, frame, finishSorts } = await setup(mesh, other);
  const v0 = spark.display.version;

  mesh.updateVersion();
  await frame();
  mesh.updateVersion();
  await frame();
  other.visible = false;
  await frame();
  other.visible = true;
  await frame();

  await finishSorts();
  expect(sorts.map((s) => s.version)).toEqual([v0 + 1, v0 + 2]);
});

// A content change during a sort is sorted when that sort ends.
test("a change during a sort is sorted after it", async () => {
  const mesh = splatGenerator(64);
  const { spark, sorts, frame, finishSorts } = await setup(mesh);
  const v0 = spark.display.version;

  mesh.updateVersion();
  await frame();
  mesh.updateVersion();
  await frame();

  await finishSorts();
  expect(sorts.map((s) => s.version)).toEqual([v0 + 1, v0 + 2]);
});
