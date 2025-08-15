import * as THREE from "three";

import init_wasm, { raycast_splats } from "spark-internal-rs";
import {
  DEFAULT_SPLAT_ENCODING,
  PackedSplats,
  type SplatEncoding,
} from "./PackedSplats";
import { type RgbaArray, readRgbaArray } from "./RgbaArray";
import { SparkRenderer } from "./SparkRenderer";
import { SplatEdit, SplatEditSdf, SplatEdits } from "./SplatEdit";
import {
  type GsplatModifier,
  SplatGenerator,
  SplatTransformer,
} from "./SplatGenerator";
import type { SplatFileType } from "./SplatLoader";
import type { SplatSkinning } from "./SplatSkinning";
import { LN_SCALE_MAX, LN_SCALE_MIN } from "./defines";
import {
  DynoFloat,
  DynoUsampler2DArray,
  type DynoVal,
  DynoVec4,
  Gsplat,
  add,
  combineGsplat,
  defineGsplat,
  dyno,
  dynoBlock,
  dynoConst,
  extendVec,
  mul,
  normalize,
  readPackedSplat,
  split,
  splitGsplat,
  sub,
  unindent,
  unindentLines,
} from "./dyno";
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
  // Reserve space for at least this many splats when constructing the mesh
  // initially. (default: determined by file)
  maxSplats?: number;
  // Callback function to programmatically create splats at initialization
  // in provided PackedSplats. (default: undefined)
  constructSplats?: (splats: PackedSplats) => Promise<void> | void;
  // Callback function that is called when mesh initialization is complete.
  // (default: undefined)
  onLoad?: (mesh: SplatMesh) => Promise<void> | void;
  // Controls whether SplatEdits have any effect on this mesh. (default: true)
  editable?: boolean;
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
};

