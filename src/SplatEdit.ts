import * as THREE from "three";

import {
  Dyno,
  DynoInt,
  DynoUniform,
  type DynoVal,
  Gsplat,
  unindent,
  unindentLines,
} from "./dyno";
import { newArray } from "./utils";

// Spark provides the ability to apply "edits" to Gsplats as part of the standard
// SplatMesh pipeline. These edits take the form of a sequence of operations,
// applied one at a time to the set of Gsplats in its packedSplats. Each operation
// evaluates a 7-dimensional field (RGBA and XYZ displacement) at each point in
// space that derives from N=1 or more Signed Distance Field shapes (such as spheres,
// boxes, planes, etc.), blended together and across inside-outisde boundaries.

// The result is a an RGBA,XYZ value for each point in space, which combined with
// SplatEditRgbaBlendMode.MULTIPLY/SET_RGB/ADD_RGBA can be used to create special
// effects, for example simulating simple lighting or applying deformations in space,
// whose parameters can be updated each frame to create animated effects.

// RGBA-XYZ values are computed by blending together values from all SDF shapes using
// the exponential "softmax" function, which is commutative (so blending order within
// a SplatEdit operation doesn't matter). The parameter SplatEdit.sdfSmooth controls
// the blending scale between SDF shapes, while SplatEdit.softEdge controls the scale
// of soft inside-outside shape edit blending. Their default values start at 0.0 and
// should be increased to soften the effect.

// Note that XYZ displacement values are blended in the same way as RGBA, with a
// resulting displacement field that can be quite complex but "softly" blending
// between shapes. These RGBA-XYZ edits, along with time-based and overlapping
// fields can create many interesting animations and special effects, such as
// rippling leaves in the wind, an angry fire, or a looping water effects. Simply
// update the SplatEdit and SplatEditSdf objects and the operations will be applied
// immediately to the Gsplats in the scene.

export enum SplatEditSdfType {
  // ALL: Affects all points in space
  ALL = "all",
  // PLANE: Infinite plane (position, rotation)
  PLANE = "plane",
  // SPHERE: Sphere (position, radius)
  SPHERE = "sphere",
  // BOX: Rounded box (position, rotation, sizes, radius)
  BOX = "box",
  // ELLIPSOID: Ellipsoid (position, rotation, sizes)
  ELLIPSOID = "ellipsoid",
  // CYLINDER: Cylinder (position, rotation, radius, size_y)
  CYLINDER = "cylinder",
  // CAPSULE: Capsule (position, rotation, radius, size_y)
  CAPSULE = "capsule",
  // INFINITE_CONE: Infinite cone (position, rotation, radius=angle)
  INFINITE_CONE = "infinite_cone",
}

function sdfTypeToNumber(type: SplatEditSdfType) {
  switch (type) {
    case SplatEditSdfType.ALL:
      return 0;
    case SplatEditSdfType.PLANE:
      return 1;
    case SplatEditSdfType.SPHERE:
      return 2;
    case SplatEditSdfType.BOX:
      return 3;
    case SplatEditSdfType.ELLIPSOID:
      return 4;
    case SplatEditSdfType.CYLINDER:
      return 5;
    case SplatEditSdfType.CAPSULE:
      return 6;
    case SplatEditSdfType.INFINITE_CONE:
      return 7;
    default:
      throw new Error(`Unknown SDF type: ${type}`);
  }
}

export enum SplatEditRgbaBlendMode {
  // The RGBA of the splat is multiplied component-wise by the SDF’s
  // RGBA value at that point in space.
  MULTIPLY = "multiply",
  // Ignore the Alpha value in the SDF, but set the splat’s RGB to
  // equal the SDF’s RGB value at that point.
  SET_RGB = "set_rgb",
  // Add the SDF’s RGBA value at that point to the RGBA value of
  // the Gsplat. This can produce hyper-saturated results, but is useful
  // to easily “light up” areas.
  ADD_RGBA = "add_rgba",
}

