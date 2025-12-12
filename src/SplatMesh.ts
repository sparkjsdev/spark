import * as THREE from "three";

import init_wasm, { raycast_splats } from "spark-internal-rs";
import { ExtSplats } from "./ExtSplats";
import {
  DEFAULT_SPLAT_ENCODING,
  DynoPackedSplats,
  PackedSplats,
  type SplatEncoding,
} from "./PackedSplats";
import { type RgbaArray, TRgbaArray } from "./RgbaArray";
import { SparkRenderer } from "./SparkRenderer";
import { SplatEdit, SplatEditSdf, SplatEdits } from "./SplatEdit";
import {
  type FrameUpdateContext,
  type GsplatModifier,
  SplatGenerator,
  SplatTransformer,
} from "./SplatGenerator";
import type { SplatFileType } from "./SplatLoader";
import type { SplatSkinning } from "./SplatSkinning";
import { LN_SCALE_MAX, LN_SCALE_MIN } from "./defines";
import {
  Dyno,
  DynoBool,
  DynoFloat,
  DynoInt,
  DynoUsampler2D,
  type DynoVal,
  DynoVec4,
  Gsplat,
  add,
  combineGsplat,
  defineGsplat,
  dyno,
  dynoBlock,
  mul,
  splitGsplat,
  unindentLines,
} from "./dyno";
// import { SplatWorker } from "./splatWorker";
import { getTextureSize } from "./utils";

export type SplatMeshOptions = {
  // URL to fetch a Gaussian splat file from(supports .ply, .splat, .ksplat,
  // .spz formats). (default: undefined)
  url?: string;
  // Raw bytes of a Gaussian splat file to decode directly instead of fetching
  // from URL. (default: undefined)
  fileBytes?: Uint8Array | ArrayBuffer;
  // Override the file type detection for formats that can't be reliably
  // auto-detected (.splat, .ksplat). (default: undefined auto-detects other
  // formats from file contents)
  fileType?: SplatFileType;
  // File name to use for type detection. (default: undefined)
  fileName?: string;
  // Use an existing PackedSplats object as the source instead of loading from
  // a file. Can be used to share a collection of Gsplats among multiple SplatMeshes
  // (default: undefined creates a new empty PackedSplats or decoded from a
  // data source above)
  packedSplats?: PackedSplats;
  // Use an existing SplatSource object as the source instead of loading from file.
  splats?: SplatSource;
  // Reserve space for at least this many splats when constructing the mesh
  // initially. (default: determined by file)
  maxSplats?: number;
  // Callback function to programmatically create splats at initialization
  // in provided PackedSplats. (default: undefined)
  constructSplats?: (splats: PackedSplats) => Promise<void> | void;
  // Callback function called while downloading and initializing (default: undefined)
  onProgress?: (event: ProgressEvent) => void;
  // Callback function that is called when mesh initialization is complete.
  // (default: undefined)
  onLoad?: (mesh: SplatMesh) => Promise<void> | void;
  // Controls whether SplatEdits have any effect on this mesh. (default: true)
  editable?: boolean;
  // Controls whether SplatMesh participates in Three.js raycasting (default: true)
  raycastable?: boolean;
  // Callback function that is called every frame to update the mesh.
  // Call mesh.updateVersion() if splats need to be regenerated due to some change.
  // Calling updateVersion() is not necessary for object transformations, recoloring,
  // or opacity adjustments as these are auto-detected. (default: undefined)
  onFrame?: ({
    mesh,
    time,
    deltaTime,
  }: { mesh: SplatMesh; time: number; deltaTime: number }) => void;
  // Gsplat modifier to apply in object-space before any transformations.
  // A GsplatModifier is a dyno shader-graph block that transforms an input
  // gsplat: DynoVal<Gsplat> to an output gsplat: DynoVal<Gsplat> with gsplat.center
  // coordinate in object-space. (default: undefined)
  objectModifier?: GsplatModifier;
  // Gsplat modifier to apply in world-space after transformations.
  // (default: undefined)
  worldModifier?: GsplatModifier;
  // Override the default splat encoding ranges for the PackedSplats.
  // (default: undefined)
  splatEncoding?: SplatEncoding;
  // Set to true to load/use "extended splat" encoding with float32 x/y/z
  // TODO: Not implemented yet
  extSplats?: boolean | ExtSplats;
  // Enable LOD. If a number is provided, it will be used as LoD level base,
  // otherwise the default 1.5 is used. When loading a file without pre-computed
  // LoD it will use the "quick lod" algorithm to generate one on-the-fly with
  // the selected LoD level base. (default: undefined=false)
  lod?: boolean | number;
  // Keep the original PackedSplats data before creating LoD version. (default: false)
  nonLod?: boolean | "wait";
  // Force enable/disable LoD (default: enabled iff packedSplats.lodSplats is not null)
  enableLod?: boolean;
  // LoD scale to apply @default 1.0
  lodScale?: number;
  // Foveation scale to apply outside the view frustum (but not behind viewer)
  // (default: 1.0)
  outsideFoveate?: number;
  // Foveation scale to apply behind viewer
  // (default: 1.0)
  behindFoveate?: number;
  // Full-width angle in degrees of fixed foveation cone along the view direction. 0.0=disable
  // (default: 0.0)
  coneFov?: number;
  // Foveation scale to apply at the edge of the cone
  // (default: 1.0)
  coneFoveate?: number;
};

