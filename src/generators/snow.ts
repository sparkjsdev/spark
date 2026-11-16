import * as THREE from "three";

import { SplatGenerator, SplatTransformer } from "../SplatGenerator.js";
import {
  Gsplat,
  add,
  combine,
  combineGsplat,
  defineGsplat,
  dynoBlock,
  dynoConst,
  dynoFloat,
  dynoLiteral,
  fract,
  hashVec4,
  max,
  mix,
  mod,
  mul,
  sin,
  split,
  sub,
  vec3,
} from "../dyno.js";
import { dynoVec3 } from "../dyno.js";

// snowBox produces Gsplat trajectories that move in a deterministic fashion over time,
// with high similarity between adjacent frames. See examples/atmospheric/main.js
// for an example that creates a snowBox.

// A snowBox instance has a collection of properties that can be tuned to achieve
// different particle effects. The below DEFAULT_SNOW and DEFAULT_RAIN are example
// parameter sets that look a lot like snow and rain, and can be used as a starting
// point for further tweaking: `const mySnow = { ...DEFAULT_SNOW, density: 500 };`

export const DEFAULT_SNOW = {
  box: new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  ),
  density: 100,
  fallDirection: new THREE.Vector3(-1, -3, 1).normalize(),
  fallVelocity: 0.02,
  wanderScale: 0.04,
  wanderVariance: 2,
  color1: new THREE.Color(1, 1, 1),
  color2: new THREE.Color(0.5, 0.5, 1),
  minScale: 0.001,
  maxScale: 0.005,
  anisoScale: new THREE.Vector3(1, 1, 1),
};

export const DEFAULT_RAIN = {
  box: new THREE.Box3(
    new THREE.Vector3(-2, -1, -2),
    new THREE.Vector3(2, 5, 2),
  ),
  density: 10,
  fallDirection: new THREE.Vector3(0, -1, 0),
  fallVelocity: 2,
  wanderScale: 0.1,
  wanderVariance: 1,
  color1: new THREE.Color(1, 1, 1),
  color2: new THREE.Color(0.25, 0.25, 0.5),
  minScale: 0.005,
  maxScale: 0.01,
  anisoScale: new THREE.Vector3(0.1, 1, 0.1),
};

// Calling snowBox creates a new snowBox instance and returns an object with
// the snowBox itself as well `as` a collection of controls that can be used to
// adjust the snowBox's properties over time:
//
// - snow: the SplatGenerator snowBox instance
// - min: the vec3 uniform of the snowBox minimum position
// - max: the vec3 uniform of the snowBox maximum position
// - minY: the float uniform of the snowBox minimum y-coordinate
// - color1: the vec3 uniform of the snowBox first color
// - color2: the vec3 uniform of the snowBox second color
// - opacity: the float uniform of the snowBox opacity
// - fallVelocity: the float uniform of the snowBox fall velocity
// - wanderVariance: the float uniform of the snowBox wander variance
// - wanderScale: the float uniform of the snowBox wander scale
// - fallDirection: the vec3 uniform of the snowBox fall direction
// - minScale: the float uniform of the snowBox minimum scale
// - maxScale: the float uniform of the snowBox maximum scale
// - anisoScale: the vec3 uniform of the snowBox anisotropic scale