function rgbaBlendModeToNumber(mode: SplatEditRgbaBlendMode) {
  switch (mode) {
    case SplatEditRgbaBlendMode.MULTIPLY:
      return 0;
    case SplatEditRgbaBlendMode.SET_RGB:
      return 1;
    case SplatEditRgbaBlendMode.ADD_RGBA:
      return 2;
    default:
      throw new Error(`Unknown blend mode: ${mode}`);
  }
}

export type SplatEditSdfOptions = {
  // The SDF shape type: ALL, PLANE, SPHERE, BOX, ELLIPSOID, CYLINDER, CAPSULE,
  // or INFINITE_CONE. (default: SplatEditSdfType.SPHERE)
  type?: SplatEditSdfType;
  // Invert the SDF evaluation, swapping inside and outside regions. (default: false)
  invert?: boolean;
  // Opacity / "alpha" value used differently by blending modes (default: 1.0)
  opacity?: number;
  // RGB color applied within the shape. (default: new THREE.Color(1.0, 1.0, 1.0))
  color?: THREE.Color;
  // XYZ displacement applied to splat positions inside the shape.
  // (default: new THREE.Vector3(0.0, 0.0, 0.0))
  displace?: THREE.Vector3;
  // Shape-specific size parameter: sphere radius, box corner rounding,
  // cylinder/capsule radius, or for the infinite cone the angle factor
  // (opening half-angle = π/4 × radius).
  radius?: number;
};

export class SplatEditSdf extends THREE.Object3D {
  type: SplatEditSdfType;
  invert: boolean;
  opacity: number;
  color: THREE.Color;
  displace: THREE.Vector3;
  radius: number;

  constructor(options: SplatEditSdfOptions = {}) {
    super();
    const { type, invert, opacity, color, displace, radius } = options;
    this.type = type ?? SplatEditSdfType.SPHERE;
    this.invert = invert ?? false;
    this.opacity = opacity ?? 1.0;
    this.color = color ?? new THREE.Color(1.0, 1.0, 1.0);
    this.displace = displace ?? new THREE.Vector3(0.0, 0.0, 0.0);
    this.radius = radius ?? 0.0;
  }
}

export type SplatEditOptions = {
  // Name of this edit operation. If you omit it, a default "Edit 1", "Edit 2", ...
  // is assigned.
  name?: string;
  // How the SDF’s RGBA modifies each splat’s RGBA: multiply, overwrite RGB,
  // or add RGBA. (default: MULTIPLY)
  rgbaBlendMode?: SplatEditRgbaBlendMode;
  // Smoothing (in world‐space units) for blending between multiple SDF shapes
  // at their boundaries. (default: 0.0)
  sdfSmooth?: number;
  // Soft‐edge falloff radius (in world‐space units) around each SDF shape’s surface.
  // (default: 0.0)
  softEdge?: number;
  // Invert the SDF evaluation (inside/outside swap). (default: false)
  invert?: boolean;
  // Explicit array of SplatEditSdf objects to include. If null, any child
  // SplatEditSdf instances are used.
  sdfs?: SplatEditSdf[];
};

export class SplatEdit extends THREE.Object3D {
  // ordering used to apply SplatEdit operations to Gsplats. This is implicitly
  // increased with each new SplatEdit. Reassigning ordering can be used to
  // reorder the operations.
  ordering: number;
  rgbaBlendMode: SplatEditRgbaBlendMode;
  sdfSmooth: number;
  softEdge: number;
  invert: boolean;

  // Optional list of explicit SDFs to including in this edit. If it is null, then
  // any SplatEditSdf children in the scene graph will be added automatically.
  sdfs: SplatEditSdf[] | null;

  // The next ordering number to use for a new SplatEdit, auto-incremented
  static nextOrdering = 1;

  constructor(options: SplatEditOptions = {}) {
    const {
      name,
      rgbaBlendMode = SplatEditRgbaBlendMode.MULTIPLY,
      sdfSmooth = 0.0,
      softEdge = 0.0,
      invert = false,
      sdfs = null,
    } = options;

    super();
    this.rgbaBlendMode = rgbaBlendMode;
    this.sdfSmooth = sdfSmooth;
    this.softEdge = softEdge;
    this.invert = invert;
    this.sdfs = sdfs;
    // Assign and auto-increment unique ordering number for this edit
    this.ordering = SplatEdit.nextOrdering++;
    // Automatically assign a default name if not provided
    this.name = name ?? `Edit ${this.ordering}`;
  }