export type SplatMeshContext = {
  transform: SplatTransformer;
  viewToWorld: SplatTransformer;
  worldToView: SplatTransformer;
  viewToObject: SplatTransformer;
  recolor: DynoVec4<THREE.Vector4>;
  time: DynoFloat;
  deltaTime: DynoFloat;
  numSplats: DynoInt<string>;
  // splats: DynoPackedSplats;
  splats: SplatSource;
  enableLod: DynoBool<string>;
  lodIndices: DynoUsampler2D<"lodIndices", THREE.DataTexture>;
};

export interface SplatSource {
  prepareFetchSplat(): void;
  dispose(): void;

  getNumSplats(): number;
  hasRgbDir(): boolean;
  getNumSh(): number;
  setMaxSh(maxSh: number): void;

  fetchSplat({
    index,
    viewOrigin,
  }: { index: DynoVal<"int">; viewOrigin?: DynoVal<"vec3"> }): DynoVal<
    typeof Gsplat
  >;
}

export class EmptySplatSource implements SplatSource {
  fetchDyno = new Dyno({
    inTypes: {},
    outTypes: { gsplat: Gsplat },
    globals: () => [defineGsplat],
    statements: ({ outputs }) =>
      unindentLines(`
      ${outputs.gsplat}.flags = 0u;
      return;
    `),
  }).outputs.gsplat;

  prepareFetchSplat() {}
  dispose() {}

  getNumSplats() {
    return 0;
  }
  hasRgbDir() {
    return false;
  }
  getNumSh() {
    return 0;
  }
  setMaxSh(maxSh: number) {}

  fetchSplat({ index }: { index: DynoVal<"int"> }): DynoVal<typeof Gsplat> {
    return this.fetchDyno;
  }
}

export class SplatMesh extends SplatGenerator {
  // A Promise<SplatMesh> you can await to ensure fetching, parsing,
  // and initialization has completed
  initialized: Promise<SplatMesh>;
  // A boolean indicating whether initialization is complete
  isInitialized = false;

  // If you modify packedSplats you should set
  // splatMesh.packedSplats.needsUpdate = true to signal to Three.js that it
  // should re-upload the data to the underlying texture. Use this sparingly with
  // objects with smaller Gsplat counts as it requires a CPU-GPU data transfer for
  // each frame. Thousands to tens of thousands of Gsplats is fine. (See hands.ts
  // for an example of rendering "Gsplat hands" in WebXR using this technique.)
  packedSplats?: PackedSplats;
  extSplats?: ExtSplats;
  splats?: SplatSource;

