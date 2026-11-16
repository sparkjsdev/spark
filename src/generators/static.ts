import * as THREE from "three";
import { SplatGenerator, SplatTransformer } from "../SplatGenerator.js";
import {
  type DynoVal,
  Gsplat,
  add,
  combine,
  combineGsplat,
  defineGsplat,
  div,
  dynoBlock,
  dynoConst,
  dynoFloat,
  dynoLiteral,
  floatBitsToInt,
  hashVec3,
  imod,
  mul,
  split,
  sub,
  vec3,
} from "../dyno.js";

export function staticBox({
  box,
  cells,
  dotScale,
  color,
  opacity,
}: {
  box: THREE.Box3;
  cells: THREE.Vector3;
  dotScale: number;
  color?: THREE.Color;
  opacity?: number;
}) {
  cells.x = Math.max(1, Math.round(cells.x));
  cells.y = Math.max(1, Math.round(cells.y));
  cells.z = Math.max(1, Math.round(cells.z));
  opacity = opacity ?? 1;
  const numSplats = cells.x * cells.y * cells.z;
  const dynoX = dynoConst("int", cells.x);
  const dynoY = dynoConst("int", cells.y);
  const dynoZ = dynoConst("int", cells.z);

  const dynoTime = dynoFloat(0);
  const generator = new SplatGenerator({
    numSplats,
    generator: dynoBlock(
      { index: "int" },
      { gsplat: Gsplat },
      ({ index }) => {
        if (!index) {
          throw new Error("index is undefined");
        }
        const cellX = imod(index, dynoX);
        const index2 = div(index, dynoX);
        const cellY = imod(index2, dynoY);
        const cellZ = div(index2, dynoY);
        const cell = combine({
          vectorType: "ivec3",
          x: cellX,
          y: cellY,
          z: cellZ,
        });

        const intTime = floatBitsToInt(dynoTime);
        const inputs = combine({ vectorType: "ivec2", x: index, y: intTime });
        const random = hashVec3(inputs);
        const min = dynoConst("vec3", box.min);
        const max = dynoConst("vec3", box.max);
        const size = sub(max, min);
        const coord = div(add(vec3(cell), random), dynoConst("vec3", cells));
        let r: DynoVal<"float">;
        let g: DynoVal<"float">;
        let b: DynoVal<"float">;
        if (color) {
          r = dynoConst("float", color.r);
          g = dynoConst("float", color.g);
          b = dynoConst("float", color.b);
        } else {
          ({ r, g, b } = split(coord).outputs);
        }
        const rgba = combine({
          vectorType: "vec4",
          r,
          g,
          b,
          a: dynoConst("float", opacity),
        });
        const center = add(min, mul(size, coord));
        const scales = vec3(dynoConst("float", dotScale));
        const quaternion = dynoConst("vec4", new THREE.Quaternion(0, 0, 0, 1));
        let gsplat = combineGsplat({
          flags: dynoLiteral("uint", "GSPLAT_FLAG_ACTIVE"),
          index: index,
          center,
          scales,
          quaternion,
          rgba,
        });
        gsplat = transformer.applyGsplat(gsplat);
        return { gsplat };
      },
      {
        globals: () => [defineGsplat],
      },
    ),
    update: ({ time }) => {
      dynoTime.value = time;
      const _updated = transformer.update(generator);
      generator.updateVersion();
    },
  });
  const transformer: SplatTransformer = new SplatTransformer();
  return generator;
}
