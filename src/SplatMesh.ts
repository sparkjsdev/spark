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
import { getShArrayStride, getTextureSize } from "./utils";

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
          const { shTexture, shDegrees } = this.ensureShTexture();
          if (shTexture && shDegrees) {
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
            const rgb = evaluateSH(
              gsplat,
              shTexture,
              viewDir,
              shDegrees,
              this.maxSh,
              this.packedSplats.dynoSh1MinMax,
              this.packedSplats.dynoSh2MinMax,
              this.packedSplats.dynoSh3MinMax,
            );

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
      (this.enableViewToObject || this.packedSplats.extra.sh)
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

  private ensureShTexture(): {
    shTexture?: DynoUsampler2DArray<"sh", THREE.DataArrayTexture>;
    shDegrees?: 0 | 1 | 2 | 3;
  } {
    // Ensure we have textures for SH1..SH3 if we have data
    if (!this.packedSplats.extra.sh) {
      return {};
    }

    const shDegrees = (this.packedSplats.extra.shDegrees as 0 | 1 | 2 | 3) ?? 0;
    let shTexture = this.packedSplats.extra.shTexture as
      | DynoUsampler2DArray<"sh", THREE.DataArrayTexture>
      | undefined;
    if (!shTexture && shDegrees) {
      let sh = this.packedSplats.extra.sh as Uint8Array;
      const { width, height, depth, maxSplats } = getTextureSize(
        this.numSplats * shDegrees, // 1st order = 1 RGB pixel, 2nd = 2 RGB pixels, 3rd = 3 RGBA pixels
      );
      const coefficientsWithPadding = getShArrayStride(shDegrees);
      if (sh.length < maxSplats * coefficientsWithPadding) {
        const newSh = new Uint8Array(maxSplats * coefficientsWithPadding);
        newSh.set(sh);
        this.packedSplats.extra.sh = newSh;
        sh = newSh;
      }

      const texture = new THREE.DataArrayTexture(
        new Uint32Array(sh.buffer),
        width,
        height,
        depth,
      );
      texture.format = (
        shDegrees === 3 ? THREE.RGBAIntegerFormat : "RGB_INTEGER"
      ) as THREE.AnyPixelFormat;
      texture.type = THREE.UnsignedIntType;
      texture.internalFormat = shDegrees === 3 ? "RGBA32UI" : "RGB32UI";
      texture.needsUpdate = true;

      shTexture = new DynoUsampler2DArray({
        value: texture,
        key: "sh",
      });
      this.packedSplats.extra.shTexture = shTexture;
    }

    return { shTexture, shDegrees };
  }
}

const defineUnpackSint8 = unindent(/*glsl*/ `
    vec4 unpackSint8(uint packed) {
    return vec4(ivec4(
      int(packed << 24u) >> 24,
      int(packed << 16u) >> 24,
      int(packed << 8u) >> 24,
      int(packed) >> 24
    )) / 127.0;
  }
`);

