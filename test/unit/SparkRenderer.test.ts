import * as THREE from "three";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PackedSplats } from "../../src/PackedSplats";
import { SparkRenderer } from "../../src/SparkRenderer";
import { SplatGenerator } from "../../src/SplatGenerator";
import { SplatMesh } from "../../src/SplatMesh";
import { Dyno, dynoBlock } from "../../src/dyno/base";
import { Gsplat } from "../../src/dyno/splats";

afterEach(() => {
  vi.restoreAllMocks();
});

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
    dispose() {},
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

async function setupLod() {
  const mesh = new SplatMesh({
    packedSplats: new PackedSplats({
      lodSplats: new PackedSplats({ extra: { lodTree: new Uint32Array(4) } }),
    }),
  });
  const { spark, frame } = await setup(mesh);
  const lodWorker = {
    tryExclusive: (run: (worker: unknown) => unknown) => run(lodWorker),
    call: async () => ({
      lodId: 1,
      keyIndices: {
        [mesh.uuid]: {
          lodId: 1,
          numSplats: 0,
          indices: new Uint32Array(16384),
        },
      },
    }),
    dispose() {},
  };
  spark.lodWorker = lodWorker as unknown as SparkRenderer["lodWorker"];
  spark.enableLod = true;
  spark.enableDriveLod = true;
  return { spark, frame, mesh };
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

// A LoD result can change a mesh mapping between frames, just before a sort
// ends. The new mapping must still be sorted next.
test("a new mapping that appears between frames, just before a sort ends, is sorted next", async () => {
  const mesh = splatGenerator(64);
  const { spark, camera, sorts, frame, finishSorts } = await setup(mesh);
  const m0 = spark.display.mappingVersion;

  camera.position.x += 1;
  await frame();
  camera.position.x += 1;
  await frame();
  mesh.updateMappingVersion();

  await finishSorts();
  expect(sorts.map((s) => s.mappingVersion)).toEqual([m0, m0 + 1]);
});

// Hiding a mesh during a sort changes the mapping without changing any mesh
// mapping version. The new mapping must still be sorted next.
test("a mesh hidden during a sort is sorted next", async () => {
  const mesh = splatGenerator(64);
  const other = splatGenerator(32);
  const { spark, camera, sorts, frame, finishSorts } = await setup(mesh, other);
  const m0 = spark.display.mappingVersion;

  camera.position.x += 1;
  await frame();
  camera.position.x += 1;
  await frame();
  other.visible = false;
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

async function expectNoUnhandledRejection(run: () => Promise<void>) {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  await run();
  await flushPromises();
  process.off("unhandledRejection", unhandled);
  expect(unhandled).not.toHaveBeenCalled();
}

describe("a disposed SparkRenderer", () => {
  test("disposes its LoD index textures", async () => {
    const { spark, frame, mesh } = await setupLod();
    await frame();
    const disposed = vi.fn();
    spark.lodInstances.get(mesh)?.texture.addEventListener("dispose", disposed);

    spark.dispose();

    expect(disposed).toHaveBeenCalledOnce();
  });

  test("does nothing when updated or rendered", async () => {
    const spark = new SparkRenderer({ renderer: stubRenderer });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    spark.dispose();

    await spark.update({ scene, camera });
    spark.onBeforeRender(stubRenderer, scene, camera);

    expect(spark.current.target).toBeNull();
    expect(spark.lodWorker).toBeNull();
  });

  test("creates no sort worker when disposed during the readback", async () => {
    const { spark, camera, frame } = await setup(splatGenerator(64));
    vi.spyOn(stubRenderer, "readRenderTargetPixelsAsync").mockImplementation(
      async () => spark.dispose(),
    );
    camera.position.x += 1;

    await expectNoUnhandledRejection(frame);

    expect(spark.sortWorker).toBeNull();
  });

  test("requests no render", () => {
    const onDirty = vi.fn();
    const spark = new SparkRenderer({ renderer: stubRenderer, onDirty });
    spark.dirty = false;
    spark.dispose();

    spark.setDirty();

    expect(onDirty).not.toHaveBeenCalled();
  });
});
