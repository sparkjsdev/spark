// Browser-side test harness for Spark's paged LoD / on-demand rendering tests.
// Loaded by harness.html through the Vite dev server and driven from Playwright
// via `window.harness`.

import * as THREE from "three";
import {
  PagedSplats,
  type SparkHooks,
  SparkRenderer,
  SplatMesh,
  SplatPager,
} from "../../../src/index";
import type { LodTreeInfo } from "../../../src/worker";
import { type FuzzOptions, type FuzzResult, runFuzz } from "./fuzz";

export type RenderMode = "loop" | "ondemand" | "manual";

export interface HarnessInitOptions {
  mode?: RenderMode;
  width?: number;
  height?: number;
  /** Page pool size in pages of 65536 splats */
  maxPages?: number;
  lodSplatCount?: number;
  numLodFetchers?: number;
  lodDisposeTimeoutMs?: number;
  lodRaycast?: number;
  fetchPause?: number;
  /**
   * Extra scalar SparkRenderer options. Only JSON-serializable values can
   * cross page.evaluate, and a narrow type keeps Playwright's argument
   * serialization types from recursing into SparkRendererOptions.
   */
  spark?: Record<string, number | boolean | string>;
}

interface HeldPoint {
  name: string;
  info: unknown;
  seq: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Hook controller: lets a test hold execution at named async points, release
 * them in a chosen order, or inject faults.
 */
class HookController implements SparkHooks {
  private holds = new Set<string>();
  private held: HeldPoint[] = [];
  private faults = new Map<string, string[]>();
  private seq = 0;
  log: { seq: number; name: string; t: number; held: boolean }[] = [];
  /** Names to record in the log (all when undefined) */
  logFilter?: Set<string>;

  point(name: string, info?: unknown): undefined | Promise<void> {
    const seq = ++this.seq;
    const fault = this.faults.get(name);
    if (fault && fault.length > 0) {
      const message = fault.shift() as string;
      this.record(seq, name, false);
      throw new Error(message);
    }
    if (!this.holds.has(name)) {
      this.record(seq, name, false);
      return undefined;
    }
    this.record(seq, name, true);
    return new Promise<void>((resolve, reject) => {
      this.held.push({ name, info, seq, resolve, reject });
    });
  }

  private record(seq: number, name: string, held: boolean) {
    if (!this.logFilter || this.logFilter.has(name)) {
      this.log.push({ seq, name, t: performance.now(), held });
    }
  }

  hold(name: string) {
    this.holds.add(name);
  }

  unhold(name: string) {
    this.holds.delete(name);
  }

  unholdAll() {
    this.holds.clear();
  }

  /** Number of executions currently parked at `name` (all names if omitted) */
  heldCount(name?: string) {
    return this.held.filter((h) => !name || h.name === name).length;
  }

  heldNames() {
    return this.held.map((h) => h.name);
  }

  /** Release up to `count` parked executions at `name` (FIFO). Returns released count. */
  release(name?: string, count = 1) {
    let released = 0;
    for (let i = 0; i < this.held.length && released < count; ) {
      const h = this.held[i];
      if (!name || h.name === name) {
        this.held.splice(i, 1);
        h.resolve();
        released++;
      } else {
        i++;
      }
    }
    return released;
  }

  releaseAll() {
    const held = this.held;
    this.held = [];
    for (const h of held) h.resolve();
    return held.length;
  }

  /** Make the next `count` executions of `name` throw `message`. */
  failNext(name: string, message = `Injected fault at ${name}`, count = 1) {
    const list = this.faults.get(name) ?? [];
    for (let i = 0; i < count; i++) list.push(message);
    this.faults.set(name, list);
  }

  /** Reject a parked execution (fault injection at a held point). */
  rejectHeld(name: string, message = `Injected fault at ${name}`) {
    const index = this.held.findIndex((h) => h.name === name);
    if (index < 0) return false;
    const [h] = this.held.splice(index, 1);
    h.reject(new Error(message));
    return true;
  }

