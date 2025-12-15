import * as THREE from "three";

import computeUvec4Template from "./shaders/computeUvec4.glsl";
import computeVec4Template from "./shaders/computeVec4.glsl";
import splatDefines from "./shaders/splatDefines.glsl";
import splatFragment from "./shaders/splatFragment.glsl";
import splatVertex from "./shaders/splatVertex.glsl";

let shaders: Record<string, string> | null = null;

export function getShaders(): Record<string, string> {
  if (!shaders) {
    // @ts-ignore
    THREE.ShaderChunk.splatDefines = splatDefines;
    shaders = {
      splatVertex,
      splatFragment,
      computeVec4Template,
      computeUvec4Template,
    };
  }
  return shaders;
}