export type SplatMeshContext = {
  transform: SplatTransformer;
  viewToWorld: SplatTransformer;
  worldToView: SplatTransformer;
  viewToObject: SplatTransformer;
  recolor: DynoVec4<THREE.Vector4>;
  time: DynoFloat;
  deltaTime: DynoFloat;
};

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
  // each frame. Thousands to tens of thousands of Gsplats ir fine. (See hands.ts
  // for an example of rendering "Gsplat hands" in WebXR using this technique.)
  packedSplats: PackedSplats;

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
  // Compiled SplatEdits for applying SDF edits to splat RGBA + centers
  private rgbaDisplaceEdits: SplatEdits | null = null;
  // Optional RgbaArray to overwrite splat RGBA values with custom values.
  // Useful for "baking" RGB and opacity edits into the SplatMesh. (default: null)
  splatRgba: RgbaArray | null = null;

  // Maximum Spherical Harmonics level to use. Call updateGenerator()
  // after changing. (default: 3)
  maxSh = 3;

  constructor(options: SplatMeshOptions = {}) {
    const transform = new SplatTransformer();
    const viewToWorld = new SplatTransformer();
    const worldToView = new SplatTransformer();
    const viewToObject = new SplatTransformer();
    const recolor = new DynoVec4({
      value: new THREE.Vector4(
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ),
    });
    const time = new DynoFloat({ value: 0 });
    const deltaTime = new DynoFloat({ value: 0 });
    const context = {
      transform,
      viewToWorld,
      worldToView,
      viewToObject,
      recolor,
      time,
      deltaTime,
    };

    super({
      update: ({ time, deltaTime, viewToWorld, globalEdits }) =>
        this.update({ time, deltaTime, viewToWorld, globalEdits }),
    });

    this.packedSplats = options.packedSplats ?? new PackedSplats();
    this.packedSplats.splatEncoding = options.splatEncoding ?? {
      ...DEFAULT_SPLAT_ENCODING,
    };
    this.numSplats = this.packedSplats.numSplats;
    this.editable = options.editable ?? true;
    this.onFrame = options.onFrame;

    this.context = context;
    this.objectModifier = options.objectModifier;
    this.worldModifier = options.worldModifier;

    this.updateGenerator();

    if (
      options.url ||
      options.fileBytes ||
      options.constructSplats ||
      (options.packedSplats && !options.packedSplats.isInitialized)
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

    this.add(createRendererDetectionMesh());
  }

  async asyncInitialize(options: SplatMeshOptions) {
    const {
      url,
      fileBytes,
      fileType,
      fileName,
      maxSplats,
      constructSplats,
      splatEncoding,
    } = options;
    if (url || fileBytes || constructSplats) {
      const packedSplatsOptions = {
        url,
        fileBytes,
        fileType,
        fileName,
        maxSplats,
        construct: constructSplats,
        splatEncoding,
      };
      this.packedSplats.reinitialize(packedSplatsOptions);
    }
    if (this.packedSplats) {
      await this.packedSplats.initialized;
      this.numSplats = this.packedSplats.numSplats;
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
    this.packedSplats.pushSplat(center, scales, quaternion, opacity, color);
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
    this.packedSplats.forEachSplat(callback);
  }

  // Call this when you are finished with the SplatMesh and want to free
  // any buffers it holds (via packedSplats).
  dispose() {
    this.packedSplats.dispose();
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
    this.packedSplats.forEachSplat(
      (_index, center, scales, quaternion, _opacity, _color) => {
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
      },
    );
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
        // Read a Gsplat from the PackedSplats template
        let gsplat = readPackedSplat(this.packedSplats.dyno, index);

        if (this.maxSh >= 1) {
          // Inject lighting from SH1..SH3
          const { sh1Texture, sh2Texture, sh3Texture } =
            this.ensureShTextures();
          if (sh1Texture) {
            //Calculate view direction in object space
            const viewCenterInObject = viewToObject.translate;
            const { center } = splitGsplat(gsplat).outputs;
            const viewDir = normalize(sub(center, viewCenterInObject));

            function rescaleSh(
              sNorm: DynoVal<"vec3">,
              minMax: DynoVal<"vec2">,
            ) {
              const { x: min, y: max } = split(minMax).outputs;
              const mid = mul(add(min, max), dynoConst("float", 0.5));
              const scale = mul(sub(max, min), dynoConst("float", 0.5));
              return add(mid, mul(sNorm, scale));
            }

            // Evaluate Spherical Harmonics
            const sh1Snorm = evaluateSH1(gsplat, sh1Texture, viewDir);
            let rgb = rescaleSh(sh1Snorm, this.packedSplats.dynoSh1MinMax);
            if (this.maxSh >= 2 && sh2Texture) {
              const sh2Snorm = evaluateSH2(gsplat, sh2Texture, viewDir);
              rgb = add(
                rgb,
                rescaleSh(sh2Snorm, this.packedSplats.dynoSh2MinMax),
              );
            }
            if (this.maxSh >= 3 && sh3Texture) {
              const sh3Snorm = evaluateSH3(gsplat, sh3Texture, viewDir);
              rgb = add(
                rgb,
                rescaleSh(sh3Snorm, this.packedSplats.dynoSh3MinMax),
              );
            }

            // Flash off for 0.3 / 1.0 sec for debugging
            // const fractTime = fract(SplatMesh.dynoTime);
            // const lessThan05 = lessThan(fractTime, dynoConst("float", 0.3));
            // rgb = select(lessThan05, dynoConst("vec3", new THREE.Vector3()), rgb);

            // Add SH lighting to RGBA
            let { rgba } = splitGsplat(gsplat).outputs;
            rgba = add(rgba, extendVec(rgb, dynoConst("float", 0.0)));
            gsplat = combineGsplat({ gsplat, rgba });
          }
        }

        if (this.splatRgba) {
          // Overwrite RGBA with baked RGBA values
          const rgba = readRgbaArray(this.splatRgba.dyno, index);
          gsplat = combineGsplat({ gsplat, rgba });
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
    this.constructGenerator(this.context);
  }

  // This is called automatically by SparkRenderer and you should not have to
  // call it. It updates parameters for the generated pipeline and calls
  // updateGenerator() if the pipeline needs to change.
  update({
    time,
    viewToWorld,
    deltaTime,
    globalEdits,
  }: {
    time: number;
    viewToWorld: THREE.Matrix4;
    deltaTime: number;
    globalEdits: SplatEdit[];
  }) {
    this.numSplats = this.packedSplats.numSplats;
    this.context.time.value = time;
    this.context.deltaTime.value = deltaTime;
    SplatMesh.dynoTime.value = time;

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
      (this.enableViewToObject || this.packedSplats.extra.sh1)
    ) {
      // Only trigger update if we have view-dependent spherical harmonics
      updated = true;
    }

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
    if (!this.packedSplats.packedArray || !this.packedSplats.numSplats) {
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

  private ensureShTextures(): {
    sh1Texture?: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>;
    sh2Texture?: DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>;
    sh3Texture?: DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>;
  } {
    // Ensure we have textures for SH1..SH3 if we have data
    if (!this.packedSplats.extra.sh1) {
      return {};
    }

    let sh1Texture = this.packedSplats.extra.sh1Texture as
      | DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>
      | undefined;
    if (!sh1Texture) {
      let sh1 = this.packedSplats.extra.sh1 as Uint32Array;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh1.length / 2,
      );
      if (sh1.length < maxSplats * 2) {
        const newSh1 = new Uint32Array(maxSplats * 2);
        newSh1.set(sh1);
        this.packedSplats.extra.sh1 = newSh1;
        sh1 = newSh1;
      }

      const texture = new THREE.DataArrayTexture(sh1, width, height, depth);
      texture.format = THREE.RGIntegerFormat;
      texture.type = THREE.UnsignedIntType;
      texture.internalFormat = "RG32UI";
      texture.needsUpdate = true;

      sh1Texture = new DynoUsampler2DArray({
        value: texture,
        key: "sh1",
      });
      this.packedSplats.extra.sh1Texture = sh1Texture;
    }

    if (!this.packedSplats.extra.sh2) {
      return { sh1Texture };
    }

    let sh2Texture = this.packedSplats.extra.sh2Texture as
      | DynoUsampler2DArray<"sh2", THREE.DataArrayTexture>
      | undefined;
    if (!sh2Texture) {
      let sh2 = this.packedSplats.extra.sh2 as Uint32Array;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh2.length / 4,
      );
      if (sh2.length < maxSplats * 4) {
        const newSh2 = new Uint32Array(maxSplats * 4);
        newSh2.set(sh2);
        this.packedSplats.extra.sh2 = newSh2;
        sh2 = newSh2;
      }

      const texture = new THREE.DataArrayTexture(sh2, width, height, depth);
      texture.format = THREE.RGBAIntegerFormat;
      texture.type = THREE.UnsignedIntType;
      texture.internalFormat = "RGBA32UI";
      texture.needsUpdate = true;

      sh2Texture = new DynoUsampler2DArray({
        value: texture,
        key: "sh2",
      });
      this.packedSplats.extra.sh2Texture = sh2Texture;
    }

    if (!this.packedSplats.extra.sh3) {
      return { sh1Texture, sh2Texture };
    }

    let sh3Texture = this.packedSplats.extra.sh3Texture as
      | DynoUsampler2DArray<"sh3", THREE.DataArrayTexture>
      | undefined;
    if (!sh3Texture) {
      let sh3 = this.packedSplats.extra.sh3 as Uint32Array;
      const { width, height, depth, maxSplats } = getTextureSize(
        sh3.length / 4,
      );
      if (sh3.length < maxSplats * 4) {
        const newSh3 = new Uint32Array(maxSplats * 4);
        newSh3.set(sh3);
        this.packedSplats.extra.sh3 = newSh3;
        sh3 = newSh3;
      }

      const texture = new THREE.DataArrayTexture(sh3, width, height, depth);
      texture.format = THREE.RGBAIntegerFormat;
      texture.type = THREE.UnsignedIntType;
      texture.internalFormat = "RGBA32UI";
      texture.needsUpdate = true;

      sh3Texture = new DynoUsampler2DArray({
        value: texture,
        key: "sh3",
      });
      this.packedSplats.extra.sh3Texture = sh3Texture;
    }

    return { sh1Texture, sh2Texture, sh3Texture };
  }
}

const defineEvaluateSH1 = unindent(`
  vec3 evaluateSH1(Gsplat gsplat, usampler2DArray sh1, vec3 viewDir) {
    // Extract sint7 values packed into 2 x uint32
    uvec2 packed = texelFetch(sh1, splatTexCoord(gsplat.index), 0).rg;
    vec3 sh1_0 = vec3(ivec3(
      int(packed.x << 25u) >> 25,
      int(packed.x << 18u) >> 25,
      int(packed.x << 11u) >> 25
    )) / 63.0;
    vec3 sh1_1 = vec3(ivec3(
      int(packed.x << 4u) >> 25,
      int((packed.x >> 3u) | (packed.y << 29u)) >> 25,
      int(packed.y << 22u) >> 25
    )) / 63.0;
    vec3 sh1_2 = vec3(ivec3(
      int(packed.y << 15u) >> 25,
      int(packed.y << 8u) >> 25,
      int(packed.y << 1u) >> 25
    )) / 63.0;

    return sh1_0 * (-0.4886025 * viewDir.y)
      + sh1_1 * (0.4886025 * viewDir.z)
      + sh1_2 * (-0.4886025 * viewDir.x);
  }
`);

const defineEvaluateSH2 = unindent(`
  vec3 evaluateSH2(Gsplat gsplat, usampler2DArray sh2, vec3 viewDir) {
    // Extract sint8 values packed into 4 x uint32
    uvec4 packed = texelFetch(sh2, splatTexCoord(gsplat.index), 0);
    vec3 sh2_0 = vec3(ivec3(
      int(packed.x << 24u) >> 24,
      int(packed.x << 16u) >> 24,
      int(packed.x << 8u) >> 24
    )) / 127.0;
    vec3 sh2_1 = vec3(ivec3(
      int(packed.x) >> 24,
      int(packed.y << 24u) >> 24,
      int(packed.y << 16u) >> 24
    )) / 127.0;
    vec3 sh2_2 = vec3(ivec3(
      int(packed.y << 8u) >> 24,
      int(packed.y) >> 24,
      int(packed.z << 24u) >> 24
    )) / 127.0;
    vec3 sh2_3 = vec3(ivec3(
      int(packed.z << 16u) >> 24,
      int(packed.z << 8u) >> 24,
      int(packed.z) >> 24
    )) / 127.0;
    vec3 sh2_4 = vec3(ivec3(
      int(packed.w << 24u) >> 24,
      int(packed.w << 16u) >> 24,
      int(packed.w << 8u) >> 24
    )) / 127.0;

    return sh2_0 * (1.0925484 * viewDir.x * viewDir.y)
      + sh2_1 * (-1.0925484 * viewDir.y * viewDir.z)
      + sh2_2 * (0.3153915 * (2.0 * viewDir.z * viewDir.z - viewDir.x * viewDir.x - viewDir.y * viewDir.y))
      + sh2_3 * (-1.0925484 * viewDir.x * viewDir.z)
      + sh2_4 * (0.5462742 * (viewDir.x * viewDir.x - viewDir.y * viewDir.y));
  }
`);

const defineEvaluateSH3 = unindent(`
  vec3 evaluateSH3(Gsplat gsplat, usampler2DArray sh3, vec3 viewDir) {
    // Extract sint6 values packed into 4 x uint32
    uvec4 packed = texelFetch(sh3, splatTexCoord(gsplat.index), 0);
    vec3 sh3_0 = vec3(ivec3(
      int(packed.x << 26u) >> 26,
      int(packed.x << 20u) >> 26,
      int(packed.x << 14u) >> 26
    )) / 31.0;
    vec3 sh3_1 = vec3(ivec3(
      int(packed.x << 8u) >> 26,
      int(packed.x << 2u) >> 26,
      int((packed.x >> 4u) | (packed.y << 28u)) >> 26
    )) / 31.0;
    vec3 sh3_2 = vec3(ivec3(
      int(packed.y << 22u) >> 26,
      int(packed.y << 16u) >> 26,
      int(packed.y << 10u) >> 26
    )) / 31.0;
    vec3 sh3_3 = vec3(ivec3(
      int(packed.y << 4u) >> 26,
      int((packed.y >> 2u) | (packed.z << 30u)) >> 26,
      int(packed.z << 24u) >> 26
    )) / 31.0;
    vec3 sh3_4 = vec3(ivec3(
      int(packed.z << 18u) >> 26,
      int(packed.z << 12u) >> 26,
      int(packed.z << 6u) >> 26
    )) / 31.0;
    vec3 sh3_5 = vec3(ivec3(
      int(packed.z) >> 26,
      int(packed.w << 26u) >> 26,
      int(packed.w << 20u) >> 26
    )) / 31.0;
    vec3 sh3_6 = vec3(ivec3(
      int(packed.w << 14u) >> 26,
      int(packed.w << 8u) >> 26,
      int(packed.w << 2u) >> 26
    )) / 31.0;

    float xx = viewDir.x * viewDir.x;
    float yy = viewDir.y * viewDir.y;
    float zz = viewDir.z * viewDir.z;
    float xy = viewDir.x * viewDir.y;
    float yz = viewDir.y * viewDir.z;
    float zx = viewDir.z * viewDir.x;

    return sh3_0 * (-0.5900436 * viewDir.y * (3.0 * xx - yy))
      + sh3_1 * (2.8906114 * xy * viewDir.z) +
      + sh3_2 * (-0.4570458 * viewDir.y * (4.0 * zz - xx - yy))
      + sh3_3 * (0.3731763 * viewDir.z * (2.0 * zz - 3.0 * xx - 3.0 * yy))
      + sh3_4 * (-0.4570458 * viewDir.x * (4.0 * zz - xx - yy))
      + sh3_5 * (1.4453057 * viewDir.z * (xx - yy))
      + sh3_6 * (-0.5900436 * viewDir.x * (xx - 3.0 * yy));
  }
`);

export function evaluateSH1(
  gsplat: DynoVal<typeof Gsplat>,
  sh1: DynoUsampler2DArray<"sh1", THREE.DataArrayTexture>,
  viewDir: DynoVal<"vec3">,
): DynoVal<"vec3"> {
  return dyno({
    inTypes: { gsplat: Gsplat, sh1: "usampler2DArray", viewDir: "vec3" },
    outTypes: { rgb: "vec3" },
    inputs: { gsplat, sh1, viewDir },
    globals: () => [defineGsplat, defineEvaluateSH1],
    statements: ({ inputs, outputs }) => {
      const statements = unindentLines(`
        if (isGsplatActive(${inputs.gsplat}.flags)) {
          ${outputs.rgb} = evaluateSH1(${inputs.gsplat}, ${inputs.sh1}, ${inputs.viewDir});
        } else {
          ${outputs.rgb} = vec3(0.0);
        }
      `);
      return statements;
    },
  }).outputs.rgb;
}

export function evaluateSH2(
  gsplat: DynoVal<typeof Gsplat>,
  sh2: DynoVal<"usampler2DArray">,
  viewDir: DynoVal<"vec3">,
): DynoVal<"vec3"> {
  return dyno({
    inTypes: { gsplat: Gsplat, sh2: "usampler2DArray", viewDir: "vec3" },
    outTypes: { rgb: "vec3" },
    inputs: { gsplat, sh2, viewDir },
    globals: () => [defineGsplat, defineEvaluateSH2],
    statements: ({ inputs, outputs }) =>
      unindentLines(`
        if (isGsplatActive(${inputs.gsplat}.flags)) {
          ${outputs.rgb} = evaluateSH2(${inputs.gsplat}, ${inputs.sh2}, ${inputs.viewDir});
        } else {
          ${outputs.rgb} = vec3(0.0);
        }
      `),
  }).outputs.rgb;
}

export function evaluateSH3(
  gsplat: DynoVal<typeof Gsplat>,
  sh3: DynoVal<"usampler2DArray">,
  viewDir: DynoVal<"vec3">,
): DynoVal<"vec3"> {
  return dyno({
    inTypes: { gsplat: Gsplat, sh3: "usampler2DArray", viewDir: "vec3" },
    outTypes: { rgb: "vec3" },
    inputs: { gsplat, sh3, viewDir },
    globals: () => [defineGsplat, defineEvaluateSH3],
    statements: ({ inputs, outputs }) =>
      unindentLines(`
        if (isGsplatActive(${inputs.gsplat}.flags)) {
          ${outputs.rgb} = evaluateSH3(${inputs.gsplat}, ${inputs.sh3}, ${inputs.viewDir});
        } else {
          ${outputs.rgb} = vec3(0.0);
        }
      `),
  }).outputs.rgb;
}

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