  // A THREE.Color that can be used to tint all splats in the mesh.
  // (default: new THREE.Color(1, 1, 1))
  recolor: THREE.Color = new THREE.Color(1, 1, 1);
  // Global opacity multiplier for all splats in the mesh. (default: 1)
  opacity = 1;

  // A SplatMeshContext consisting of useful scene and object dyno uniforms that can
  // be used to in the Gsplat processing pipeline, for example via objectModifier and
  // worldModifier. (created on construction)
  context: SplatMeshContext;
  onFrame?: ({
    mesh,
    time,
    deltaTime,
  }: { mesh: SplatMesh; time: number; deltaTime: number }) => void;

  objectModifier?: GsplatModifier;
  worldModifier?: GsplatModifier;
  // Set to true to have the viewToObject property in context be updated each frame.
  // If the mesh has extra.sh1 (first order spherical harmonics directional lighting)
  // this property will always be updated. (default: false)
  enableViewToObject = false;
  // Set to true to have context.viewToWorld updated each frame. (default: false)
  enableViewToWorld = false;
  // Set to true to have context.worldToView updated each frame. (default: false)
  enableWorldToView = false;

  // Optional SplatSkinning instance for animating splats with dual-quaternion
  // skeletal animation. (default: null)
  skinning: SplatSkinning | null = null;

  // Optional list of SplatEdits to apply to the mesh. If null, any SplatEdit
  // children in the scene graph will be added automatically. (default: null)
  edits: SplatEdit[] | null = null;
  editable: boolean;
  raycastable: boolean;
  // Compiled SplatEdits for applying SDF edits to splat RGBA + centers
  private rgbaDisplaceEdits: SplatEdits | null = null;
  // Optional RgbaArray to overwrite splat RGBA values with custom values.
  // Useful for "baking" RGB and opacity edits into the SplatMesh. (default: null)
  splatRgba: RgbaArray | null = null;

  // Maximum Spherical Harmonics level to use. Call updateGenerator()
  // after changing. (default: 3)
  maxSh = 3;

  enableLod?: boolean;
  lodScale: number;
  outsideFoveate?: number;
  behindFoveate?: number;
  coneFov?: number;
  coneFoveate?: number;

  constructor(options: SplatMeshOptions = {}) {
    const context = {
      transform: new SplatTransformer(),
      viewToWorld: new SplatTransformer(),
      worldToView: new SplatTransformer(),
      viewToObject: new SplatTransformer(),
      recolor: new DynoVec4({
        value: new THREE.Vector4().setScalar(Number.NEGATIVE_INFINITY),
      }),
      time: new DynoFloat({ value: 0 }),
      deltaTime: new DynoFloat({ value: 0 }),
      numSplats: new DynoInt({ value: 0 }),
      splats: new EmptySplatSource(),
      enableLod: new DynoBool({ value: false }),
      lodIndices: new DynoUsampler2D({
        value: emptyLodIndices,
        key: "lodIndices",
      }),
    };

    super({
      update: (context) => this.update(context),
    });

    if (options.splats) {
      this.splats = options.splats;
      this.numSplats = options.splats.getNumSplats();
    } else if (options.extSplats) {
      this.extSplats =
        options.extSplats instanceof ExtSplats
          ? options.extSplats
          : new ExtSplats();
      options.extSplats = this.extSplats;
      this.numSplats = this.extSplats.numSplats;
    } else {
      this.packedSplats = options.packedSplats ?? new PackedSplats();
      this.packedSplats.splatEncoding = options.splatEncoding ?? {
        ...DEFAULT_SPLAT_ENCODING,
      };
      this.numSplats = this.packedSplats.numSplats;
    }

    this.editable = options.editable ?? true;
    this.raycastable = options.raycastable ?? true;
    this.onFrame = options.onFrame;

    this.context = context;
    this.objectModifier = options.objectModifier;
    this.worldModifier = options.worldModifier;

    this.enableLod = options.enableLod;
    this.lodScale = options.lodScale ?? 1.0;
    this.outsideFoveate = options.outsideFoveate;
    this.behindFoveate = options.behindFoveate;
    this.coneFov = options.coneFov;
    this.coneFoveate = options.coneFoveate;

    this.updateGenerator();

    if (
      options.url ||
      options.fileBytes ||
      options.constructSplats ||
      (options.packedSplats && !options.packedSplats.isInitialized) ||
      (this.extSplats && !this.extSplats.isInitialized)
    ) {
      // We need to initialize asynchronously given the options
      this.initialized = this.asyncInitialize(options).then(async () => {
        this.updateGenerator();

        this.isInitialized = true;
        if (options.onLoad) {
          const maybePromise = options.onLoad(this);
          if (maybePromise instanceof Promise) {
            await maybePromise;
          }
        }
        return this;
      });
    } else {
      this.isInitialized = true;
      this.initialized = Promise.resolve(this);
      if (options.onLoad) {
        const maybePromise = options.onLoad(this);
        // If onLoad returns a promise, wait for it to complete
        if (maybePromise instanceof Promise) {
          this.initialized = maybePromise.then(() => this);
        }
      }
    }

    // this.add(createRendererDetectionMesh());
  }

