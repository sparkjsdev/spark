import type { SplatTransformer } from "../SplatGenerator";
import type { SplatMesh } from "../SplatMesh";
import {
  type DynoVal,
  Gsplat,
  combineGsplat,
  dynoBlock,
  dynoConst,
  neg,
  normalizedDepth,
  select,
  split,
  splitGsplat,
  sub,
} from "../dyno";

export function makeDepthColorModifier(
  splatToView: SplatTransformer,
  minDepth: DynoVal<"float">,
  maxDepth: DynoVal<"float">,
  reverse: DynoVal<"bool">,
) {
  return dynoBlock({ gsplat: Gsplat }, { gsplat: Gsplat }, ({ gsplat }) => {
    if (!gsplat) {
      throw new Error("No gsplat input");
    }
    let { center } = splitGsplat(gsplat).outputs;
    center = splatToView.apply(center);
    const { z } = split(center).outputs;
    let depth = normalizedDepth(neg(z), minDepth, maxDepth);
    depth = select(reverse, sub(dynoConst("float", 1), depth), depth);

    gsplat = combineGsplat({ gsplat, r: depth, g: depth, b: depth });
    return { gsplat };
  });
}

export function setDepthColor(
  splats: SplatMesh,
  minDepth: number,
  maxDepth: number,
  reverse?: boolean,
) {
  splats.enableWorldToView = true;
  const dynoMinDepth = dynoConst("float", minDepth);
  const dynoMaxDepth = dynoConst("float", maxDepth);
  const dynoReverse = dynoConst("bool", reverse ?? false);
  splats.worldModifier = makeDepthColorModifier(
    splats.context.worldToView,
    dynoMinDepth,
    dynoMaxDepth,
    dynoReverse,
  );
  splats.updateGenerator();
  return {
    minDepth: dynoMinDepth,
    maxDepth: dynoMaxDepth,
    reverse: dynoReverse,
  };
}
