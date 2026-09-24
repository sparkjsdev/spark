import * as THREE from "three";
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
  }
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

  constructor(width = 256, height = 256) {
    this.renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height);
    document.body.appendChild(this.renderer.domElement);
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
   * pending, and no sort in flight. Note: gaps between streamed chunks of a
   * paged mesh can look quiet, so this may return early for paged meshes.
   */
  async settle(timeoutMs = 60_000) {
    const { spark } = this;
    if (!spark) throw new Error("createSpark() must be called before settle()");
    if (!this.camera) {
      throw new Error("createCamera() must be called before settle()");
    }
    await Promise.all(this.meshes.map((mesh) => mesh.initialized));
    const deadline = performance.now() + timeoutMs;
    let quietFrames = 0;
    this.requestRender();
    while (quietFrames < 2) {
      await nextFrame();
      const busy =
        this.renderScheduled ||
        spark.sorting ||
        spark.sortDirty ||
        spark.lodDirty ||
        spark.lodWorker?.queue != null ||
        spark.pager?.pending();
      quietFrames = busy ? 0 : quietFrames + 1;
      if (performance.now() > deadline) {
        throw new Error("Timed out waiting for Spark to settle");
      }
    }
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