  async asyncInitialize(options: SplatMeshOptions) {
    const {
      url,
      fileBytes,
      fileType,
      fileName,
      maxSplats,
      constructSplats,
      onProgress,
      splatEncoding,
      lod,
      nonLod,
    } = options;
    if (this.packedSplats) {
      if (url || fileBytes || constructSplats) {
        const packedSplatsOptions = {
          url,
          fileBytes,
          fileType,
          fileName,
          maxSplats,
          construct: constructSplats,
          onProgress,
          splatEncoding,
          lod,
          nonLod,
        };
        this.packedSplats.reinitialize(packedSplatsOptions);
      }
      await this.packedSplats.initialized;
      this.splats = this.packedSplats;
    } else if (this.extSplats) {
      if (url || fileBytes || constructSplats) {
        const construct = constructSplats as
          | ((splats: ExtSplats) => Promise<void>)
          | undefined;
        this.extSplats.reinitialize({
          url,
          fileBytes,
          fileType,
          fileName,
          maxSplats,
          construct,
          onProgress,
          lod,
          nonLod,
        });
        await this.extSplats.initialized;
        this.splats = this.extSplats;
      }
    }

    if (this.splats) {
      this.splats.prepareFetchSplat();
      this.numSplats = this.splats.getNumSplats();
      this.updateGenerator();
    }
  }

  static staticInitialized = SplatMesh.staticInitialize();
  static isStaticInitialized = false;

  static dynoTime = new DynoFloat({ value: 0 });

  static async staticInitialize() {
    await init_wasm();
    SplatMesh.isStaticInitialized = true;
  }

  // Creates a new Gsplat with the provided parameters (all values in "float" space,
  // i.e. 0-1 for opacity and color) and adds it to the end of the packedSplats,
  // increasing numSplats by 1. If necessary, reallocates the buffer with an exponential
  // doubling strategy to fit the new data, so it's fairly efficient to just
  // pushSplat(...) each Gsplat you want to create in a loop.
  pushSplat(
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) {
    if (this.packedSplats) {
      this.packedSplats.pushSplat(center, scales, quaternion, opacity, color);
    } else if (this.extSplats) {
      this.extSplats.pushSplat(center, scales, quaternion, opacity, color);
    }
  }