const defineEvaluateSH = unindent(/* glsl */ `
  vec3 evaluateSH(Gsplat gsplat, usampler2DArray sh, vec3 viewDir, vec2 sh1MinMax, vec2 sh2MinMax, vec2 sh3MinMax) {
    // Extract sint8 values packed into 3, 8 and 12 x uint32
    uvec4 packedA = texelFetch(sh, splatTexCoord(gsplat.index * SH_TEXEL_STRIDE), 0);
    vec4 a1 = unpackSint8(packedA.x);
    vec4 a2 = unpackSint8(packedA.y);
    vec4 a3 = unpackSint8(packedA.z);
    vec4 a4 = unpackSint8(packedA.w);
#if SH_DEGREES > 1
    uvec4 packedB = texelFetch(sh, splatTexCoord(gsplat.index * SH_TEXEL_STRIDE + 1), 0);
    vec4 b1 = unpackSint8(packedB.x);
    vec4 b2 = unpackSint8(packedB.y);
    vec4 b3 = unpackSint8(packedB.z);
    vec4 b4 = unpackSint8(packedB.w);
#endif
#if SH_DEGREES > 2
    uvec4 packedC = texelFetch(sh, splatTexCoord(gsplat.index * SH_TEXEL_STRIDE + 2), 0);
    vec4 c1 = unpackSint8(packedC.x);
    vec4 c2 = unpackSint8(packedC.y);
    vec4 c3 = unpackSint8(packedC.z);
    vec4 c4 = unpackSint8(packedC.w);
#endif

#if SH_DEGREES <= 2
    // RGB
    vec3 sh1_0 = a1.xyz;
    vec3 sh1_1 = vec3(a1.w, a2.xy);
    vec3 sh1_2 = vec3(a2.zw, a3.x);
#else
    // RGBA
    vec3 sh1_0 = a1.xyz;
    vec3 sh1_1 = vec3(a1.w, a2.xy);
    vec3 sh1_2 = vec3(a2.zw, a3.x);
#endif

    vec3 sh1 = sh1_0 * (-0.4886025 * viewDir.y)
      + sh1_1 * (0.4886025 * viewDir.z)
      + sh1_2 * (-0.4886025 * viewDir.x);

    // rescale
    sh1 = (sh1MinMax.x + sh1MinMax.y) / 2.0 + sh1 * (sh1MinMax.y - sh1MinMax.x) / 2.0;

#if SH_DEGREES == 1 || MAX_SH == 1
    return sh1;
#else

    float xx = viewDir.x * viewDir.x;
    float yy = viewDir.y * viewDir.y;
    float zz = viewDir.z * viewDir.z;
    float xy = viewDir.x * viewDir.y;
    float yz = viewDir.y * viewDir.z;
    float zx = viewDir.z * viewDir.x;

#if SH_DEGREES <= 2
    // RGB
    vec3 sh2_0 = a3.yzw;
    vec3 sh2_1 = b1.xyz;
    vec3 sh2_2 = vec3(b1.w, b2.xy);
    vec3 sh2_3 = vec3(b2.zw, b3.x);
    vec3 sh2_4 = b3.yzw;
#else
    // RGBA
    vec3 sh2_0 = vec3(a3.yzw);
    vec3 sh2_1 = vec3(a4.xyz);
    vec3 sh2_2 = vec3(a4.w, b1.xy);
    vec3 sh2_3 = vec3(b1.zw, b2.x);
    vec3 sh2_4 = vec3(b2.yzw);
#endif
    vec3 sh2 = sh2_0 * (1.0925484 * xy)
      + sh2_1 * (-1.0925484 * yz)
      + sh2_2 * (0.3153915 * (2.0 * zz - xx - yy))
      + sh2_3 * (-1.0925484 * zx)
      + sh2_4 * (0.5462742 * (xx - yy));

    // rescale
    sh2 = (sh2MinMax.x + sh2MinMax.y) / 2.0 + sh2 * (sh2MinMax.y - sh2MinMax.x) / 2.0;

#if SH_DEGREES == 2 || MAX_SH == 2
    return sh1 + sh2;
#else
    vec3 sh3_0 = vec3(b3.xyz);
    vec3 sh3_1 = vec3(b3.w, b4.xy);
    vec3 sh3_2 = vec3(b4.zw, c1.x);
    vec3 sh3_3 = vec3(c1.yzw);
    vec3 sh3_4 = vec3(c2.xyz);
    vec3 sh3_5 = vec3(c2.w, c3.xy);
    vec3 sh3_6 = vec3(c3.zw, c4.x);
    vec3 sh3 = sh3_0 * (-0.5900436 * viewDir.y * (3.0 * xx - yy))
      + sh3_1 * (2.8906114 * xy * viewDir.z) +
      + sh3_2 * (-0.4570458 * viewDir.y * (4.0 * zz - xx - yy))
      + sh3_3 * (0.3731763 * viewDir.z * (2.0 * zz - 3.0 * xx - 3.0 * yy))
      + sh3_4 * (-0.4570458 * viewDir.x * (4.0 * zz - xx - yy))
      + sh3_5 * (1.4453057 * viewDir.z * (xx - yy))
      + sh3_6 * (-0.5900436 * viewDir.x * (xx - 3.0 * yy));

    // rescale
    sh3 = (sh3MinMax.x + sh3MinMax.y) / 2.0 + sh3 * (sh3MinMax.y - sh3MinMax.x) / 2.0;

    return sh1 + sh2 + sh3;
#endif
#endif
  }
`);

export function evaluateSH(
  gsplat: DynoVal<typeof Gsplat>,
  sh: DynoVal<"usampler2DArray">,
  viewDir: DynoVal<"vec3">,
  shDegrees: 1 | 2 | 3,
  maxSh: number,
  sh1MinMax: DynoVal<"vec2">,
  sh2MinMax: DynoVal<"vec2">,
  sh3MinMax: DynoVal<"vec2">,
): DynoVal<"vec3"> {
  return dyno({
    inTypes: {
      gsplat: Gsplat,
      sh: "usampler2DArray",
      viewDir: "vec3",
      sh1MinMax: "vec2",
      sh2MinMax: "vec2",
      sh3MinMax: "vec2",
    },
    outTypes: { rgb: "vec3" },
    inputs: { gsplat, sh, viewDir, sh1MinMax, sh2MinMax, sh3MinMax },
    globals: () => {
      const defines = unindent(`
        #define MAX_SH ${maxSh}
        #define SH_DEGREES ${shDegrees}
        #define SH_TEXEL_STRIDE ${[0, 1, 2, 3][shDegrees]}
      `);
      return [defines, defineGsplat, defineUnpackSint8, defineEvaluateSH];
    },
    statements: ({ inputs, outputs }) =>
      unindentLines(`
        if (isGsplatActive(${inputs.gsplat}.flags)) {
          ${outputs.rgb} = evaluateSH(${inputs.gsplat}, ${inputs.sh}, ${inputs.viewDir}, ${inputs.sh1MinMax}, ${inputs.sh2MinMax}, ${inputs.sh3MinMax});
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