  addSdf(sdf: SplatEditSdf) {
    if (this.sdfs == null) {
      this.sdfs = [];
    }
    if (!this.sdfs.includes(sdf)) {
      this.sdfs.push(sdf);
    }
  }

  removeSdf(sdf: SplatEditSdf) {
    if (this.sdfs == null) {
      return;
    }
    this.sdfs = this.sdfs.filter((s) => s !== sdf);
  }
}

// Dyno implementation of RGBA-XYZ SDF editing.
// The SDFs are encoded in a texture while the edits are encoded
// as a uniform uvec4 array.

export class SplatEdits {
  // Maximum number of SDFs allocated
  maxSdfs: number;
  // Number of SDFs currently in use
  numSdfs: number;
  // Encoded SDF data
  sdfData: Uint32Array;
  // Float interpretation of SDF data
  sdfFloatData: Float32Array;
  // Texture with encoded SDF data
  sdfTexture: THREE.DataTexture;
  // An SdfArray dyno uniform
  dynoSdfArray: DynoUniform<typeof SdfArray, "sdfArray">;

  // Maximum number of edits allocated
  maxEdits: number;
  // Number of edits currently in use
  numEdits: number;
  // Encoded edit data
  editData: Uint32Array;
  // Float interpretation of edit data
  editFloatData: Float32Array;
  // A dyno uniform for the number of edits
  dynoNumEdits: DynoUniform<"int", "numEdits">;
  // A dyno uniform for the encoded edits, one uvec4 per edit
  dynoEdits: DynoUniform<"uvec4", "edits">;

  constructor({ maxSdfs, maxEdits }: { maxSdfs?: number; maxEdits?: number }) {
    // Allocate at least 16 SDFs for efficiency
    this.maxSdfs = Math.max(16, maxSdfs ?? 0);
    this.numSdfs = 0;

    // Allocate space: 8 x (u)vec4 values per SDF, Uint32 and Float32 arrays
    this.sdfData = new Uint32Array(this.maxSdfs * 8 * 4);
    this.sdfFloatData = new Float32Array(this.sdfData.buffer);
    this.sdfTexture = this.newSdfTexture(this.sdfData, this.maxSdfs);
    this.dynoSdfArray = new DynoUniform({
      key: "sdfArray",
      type: SdfArray,
      globals: () => [defineSdfArray],
      value: {
        numSdfs: 0,
        sdfTexture: this.sdfTexture,
      },
      update: (uniform) => {
        uniform.numSdfs = this.numSdfs;
        uniform.sdfTexture = this.sdfTexture;
        return uniform;
      },
    });

    // Allocate at least 16 edits slots for efficiency
    this.maxEdits = Math.max(16, maxEdits ?? 0);
    this.numEdits = 0;
    // Allocate space: 1 uvec4 per edit
    this.editData = new Uint32Array(this.maxEdits * 4);
    this.editFloatData = new Float32Array(this.editData.buffer);
    this.dynoNumEdits = new DynoInt({ value: 0 });
    this.dynoEdits = this.newEdits(this.editData, this.maxEdits);
  }

  private newSdfTexture(data: Uint32Array, maxSdfs: number) {
    const texture = new THREE.DataTexture(
      data,
      8,
      maxSdfs,
      THREE.RGBAIntegerFormat,
      THREE.UnsignedIntType,
    );
    texture.internalFormat = "RGBA32UI";
    texture.needsUpdate = true;
    return texture;
  }

  private newEdits(data: Uint32Array, maxEdits: number) {
    return new DynoUniform({
      key: "edits",
      type: "uvec4",
      count: maxEdits,
      globals: () => [defineEdit],
      value: data,
    });
  }

