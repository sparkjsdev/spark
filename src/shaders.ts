import * as THREE from "three";

import oldSplatFragment from "./shaders/oldSplatFragment.glsl";
import oldSplatVertex from "./shaders/oldSplatVertex.glsl";
import splatDefines from "./shaders/splatDefines.glsl";
import splatFragment from "./shaders/splatFragment.glsl";
import splatVertex from "./shaders/splatVertex.glsl";

let shaders: Record<string, string> | null = null;

export function getShaders(): Record<string, string> {
  if (!shaders) {
    // @ts-ignore
    THREE.ShaderChunk.splatDefines = splatDefines;
    shaders = {
      oldSplatVertex,
      oldSplatFragment,
      splatVertex,
      splatFragment,
    };
  }
  return shaders;
}
