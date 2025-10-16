import * as THREE from "three";

import newSplatFragment from "./shaders/newSplatFragment.glsl";
import newSplatVertex from "./shaders/newSplatVertex.glsl";
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
      newSplatVertex,
      newSplatFragment,
    };
  }
  return shaders;
}