  // This method iterates over all Gsplats in this instance's packedSplats,
  // invoking the provided callback with index: number in 0..=(this.numSplats-1) and
  // center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion,
  // opacity: number (0..1), and color: THREE.Color (rgb values in 0..1).
  // Note that the objects passed in as center etc. are the same for every callback
  // invocation: these objects are reused for efficiency. Changing these values has
  // no effect as they are decoded/unpacked copies of the underlying data. To update
  // the packedSplats, call .packedSplats.setSplat(index, center, scales,
  // quaternion, opacity, color).
  forEachSplat(
    callback: (
      index: number,
      center: THREE.Vector3,
      scales: THREE.Vector3,
      quaternion: THREE.Quaternion,
      opacity: number,
      color: THREE.Color,
    ) => void,
  ) {
    if (this.packedSplats) {
      this.packedSplats.forEachSplat(callback);
    } else if (this.extSplats) {
      this.extSplats.forEachSplat(callback);
    }
  }

  // Call this when you are finished with the SplatMesh and want to free
  // any buffers it holds (via packedSplats).
  dispose() {
    if (
      this.splats &&
      this.splats !== this.packedSplats &&
      this.splats !== this.extSplats
    ) {
      this.splats.dispose();
      this.splats = undefined;
    }
    if (this.packedSplats) {
      this.packedSplats.dispose();
      this.packedSplats = undefined;
    }
    if (this.extSplats) {
      this.extSplats.dispose();
      this.extSplats = undefined;
    }
  }

  // Returns axis-aligned bounding box of the SplatMesh. If centers_only is true,
  // only the centers of the splats are used to compute the bounding box.
  // IMPORTANT: This should only be called after the SplatMesh is initialized.
  getBoundingBox(centers_only = true) {
    if (!this.initialized) {
      throw new Error(
        "Cannot get bounding box before SplatMesh is initialized",
      );
    }
    if (!this.packedSplats && !this.extSplats) {
      throw new Error("Bounding box requires PackedSplats or ExtSplats");
    }
    const minVec = new THREE.Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const maxVec = new THREE.Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );
    const corners = new THREE.Vector3();
    const signs = [-1, 1];

    function callback(
      _index: number,
      center: THREE.Vector3,
      scales: THREE.Vector3,
      quaternion: THREE.Quaternion,
      _opacity: number,
      _color: THREE.Color,
    ) {
      if (centers_only) {
        minVec.min(center);
        maxVec.max(center);
      } else {
        // Get the 8 corners of the AABB in local space
        for (const x of signs) {
          for (const y of signs) {
            for (const z of signs) {
              corners.set(x * scales.x, y * scales.y, z * scales.z);
              // Transform corner by rotation and position
              corners.applyQuaternion(quaternion);
              corners.add(center);
              minVec.min(corners);
              maxVec.max(corners);
            }
          }
        }
      }
    }

