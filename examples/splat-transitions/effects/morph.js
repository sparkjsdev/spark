import { SplatMesh, dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

export async function init({ THREE: _THREE, scene, camera, renderer, spark }) {
  const group = new THREE.Group();
  scene.add(group);
  let disposed = false;

  // Camera baseline for Morph effect
  camera.position.set(0, 2.2, 6.5);
  camera.lookAt(0, 1.0, 0);

  const PARAMETERS = {
    speedMultiplier: 1.0,
    rotation: true,
    pause: false,
    staySeconds: 1.5,
    transitionSeconds: 2.0,
    randomRadius: 1.3,
  };

  const time = dyno.dynoFloat(0.0);

  // Tres splats de comida
  const splatFiles = [
    "branzino-amarin.spz",
    "pad-thai.spz",
    "primerib-tamos.spz",
  ];

  function morphDyno() {
    return new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        gt: "float",
        objectIndex: "int",
        stay: "float",
        trans: "float",
        numObjects: "int",
        randomRadius: "float",
        offsetY: "float",
      },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [
        dyno.unindent(`
        vec3 hash3(int n) {
          float x = float(n);
          return fract(sin(vec3(x, x + 1.0, x + 2.0)) * 43758.5453123);
        }
        float ease(float x) { return x*x*(3.0 - 2.0*x); }
        vec3 randPos(int splatIndex, float radius) {
          // Uniform disk sampling on XZ plane
          vec3 h = hash3(splatIndex);
          float theta = 6.28318530718 * h.x;
          float r = radius * sqrt(h.y);
          return vec3(r * cos(theta), 0.0, r * sin(theta));
        }
      `),
      ],
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(`
        ${outputs.gsplat} = ${inputs.gsplat};
        float stay = ${inputs.stay};
        float trans = ${inputs.trans};
        float cycle = stay + trans;
        float tot = float(${inputs.numObjects}) * cycle;
        float w = mod(${inputs.gt}, tot);
        int cur = int(floor(w / cycle));
        int nxt = (cur + 1) % ${inputs.numObjects};
        float local = mod(w, cycle);
        bool inTrans = local > stay;
        float uPhase = inTrans ? clamp((local - stay) / trans, 0.0, 1.0) : 0.0;
        bool phaseScatter = uPhase < 0.5;
        float s = phaseScatter ? (uPhase / 0.5) : ((uPhase - 0.5) / 0.5);
        int idx = ${inputs.objectIndex};

        vec3 rp = randPos(int(${inputs.gsplat}.index), ${inputs.randomRadius});
        rp.y -= ${inputs.offsetY};
        vec3 rpMid = mix(${inputs.gsplat}.center, rp, 0.7);

        float alpha = 0.0;
        vec3 pos = ${inputs.gsplat}.center;
        vec3 origScale = ${inputs.gsplat}.scales;
        vec3 small = ${inputs.gsplat}.scales*.2;
        if (idx == cur) {
          if (!inTrans) {
            alpha = 1.0;
            pos = ${inputs.gsplat}.center;
            ${outputs.gsplat}.scales = origScale;
          } else if (phaseScatter) {
            alpha = 1.0 - ease(s)*.5;
            pos = mix(${inputs.gsplat}.center, rpMid, ease(s));
            ${outputs.gsplat}.scales = mix(origScale, small, ease(s));
          } else {
            alpha = 0.0;
            pos = rpMid;
            ${outputs.gsplat}.scales = small;
          }
        } else if (idx == nxt) {
          if (!inTrans) {
            alpha = 0.0;
            pos = rpMid;
            ${outputs.gsplat}.scales = small;
          } else if (phaseScatter) {
            alpha = 0.0;
            pos = rpMid;
            ${outputs.gsplat}.scales = small;
          } else {
            alpha = max(ease(s), 0.5);
            pos = mix(rpMid, ${inputs.gsplat}.center, ease(s));
            ${outputs.gsplat}.scales = mix(small, origScale, ease(s));
          }
        } else {
          alpha = 0.0;
          pos = ${inputs.gsplat}.center;
          ${outputs.gsplat}.scales = origScale;
        }
        pos.y += ${inputs.offsetY};
        ${outputs.gsplat}.center = pos;
        ${outputs.gsplat}.rgba.a = ${inputs.gsplat}.rgba.a * alpha;
      `),
    });
  }

  function getMorphModifier(
    gt,
    idx,
    stay,
    trans,
    numObjects,
    randomRadius,
    offsetY,
  ) {
    const dyn = morphDyno();
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => ({
        gsplat: dyn.apply({
          gsplat,
          gt,
          objectIndex: idx,
          stay,
          trans,
          numObjects,
          randomRadius,
          offsetY,
        }).gsplat,
      }),
    );
  }

  const meshes = [];
  const numObjectsDyn = dyno.dynoInt(splatFiles.length);
  const stayDyn = dyno.dynoFloat(PARAMETERS.staySeconds);
  const transDyn = dyno.dynoFloat(PARAMETERS.transitionSeconds);
  const radiusDyn = dyno.dynoFloat(PARAMETERS.randomRadius);
  const OFFSETS_Y = [
    dyno.dynoFloat(0.0),
    dyno.dynoFloat(0.3),
    dyno.dynoFloat(0.0),
  ];

  for (let i = 0; i < splatFiles.length; i++) {
    const url = await getAssetFileURL(splatFiles[i]);
    const mesh = new SplatMesh({ url });
    await mesh.initialized;
    // Orientación base similar a otros efectos
    mesh.rotateX(Math.PI);
    mesh.position.set(0, 0, 0);
    mesh.scale.set(1.5, 1.5, 1.5);
    if (!disposed) group.add(mesh);
    meshes.push(mesh);
  }

  // Asignar modificadores de morph (hold → scatter → morph)
  meshes.forEach((m, i) => {
    m.worldModifier = getMorphModifier(
      time,
      dyno.dynoInt(i),
      stayDyn,
      transDyn,
      numObjectsDyn,
      radiusDyn,
      OFFSETS_Y[i] ?? dyno.dynoFloat(0.0),
    );
    m.updateGenerator();
  });

  function update(dt, _t) {
    if (!PARAMETERS.pause) {
      time.value += dt * PARAMETERS.speedMultiplier;
      for (const m of meshes) {
        if (PARAMETERS.rotation) {
          m.rotation.y += dt * PARAMETERS.speedMultiplier;
        }
        // Ensure dyno uniform updates are applied even without rotation
        m.updateVersion();
      }
    }
  }

  function setupGUI(folder) {
    folder.add(PARAMETERS, "speedMultiplier", 0.1, 3.0, 0.01);
    folder.add(PARAMETERS, "rotation");
    folder.add(PARAMETERS, "pause");
    folder.add(PARAMETERS, "staySeconds", 0.2, 5.0, 0.05).onChange((v) => {
      stayDyn.value = v;
    });
    folder
      .add(PARAMETERS, "transitionSeconds", 1.0, 3.0, 0.05)
      .onChange((v) => {
        transDyn.value = v;
      });
    folder.add(PARAMETERS, "randomRadius", 1, 5.0, 0.1).onChange((v) => {
      radiusDyn.value = v;
    });
    return folder;
  }

  function dispose() {
    disposed = true;
    scene.remove(group);
  }

  return { group, update, dispose, setupGUI };
}
