import * as THREE from "three";
import { SPARK_ENABLE_HOOKS, setSparkHook } from "../../src/hooks.js";
import {
  PackedSplats,
  type PackedSplatsOptions,
  SparkRenderer,
  type SparkRendererOptions,
  SplatMesh,
  type SplatMeshOptions,
} from "../../src/index.js";

declare global {
  interface Window {
    harness: Harness;
    // Installed by harness.fixture.ts; see Harness.holdRequest().
    __holdRequest: (url: string) => Promise<number>;
    __awaitRequested: (id: number) => Promise<void>;
    __releaseRequest: (id: number) => Promise<void>;
  }
}

/** A hook point Spark will pause at; see Harness.holdHook(). */
export type HookHold = {
  /** Resolves once Spark is paused at the hook point. */
  reached: Promise<void>;
  /** Let Spark continue. */
  release: () => void;
};

type ArmedHold = {
  match?: (context?: Record<string, unknown>) => boolean;
  reached: () => void;
  releasePromise: Promise<void>;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export type Transform = {
  position?: [number, number, number];
  quaternion?: [number, number, number, number];
  /** Euler XYZ rotation in degrees. */
  rotation?: [number, number, number];
  /** Point the object's -Z axis at this world position (applied after position). */
  lookAt?: [number, number, number];
  scale?: number | [number, number, number];
  visible?: boolean;
};

export type CameraOptions = {
  type?: "perspective" | "orthographic";
  /** Perspective vertical field of view in degrees. */
  fov?: number;
  /** Orthographic half-height in world units. */
  size?: number;
  near?: number;
  far?: number;
} & Transform;

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export class Harness {
  scene = new THREE.Scene();
  renderer: THREE.WebGLRenderer;
  spark?: SparkRenderer;
  camera?: THREE.Camera;
  private meshes: SplatMesh[] = [];
  private renderScheduled = false;
  /** Hook holds armed by holdHook(), by hook name, in arming order. */
  private holds = new Map<string, ArmedHold[]>();

  constructor(width = 256, height = 256) {
    this.renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height);
    document.body.appendChild(this.renderer.domElement);
    if (SPARK_ENABLE_HOOKS) {
      setSparkHook((name, context) => this.onHook(name, context));
    }
  }

  createSpark(options: Partial<Omit<SparkRendererOptions, "renderer">> = {}) {
    this.spark = new SparkRenderer({
      renderer: this.renderer,
      onDirty: () => this.requestRender(),
      ...options,
    });
    this.scene.add(this.spark);
    return this.spark;
  }

  createCamera({
    type = "perspective",
    fov = 70,
    size = 1,
    near = 0.01,
    far = 1000,
    ...transform
  }: CameraOptions = {}) {
    const { width, height } = this.renderer.getSize(new THREE.Vector2());
    const aspect = width / height;
    this.camera =
      type === "perspective"
        ? new THREE.PerspectiveCamera(fov, aspect, near, far)
        : new THREE.OrthographicCamera(
            -size * aspect,
            size * aspect,
            size,
            -size,
            near,
            far,
          );
    this.setTransform(this.camera, transform);
    return this.camera;
  }

  /** Load splats once so several meshes can share them via `addSplatMesh({ packedSplats })`. */
  createPackedSplats(options: PackedSplatsOptions) {
    return new PackedSplats(options);
  }

  addSplatMesh({
    position,
    quaternion,
    rotation,
    lookAt,
    scale,
    visible,
    ...options
  }: SplatMeshOptions & Transform) {
    const mesh = new SplatMesh(options);
    this.setTransform(mesh, {
      position,
      quaternion,
      rotation,
      lookAt,
      scale,
      visible,
    });
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  setTransform(
    obj: THREE.Object3D,
    { position, quaternion, rotation, lookAt, scale, visible }: Transform,
  ) {
    if (position) obj.position.set(...position);
    if (quaternion) obj.quaternion.set(...quaternion);
    if (rotation) {
      const [x, y, z] = rotation.map(THREE.MathUtils.degToRad);
      obj.rotation.set(x, y, z);
    }
    if (lookAt) obj.lookAt(...lookAt);
    if (typeof scale === "number") obj.scale.setScalar(scale);
    else if (scale) obj.scale.set(...scale);
    if (visible !== undefined) obj.visible = visible;
  }

  /** Schedule a render on the next animation frame, coalescing repeated calls. */
  requestRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  /**
   * Render until Spark has nothing more to show: all meshes loaded, no render
   * pending, no sort or LoD work in flight, and no paged chunks being fetched
   * or waiting to be paged in. Pass `waitForFetches: false` to ignore chunk
   * requests still in flight (e.g. ones a test is deliberately holding back).
   */
  async settle({
    timeoutMs = 60_000,
    waitForFetches = true,
  }: { timeoutMs?: number; waitForFetches?: boolean } = {}) {
    const { spark } = this;
    if (!spark) throw new Error("createSpark() must be called before settle()");
    if (!this.camera) {
      throw new Error("createCamera() must be called before settle()");
    }
    await Promise.all(this.meshes.map((mesh) => mesh.initialized));
    this.requestRender();
    await this.waitUntil(
      () => {
        const { pager } = spark;
        const pagerBusy = waitForFetches
          ? pager?.isPending()
          : pager?.hasQueued();
        return !(
          this.renderScheduled ||
          spark.sorting ||
          spark.sortDirty ||
          spark.lodDirty ||
          spark.lodWorker?.queue != null ||
          pagerBusy
        );
      },
      timeoutMs,
      "Spark to settle",
    );
  }

  /**
   * Wait until `predicate` holds for two consecutive animation frames.
   * `what` names the condition in the timeout error.
   */
  async waitUntil(
    predicate: () => boolean,
    timeoutMs = 60_000,
    what = "condition",
  ) {
    const deadline = performance.now() + timeoutMs;
    let quietFrames = 0;
    while (quietFrames < 2) {
      await nextFrame();
      quietFrames = predicate() ? quietFrames + 1 : 0;
      if (performance.now() > deadline) {
        throw new Error(`Timed out waiting for ${what}`);
      }
    }
  }

  /** Whether the library was built with hook points (SPARK_ENABLE_HOOKS=1). */
  get hooksEnabled() {
    return SPARK_ENABLE_HOOKS;
  }

  /**
   * Pause Spark the next time it reaches the named hook point, or the next
   * time `match` accepts the hook's context if given. Each hold fires once.
   */
  holdHook(name: string, match?: ArmedHold["match"]): HookHold {
    const reached = deferred();
    const release = deferred();
    const armed = this.holds.get(name) ?? [];
    armed.push({
      match,
      reached: reached.resolve,
      releasePromise: release.promise,
    });
    this.holds.set(name, armed);
    return { reached: reached.promise, release: release.resolve };
  }

  /** Spark hook callback: pause at the first armed hold that matches, if any. */
  private onHook(name: string, context?: Record<string, unknown>) {
    const armed = this.holds.get(name);
    const index = armed?.findIndex((hold) => hold.match?.(context) ?? true);
    if (!armed || index === undefined || index < 0) return undefined;
    const [hold] = armed.splice(index, 1);
    hold.reached();
    return hold.releasePromise;
  }

  /**
   * Hold back the first request matching the URL glob until `release()`;
   * later matching requests pass through. Await this before triggering the
   * request. `requested` resolves once the held request has been issued.
   */
  async holdRequest(url: string) {
    const id = await window.__holdRequest(url);
    return {
      requested: window.__awaitRequested(id),
      release: () => window.__releaseRequest(id),
    };
  }

  /** The current canvas contents as a PNG data URL. */
  getPixels() {
    return this.renderer.domElement.toDataURL("image/png");
  }

  private render() {
    if (!this.camera) {
      throw new Error("createCamera() must be called before rendering");
    }
    this.renderer.render(this.scene, this.camera);
  }
}

window.harness = new Harness();