    if (this.packedSplats) {
      this.packedSplats.forEachSplat(callback);
    } else if (this.extSplats) {
      this.extSplats.forEachSplat(callback);
    }
    const box = new THREE.Box3(minVec, maxVec);
    return box;
  }

  constructGenerator(context: SplatMeshContext) {
    const { transform, viewToObject, recolor } = context;
    const generator = dynoBlock(
      { index: "int" },
      { gsplat: Gsplat },
      ({ index }) => {
        if (!index) {
          throw new Error("index is undefined");
        }

        index = maybeLookupIndex(
          context.lodIndices,
          index,
          context.numSplats,
          context.enableLod,
        );

        // Read a Gsplat from the SplatSource
        context.splats.prepareFetchSplat();
        let gsplat = context.splats.fetchSplat({
          index,
          viewOrigin: viewToObject.translate,
        });

        if (this.splatRgba) {
          // Overwrite RGBA with baked RGBA values
          gsplat = maybeInjectSplatRgba(
            gsplat,
            this.splatRgba.dyno,
            index,
            context.enableLod,
          );
        }

        if (this.skinning) {
          // Transform according to bones + skinning weights
          gsplat = this.skinning.modify(gsplat);
        }

        if (this.objectModifier) {
          // Inject object-space Gsplat modifier dyno
          gsplat = this.objectModifier.apply({ gsplat }).gsplat;
        }

        // Transform from object to world-space
        gsplat = transform.applyGsplat(gsplat);

        // Apply any global recoloring and opacity
        const recolorRgba = mul(recolor, splitGsplat(gsplat).outputs.rgba);
        gsplat = combineGsplat({ gsplat, rgba: recolorRgba });

        if (this.rgbaDisplaceEdits) {
          // Apply RGBA edit layer SDFs
          gsplat = this.rgbaDisplaceEdits.modify(gsplat);
        }
        if (this.worldModifier) {
          // Inject world-space Gsplat modifier dyno
          gsplat = this.worldModifier.apply({ gsplat }).gsplat;
        }

        // We're done! Output resulting Gsplat
        return { gsplat };
      },
    );
    this.generator = generator;
  }

  // Call this whenever something changes in the Gsplat processing pipeline,
  // for example changing maxSh or updating objectModifier or worldModifier.
  // Compiled generators are cached for efficiency and re-use when the same
  // pipeline structure emerges after successive changes.
  updateGenerator() {
    const splats = this.splats ?? this.packedSplats ?? this.extSplats;
    if (splats) {
      this.context.splats = splats;
    }

    this.constructGenerator(this.context);
  }

  // This is called automatically by SparkRenderer and you should not have to
  // call it. It updates parameters for the generated pipeline and calls
  // updateGenerator() if the pipeline needs to change.
  update({
    renderer,
    time,
    deltaTime,
    viewToWorld,
    camera,
    renderSize,
    globalEdits,
    lodIndices,
  }: FrameUpdateContext) {
    this.context.time.value = time;
    this.context.deltaTime.value = deltaTime;
    SplatMesh.dynoTime.value = time;

    const splats = this.splats ?? this.packedSplats ?? this.extSplats;
    if (splats) {
      this.context.splats = splats;
    }
    this.numSplats = this.context.splats.getNumSplats();

    const { transform, viewToObject, recolor } = this.context;
    let updated = transform.update(this);

    if (
      this.context.viewToWorld.updateFromMatrix(viewToWorld) &&
      this.enableViewToWorld
    ) {
      updated = true;
    }
    const worldToView = viewToWorld.clone().invert();
    if (
      this.context.worldToView.updateFromMatrix(worldToView) &&
      this.enableWorldToView
    ) {
      updated = true;
    }

    const objectToWorld = new THREE.Matrix4().compose(
      transform.translate.value,
      transform.rotate.value,
      new THREE.Vector3().setScalar(transform.scale.value),
    );
    const worldToObject = objectToWorld.invert();
    const viewToObjectMatrix = worldToObject.multiply(viewToWorld);
    if (
      viewToObject.updateFromMatrix(viewToObjectMatrix) &&
      (this.enableViewToObject || this.context.splats.hasRgbDir())
    ) {
      // Only trigger update if we have view-dependent spherical harmonics
      updated = true;
    }

    const viewInObject = new THREE.Vector3().setFromMatrixColumn(
      viewToObjectMatrix,
      3,
    );
    const viewDirInObject = new THREE.Vector3()
      .setFromMatrixColumn(viewToObjectMatrix, 2)
      .negate()
      .normalize();

    const newRecolor = new THREE.Vector4(
      this.recolor.r,
      this.recolor.g,
      this.recolor.b,
      this.opacity,
    );
    if (!newRecolor.equals(recolor.value)) {
      recolor.value.copy(newRecolor);
      updated = true;
    }

    const edits = this.editable ? (this.edits ?? []).concat(globalEdits) : [];
    if (this.editable && !this.edits) {
      // If we haven't set any explicit edits, add any child SplatEdits
      this.traverseVisible((node) => {
        if (node instanceof SplatEdit) {
          edits.push(node);
        }
      });
    }

    edits.sort((a, b) => a.ordering - b.ordering);
    const editsSdfs = edits.map((edit) => {
      if (edit.sdfs != null) {
        return { edit, sdfs: edit.sdfs };
      }
      const sdfs: SplatEditSdf[] = [];
      edit.traverseVisible((node) => {
        if (node instanceof SplatEditSdf) {
          sdfs.push(node);
        }
      });
      return { edit, sdfs };
    });

    if (editsSdfs.length > 0 && !this.rgbaDisplaceEdits) {
      const edits = editsSdfs.length;
      const sdfs = editsSdfs.reduce(
        (total, edit) => total + edit.sdfs.length,
        0,
      );
      this.rgbaDisplaceEdits = new SplatEdits({
        maxEdits: edits,
        maxSdfs: sdfs,
      });
      this.updateGenerator();
    }
    if (this.rgbaDisplaceEdits) {
      const editResult = this.rgbaDisplaceEdits.update(editsSdfs);
      updated ||= editResult.updated;
      if (editResult.dynoUpdated) {
        this.updateGenerator();
      }
    }

    const lodSplats = this.packedSplats?.lodSplats ?? this.extSplats?.lodSplats;
    this.context.enableLod.value = lodSplats != null && lodIndices != null;
    if (this.enableLod === false) {
      this.context.enableLod.value = false;
    }
    this.context.lodIndices.value = lodIndices?.texture ?? emptyLodIndices;

    if (this.context.enableLod.value && lodSplats) {
      this.context.splats = lodSplats;
      this.numSplats = lodIndices?.numSplats ?? 0;
    }

    this.context.numSplats.value = this.numSplats;

    if (updated) {
      this.updateVersion();
    }

    this.onFrame?.({ mesh: this, time, deltaTime });
  }

  // This method conforms to the standard THREE.Raycaster API, performing object-ray
  // intersections using this method to populate the provided intersects[] array
  // with each intersection point.
  raycast(
    raycaster: THREE.Raycaster,
    intersects: {
      distance: number;
      point: THREE.Vector3;
      object: THREE.Object3D;
    }[],
  ) {
    if (
      !this.raycastable ||
      !this.packedSplats?.packedArray ||
      !this.packedSplats?.numSplats
    ) {
      return;
    }

    const { near, far, ray } = raycaster;
    const worldToMesh = this.matrixWorld.clone().invert();
    const worldToMeshRot = new THREE.Matrix3().setFromMatrix4(worldToMesh);
    const origin = ray.origin.clone().applyMatrix4(worldToMesh);
    const direction = ray.direction.clone().applyMatrix3(worldToMeshRot);
    const scales = new THREE.Vector3();
    worldToMesh.decompose(new THREE.Vector3(), new THREE.Quaternion(), scales);
    const scale = (scales.x * scales.y * scales.z) ** (1.0 / 3.0);

    const RAYCAST_ELLIPSOID = true;
    const distances = raycast_splats(
      origin.x,
      origin.y,
      origin.z,
      direction.x,
      direction.y,
      direction.z,
      near,
      far,
      this.packedSplats.numSplats,
      this.packedSplats.packedArray,
      RAYCAST_ELLIPSOID,
      this.packedSplats.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN,
      this.packedSplats.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX,
    );

    for (const distance of distances) {
      const point = ray.direction
        .clone()
        .multiplyScalar(distance)
        .add(ray.origin);
      intersects.push({
        distance,
        point,
        object: this,
      });
    }
  }

  // ensureLodIndices() {
  //   if (this.lodState) {
  //     const maxSplats = Math.min(this.packedSplats.numSplats, 16 * 1048576);
  //     const numSplats = Math.max(16384, Math.min(this.lodMaxSplats, maxSplats));
  //     const rows = Math.ceil(numSplats / 16384);
  //     const capacity = rows * 16384;

  //     if (capacity > this.lodState.indices.length) {
  //       this.context.lodIndices.value.dispose();

  //       this.lodState.indices = new Uint32Array(capacity);
  //       this.context.lodIndices.value = new THREE.DataTexture(
  //         this.lodState.indices,
  //         4096,
  //         rows,
  //         THREE.RGBAIntegerFormat,
  //         THREE.UnsignedIntType,
  //       );
  //       this.context.lodIndices.value.internalFormat = "RGBA32UI";
  //       this.context.lodIndices.value.needsUpdate = true;
  //     }
  //   }
  // }
}

