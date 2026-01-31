import * as THREE from "three";

// SplatSkinning is an experimental class that implements dual-quaternion
// skeletal animation for Gsplats. A skeletal animation system consists
// of a set of bones, each with a "rest" pose that consists of a position
// and orientation, and a weighting of up to 4 bones for each Gsplat.
// By moving and rotating the bones you can animate all the Gsplats like
// your would for a normal 3D animated mesh.
// Note that the dual-quaternion formulation assumes that mass/volume
// is conserved through these transformations, which helps avoid common
// issues with linear blend skinning such as joint collapse or bulging.
// However, it is not as good a fit for animations that involve explicit
// deformations, such as cartoon animations.

import type { SplatMesh } from "./SplatMesh";
import {
  CovSplat,
  Dyno,
  DynoUniform,
  type DynoVal,
  Gsplat,
  unindent,
  unindentLines,
} from "./dyno";
import { getTextureSize, newArray } from "./utils";

export enum SplatSkinningMode {
  DUAL_QUATERNION = "dual_quaternion",
  LINEAR_BLEND = "linear_blend",
}

export type SplatSkinningOptions = {
  // Specifies the SplatMesh that will be animated.
  mesh: SplatMesh;
  // Overrides the number of Gsplats in the mesh that will be animated.
  // (default: mesh.numSplats)
  numSplats?: number;
  // Set the number of bones used to animate the SplatMesh, with a maximum
  // of 256 (in order to compactly encode the bone index). (default: 256)
  numBones?: number;
  // Set the mode of skinning to use.
  // (default: DUAL_QUATERNION)
  mode?: SplatSkinningMode;
};

export class SplatSkinning {
  mesh: SplatMesh;
  numSplats: number;
  mode: SplatSkinningMode;

  // Store the skinning weights for each Gsplat, composed of a 4-vector
  // of bone indices and weight
  skinData: Uint16Array<ArrayBuffer>;
  skinTexture: THREE.DataArrayTexture;

  numBones: number;
  boneData: Float32Array;
  boneTexture: THREE.DataTexture;

  boneRestQuatPosScale: {
    quat: THREE.Quaternion;
    pos: THREE.Vector3;
    scale: THREE.Vector3;
  }[];
  boneRestInvMats: THREE.Matrix4[];

  uniform: DynoUniform<typeof GsplatSkinning, "skinning">;