  // Ensure our SDF texture and edits uniform array have enough capacity.
  // Reallocate if not.
  private ensureCapacity({
    maxSdfs,
    maxEdits,
  }: { maxSdfs: number; maxEdits: number }): boolean {
    let dynoUpdated = false;
    if (maxSdfs > this.sdfTexture.image.height) {
      this.sdfTexture.dispose();
      // At least double the size to avoid frequent reallocations
      this.maxSdfs = Math.max(this.maxSdfs * 2, maxSdfs);
      this.sdfData = new Uint32Array(this.maxSdfs * 8 * 4);
      this.sdfFloatData = new Float32Array(this.sdfData.buffer);
      this.sdfTexture = this.newSdfTexture(this.sdfData, this.maxSdfs);
    }
    if (maxEdits > (this.dynoEdits.count ?? 0)) {
      // At least double the size to avoid frequent reallocations
      this.maxEdits = Math.max(this.maxEdits * 2, maxEdits);
      this.editData = new Uint32Array(this.maxEdits * 4);
      this.editFloatData = new Float32Array(this.editData.buffer);
      this.dynoEdits = this.newEdits(this.editData, this.maxEdits);
      dynoUpdated = true;
    }
    return dynoUpdated;
  }

  private updateEditData(offset: number, value: number): boolean {
    // Update an edit uint32 value and return true if it changed
    const updated = this.editData[offset] !== value;
    this.editData[offset] = value;
    return updated;
  }

  private updateEditFloatData(offset: number, value: number): boolean {
    // Update an edit float32 value and return true if it changed
    tempFloat32[0] = value;
    const updated = this.editFloatData[offset] !== tempFloat32[0];
    if (updated) {
      this.editFloatData[offset] = tempFloat32[0];
    }
    return updated;
  }

  private encodeEdit(
    editIndex: number,
    {
      sdfFirst,
      sdfCount,
      invert,
      rgbaBlendMode,
      softEdge,
      sdfSmooth,
    }: {
      sdfFirst: number;
      sdfCount: number;
      invert: boolean;
      rgbaBlendMode: number;
      softEdge: number;
      sdfSmooth: number;
    },
  ): boolean {
    const base = editIndex * 4;
    let updated = false;
    // Encode the edit fields into the editData array and check if any changed
    updated =
      this.updateEditData(base + 0, rgbaBlendMode | (invert ? 1 << 8 : 0)) ||
      updated;
    updated =
      this.updateEditData(base + 1, sdfFirst | (sdfCount << 16)) || updated;
    updated = this.updateEditFloatData(base + 2, softEdge) || updated;
    updated = this.updateEditFloatData(base + 3, sdfSmooth) || updated;
    return updated;
  }

  private updateSdfData(offset: number, value: number): boolean {
    // Update an SDF uint32 value and return true if it changed
    const updated = this.sdfData[offset] !== value;
    this.sdfData[offset] = value;
    return updated;
  }

  private updateSdfFloatData(offset: number, value: number): boolean {
    // Update an SDF float32 value and return true if it changed
    tempFloat32[0] = value;
    const updated = this.sdfFloatData[offset] !== tempFloat32[0];
    if (updated) {
      this.sdfFloatData[offset] = tempFloat32[0];
    }
    return updated;
  }

