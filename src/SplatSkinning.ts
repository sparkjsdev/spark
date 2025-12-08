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
  Dyno,
  DynoUniform,
  type DynoVal,
  Gsplat,
  unindent,
  unindentLines,
} from "./dyno";
import { getTextureSize } from "./utils";

export type SplatSkinningOptions = {
  // Specifies the SplatMesh that will be animated.
  mesh: SplatMesh;
  // Overrides the number of Gsplats in the mesh that will be animated.
  // (default: mesh.numSplats)
  numSplats?: number;
  // Set the number of bones used to animate the SplatMesh, with a maximum
  // of 256 (in order to compactly encode the bone index). (default: 256)
  numBones?: number;
};

export class SplatSkinning {
  mesh: SplatMesh;
  numSplats: number;

  // Store the skinning weights for each Gsplat, composed of a 4-vector
  // of bone indices and weight
  skinData: Uint16Array;
  skinTexture: THREE.DataArrayTexture;

  numBones: number;
  boneData: Float32Array;
  boneTexture: THREE.DataTexture;

  uniform: DynoUniform<typeof GsplatSkinning, "skinning">;

  constructor(options: SplatSkinningOptions) {
    this.mesh = options.mesh;
    this.numSplats = options.numSplats ?? this.mesh.numSplats;

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
    return applyGsplatSkinning(gsplat, this.uniform);
  }

  // Set the "rest" pose for a bone with position and quaternion orientation.
  setRestQuatPos(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
  ) {
    const i16 = boneIndex * 16;
    this.boneData[i16 + 0] = quat.x;
    this.boneData[i16 + 1] = quat.y;
    this.boneData[i16 + 2] = quat.z;
    this.boneData[i16 + 3] = quat.w;
    this.boneData[i16 + 4] = pos.x;
    this.boneData[i16 + 5] = pos.y;
    this.boneData[i16 + 6] = pos.z;
    this.boneData[i16 + 7] = 0;
    this.boneData[i16 + 8] = 0;
    this.boneData[i16 + 9] = 0;
    this.boneData[i16 + 10] = 0;
    this.boneData[i16 + 11] = 1;
    this.boneData[i16 + 12] = 0;
    this.boneData[i16 + 13] = 0;
    this.boneData[i16 + 14] = 0;
    this.boneData[i16 + 15] = 0;
  }

  getRestQuatPos(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
  ) {
    const i16 = boneIndex * 16;
    quat.set(
      this.boneData[i16 + 0],
      this.boneData[i16 + 1],
      this.boneData[i16 + 2],
      this.boneData[i16 + 3],
    );
    pos.set(
      this.boneData[i16 + 4],
      this.boneData[i16 + 5],
      this.boneData[i16 + 6],
    );
  }

  // Set the "current" position and orientation of a bone.
  setBoneQuatPos(
    boneIndex: number,
    quat: THREE.Quaternion,
    pos: THREE.Vector3,
  ) {
    const i16 = boneIndex * 16;
    const origQuat = new THREE.Quaternion(
      this.boneData[i16 + 0],
      this.boneData[i16 + 1],
      this.boneData[i16 + 2],
      this.boneData[i16 + 3],
    );
    const origPos = new THREE.Vector3(
      this.boneData[i16 + 4],
      this.boneData[i16 + 5],
      this.boneData[i16 + 6],
    );

    const relQuat = origQuat.clone().invert();
    const relPos = pos.clone().sub(origPos);
    relPos.applyQuaternion(relQuat);
    relQuat.multiply(quat);
    const dual = new THREE.Quaternion(
      relPos.x,
      relPos.y,
      relPos.z,
      0.0,
    ).multiply(origQuat);

    this.boneData[i16 + 8] = relQuat.x;
    this.boneData[i16 + 9] = relQuat.y;
    this.boneData[i16 + 10] = relQuat.z;
    this.boneData[i16 + 11] = relQuat.w;
    this.boneData[i16 + 12] = 0.5 * dual.x;
    this.boneData[i16 + 13] = 0.5 * dual.y;
    this.boneData[i16 + 14] = 0.5 * dual.z;
    this.boneData[i16 + 15] = 0.5 * dual.w;
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
          boneQuat = texelFetch(boneTexture, ivec2(2, boneIndex), 0);
          boneDual = texelFetch(boneTexture, ivec2(3, boneIndex), 0);
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
