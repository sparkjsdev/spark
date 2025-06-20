import type { SplatTransformer } from "../SplatGenerator";
import type { SplatMesh } from "../SplatMesh";
import {
  Gsplat,
  add,
  combineGsplat,
  dot,
  dynoBlock,
  dynoConst,
  greaterThanEqual,
  gsplatNormal,
  mul,
  neg,
  select,
  splitGsplat,
} from "../dyno";

export function makeNormalColorModifier(splatToView: SplatTransformer) {
  return dynoBlock({ gsplat: Gsplat }, { gsplat: Gsplat }, ({ gsplat }) => {
    if (!gsplat) {
      throw new Error("No gsplat input");
    }
    let normal = gsplatNormal(gsplat);

    const viewGsplat = splatToView.applyGsplat(gsplat);
    const viewCenter = splitGsplat(viewGsplat).outputs.center;
    const viewNormal = gsplatNormal(viewGsplat);
    const splatDot = dot(viewCenter, viewNormal);

    const sameDir = greaterThanEqual(splatDot, dynoConst("float", 0));
    normal = select(sameDir, neg(normal), normal);
    const rgb = add(
      mul(normal, dynoConst("float", 0.5)),
      dynoConst("float", 0.5),
    );

    gsplat = combineGsplat({ gsplat, rgb });
    return { gsplat };
  });
}

export function setWorldNormalColor(splats: SplatMesh) {
  splats.enableWorldToView = true;
  splats.worldModifier = makeNormalColorModifier(splats.context.worldToView);
  splats.updateGenerator();
}