  private encodeSdf(
    sdfIndex: number,
    {
      sdfType,
      invert,
      center,
      quaternion,
      scale,
      sizes,
    }: {
      sdfType: number;
      invert?: boolean;
      center?: THREE.Vector3;
      quaternion?: THREE.Quaternion;
      scale?: THREE.Vector3;
      sizes?: THREE.Vector4;
    },
    values: THREE.Vector4[],
  ): boolean {
    // Encode the SDF fields into the sdfData array and check if any changed
    const base = sdfIndex * (8 * 4);
    const flags = sdfType | (invert ? 1 << 8 : 0);
    let updated = false;

    updated = this.updateSdfFloatData(base + 0, center?.x ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 1, center?.y ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 2, center?.z ?? 0) || updated;
    updated = this.updateSdfData(base + 3, flags) || updated;

    updated = this.updateSdfFloatData(base + 4, quaternion?.x ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 5, quaternion?.y ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 6, quaternion?.z ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 7, quaternion?.w ?? 0) || updated;

    updated = this.updateSdfFloatData(base + 8, scale?.x ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 9, scale?.y ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 10, scale?.z ?? 0) || updated;
    updated = this.updateSdfData(base + 11, 0) || updated;

    updated = this.updateSdfFloatData(base + 12, sizes?.x ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 13, sizes?.y ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 14, sizes?.z ?? 0) || updated;
    updated = this.updateSdfFloatData(base + 15, sizes?.w ?? 0) || updated;

    const nValues = Math.min(4, values.length);
    for (let i = 0; i < nValues; ++i) {
      const vBase = base + 16 + i * 4;
      updated = this.updateSdfFloatData(vBase + 0, values[i].x) || updated;
      updated = this.updateSdfFloatData(vBase + 1, values[i].y) || updated;
      updated = this.updateSdfFloatData(vBase + 2, values[i].z) || updated;
      updated = this.updateSdfFloatData(vBase + 3, values[i].w) || updated;
    }
    return updated;
  }

  // Update the SDFs and edits from an array of SplatEdits and their
  // associated SplatEditSdfs, updating it for the dyno shader program.
  update(edits: { edit: SplatEdit; sdfs: SplatEditSdf[] }[]): {
    updated: boolean;
    dynoUpdated: boolean;
  } {
    const sdfCount = edits.reduce((total, { sdfs }) => total + sdfs.length, 0);
    const dynoUpdated = this.ensureCapacity({
      maxEdits: edits.length,
      maxSdfs: sdfCount,
    });

    const values = [new THREE.Vector4(), new THREE.Vector4()];
    const center = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const sizes = new THREE.Vector4();

    let sdfIndex = 0;
    let updated = dynoUpdated;

    if (edits.length !== this.dynoNumEdits.value) {
      this.dynoNumEdits.value = edits.length;
      this.numEdits = edits.length;
      updated = true;
    }

    for (const [editIndex, { edit, sdfs }] of edits.entries()) {
      updated =
        this.encodeEdit(editIndex, {
          sdfFirst: sdfIndex,
          sdfCount: sdfs.length,
          invert: edit.invert,
          rgbaBlendMode: rgbaBlendModeToNumber(edit.rgbaBlendMode),
          softEdge: edit.softEdge,
          sdfSmooth: edit.sdfSmooth,
        }) || updated;

      let sdfUpdated = false;
      for (const sdf of sdfs) {
        sizes.set(sdf.scale.x, sdf.scale.y, sdf.scale.z, sdf.radius);
        // Temporarily set the SDF scale to 1.0 to get the world-to-SDF
        // transform without scaling. The SDF treats the scale separately.
        sdf.scale.setScalar(1.0);
        sdf.updateMatrixWorld();
        const worldToSdf = sdf.matrixWorld.clone().invert();
        worldToSdf.decompose(center, quaternion, scale);

        sdf.scale.set(sizes.x, sizes.y, sizes.z);
        sdf.updateMatrixWorld();

        values[0].set(sdf.color.r, sdf.color.g, sdf.color.b, sdf.opacity);
        values[1].set(sdf.displace.x, sdf.displace.y, sdf.displace.z, 1.0);

        sdfUpdated =
          this.encodeSdf(
            sdfIndex,
            {
              sdfType: sdfTypeToNumber(sdf.type),
              invert: sdf.invert,
              center,
              quaternion,
              scale,
              sizes,
            },
            values,
          ) || sdfUpdated;

        sdfIndex += 1;
      }
      this.numSdfs = sdfIndex;
      if (sdfUpdated) {
        this.sdfTexture.needsUpdate = true;
      }
      updated ||= sdfUpdated;
    }
    return { updated, dynoUpdated };
  }

  // Modify a Gsplat in a dyno shader program using the current edits and SDFs.
  modify(gsplat: DynoVal<typeof Gsplat>): DynoVal<typeof Gsplat> {
    return applyGsplatRgbaDisplaceEdits(
      gsplat,
      this.dynoSdfArray,
      this.dynoNumEdits,
      this.dynoEdits,
    );
  }
}

