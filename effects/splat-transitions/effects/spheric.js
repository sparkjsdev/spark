import { SplatMesh, dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

export async function init({ THREE: _THREE, scene, camera, renderer, spark }) {
  const group = new THREE.Group();
  scene.add(group);
  let disposed = false;

  // Params and uniforms
  const PARAMETERS = {
    splatCoverage: 1.0,
    spereRadius: 1.0,
    sphereHeight: 2.0,
    speedMultiplier: 1.0,
    rotation: true,
    pause: false,
  };

  const time = dyno.dynoFloat(0.0);

  // Camera baseline
  const _prevPos = camera.position.clone();
  const prevLook = new THREE.Vector3();
  camera.getWorldDirection(prevLook);

  const SPHERICAL_TARGET = new THREE.Vector3(0, 2, 0);
  camera.position.set(5, 4, 7);
  camera.lookAt(SPHERICAL_TARGET);

  const skyFile = "dali-env.glb";
  const sceneFile = "dali-table.glb";
  const splatFiles = ["penguin.spz", "dessert.spz", "woobles.spz"];

  async function loadDelitGLB(filename, isEnv = false) {
    const url = await getAssetFileURL(filename);
    const gltfLoader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.load(url, resolve, undefined, reject);
    });
    const root = gltf.scene;
    root.traverse((child) => {
      if (child.isMesh && child.material) {
        const original = child.material;
        const basic = new THREE.MeshBasicMaterial();
        if (original.color) basic.color.copy(original.color);
        if (original.map) basic.map = original.map;
        if (isEnv) {
          basic.side = THREE.BackSide;
          if (basic.map) {
            basic.map.mapping = THREE.EquirectangularReflectionMapping;
            basic.map.colorSpace = THREE.LinearSRGBColorSpace;
            basic.map.needsUpdate = true;
          }
        }
        child.material = basic;
      }
    });
    return root;
  }

  function getTransitionState(t, fadeInTime, fadeOutTime, period) {
    const dynoOne = dyno.dynoFloat(1.0);
    const wrapT = dyno.mod(t, period);
    const normT = dyno.mod(t, dynoOne);
    const isFadeIn = dyno.and(
      dyno.greaterThan(wrapT, fadeInTime),
      dyno.lessThan(wrapT, dyno.add(fadeInTime, dynoOne)),
    );
    const isFadeOut = dyno.and(
      dyno.greaterThan(wrapT, fadeOutTime),
      dyno.lessThan(wrapT, dyno.add(fadeOutTime, dynoOne)),
    );
    const inTransition = dyno.or(isFadeIn, isFadeOut);
    return { inTransition, isFadeIn, normT };
  }

  function contractionDyno() {
    return new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        inTransition: "bool",
        fadeIn: "bool",
        t: "float",
        splatScale: "float",
        spereRadius: "float",
        sphereHeight: "float",
      },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [
        dyno.unindent(`
        vec3 applyCenter(vec3 center, float t, float spereRadius, float sphereHeight) {
          float heightModifier = 0.5 + 0.5 * pow(abs(1.0 - 2.0*t), 0.2);
          vec3 targetCenter = vec3(0.0, heightModifier * sphereHeight, 0.0);
          vec3 dir = normalize(center - targetCenter);
          vec3 targetPoint = targetCenter + dir * spereRadius;
          if (t < 0.25 || t > 0.75) {
            return center;
          } else if (t < 0.45) {
            return mix(center, targetPoint, pow((t - 0.25) * 5.0, 4.0));
          } else if (t < 0.55) {
            float churn = 0.1;
            float transitionT = (t - 0.45) * 10.0;
            float angle = transitionT * 2.0 * PI;
            vec3 rotvec = vec3(sin(angle), 0.0, cos(angle));
            float strength = sin(transitionT * PI);
            return targetPoint + cross(dir, rotvec) * churn * strength;
          } else {
            return mix(targetPoint, center, pow((t - 0.55) * 5.0, 4.0));
          }
        }
        vec3 applyScale(vec3 scales, float t, float targetScale) {
          vec3 targetScales = targetScale * vec3(1.0);
          if (t < 0.25) return scales;
          else if (t < 0.45) return mix(scales, targetScales, pow((t - 0.25) * 5.0, 2.0));
          else if (t < 0.55) return targetScales;
          else if (t < 0.75) return mix(targetScales, scales, pow((t - 0.55) * 5.0, 2.0));
          else return scales;
        }
        float applyOpacity(float opacity, float t, bool fadeIn) {
          if (fadeIn) {
            if (t < 0.4) return 0.0;
            else if (t < 0.6) return mix(0.0, opacity, pow((t - 0.4) * 5.0, 2.0));
            else return opacity;
          } else {
            if (t < 0.4) return opacity;
            else if (t < 0.6) return mix(opacity, 0.0, pow((t - 0.4) * 5.0, 2.0));
            else return 0.0;
          }
        }
      `),
      ],
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(`
        ${outputs.gsplat} = ${inputs.gsplat};
        ${outputs.gsplat}.center = applyCenter(${inputs.gsplat}.center, ${inputs.t}, ${inputs.spereRadius}, ${inputs.sphereHeight});
        ${outputs.gsplat}.scales = applyScale(${inputs.gsplat}.scales, ${inputs.t}, ${inputs.splatScale});
        if (${inputs.inTransition}) {
          ${outputs.gsplat}.rgba.a = applyOpacity(${inputs.gsplat}.rgba.a, ${inputs.t}, ${inputs.fadeIn});
        } else {
          ${outputs.gsplat}.rgba.a = 0.0;
        }
      `),
    });
  }

  function getTransitionModifier(
    inTransition,
    fadeIn,
    t,
    splatScale,
    spereRadius,
    sphereHeight,
  ) {
    const contraction = contractionDyno();
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        gsplat = contraction.apply({
          gsplat,
          inTransition,
          fadeIn,
          t,
          splatScale,
          spereRadius,
          sphereHeight,
        }).gsplat;
        return { gsplat };
      },
    );
  }

  async function morphableSplatMesh(
    assetName,
    time,
    fadeInTime,
    fadeOutTime,
    period,
    splatCoverage,
    spereRadius,
    sphereHeight,
  ) {
    const url = await getAssetFileURL(assetName);
    const splatMesh = new SplatMesh({ url });
    await splatMesh.initialized;
    const splatScale = dyno.div(
      dyno.mul(splatCoverage, spereRadius),
      dyno.dynoFloat(splatMesh.packedSplats.numSplats / 1000.0),
    );
    const { inTransition, isFadeIn, normT } = getTransitionState(
      time,
      fadeInTime,
      fadeOutTime,
      period,
    );
    splatMesh.worldModifier = getTransitionModifier(
      inTransition,
      isFadeIn,
      normT,
      splatScale,
      spereRadius,
      sphereHeight,
    );
    splatMesh.updateGenerator();
    splatMesh.quaternion.set(1, 0, 0, 0);
    return splatMesh;
  }

  // Load env and assets
  const sky = await loadDelitGLB(skyFile, true);
  if (!disposed) group.add(sky);
  const table = await loadDelitGLB(sceneFile, false);
  const sceneScale = 3.5;
  table.scale.set(sceneScale, sceneScale, sceneScale);
  table.position.set(-1, 0, -0.8);
  if (!disposed) group.add(table);

  const period = dyno.dynoFloat(splatFiles.length);
  const spereRadiusDyno = dyno.dynoFloat(PARAMETERS.spereRadius);
  const splatCoverageDyno = dyno.dynoFloat(PARAMETERS.splatCoverage);
  const sphereHeightDyno = dyno.dynoFloat(PARAMETERS.sphereHeight);

  const meshes = [];
  for (let i = 0; i < splatFiles.length; i++) {
    const mesh = await morphableSplatMesh(
      splatFiles[i],
      time,
      dyno.dynoFloat(i),
      dyno.dynoFloat((i + 1) % splatFiles.length),
      period,
      splatCoverageDyno,
      spereRadiusDyno,
      sphereHeightDyno,
    );
    if (!disposed) group.add(mesh);
    meshes.push(mesh);
  }

  function update(dt, _t) {
    if (!PARAMETERS.pause) {
      time.value += dt * 0.5 * PARAMETERS.speedMultiplier;
      if (PARAMETERS.rotation) {
        for (const m of meshes) {
          m.rotation.y += dt * PARAMETERS.speedMultiplier;
        }
      }
    }
    // Keep camera centered on spherical target
    camera.lookAt(SPHERICAL_TARGET);
  }

  function setupGUI(folder) {
    folder.add(PARAMETERS, "spereRadius", 0.1, 8.0, 0.01).onChange((v) => {
      spereRadiusDyno.value = v;
    });
    folder.add(PARAMETERS, "sphereHeight", -1.0, 4.0, 0.01).onChange((v) => {
      sphereHeightDyno.value = v;
    });
    folder.add(PARAMETERS, "splatCoverage", 0.1, 2.0, 0.01).onChange((v) => {
      splatCoverageDyno.value = v;
    });
    folder.add(PARAMETERS, "speedMultiplier", 0.25, 4.0, 0.01);
    folder.add(PARAMETERS, "rotation");
    folder.add(PARAMETERS, "pause");
    return folder;
  }

  function dispose() {
    disposed = true;
    // Remove group
    scene.remove(group);
    // No global listeners here; controls are managed by main
  }

  return { group, update, dispose, setupGUI };
}