function maybeLookupIndex(
  lodIndices: DynoUsampler2D<"lodIndices", THREE.DataTexture>,
  index: DynoVal<"int">,
  numSplats: DynoVal<"int">,
  enableLod: DynoVal<"bool">,
) {
  return dyno({
    inTypes: {
      lodIndices: "usampler2D",
      index: "int",
      numSplats: "int",
      enableLod: "bool",
    },
    outTypes: {
      index: "int",
    },
    inputs: {
      lodIndices,
      index,
      numSplats,
      enableLod,
    },
    statements: ({ inputs, outputs }) =>
      unindentLines(`
        if (${inputs.index} >= ${inputs.numSplats}) {
          return;
        }
        if (${inputs.enableLod}) {
          ivec2 lodIndexCoord = ivec2((${inputs.index} >> 2) & 4095, ${inputs.index} >> 14);
          uint splatIndex = texelFetch(${inputs.lodIndices}, lodIndexCoord, 0)[${inputs.index} & 3];
          ${outputs.index} = int(splatIndex);
        } else {
          ${outputs.index} = ${inputs.index};
        }
      `),
  }).outputs.index;
}

function maybeInjectSplatRgba(
  gsplat: DynoVal<typeof Gsplat>,
  rgba: DynoVal<typeof TRgbaArray>,
  index: DynoVal<"int">,
  enableLod: DynoVal<"bool">,
): DynoVal<typeof Gsplat> {
  return dyno({
    inTypes: {
      gsplat: Gsplat,
      rgba: TRgbaArray,
      index: "int",
      enableLod: "bool",
    },
    outTypes: { gsplat: Gsplat },
    inputs: { gsplat, rgba, index, enableLod },
    statements: ({ inputs, outputs }) =>
      unindentLines(`
        ${outputs.gsplat} = ${inputs.gsplat};
        if (!${inputs.enableLod} && (${inputs.index} >= 0) && (${inputs.index} < ${inputs.rgba}.count)) {
          ${outputs.gsplat}.rgba = texelFetch(${inputs.rgba}.texture, splatTexCoord(${inputs.index}), 0);
        }
      `),
  }).outputs.gsplat;
}