// Dyno types and components:

// An SdfArray contains a collection of SDFs encoded in a texture.
// Each SDF has a type and geometric parameters, but also encodes
// 4 x vec4 values, which can all be blended across multiple SDFs.
// The SplatEdit system uses 7 of these 16 values to encode RGBA-XYZ edits,
// but more can be added, and these SDFs can be used for entirely different
// purposes as well.

export const SdfArray = { type: "SdfArray" } as { type: "SdfArray" };

export const defineSdfArray = unindent(`
  struct SdfArray {
    int numSdfs;
    usampler2D sdfTexture;
  };

  void unpackSdfArray(
    usampler2D sdfTexture, int sdfIndex, out uint flags,
    out vec3 center, out vec4 quaternion, out vec3 scale, out vec4 sizes,
    int numValues, out vec4 values[4]
  ) {
    uvec4 temp = texelFetch(sdfTexture, ivec2(0, sdfIndex), 0);
    flags = temp.w;
    center = vec3(uintBitsToFloat(temp.x), uintBitsToFloat(temp.y), uintBitsToFloat(temp.z));

    temp = texelFetch(sdfTexture, ivec2(1, sdfIndex), 0);
    quaternion = vec4(uintBitsToFloat(temp.x), uintBitsToFloat(temp.y), uintBitsToFloat(temp.z), uintBitsToFloat(temp.w));

    temp = texelFetch(sdfTexture, ivec2(2, sdfIndex), 0);
    scale = vec3(uintBitsToFloat(temp.x), uintBitsToFloat(temp.y), uintBitsToFloat(temp.z));

    temp = texelFetch(sdfTexture, ivec2(3, sdfIndex), 0);
    sizes = vec4(uintBitsToFloat(temp.x), uintBitsToFloat(temp.y), uintBitsToFloat(temp.z), uintBitsToFloat(temp.w));

    for (int i = 0; i < numValues; ++i) {
      temp = texelFetch(sdfTexture, ivec2(4 + i, sdfIndex), 0);
      values[i] = vec4(uintBitsToFloat(temp.x), uintBitsToFloat(temp.y), uintBitsToFloat(temp.z), uintBitsToFloat(temp.w));
    }
  }

  const uint SDF_FLAG_TYPE = 0xFFu;
  const uint SDF_FLAG_INVERT = 1u << 8u;

  const uint SDF_TYPE_ALL = 0u;
  const uint SDF_TYPE_PLANE = 1u;
  const uint SDF_TYPE_SPHERE = 2u;
  const uint SDF_TYPE_BOX = 3u;
  const uint SDF_TYPE_ELLIPSOID = 4u;
  const uint SDF_TYPE_CYLINDER = 5u;
  const uint SDF_TYPE_CAPSULE = 6u;
  const uint SDF_TYPE_INFINITE_CONE = 7u;

  float evaluateSdfArray(
    usampler2D sdfTexture, int numSdfs, int sdfFirst, int sdfCount, vec3 pos,
    float smoothK, int numValues, out vec4 outValues[4]
  ) {
    float distanceAccum = (smoothK == 0.0) ? 1.0 / 0.0 : 0.0;
    float maxExp = -1.0 / 0.0;
    for (int i = 0; i < numValues; ++i) {
        outValues[i] = vec4(0.0);
    }

    uint flags;
    vec3 center, scale;
    vec4 quaternion, sizes;
    vec4 values[4];

    int sdfLast = min(sdfFirst + sdfCount, numSdfs);
    for (int index = sdfFirst; index < sdfLast; ++index) {
      unpackSdfArray(sdfTexture, index, flags, center, quaternion, scale, sizes, numValues, values);
      uint sdfType = flags & SDF_FLAG_TYPE;
      vec3 sdfPos = quatVec(quaternion, pos * scale) + center;

      float distance;
      switch (sdfType) {
        case SDF_TYPE_ALL:
          distance = -1.0 / 0.0;
          break;
        case SDF_TYPE_PLANE: {
          distance = sdfPos.z;
          break;
        }
        case SDF_TYPE_SPHERE: {
          distance = length(sdfPos) - sizes.w;
          break;
        }
        case SDF_TYPE_BOX: {
          vec3 q = abs(sdfPos) - sizes.xyz + sizes.w;
          distance = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - sizes.w;
          break;
        }
        case SDF_TYPE_ELLIPSOID: {
          vec3 sizes = sizes.xyz;
          float k0 = length(sdfPos / sizes);
          float k1 = length(sdfPos / dot(sizes, sizes));
          distance = k0 * (k0 - 1.0) / k1;
          break;
        }
        case SDF_TYPE_CYLINDER: {
          vec2 d = abs(vec2(length(sdfPos.xz), sdfPos.y)) - sizes.wy;
          distance = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
          break;
        }
        case SDF_TYPE_CAPSULE: {
          sdfPos.y -= clamp(sdfPos.y, -0.5 * sizes.y, 0.5 * sizes.y);
          distance = length(sdfPos) - sizes.w;
          break;
        }
        case SDF_TYPE_INFINITE_CONE: {
          float angle = 0.25 * PI * sizes.w;
          vec2 c = vec2(sin(angle), cos(angle));
          vec2 q = vec2(length(sdfPos.xy), -sdfPos.z);
          float d = length(q - c * max(dot(q, c), 0.0));
          distance = d * (((q.x * c.y - q.y * c.x) < 0.0) ? -1.0 : 1.0);
          break;
        }
      }

      if ((flags & SDF_FLAG_INVERT) != 0u) {
        distance = -distance;
      }

      if (smoothK == 0.0) {
        if (distance < distanceAccum) {
          distanceAccum = distance;
          for (int i = 0; i < numValues; ++i) {
            outValues[i] = values[i];
          }
        }
      } else {
        float scaledDistance = -distance / smoothK;
        if (scaledDistance > maxExp) {
          float scale = exp(maxExp - scaledDistance);
          distanceAccum *= scale;
          for (int i = 0; i < numValues; ++i) {
            outValues[i] *= scale;
          }
          maxExp = scaledDistance;
        }

        float weight = exp(scaledDistance - maxExp);
        distanceAccum += weight;
        for (int i = 0; i < numValues; ++i) {
          outValues[i] += weight * values[i];
        }
      }
    }

    if (smoothK == 0.0) {
      return distanceAccum;
    } else {
      // Very distant SDFs may result in 0 accumulation
      if (distanceAccum == 0.0) {
        return 1.0 / 0.0;
      }
      for (int i = 0; i < numValues; ++i) {
        outValues[i] /= distanceAccum;
      }
      return (-log(distanceAccum) - maxExp) * smoothK;
    }
  }

  float modulateSdfArray(
    usampler2D sdfTexture, int numSdfs, int sdfFirst, int sdfCount, vec3 pos,
    float smoothK, int numValues, out vec4 values[4],
    float softEdge, bool invert
  ) {
    float distance = evaluateSdfArray(sdfTexture, numSdfs, sdfFirst, sdfCount, pos, smoothK, numValues, values);
    if (invert) {
      distance = -distance;
    }

    return (softEdge == 0.0) ? ((distance < 0.0) ? 1.0 : 0.0)
      : clamp(-distance / softEdge + 0.5, 0.0, 1.0);
  }
`);

