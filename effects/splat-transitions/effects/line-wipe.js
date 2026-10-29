import { SplatMesh, dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

export async function init({ THREE: _THREE, scene, camera, renderer, spark }) {
  const group = new THREE.Group();
  scene.add(group);
  let disposed = false;

  const PARAMETERS = {
    speedMultiplier: 1.0,
    edgeSoftness: 0.3,
    angleDegrees: 0,
    pause: false,
  };
  const LINE_MIN_Y = -2.0;
  const LINE_MAX_Y = 2.0;

  const time = dyno.dynoFloat(0.0);
  const lineYDyn = dyno.dynoFloat(0.0);
  const lineMinDyn = dyno.dynoFloat(LINE_MIN_Y);
  const lineMaxDyn = dyno.dynoFloat(LINE_MAX_Y);
  const edgeDyn = dyno.dynoFloat(PARAMETERS.edgeSoftness);
  const angleRadDyn = dyno.dynoFloat(0.0);

  function createLineWipeModifier(isAboveLine) {
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            lineY: "float",
            edge: "float",
            angleRad: "float",
            isAbove: "int",
          },
          outTypes: { gsplat: dyno.Gsplat },
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            vec3 c = ${inputs.gsplat}.center;
            float height = c.y * cos(${inputs.angleRad}) + c.x * sin(${inputs.angleRad});
            float lineY = ${inputs.lineY};
            float edge = ${inputs.edge};
            float alpha;
            if (${inputs.isAbove} == 1) {
              alpha = smoothstep(lineY - edge, lineY + edge, height);
            } else {
              alpha = 1.0 - smoothstep(lineY - edge, lineY + edge, height);
            }
            ${outputs.gsplat}.rgba.a *= alpha;
          `),
        });
        return {
          gsplat: d.apply({
            gsplat,
            lineY: lineYDyn,
            edge: edgeDyn,
            angleRad: angleRadDyn,
            isAbove: dyno.dynoInt(isAboveLine ? 1 : 0),
          }).gsplat,
        };
      },
    );
  }

  const penguinURL = await getAssetFileURL("penguin.spz");
  const catURL = await getAssetFileURL("cat.spz");

  const penguin = new SplatMesh({ url: penguinURL });
  await penguin.initialized;
  penguin.position.set(0.1, -1.5, 0);
  penguin.rotation.set(Math.PI, 0, 0);
  penguin.scale.set(1, 1, 1);
  penguin.worldModifier = createLineWipeModifier(true);
  penguin.updateGenerator();

  const cat = new SplatMesh({ url: catURL });
  await cat.initialized;
  cat.position.set(0, -1.5, 0);
  cat.rotation.set(Math.PI, 0, 0);
  cat.scale.set(1, 1, 1);
  cat.worldModifier = createLineWipeModifier(false);
  cat.updateGenerator();

  if (!disposed) {
    group.add(penguin);
    group.add(cat);
  }

  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);

  function update(dt, t) {
    if (!PARAMETERS.pause) {
      time.value += dt * PARAMETERS.speedMultiplier;
      const cycle = (lineMaxDyn.value - lineMinDyn.value) * 3;
      const phase = (time.value % cycle) / cycle;
      const lineY =
        phase < 0.5
          ? lineMinDyn.value +
            (lineMaxDyn.value - lineMinDyn.value) * (phase * 2)
          : lineMaxDyn.value -
            (lineMaxDyn.value - lineMinDyn.value) * ((phase - 0.5) * 2);
      lineYDyn.value = lineY;
      penguin.updateVersion();
      cat.updateVersion();
    }
  }

  function setupGUI(folder) {
    folder.add(PARAMETERS, "speedMultiplier", 0.2, 3.0, 0.1);
    folder.add(PARAMETERS, "edgeSoftness", 0.01, 0.5, 0.01).onChange((v) => {
      edgeDyn.value = v;
    });
    folder
      .add(PARAMETERS, "angleDegrees", 0, 90, 1)
      .name("Angle (deg)")
      .onChange((v) => {
        angleRadDyn.value = (v * Math.PI) / 180;
      });
    folder.add(PARAMETERS, "pause");
    return folder;
  }

  function dispose() {
    disposed = true;
    scene.remove(group);
  }

  return { group, update, dispose, setupGUI };
}