const emptyLodIndices = (() => {
  const texture = new THREE.DataTexture(
    new Uint32Array(16384),
    4096,
    1,
    THREE.RGBAIntegerFormat,
    THREE.UnsignedIntType,
  );
  texture.internalFormat = "RGBA32UI";
  texture.needsUpdate = true;
  return texture;
})();

const EMPTY_GEOMETRY = new THREE.BufferGeometry();
const EMPTY_MATERIAL = new THREE.ShaderMaterial();

// Creates an empty mesh to hook into Three.js rendering.
// This is used to detect if a SparkRenderer is present in the scene.
// If not, one will be injected automatically.
function createRendererDetectionMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(EMPTY_GEOMETRY, EMPTY_MATERIAL);
  mesh.frustumCulled = false;
  mesh.onBeforeRender = function (renderer, scene) {
    if (!scene.isScene) {
      // The SplatMesh is part of render call that doesn't have a Scene at its root
      // Don't auto-inject a renderer.
      this.removeFromParent();
      return;
    }

    // Check if the scene has a SparkRenderer instance
    let hasSparkRenderer = false;
    scene.traverse((c) => {
      if (c instanceof SparkRenderer) {
        hasSparkRenderer = true;
      }
    });

    if (!hasSparkRenderer) {
      // No spark renderer present in the scene, inject one.
      scene.add(new SparkRenderer({ renderer }));
    }

    // Remove mesh to stop checking
    this.removeFromParent();
  };
  return mesh;
}