export const defineEdit = unindent(`
  const uint EDIT_FLAG_BLEND = 0xFFu;
  const uint EDIT_BLEND_MULTIPLY = 0u;
  const uint EDIT_BLEND_SET_RGB = 1u;
  const uint EDIT_BLEND_ADD_RGBA = 2u;
  const uint EDIT_FLAG_INVERT = 0x100u;

  void decodeEdit(
    uvec4 packedEdit, out int sdfFirst, out int sdfCount,
    out bool invert, out uint rgbaBlendMode, out float softEdge, out float sdfSmooth
  ) {
    rgbaBlendMode = packedEdit.x & EDIT_FLAG_BLEND;
    invert = (packedEdit.x & EDIT_FLAG_INVERT) != 0u;

    sdfFirst = int(packedEdit.y & 0xFFFFu);
    sdfCount = int(packedEdit.y >> 16u);

    softEdge = uintBitsToFloat(packedEdit.z);
    sdfSmooth = uintBitsToFloat(packedEdit.w);
  }

  void applyRgbaDisplaceEdit(
    usampler2D sdfTexture, int numSdfs, int sdfFirst, int sdfCount, inout vec3 pos,
    float smoothK, float softEdge, bool invert, uint rgbaBlendMode, inout vec4 rgba
  ) {
    vec4 values[4];
    float modulate = modulateSdfArray(sdfTexture, numSdfs, sdfFirst, sdfCount, pos, smoothK, 2, values, softEdge, invert);
    // On Android, moving values[0] is necessary to work around a compiler bug.
    vec4 sdfRgba = values[0];
    vec4 sdfDisplaceScale = values[1];

    vec4 target;
    switch (rgbaBlendMode) {
      case EDIT_BLEND_MULTIPLY:
        target = rgba * sdfRgba;
        break;
      case EDIT_BLEND_SET_RGB:
        target = vec4(sdfRgba.rgb, rgba.a * sdfRgba.a);
        break;
      case EDIT_BLEND_ADD_RGBA:
        target = rgba + sdfRgba;
        break;
      default:
        // Debug output if blend mode not set
        target = vec4(fract(pos), 1.0);
    }
    rgba = mix(rgba, target, modulate);
    pos += sdfDisplaceScale.xyz * modulate;
  }

  void applyPackedRgbaDisplaceEdit(uvec4 packedEdit, usampler2D sdfTexture, int numSdfs, inout vec3 pos, inout vec4 rgba) {
    int sdfFirst, sdfCount;
    bool invert;
    uint rgbaBlendMode;
    float softEdge, sdfSmooth;
    decodeEdit(packedEdit, sdfFirst, sdfCount, invert, rgbaBlendMode, softEdge, sdfSmooth);
    applyRgbaDisplaceEdit(sdfTexture, numSdfs, sdfFirst, sdfCount, pos, sdfSmooth, softEdge, invert, rgbaBlendMode, rgba);
  }
`);