  reset() {
    this.releaseAll();
    this.holds.clear();
    this.faults.clear();
    this.log = [];
  }
}

interface MeshRecord {
  name: string;
  mesh: SplatMesh;
  url: string;
}

export class Harness {
  THREE = THREE;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  spark!: SparkRenderer;
  hooks = new HookController();
  mode: RenderMode = "manual";

  meshes = new Map<string, MeshRecord>();
  /** Stable names for PagedSplats instances (survive remove/re-add) */
  private splatsNames = new Map<object, string>();

  renders = 0;
  dirtyEvents: number[] = [];
  errors: string[] = [];
  private scheduled = false;
  private loopHandle = false;
  pagerUpdates = 0;
  initialized = false;

  constructor() {
    window.addEventListener("error", (event) => {
      this.errors.push(`error: ${event.message}`);
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason as { message?: string } | string;
      const message =
        typeof reason === "string"
          ? reason
          : (reason?.message ?? String(reason));
      this.errors.push(`unhandledrejection: ${message}`);
    });
    const origError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      this.errors.push(`console.error: ${args.map(String).join(" ")}`);
      origError(...args);
    };
    const origWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      this.warnings.push(`console.warn: ${args.map(String).join(" ")}`);
      origWarn(...args);
    };
  }
  warnings: string[] = [];

  init(options: HarnessInitOptions = {}) {
    if (this.initialized) {
      throw new Error("Harness already initialized; reload the page");
    }
    this.initialized = true;
    const width = options.width ?? 256;
    const height = options.height ?? 256;
    this.mode = options.mode ?? "manual";

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height);
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 100);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -4);
    this.camera.updateMatrixWorld();

    const maxPages = options.maxPages ?? 4;
    this.spark = new SparkRenderer({
      renderer: this.renderer,
      maxPagedSplats: maxPages * 65536,
      lodSplatCount: options.lodSplatCount ?? 30000,
      numLodFetchers: options.numLodFetchers ?? 1,
      lodDisposeTimeoutMs: options.lodDisposeTimeoutMs ?? 3000,
      // Disable raycast traverses unless a test asks for them; they add a
      // second traverse per LoD callback that only makes traces noisier.
      lodRaycast: options.lodRaycast ?? 0,
      hooks: this.hooks,
      onDirty: () => this.onDirty(),
      ...(options.spark ?? {}),
    });
    this.scene.add(this.spark);

    if (options.fetchPause !== undefined) {
      // Applied when the pager is created (see pagerHook)
      this.fetchPause = options.fetchPause;
    }

    if (this.mode === "loop") {
      this.loopHandle = true;
      this.renderer.setAnimationLoop(() => this.render());
    }
  }
  private fetchPause?: number;

  private onDirty() {
    this.dirtyEvents.push(performance.now());
    if (this.mode === "ondemand" && !this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => {
        this.scheduled = false;
        this.render();
      });
    }
  }

  setMode(mode: RenderMode) {
    if (this.mode === "loop" && mode !== "loop") {
      this.renderer.setAnimationLoop(null);
      this.loopHandle = false;
    }
    this.mode = mode;
    if (mode === "loop" && !this.loopHandle) {
      this.loopHandle = true;
      this.renderer.setAnimationLoop(() => this.render());
    }
  }

  /** Render one frame now (works in every mode). */
  render() {
    this.renders += 1;
    this.renderer.render(this.scene, this.camera);
    // Pick up the pager once it exists so the tests can observe its counters
    const pager = this.spark.pager;
    if (pager && !this.pagerHooked) {
      this.pagerHooked = true;
      if (this.fetchPause !== undefined) pager.fetchPause = this.fetchPause;
      const prev = pager.onUpdate;
      pager.onUpdate = () => {
        this.pagerUpdates += 1;
        prev?.();
      };
      // Count fetched chunks dropped because no page could be allocated
      // (processFetched's "no pages available" branch).
      const privatePager = pager as unknown as {
        allocateFreeable(): number | undefined;
      };
      const origAllocateFreeable = privatePager.allocateFreeable.bind(pager);
      privatePager.allocateFreeable = () => {
        const page = origAllocateFreeable();
        if (page === undefined) this.pagerDrops += 1;
        return page;
      };
    }
  }
  private pagerHooked = false;
  pagerDrops = 0;

  get pager(): SplatPager | undefined {
    return this.spark.pager;
  }

  private nameFor(splats: object | undefined): string {
    if (!splats) return "?";
    return this.splatsNames.get(splats) ?? "<unknown>";
  }

  /** Add a paged SplatMesh loading a chunked -lod.rad URL. */
  addPaged(
    name: string,
    url: string,
    opts: { position?: [number, number, number]; lodScale?: number } = {},
  ) {
    if (this.meshes.has(name)) {
      throw new Error(`mesh ${name} already exists`);
    }
    const mesh = new SplatMesh({ url, paged: true, lodScale: opts.lodScale });
    if (opts.position) mesh.position.set(...opts.position);
    if (mesh.paged) this.splatsNames.set(mesh.paged, name);
    this.meshes.set(name, { name, mesh, url });
    this.scene.add(mesh);
    return name;
  }

  /** Add a regular (non-paged) SplatMesh; `lod` enables LoD for -lod.rad files */
  addMesh(
    name: string,
    url: string,
    opts: { position?: [number, number, number]; lod?: boolean } = {},
  ) {
    if (this.meshes.has(name)) {
      throw new Error(`mesh ${name} already exists`);
    }
    const mesh = new SplatMesh({ url, lod: opts.lod });
    if (opts.position) mesh.position.set(...opts.position);
    this.meshes.set(name, { name, mesh, url });
    this.scene.add(mesh);
    mesh.initialized.then(() => {
      const splats = mesh.packedSplats?.lodSplats ?? mesh.extSplats?.lodSplats;
      if (splats) this.splatsNames.set(splats, name);
    });
    return name;
  }

  private rec(name: string) {
    const rec = this.meshes.get(name);
    if (!rec) throw new Error(`unknown mesh ${name}`);
    return rec;
  }

  remove(name: string) {
    this.scene.remove(this.rec(name).mesh);
  }

  /** Re-add a previously removed (not disposed) mesh */
  readd(name: string) {
    this.scene.add(this.rec(name).mesh);
  }

  dispose(name: string) {
    const rec = this.rec(name);
    this.scene.remove(rec.mesh);
    rec.mesh.dispose();
  }

  /** Remove + dispose + forget the name so it can be reused */
  destroy(name: string) {
    this.dispose(name);
    this.meshes.delete(name);
  }

  setVisible(name: string, visible: boolean) {
    this.rec(name).mesh.visible = visible;
  }

  setPosition(name: string, position: [number, number, number]) {
    this.rec(name).mesh.position.set(...position);
  }

  inScene(name: string) {
    return this.rec(name).mesh.parent === this.scene;
  }

  async awaitInitialized(name: string) {
    await this.rec(name).mesh.initialized;
  }

  moveCamera(
    position: [number, number, number],
    lookAt: [number, number, number] = [0, 0, -4],
  ) {
    this.camera.position.set(...position);
    this.camera.lookAt(...lookAt);
    this.camera.updateMatrixWorld();
  }

  /** Count pixels with any visible color in the last rendered frame. */
  countLitPixels(threshold = 24) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const { width, height } = gl.canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > threshold) lit++;
    }
    return lit;
  }

  /** Is there any asynchronous work in flight? */
  inFlight() {
    const spark = this.spark;
    const pagerState = spark.pager?.debugState();
    const lodWorker = spark.lodWorker as { queue: unknown[] | null } | null;
    const reasons: string[] = [];
    if (spark.sorting) reasons.push("sorting");
    if (spark.sortTimeoutId !== -1) reasons.push("sortTimeout");
    if (lodWorker && lodWorker.queue != null) reasons.push("lodCallback");
    if (pagerState && pagerState.fetchers.length > 0) reasons.push("fetchers");
    if (this.scheduled) reasons.push("renderScheduled");
    if (this.mode === "loop") reasons.push("loop");
    for (const [name, rec] of this.meshes) {
      if (!rec.mesh.isInitialized && rec.mesh.parent === this.scene) {
        // Only count if it can still complete
        reasons.push(`init:${name}`);
      }
    }
    return reasons;
  }

  /**
   * Wait until nothing asynchronous is in flight for `settleMs`, or until
   * `timeoutMs` passes. Returns the in-flight reasons at exit (empty = quiet).
   * Loop mode never counts as quiet unless `ignoreLoop` is true.
   */
  async waitQuiet({
    settleMs = 150,
    timeoutMs = 10000,
    ignoreLoop = false,
  } = {}): Promise<string[]> {
    const start = performance.now();
    let quietSince: number | null = null;
    while (performance.now() - start < timeoutMs) {
      const reasons = this.inFlight().filter(
        (r) => !(ignoreLoop && r === "loop"),
      );
      if (reasons.length === 0) {
        if (quietSince === null) quietSince = performance.now();
        if (performance.now() - quietSince >= settleMs) return [];
      } else {
        quietSince = null;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.inFlight();
  }

  /**
   * Wait until the pipeline is fully drained: quiet, and no pending pager
   * queues. In loop/ondemand mode this is the "converged" state.
   */
  async waitIdle({ timeoutMs = 15000, settleMs = 200 } = {}) {
    const start = performance.now();
    let idleSince: number | null = null;
    while (performance.now() - start < timeoutMs) {
      if (!this.isBusy()) {
        if (idleSince === null) idleSince = performance.now();
        if (performance.now() - idleSince >= settleMs) return true;
      } else {
        idleSince = null;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  }

  /** Any in-flight work or un-consumed queued work (ignoring the render loop) */
  isBusy() {
    const s = this.snapshot();
    return (
      s.inFlight.filter((r) => r !== "loop").length > 0 ||
      s.pager.fetched > 0 ||
      s.pager.lodTreeUpdates > 0 ||
      s.pager.newUploads > 0 ||
      s.pager.readyUploads > 0 ||
      s.lodUpdates > 0 ||
      s.sortDirty ||
      s.lodInitQueue > 0
    );
  }

  /**
   * Manual-mode convergence: keep rendering frames until nothing is busy for
   * `idleFrames` consecutive frames. Returns true if converged.
   */
  async renderUntilIdle({ timeoutMs = 30000, idleFrames = 3 } = {}) {
    const start = performance.now();
    let idle = 0;
    while (performance.now() - start < timeoutMs) {
      this.render();
      await new Promise((r) => requestAnimationFrame(r));
      await this.sleep(30);
      if (!this.isBusy() && !this.spark.dirty) {
        idle += 1;
        if (idle >= idleFrames) return true;
      } else {
        idle = 0;
      }
    }
    return false;
  }

  sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** JSON-serializable view of renderer + pager state */
  snapshot() {
    const spark = this.spark;
    const pager = spark.pager;
    const state = pager?.debugState();
    const lodIds: {
      name: string;
      lodId: number;
      rootPage?: number;
      paged: boolean;
    }[] = [];
    for (const [splats, record] of spark.lodIds.entries()) {
      lodIds.push({
        name: this.nameFor(splats),
        lodId: record.lodId,
        rootPage: record.rootPage,
        paged: splats instanceof PagedSplats,
      });
    }
    const meshes: Record<
      string,
      {
        inScene: boolean;
        visible: boolean;
        initialized: boolean;
        numSplats: number;
        pagedNumSplats?: number;
        pagedAborted?: boolean;
        pagedHasIndicesTexture?: boolean;
      }
    > = {};
    for (const [name, rec] of this.meshes) {
      const paged = rec.mesh.paged;
      meshes[name] = {
        inScene: rec.mesh.parent === this.scene,
        visible: rec.mesh.visible,
        initialized: rec.mesh.isInitialized,
        numSplats: rec.mesh.numSplats,
        pagedNumSplats: paged?.numSplats,
        pagedAborted: paged?.abortController.signal.aborted,
        pagedHasIndicesTexture: paged
          ? paged.dynoIndices.value !== SplatPager.emptyIndicesTexture
          : undefined,
      };
    }
    return {
      renders: this.renders,
      dirtyEvents: this.dirtyEvents.length,
      pagerUpdates: this.pagerUpdates,
      pagerDrops: this.pagerDrops,
      activeSplats: spark.activeSplats,
      sorting: spark.sorting,
      sortDirty: spark.sortDirty,
      lodDirty: spark.lodDirty,
      lodUpdates: spark.lodUpdates.length,
      lodInitQueue: spark.lodInitQueue.length,
      lodIds,
      pagerId: spark.pagerId,
      hasPager: !!pager,
      inFlight: this.inFlight(),
      accumulatorsFree: spark.accumulators.length,
      meshes,
      pager: {
        maxPages: state?.maxPages ?? 0,
        freelist: state?.freelist ?? [],
        freeable: state?.freeable ?? [],
        mapped: (state?.mapped ?? []).map(({ page, splats, chunk }) => ({
          page,
          name: this.nameFor(splats),
          chunk,
        })),
        fetchers: (state?.fetchers ?? []).map(({ splats, chunk }) => ({
          name: this.nameFor(splats),
          chunk,
        })),
        fetched: state?.fetched.length ?? 0,
        lodTreeUpdates: state?.lodTreeUpdates.length ?? 0,
        newUploads: state?.newUploads.length ?? 0,
        readyUploads: state?.readyUploads.length ?? 0,
        fetchPriority: (state?.fetchPriority ?? []).map(
          ({ splats, chunk }) => ({ name: this.nameFor(splats), chunk }),
        ),
      },
      held: this.hooks.heldNames(),
      errors: this.errors.slice(),
      warnings: this.warnings.slice(),
    };
  }

  /** Pages currently mapped for a named paged mesh, keyed by chunk */
  residentChunks(name: string): Record<number, number> {
    const rec = this.rec(name);
    const pager = this.spark.pager;
    if (!pager || !rec.mesh.paged) return {};
    const chunks = pager.splatsChunkToPage.get(rec.mesh.paged);
    const out: Record<number, number> = {};
    chunks?.forEach((entry, chunk) => {
      if (entry) out[chunk] = entry.page;
    });
    return out;
  }

  /** Seeded random interleaving of actions, see fuzz.ts */
  fuzz(options: FuzzOptions): Promise<FuzzResult> {
    return runFuzz(this, options);
  }

  /** Direct call into the LoD worker (test introspection) */
  async lodWorkerCall<T>(name: string, args: unknown): Promise<T> {
    const worker = (
      this.spark as unknown as { ensureLodWorker(): unknown }
    ).ensureLodWorker() as {
      call(name: string, args: unknown): Promise<T>;
    };
    return worker.call(name, args);
  }

  /**
   * Pager table invariants plus cross-check against the Rust LoD trees.
   * The Rust cross-check is only meaningful once pending updates have been
   * drained; when they have not, it is skipped (reported in `skipped`).
   */
  async checkInvariants(): Promise<{ errors: string[]; skipped: string[] }> {
    const spark = this.spark;
    const errors: string[] = [];
    const skipped: string[] = [];
    const pager = spark.pager;
    if (!pager) return { errors, skipped: ["no pager"] };

    const live = new Set<PagedSplats>();
    for (const splats of spark.lodIds.keys()) {
      if (splats instanceof PagedSplats) live.add(splats);
    }
    errors.push(...pager.checkInvariants(live));

    // accumulators freelist sanity: 2 pool + display/current juggling
    const free = spark.accumulators.length;
    if (free < 1 || free > 2) {
      errors.push(`accumulators freelist size ${free} (expected 1..2)`);
    }

    const state = pager.debugState();
    const lodCallbackActive =
      (spark.lodWorker as { queue: unknown[] | null } | null)?.queue != null;
    const drained =
      state.lodTreeUpdates.length === 0 &&
      spark.lodUpdates.length === 0 &&
      !lodCallbackActive;
    if (!drained) {
      skipped.push("rust cross-check (pending updates or LoD callback active)");
      return { errors, skipped };
    }

    // Live tree ids in Rust must be exactly the pager tree + tracked lodIds
    const { lodIds: rustIds } = await this.lodWorkerCall<{
      lodIds: number[];
    }>("getLodTreeIds", {});
    const expectedIds = new Set<number>();
    if (spark.pagerId) expectedIds.add(spark.pagerId);
    for (const record of spark.lodIds.values()) expectedIds.add(record.lodId);
    // Re-check drained-ness: if a callback started meanwhile, results are moot
    if (
      (spark.lodWorker as { queue: unknown[] | null } | null)?.queue != null
    ) {
      skipped.push("rust cross-check (LoD callback started during check)");
      return { errors, skipped };
    }
    const rustSet = new Set(rustIds);
    for (const id of rustSet) {
      if (!expectedIds.has(id)) errors.push(`rust has leaked lod tree ${id}`);
    }
    for (const id of expectedIds) {
      if (!rustSet.has(id)) errors.push(`rust missing lod tree ${id}`);
    }

    for (const [splats, record] of spark.lodIds.entries()) {
      if (!(splats instanceof PagedSplats)) continue;
      if (!rustSet.has(record.lodId)) continue;
      const info = await this.lodWorkerCall<LodTreeInfo>("getLodTreeInfo", {
        lodId: record.lodId,
      });
      const name = this.nameFor(splats);
      const chunks = pager.splatsChunkToPage.get(splats) ?? [];
      const NONE = 0xffffffff;
      const maxChunks = Math.max(chunks.length, info.chunkToPage.length);
      for (let chunk = 0; chunk < maxChunks; chunk++) {
        const jsPage = chunks[chunk]?.page;
        const rustPage =
          chunk < info.chunkToPage.length ? info.chunkToPage[chunk] : NONE;
        const rustPageOrUndef = rustPage === NONE ? undefined : rustPage;
        if (jsPage !== rustPageOrUndef) {
          errors.push(
            `${name} chunk ${chunk}: pager page ${jsPage} != rust chunk_to_page ${rustPageOrUndef}`,
          );
        }
      }
      for (let page = 0; page < info.pageToChunk.length; page++) {
        const rustChunk = info.pageToChunk[page];
        if (rustChunk === NONE) continue;
        const owner = pager.pageToSplatsChunk[page];
        if (!owner || owner.splats !== splats || owner.chunk !== rustChunk) {
          errors.push(
            `${name} rust page_to_chunk[${page}]=${rustChunk} but pager page owner is ${owner ? `${this.nameFor(owner.splats)}:${owner.chunk}` : "none"}`,
          );
        }
      }
      const rustRoot =
        info.chunkToPage.length > 0 && info.chunkToPage[0] !== NONE
          ? info.chunkToPage[0]
          : undefined;
      if (record.rootPage !== rustRoot) {
        errors.push(
          `${name} rootPage ${record.rootPage} != rust chunk_to_page[0] ${rustRoot}`,
        );
      }
    }
    return { errors, skipped };
  }
}

declare global {
  interface Window {
    harness: Harness;
    harnessReady: boolean;
  }
}

window.harness = new Harness();
window.harnessReady = true;