  constructor(options: SplatSkinningOptions) {
    this.mesh = options.mesh;
    this.numSplats = options.numSplats ?? this.mesh.numSplats;
    this.mode = options.mode ?? SplatSkinningMode.DUAL_QUATERNION;

    const { width, height, depth, maxSplats } = getTextureSize(this.numSplats);
    this.skinData = new Uint16Array(maxSplats * 4);
    this.skinTexture = new THREE.DataArrayTexture(
      this.skinData,
      width,
      height,
      depth,
    );
    this.skinTexture.format = THREE.RGBAIntegerFormat;
    this.skinTexture.type = THREE.UnsignedShortType;
    this.skinTexture.internalFormat = "RGBA16UI";
    this.skinTexture.needsUpdate = true;

    this.numBones = options.numBones ?? 256;
    this.boneData = new Float32Array(this.numBones * 16);
    this.boneTexture = new THREE.DataTexture(
      this.boneData,
      4,
      this.numBones,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.boneTexture.internalFormat = "RGBA32F";
    this.boneTexture.needsUpdate = true;

    this.boneRestQuatPosScale = newArray(this.numBones, () => ({
      quat: new THREE.Quaternion(),
      pos: new THREE.Vector3(),
      scale: new THREE.Vector3(),
    }));

    if (this.mode === SplatSkinningMode.LINEAR_BLEND) {
      this.boneRestInvMats = newArray(this.numBones, () => new THREE.Matrix4());
    } else {
      this.boneRestInvMats = [];
    }

    this.uniform = new DynoUniform({
      key: "skinning",
      type: GsplatSkinning,
      globals: () => [defineGsplatSkinning],
      value: {
        numSplats: this.numSplats,
        numBones: this.numBones,
        skinTexture: this.skinTexture,
        boneTexture: this.boneTexture,
      },
    });
  }

  // Apply the skeletal animation to a Gsplat in a dyno program.
  modify(gsplat: DynoVal<typeof Gsplat>): DynoVal<typeof Gsplat> {
    if (this.mode === SplatSkinningMode.LINEAR_BLEND) {
      throw new Error("Linear blend skinning requires covSplats=true");
    }
    return applyGsplatSkinning(gsplat, this.uniform);
  }

  modifyCov(covsplat: DynoVal<typeof CovSplat>): DynoVal<typeof CovSplat> {
    if (this.mode === SplatSkinningMode.DUAL_QUATERNION) {
      return applyCovSplatDQSkinning(covsplat, this.uniform);
    }
    return applyCovSplatLBSkinning(covsplat, this.uniform);
  }

  // Set the "rest" pose for a bone with position and quaternion orientation.
  setRestQuatPos(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
  ) {
    this.boneRestQuatPosScale[boneIndex].quat.copy(quat);
    this.boneRestQuatPosScale[boneIndex].pos.copy(pos);
    this.boneRestQuatPosScale[boneIndex].scale.copy(SplatSkinning.UNIT_SCALE);

    if (this.mode === SplatSkinningMode.LINEAR_BLEND) {
      this.boneRestInvMats[boneIndex]
        .compose(pos, quat, SplatSkinning.UNIT_SCALE)
        .invert();
    }

    this.setBoneQuatPos(boneIndex, quat, pos);
  }

  getRestQuatPos(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
  ) {
    quat.copy(this.boneRestQuatPosScale[boneIndex].quat);
    pos.copy(this.boneRestQuatPosScale[boneIndex].pos);
  }

  setRestQuatPosScale(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
    scale: THREE.Vector3,
  ) {
    this.boneRestQuatPosScale[boneIndex].quat.copy(quat);
    this.boneRestQuatPosScale[boneIndex].pos.copy(pos);
    this.boneRestQuatPosScale[boneIndex].scale.copy(scale);

    if (this.mode === SplatSkinningMode.LINEAR_BLEND) {
      this.boneRestInvMats[boneIndex].compose(pos, quat, scale).invert();
    }

    this.setBoneQuatPosScale(boneIndex, quat, pos, scale);
  }

  getRestQuatPosScale(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
    scale: THREE.Vector3,
  ) {
    quat.copy(this.boneRestQuatPosScale[boneIndex].quat);
    pos.copy(this.boneRestQuatPosScale[boneIndex].pos);
    scale.copy(this.boneRestQuatPosScale[boneIndex].scale);
  }

  setRestMatrix(boneIndex: number, matrix: THREE.Matrix4) {
    if (this.mode !== SplatSkinningMode.LINEAR_BLEND) {
      throw new Error("setRestMat only supported for linear blend skinning");
    }
    this.boneRestInvMats[boneIndex].copy(matrix).invert();
    this.setBoneMatrix(boneIndex, matrix);
  }

  getRestMatrix(boneIndex: number, matrix: THREE.Matrix4) {
    if (this.mode !== SplatSkinningMode.LINEAR_BLEND) {
      throw new Error("getRestMat only supported for linear blend skinning");
    }
    matrix.copy(this.boneRestInvMats[boneIndex]).invert();
  }

  // Set the "current" position and orientation of a bone.
  setBoneQuatPos(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
  ) {
    if (this.mode === SplatSkinningMode.DUAL_QUATERNION) {
      SplatSkinning.relQuat
        .copy(this.boneRestQuatPosScale[boneIndex].quat)
        .invert();
      SplatSkinning.relPos
        .copy(pos)
        .sub(this.boneRestQuatPosScale[boneIndex].pos);
      SplatSkinning.relQuat.multiply(quat);
      SplatSkinning.dual
        .set(
          SplatSkinning.relPos.x,
          SplatSkinning.relPos.y,
          SplatSkinning.relPos.z,
          0.0,
        )
        .multiply(SplatSkinning.relQuat);

      const i16 = boneIndex * 16;
      this.boneData[i16 + 0] = SplatSkinning.relQuat.x;
      this.boneData[i16 + 1] = SplatSkinning.relQuat.y;
      this.boneData[i16 + 2] = SplatSkinning.relQuat.z;
      this.boneData[i16 + 3] = SplatSkinning.relQuat.w;
      this.boneData[i16 + 4] = 0.5 * SplatSkinning.dual.x;
      this.boneData[i16 + 5] = 0.5 * SplatSkinning.dual.y;
      this.boneData[i16 + 6] = 0.5 * SplatSkinning.dual.z;
      this.boneData[i16 + 7] = 0.5 * SplatSkinning.dual.w;
    } else {
      this.setBoneQuatPosScale(boneIndex, quat, pos, SplatSkinning.UNIT_SCALE);
    }
  }

  setBoneQuatPosScale(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
    scale: THREE.Vector3,
  ) {
    if (this.mode === SplatSkinningMode.DUAL_QUATERNION) {
      throw new Error(
        "setBoneQuatPosScale only supported for linear blend skinning",
      );
    }

    SplatSkinning.skinMat.compose(pos, quat, scale);
    this.setBoneMatrix(boneIndex, SplatSkinning.skinMat);
  }

  setBoneMatrix(boneIndex: number, matrix: THREE.Matrix4) {
    if (this.mode !== SplatSkinningMode.LINEAR_BLEND) {
      throw new Error("setBoneMatrix only supported for linear blend skinning");
    }

    SplatSkinning.skinMat.multiplyMatrices(
      this.boneRestInvMats[boneIndex],
      matrix,
    );
    const i16 = boneIndex * 16;
    this.boneData[i16 + 0] = SplatSkinning.skinMat.elements[0];
    this.boneData[i16 + 1] = SplatSkinning.skinMat.elements[1];
    this.boneData[i16 + 2] = SplatSkinning.skinMat.elements[2];
    this.boneData[i16 + 3] = SplatSkinning.skinMat.elements[4];
    this.boneData[i16 + 4] = SplatSkinning.skinMat.elements[5];
    this.boneData[i16 + 5] = SplatSkinning.skinMat.elements[6];
    this.boneData[i16 + 6] = SplatSkinning.skinMat.elements[8];
    this.boneData[i16 + 7] = SplatSkinning.skinMat.elements[9];
    this.boneData[i16 + 8] = SplatSkinning.skinMat.elements[10];
    this.boneData[i16 + 9] = SplatSkinning.skinMat.elements[12];
    this.boneData[i16 + 10] = SplatSkinning.skinMat.elements[13];
    this.boneData[i16 + 11] = SplatSkinning.skinMat.elements[14];
  }

  // Set up to 4 bone indices and weights for a Gsplat. For fewer than 4 bones,
  // you can set the remaining weights to 0 (and index=0).
  setSplatBones(
    splatIndex: number,
    boneIndices: THREE.Vector4,
    weights: THREE.Vector4,
  ) {
    const i4 = splatIndex * 4;
    this.skinData[i4 + 0] =
      Math.min(255, Math.max(0, Math.round(weights.x * 255.0))) +
      (boneIndices.x << 8);
    this.skinData[i4 + 1] =
      Math.min(255, Math.max(0, Math.round(weights.y * 255.0))) +
      (boneIndices.y << 8);
    this.skinData[i4 + 2] =
      Math.min(255, Math.max(0, Math.round(weights.z * 255.0))) +
      (boneIndices.z << 8);
    this.skinData[i4 + 3] =
      Math.min(255, Math.max(0, Math.round(weights.w * 255.0))) +
      (boneIndices.w << 8);
  }

  // Call this to indicate that the bones have changed and the Gsplats need to be
  // re-generated with updated skinning.
  updateBones() {
    this.boneTexture.needsUpdate = true;
    this.mesh.needsUpdate = true;
  }

  private static UNIT_SCALE = new THREE.Vector3(1, 1, 1);
  private static relQuat = new THREE.Quaternion();
  private static relPos = new THREE.Vector3();
  private static dual = new THREE.Quaternion();
  private static skinMat = new THREE.Matrix4();
}

// dyno program definitions for SplatSkinning

export const GsplatSkinning = { type: "GsplatSkinning" } as {
  type: "GsplatSkinning";
};

export const defineGsplatSkinning = unindent(`
  struct GsplatSkinning {
    int numSplats;
    int numBones;
    usampler2DArray skinTexture;
    sampler2D boneTexture;
  };
`);

export const defineApplyGsplatSkinning = unindent(`
  void applyGsplatSkinning(
    int numSplats, int numBones,
    usampler2DArray skinTexture, sampler2D boneTexture,
    int splatIndex, inout vec3 center, inout vec4 quaternion
  ) {
    if ((splatIndex < 0) || (splatIndex >= numSplats)) {
      return;
    }

    uvec4 skinData = texelFetch(skinTexture, splatTexCoord(splatIndex), 0);

    float weights[4];
    weights[0] = float(skinData.x & 0xffu) / 255.0;
    weights[1] = float(skinData.y & 0xffu) / 255.0;
    weights[2] = float(skinData.z & 0xffu) / 255.0;
    weights[3] = float(skinData.w & 0xffu) / 255.0;

    uint boneIndices[4];
    boneIndices[0] = (skinData.x >> 8u) & 0xffu;
    boneIndices[1] = (skinData.y >> 8u) & 0xffu;
    boneIndices[2] = (skinData.z >> 8u) & 0xffu;
    boneIndices[3] = (skinData.w >> 8u) & 0xffu;

    vec4 quat = vec4(0.0);
    vec4 dual = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      if (weights[i] > 0.0) {
        int boneIndex = int(boneIndices[i]);
        vec4 boneQuat = vec4(0.0, 0.0, 0.0, 1.0);
        vec4 boneDual = vec4(0.0);
        if (boneIndex < numBones) {
          boneQuat = texelFetch(boneTexture, ivec2(0, boneIndex), 0);
          boneDual = texelFetch(boneTexture, ivec2(1, boneIndex), 0);
        }

        if ((i > 0) && (dot(quat, boneQuat) < 0.0)) {
          // Flip sign if next blend is pointing in the opposite direction
          boneQuat = -boneQuat;
          boneDual = -boneDual;
        }
        quat += weights[i] * boneQuat;
        dual += weights[i] * boneDual;
      }
    }

    // Normalize dual quaternion
    float norm = length(quat);
    quat /= norm;
    dual /= norm;
    vec3 translate = vec3(
      2.0 * (-dual.w * quat.x + dual.x * quat.w - dual.y * quat.z + dual.z * quat.y),
      2.0 * (-dual.w * quat.y + dual.x * quat.z + dual.y * quat.w - dual.z * quat.x),
      2.0 * (-dual.w * quat.z - dual.x * quat.y + dual.y * quat.x + dual.z * quat.w)
    );

    center = quatVec(quat, center) + translate;
    quaternion = quatQuat(quat, quaternion);
  }
`);

function applyGsplatSkinning(
  gsplat: DynoVal<typeof Gsplat>,
  skinning: DynoVal<typeof GsplatSkinning>,
): DynoVal<typeof Gsplat> {
  const dyno = new Dyno<
    { gsplat: typeof Gsplat; skinning: typeof GsplatSkinning },
    { gsplat: typeof Gsplat }
  >({
    inTypes: { gsplat: Gsplat, skinning: GsplatSkinning },
    outTypes: { gsplat: Gsplat },
    globals: () => [defineGsplatSkinning, defineApplyGsplatSkinning],
    inputs: { gsplat, skinning },
    statements: ({ inputs, outputs }) => {
      const { skinning } = inputs;
      const { gsplat } = outputs;
      return unindentLines(`
        ${gsplat} = ${inputs.gsplat};
        if (isGsplatActive(${gsplat}.flags)) {
          applyGsplatSkinning(
            ${skinning}.numSplats, ${skinning}.numBones,
            ${skinning}.skinTexture, ${skinning}.boneTexture,
            ${gsplat}.index, ${gsplat}.center, ${gsplat}.quaternion
          );
        }
      `);
    },
  });
  return dyno.outputs.gsplat;
}

export const defineApplyCovSplatDQSkinning = unindent(`
  void applyCovSplatDQSkinning(
    int numSplats, int numBones,
    usampler2DArray skinTexture, sampler2D boneTexture,
    int splatIndex, inout vec3 center, inout vec3 xxyyzz, inout vec3 xyxzyz
  ) {
    if ((splatIndex < 0) || (splatIndex >= numSplats)) {
      return;
    }

    uvec4 skinData = texelFetch(skinTexture, splatTexCoord(splatIndex), 0);

    float weights[4];
    weights[0] = float(skinData.x & 0xffu) / 255.0;
    weights[1] = float(skinData.y & 0xffu) / 255.0;
    weights[2] = float(skinData.z & 0xffu) / 255.0;
    weights[3] = float(skinData.w & 0xffu) / 255.0;

    uint boneIndices[4];
    boneIndices[0] = (skinData.x >> 8u) & 0xffu;
    boneIndices[1] = (skinData.y >> 8u) & 0xffu;
    boneIndices[2] = (skinData.z >> 8u) & 0xffu;
    boneIndices[3] = (skinData.w >> 8u) & 0xffu;

    vec4 quat = vec4(0.0);
    vec4 dual = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      if (weights[i] > 0.0) {
        int boneIndex = int(boneIndices[i]);
        vec4 boneQuat = vec4(0.0, 0.0, 0.0, 1.0);
        vec4 boneDual = vec4(0.0);
        if (boneIndex < numBones) {
          boneQuat = texelFetch(boneTexture, ivec2(0, boneIndex), 0);
          boneDual = texelFetch(boneTexture, ivec2(1, boneIndex), 0);
        }

        if ((i > 0) && (dot(quat, boneQuat) < 0.0)) {
          // Flip sign if next blend is pointing in the opposite direction
          boneQuat = -boneQuat;
          boneDual = -boneDual;
        }
        quat += weights[i] * boneQuat;
        dual += weights[i] * boneDual;
      }
    }

    // Normalize dual quaternion
    float norm = length(quat);
    quat /= norm;
    dual /= norm;
    vec3 translate = vec3(
      2.0 * (-dual.w * quat.x + dual.x * quat.w - dual.y * quat.z + dual.z * quat.y),
      2.0 * (-dual.w * quat.y + dual.x * quat.z + dual.y * quat.w - dual.z * quat.x),
      2.0 * (-dual.w * quat.z - dual.x * quat.y + dual.y * quat.x + dual.z * quat.w)
    );
    mat3 basis = quaternionToMatrix(quat);

    center = quatVec(quat, center) + translate;

    mat3 cov = mat3(xxyyzz.x, xyxzyz.x, xyxzyz.y, xyxzyz.x, xxyyzz.y, xyxzyz.z, xyxzyz.y, xyxzyz.z, xxyyzz.z);
    cov = basis * cov * transpose(basis);
    xxyyzz = vec3(cov[0][0], cov[1][1], cov[2][2]);
    xyxzyz = vec3(cov[0][1], cov[0][2], cov[1][2]);
  }
`);

export const defineApplyCovSplatLBSkinning = unindent(`
  void applyCovSplatLBSkinning(
    int numSplats, int numBones,
    usampler2DArray skinTexture, sampler2D boneTexture,
    int splatIndex, inout vec3 center, inout vec3 xxyyzz, inout vec3 xyxzyz
  ) {
    if ((splatIndex < 0) || (splatIndex >= numSplats)) {
      return;
    }

    uvec4 skinData = texelFetch(skinTexture, splatTexCoord(splatIndex), 0);

    float weights[4];
    weights[0] = float(skinData.x & 0xffu) / 255.0;
    weights[1] = float(skinData.y & 0xffu) / 255.0;
    weights[2] = float(skinData.z & 0xffu) / 255.0;
    weights[3] = float(skinData.w & 0xffu) / 255.0;

    uint boneIndices[4];
    boneIndices[0] = (skinData.x >> 8u) & 0xffu;
    boneIndices[1] = (skinData.y >> 8u) & 0xffu;
    boneIndices[2] = (skinData.z >> 8u) & 0xffu;
    boneIndices[3] = (skinData.w >> 8u) & 0xffu;

    mat3 basis = mat3(0.0);
    vec3 offset = vec3(0.0);

    for (int i = 0; i < 4; i++) {
      if (weights[i] > 0.0) {
        int boneIndex = int(boneIndices[i]);
        if (boneIndex < numBones) {
          vec4 v0 = texelFetch(boneTexture, ivec2(0, boneIndex), 0);
          vec4 v1 = texelFetch(boneTexture, ivec2(1, boneIndex), 0);
          vec4 v2 = texelFetch(boneTexture, ivec2(2, boneIndex), 0);
          basis += weights[i] * mat3(v0.x, v0.y, v0.z, v0.w, v1.x, v1.y, v1.z, v1.w, v2.x);
          offset += weights[i] * vec3(v2.y, v2.z, v2.w);
        }
      }
    }

    center = basis * center + offset;

    mat3 cov = mat3(xxyyzz.x, xyxzyz.x, xyxzyz.y, xyxzyz.x, xxyyzz.y, xyxzyz.z, xyxzyz.y, xyxzyz.z, xxyyzz.z);
    cov = basis * cov * transpose(basis);
    xxyyzz = vec3(cov[0][0], cov[1][1], cov[2][2]);
    xyxzyz = vec3(cov[0][1], cov[0][2], cov[1][2]);
  }
`);

function applyCovSplatDQSkinning(
  covsplat: DynoVal<typeof CovSplat>,
  skinning: DynoVal<typeof GsplatSkinning>,
): DynoVal<typeof CovSplat> {
  const dyno = new Dyno<
    { covsplat: typeof CovSplat; skinning: typeof GsplatSkinning },
    { covsplat: typeof CovSplat }
  >({
    inTypes: { covsplat: CovSplat, skinning: GsplatSkinning },
    outTypes: { covsplat: CovSplat },
    globals: () => [defineGsplatSkinning, defineApplyCovSplatDQSkinning],
    inputs: { covsplat, skinning },
    statements: ({ inputs, outputs }) => {
      const { skinning } = inputs;
      const { covsplat } = outputs;
      return unindentLines(`
        ${covsplat} = ${inputs.covsplat};
        if (isCovSplatActive(${covsplat}.flags)) {
          applyCovSplatDQSkinning(
            ${skinning}.numSplats, ${skinning}.numBones,
            ${skinning}.skinTexture, ${skinning}.boneTexture,
            ${covsplat}.index, ${covsplat}.center, ${covsplat}.xxyyzz, ${covsplat}.xyxzyz
          );
        }
      `);
    },
  });
  return dyno.outputs.covsplat;
}

function applyCovSplatLBSkinning(
  covsplat: DynoVal<typeof CovSplat>,
  skinning: DynoVal<typeof GsplatSkinning>,
): DynoVal<typeof CovSplat> {
  const dyno = new Dyno<
    { covsplat: typeof CovSplat; skinning: typeof GsplatSkinning },
    { covsplat: typeof CovSplat }
  >({
    inTypes: { covsplat: CovSplat, skinning: GsplatSkinning },
    outTypes: { covsplat: CovSplat },
    globals: () => [defineGsplatSkinning, defineApplyCovSplatLBSkinning],
    inputs: { covsplat, skinning },
    statements: ({ inputs, outputs }) => {
      const { skinning } = inputs;
      const { covsplat } = outputs;
      return unindentLines(`
        ${covsplat} = ${inputs.covsplat};
        if (isCovSplatActive(${covsplat}.flags)) {
          applyCovSplatLBSkinning(
            ${skinning}.numSplats, ${skinning}.numBones,
            ${skinning}.skinTexture, ${skinning}.boneTexture,
            ${covsplat}.index, ${covsplat}.center, ${covsplat}.xxyyzz, ${covsplat}.xyxzyz
          );
        }
      `);
    },
  });
  return dyno.outputs.covsplat;
}