export function snowBox({
  // min and max box extents of the snowBox
  box,
  // minimum y-coordinate to clamp particle position, which can be used to
  // fake hitting a ground plane and lingering there for a bit
  minY,
  // number of Gsplats to generate (default: calculated from box and density)
  numSplats,
  // density of Gsplats per unit volume (default: 100)
  density,
  // The xyz anisotropic scale of the Gsplat, which can be used for example
  // to elongate rain particles (default: (1, 1, 1))
  anisoScale,
  // Minimum Gsplat particle scale (default: 0.001)
  minScale,
  // Maximum Gsplat particle scale (default: 0.005)
  maxScale,
  // The average direction of fall (default: (0, -1, 0))
  fallDirection,
  // The average speed of the fall (multiplied with fallDirection) (default: 0.02)
  fallVelocity,
  // The world scale of wandering overlay motion (default: 0.01)
  wanderScale,
  // Controls how uniformly the particles wander in sync, more variance mean
  // more randomness in the motion (default: 2)
  wanderVariance,
  // Color 1 of the two colors interpolated between (default: (1, 1, 1))
  color1,
  // Color 2 of the two colors interpolated between (default: (0.5, 0.5, 1))
  color2,
  // The base opacity of the Gsplats (default: 1)
  opacity,
  // Optional callback function to call each frame.
  onFrame,
}: {
  box?: THREE.Box3;
  minY?: number;
  numSplats?: number;
  density?: number;
  anisoScale?: THREE.Vector3;
  minScale?: number;
  maxScale?: number;
  fallDirection?: THREE.Vector3;
  fallVelocity?: number;
  wanderScale?: number;
  wanderVariance?: number;
  color1?: THREE.Color;
  color2?: THREE.Color;
  opacity?: number;
  onFrame?: ({
    object,
    time,
    deltaTime,
  }: { object: SplatGenerator; time: number; deltaTime: number }) => void;
}) {
  box =
    box ??
    new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const volume =
    (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z);
  density = density ?? 100;
  numSplats =
    numSplats ?? Math.max(1, Math.min(1000000, Math.round(volume * density)));

  const dynoMinScale = dynoFloat(minScale ?? 0.001);
  const dynoMaxScale = dynoFloat(maxScale ?? 0.005);
  const dynoAnisoScale = dynoVec3(
    (anisoScale?.clone() ?? new THREE.Vector3(1, 1, 1)).normalize(),
  );
  const dynoFallDirection = dynoVec3(
    (fallDirection ?? new THREE.Vector3(0, -1, 0)).normalize(),
  );
  const dynoFallVelocity = dynoFloat(fallVelocity ?? 0.02);
  const dynoWanderScale = dynoFloat(wanderScale ?? 0.01);
  const dynoWanderVariance = dynoFloat(wanderVariance ?? 2);
  const dynoColor1 = dynoVec3(color1 ?? new THREE.Color(1, 1, 1));
  const dynoColor2 = dynoVec3(color2 ?? new THREE.Color(0.5, 0.5, 1));
  const dynoOpacity = dynoFloat(opacity ?? 1);

  const dynoTime = dynoFloat(0);
  const globalOffset = dynoVec3(new THREE.Vector3(0, 0, 0));
  const dynoMin = dynoVec3(box.min);
  const dynoMax = dynoVec3(box.max);
  const dynoMinY = dynoFloat(minY ?? Number.NEGATIVE_INFINITY);
  const minMax = sub(dynoMax, dynoMin);
  const snow = new SplatGenerator({
    numSplats,
    generator: dynoBlock(
      { index: "int" },
      { gsplat: Gsplat },
      ({ index }) => {
        if (!index) {
          throw new Error("index not defined");
        }
        const random = hashVec4(index);
        const randomW = split(random).outputs.w;
        let position = vec3(random);

        let size = fract(mul(randomW, dynoConst("float", 100)));
        size = sin(mul(dynoLiteral("float", "PI"), size));
        size = add(dynoMinScale, mul(size, sub(dynoMaxScale, dynoMinScale)));
        const scales = mul(size, dynoAnisoScale);

        const intensity = fract(mul(randomW, dynoConst("float", 10)));
        const hue = fract(randomW);
        const color = mix(dynoColor1, dynoColor2, hue);
        const rgb = mul(color, intensity);

        const random2 = hashVec4(
          combine({
            vectorType: "ivec2",
            x: index,
            y: dynoConst("int", 0x1ab5),
          }),
        );
        let perturb = vec3(random2);
        let timeOffset = mul(split(random2).outputs.w, dynoWanderVariance);
        timeOffset = add(dynoTime, timeOffset);

        position = add(position, globalOffset);
        const modulo = mod(
          position,
          dynoConst("vec3", new THREE.Vector3(1, 1, 1)),
        );
        position = add(dynoMin, mul(minMax, modulo));

        const quaternion = dynoConst("vec4", new THREE.Quaternion(0, 0, 0, 1));

        perturb = sin(add(vec3(timeOffset), perturb));
        perturb = mul(perturb, dynoWanderScale);
        let center = add(position, perturb);

        let centerY = split(center).outputs.y;
        centerY = max(dynoMinY, centerY);
        center = combine({ vector: center, y: centerY });

        let gsplat = combineGsplat({
          flags: dynoLiteral("uint", "GSPLAT_FLAG_ACTIVE"),
          index: index,
          center,
          scales,
          quaternion,
          rgb,
          opacity: dynoOpacity,
        });
        gsplat = transformer.applyGsplat(gsplat);
        return { gsplat };
      },
      {
        globals: () => [defineGsplat],
      },
    ),
    update: ({ object, time, deltaTime }) => {
      dynoTime.value = time;
      const _updated = transformer.update(snow);

      const fallDelta = dynoFallDirection.value
        .clone()
        .multiplyScalar(dynoFallVelocity.value * deltaTime);
      globalOffset.value.add(fallDelta);

      // Enable/disable splats based on opacity
      object.visible = dynoOpacity.value > 0;

      onFrame?.({ object, time, deltaTime });
      snow.updateVersion();
    },
  });
  const transformer: SplatTransformer = new SplatTransformer();
  return {
    snow,
    min: dynoMin,
    max: dynoMax,
    minY: dynoMinY,
    color1: dynoColor1,
    color2: dynoColor2,
    opacity: dynoOpacity,
    fallVelocity: dynoFallVelocity,
    wanderVariance: dynoWanderVariance,
    wanderScale: dynoWanderScale,
    fallDirection: dynoFallDirection,
    minScale: dynoMinScale,
    maxScale: dynoMaxScale,
    anisoScale: dynoAnisoScale,
  };
}

export type SNOW_RESULT_TYPE = ReturnType<typeof snowBox>;
