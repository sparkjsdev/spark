import * as THREE from "three";

import extendedSplat from "./shaders/extendedSplat.glsl";
import identityVertex from "./shaders/identityVertex.glsl";
import packedSplat from "./shaders/packedSplat.glsl";
import splatDefines from "./shaders/splatDefines.glsl";
import splatDistanceFragment from "./shaders/splatDistanceFragment.glsl";
import splatFragment from "./shaders/splatFragment.glsl";
import splatVertex from "./shaders/splatVertex.glsl";

let shaderChunksInitialized = false;
const shaders = {
  splatVertex,
  splatFragment,
  identityVertex,
  splatDistanceFragment,
} as const;

export function getShaders() {
  if (!shaderChunksInitialized) {
    const shaderChunks = THREE.ShaderChunk as Record<string, string>;
    shaderChunks.splatDefines = splatDefines;
    shaderChunks.packedSplat = packedSplat;
    shaderChunks.extendedSplat = extendedSplat;
    shaderChunksInitialized = true;
  }
  return shaders;
}