function applyGsplatRgbaDisplaceEdits(
  gsplat: DynoVal<typeof Gsplat>,
  sdfArray: DynoVal<typeof SdfArray>,
  numEdits: DynoVal<"int">,
  rgbaDisplaceEdits: DynoVal<"uvec4">,
): DynoVal<typeof Gsplat> {
  const dyno = new Dyno<
    {
      gsplat: typeof Gsplat;
      sdfArray: typeof SdfArray;
      numEdits: "int";
      rgbaDisplaceEdits: "uvec4";
    },
    { gsplat: typeof Gsplat }
  >({
    inTypes: {
      gsplat: Gsplat,
      sdfArray: SdfArray,
      numEdits: "int",
      rgbaDisplaceEdits: "uvec4",
    },
    outTypes: { gsplat: Gsplat },
    globals: () => [defineSdfArray, defineEdit],
    inputs: { gsplat, sdfArray, numEdits, rgbaDisplaceEdits },
    statements: ({ inputs, outputs }) => {
      const { sdfArray, numEdits, rgbaDisplaceEdits } = inputs;
      const { gsplat } = outputs;
      return unindentLines(`
        ${gsplat} = ${inputs.gsplat};
        if (isGsplatActive(${gsplat}.flags)) {
          for (int editIndex = 0; editIndex < ${numEdits}; ++editIndex) {
            applyPackedRgbaDisplaceEdit(
              ${rgbaDisplaceEdits}[editIndex], ${sdfArray}.sdfTexture, ${sdfArray}.numSdfs,
              ${gsplat}.center, ${gsplat}.rgba
            );
          }
        }
      `);
    },
  });
  return dyno.outputs.gsplat;
}

const tempFloat32 = new Float32Array(1);
