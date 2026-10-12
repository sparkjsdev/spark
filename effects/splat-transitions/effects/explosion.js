import { SparkControls, SplatMesh, dyno, textSplats } from "@sparkjsdev/spark";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

export async function init({ THREE: _THREE, scene, camera, renderer, spark }) {
  const group = new THREE.Group();
  scene.add(group);
  let disposed = false;

  // Basic lights
  const ambient = new THREE.AmbientLight(0x404040, 0.6);
  group.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 5);
  dir.castShadow = true;
  group.add(dir);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Camera baseline
  camera.position.set(0, 2.5, 7);
  camera.lookAt(0, 1, 0);

  // WASD + mouse controls
  const controls = new SparkControls({ canvas: renderer.domElement });
  controls.fpsMovement.moveSpeed = 3.0;

  // Uniforms
  const animationTime = dyno.dynoFloat(0.0);
  const uDropProgress = dyno.dynoFloat(0.0);
  const uGravity = dyno.dynoFloat(9.8);
  const uBounceDamping = dyno.dynoFloat(0.4);
  const uFloorLevel = dyno.dynoFloat(0.0);
  const uRandomFactor = dyno.dynoFloat(1.0);
  const uReformSpeed = dyno.dynoFloat(2.0);
  const uCycleDuration = dyno.dynoFloat(1.0);
  const uDropTime = dyno.dynoFloat(0.0);
  const uFriction = dyno.dynoFloat(0.98);
  const uShrinkSpeed = dyno.dynoFloat(5.0 - 3.0);
  const uExplosionStrength = dyno.dynoFloat(4.5);
  const uIsReforming = dyno.dynoFloat(0.0);
  const uReformTime = dyno.dynoFloat(0.0);
  const uReformDuration = dyno.dynoFloat(2.0);

  const uIsBirthing = dyno.dynoFloat(0.0);
  const uBirthTime = dyno.dynoFloat(0.0);
  const uBirthDuration = dyno.dynoFloat(0.5);

  function createDeathDynoshader() {
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const physicsShader = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            time: "float",
            dropTime: "float",
            dropProgress: "float",
            gravity: "float",
            bounceDamping: "float",
            floorLevel: "float",
            randomFactor: "float",
            reformSpeed: "float",
            cycleDuration: "float",
            friction: "float",
            shrinkSpeed: "float",
            explosionStrength: "float",
            isReforming: "float",
            reformTime: "float",
            reformDuration: "float",
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
            mat2 rot(float angle) { float c = cos(angle); float s = sin(angle); return mat2(c, -s, s, c); }
            float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
            vec3 simulatePhysics(vec3 originalPos, float dropTime, float progress, float gravity, float damping, float floorLevel, float randomOffset, float friction, float explosionStrength) {
              if (progress <= 0.0) return originalPos;
              float timeVariation = hash(originalPos + vec3(42.0)) * 0.2 - 0.1;
              float t = max(0.0, dropTime + timeVariation);
              vec3 initialVelocity = vec3(
                (hash(originalPos + vec3(1.0)) - 0.5) * explosionStrength * (0.3 + hash(originalPos + vec3(10.0)) * 0.4),
                abs(hash(originalPos + vec3(3.0))) * explosionStrength * (0.8 + hash(originalPos + vec3(20.0)) * 0.4) + 0.5,
                (hash(originalPos + vec3(2.0)) - 0.5) * explosionStrength * (0.3 + hash(originalPos + vec3(30.0)) * 0.4)
              );
              float frictionDecay = pow(friction, t * 60.0);
              vec3 position = originalPos;
              position.x += initialVelocity.x * (1.0 - frictionDecay) / (1.0 - friction) / 60.0;
              position.z += initialVelocity.z * (1.0 - frictionDecay) / (1.0 - friction) / 60.0;
              position.y += initialVelocity.y * t - 0.5 * gravity * t * t;
              if (position.y <= floorLevel) {
                float bounceTime = t;
                float bounceCount = floor(bounceTime * 3.0);
                float timeSinceBounce = bounceTime - bounceCount / 3.0;
                float bounceHeight = initialVelocity.y * pow(damping, bounceCount) * max(0.0, 1.0 - timeSinceBounce * 3.0);
                if (bounceHeight > 0.1) {
                  position.y = floorLevel + abs(sin(timeSinceBounce * 3.14159 * 3.0)) * bounceHeight;
                } else {
                  position.y = floorLevel;
                  float scatterFactor = hash(originalPos + vec3(50.0)) * 0.2;
                  position.x += (hash(originalPos + vec3(60.0)) - 0.5) * scatterFactor;
                  position.z += (hash(originalPos + vec3(70.0)) - 0.5) * scatterFactor;
                }
              }
              return position;
            }
            vec3 elegantReform(vec3 currentPos, vec3 originalPos, float reformTime, float duration) {
              if (reformTime <= 0.0) return currentPos;
              if (reformTime >= duration) return originalPos;
              float progress = reformTime / duration;
              return mix(currentPos, originalPos, progress);
            }
            vec3 reformScale(vec3 currentScale, vec3 originalScale, float reformTime, float duration) {
              if (reformTime <= 0.0) return currentScale;
              if (reformTime >= duration) return originalScale;
              float progress = reformTime / duration;
              float easeOut = 1.0 - pow(1.0 - progress, 2.0);
              return mix(currentScale, originalScale, easeOut);
            }
          `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            vec3 originalPos = ${inputs.gsplat}.center;
            vec3 originalScale = ${inputs.gsplat}.scales;
            vec3 physicsPos = originalPos;
            vec3 currentScale = originalScale;
            if (${inputs.dropProgress} > 0.0) {
              float randomOffset = hash(originalPos) * ${inputs.randomFactor};
              physicsPos = simulatePhysics(originalPos, ${inputs.dropTime}, ${inputs.dropProgress}, ${inputs.gravity}, ${inputs.bounceDamping}, ${inputs.floorLevel}, randomOffset, ${inputs.friction}, ${inputs.explosionStrength});
              float factor = exp(-${inputs.dropTime} * ${inputs.shrinkSpeed});
              currentScale = mix(originalScale, vec3(0.005), 1.0 - factor);
            }
            vec3 finalPos = physicsPos;
            vec3 finalScale = currentScale;
            if (${inputs.isReforming} > 0.5) {
              finalPos = elegantReform(physicsPos, originalPos, ${inputs.reformTime}, ${inputs.reformDuration});
              finalScale = reformScale(currentScale, originalScale, ${inputs.reformTime}, ${inputs.reformDuration});
            }
            ${outputs.gsplat}.center = finalPos;
            ${outputs.gsplat}.scales = finalScale;
          `),
        });
        gsplat = physicsShader.apply({
          gsplat,
          time: animationTime,
          dropTime: uDropTime,
          dropProgress: uDropProgress,
          gravity: uGravity,
          bounceDamping: uBounceDamping,
          floorLevel: uFloorLevel,
          randomFactor: uRandomFactor,
          reformSpeed: uReformSpeed,
          cycleDuration: uCycleDuration,
          friction: uFriction,
          shrinkSpeed: uShrinkSpeed,
          explosionStrength: uExplosionStrength,
          isReforming: uIsReforming,
          reformTime: uReformTime,
          reformDuration: uReformDuration,
        }).gsplat;
        return { gsplat };
      },
    );
  }

  function createBirthDynoshader() {
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const birthShader = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            time: "float",
            isBirthing: "float",
            birthTime: "float",
            birthDuration: "float",
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
            float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            vec3 originalPos = ${inputs.gsplat}.center;
            vec3 originalScale = ${inputs.gsplat}.scales;
            if (${inputs.isBirthing} > 0.5 && ${inputs.birthTime} < ${inputs.birthDuration}) {
              float progress = ${inputs.birthTime} / ${inputs.birthDuration};
              float birthOffset = hash(originalPos) * 0.1;
              float adjusted = clamp((progress - birthOffset / ${inputs.birthDuration}) / (1.0 - birthOffset / ${inputs.birthDuration}), 0.0, 1.0);
              float ease = pow(adjusted * adjusted * (3.0 - 2.0 * adjusted), 0.6);
              vec3 birthPos = mix(vec3(0.0), originalPos, ease);
              vec3 birthScale = mix(vec3(0.0), originalScale, ease);
              ${outputs.gsplat}.center = birthPos;
              ${outputs.gsplat}.scales = birthScale;
              float alpha = ${inputs.gsplat}.rgba.a * ease;
              ${outputs.gsplat}.rgba.a = alpha;
            }
          `),
        });
        gsplat = birthShader.apply({
          gsplat,
          time: animationTime,
          isBirthing: uIsBirthing,
          birthTime: uBirthTime,
          birthDuration: uBirthDuration,
        }).gsplat;
        return { gsplat };
      },
    );
  }

  const splatMeshes = {};
  let currentSplatName = "penguin";
  let nextSplatName = "cat";

  async function loadSplats() {
    const splatNames = ["penguin.spz", "cat.spz", "woobles.spz"];
    for (const splatName of splatNames) {
      const splatURL = await getAssetFileURL(splatName);
      const mesh = new SplatMesh({ url: splatURL });
      await mesh.initialized;
      const nameKey = splatName.replace(".spz", "");
      mesh.worldModifier = createDeathDynoshader();
      mesh.updateGenerator();
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(Math.PI, 0, 0);
      if (nameKey === "woobles") mesh.scale.set(1.7, 2.0, 1.7);
      else mesh.scale.set(1, 1, 1);
      mesh.visible = nameKey === currentSplatName;
      group.add(mesh);
      splatMeshes[nameKey] = mesh;
    }
  }

  async function loadTable() {
    const tableURL = await getAssetFileURL("table.glb");
    const loader = new GLTFLoader();
    await new Promise((resolve, reject) => {
      loader.load(
        tableURL,
        (gltf) => {
          const tableModel = gltf.scene;
          tableModel.position.set(0, -0.5, 0);
          tableModel.scale.set(5.5, 5.5, 5.5);
          tableModel.rotation.set(0, 0, 0);
          tableModel.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          group.add(tableModel);
          resolve(tableModel);
        },
        undefined,
        reject,
      );
    });
  }

  function _switchToSplat(name) {
    for (const m of Object.values(splatMeshes)) {
      if (m) m.visible = false;
    }
    if (splatMeshes[name]) {
      splatMeshes[name].visible = true;
      currentSplatName = name;
    }
  }

  function getNextSplatName(current) {
    const order = ["penguin", "cat", "woobles"];
    return order[(order.indexOf(current) + 1) % order.length];
  }

  const transitionState = {
    isTransitioning: false,
    transitionTime: 0.0,
    transitionDuration: 3.0,
  };

  function startExplosion() {
    if (transitionState.isTransitioning) return;
    transitionState.isTransitioning = true;
    transitionState.transitionTime = 0.0;
    for (const [name, mesh] of Object.entries(splatMeshes)) {
      if (mesh) mesh.visible = name === currentSplatName;
    }
    if (splatMeshes[currentSplatName]) {
      splatMeshes[currentSplatName].worldModifier = createDeathDynoshader();
      splatMeshes[currentSplatName].updateGenerator();
    }
    uDropProgress.value = 1.0;
    uDropTime.value = 0.0;
    uIsReforming.value = 0.0;
  }

  function startTransition() {
    startExplosion();
    nextSplatName = getNextSplatName(currentSplatName);
    if (splatMeshes[nextSplatName]) {
      for (const [name, mesh] of Object.entries(splatMeshes)) {
        if (!mesh) continue;
        if (name !== currentSplatName && name !== nextSplatName)
          mesh.visible = false;
      }
      splatMeshes[nextSplatName].worldModifier = createBirthDynoshader();
      splatMeshes[nextSplatName].updateGenerator();
      splatMeshes[nextSplatName].visible = true;
      uIsBirthing.value = 1.0;
      uBirthTime.value = 0.0;
    }
  }

  function completeTransition() {
    uIsBirthing.value = 0.0;
    uBirthTime.value = 0.0;
    currentSplatName = nextSplatName;
    transitionState.isTransitioning = false;
    transitionState.transitionTime = 0.0;
  }

  await Promise.all([loadSplats(), loadTable()]);
  if (disposed) return { group, update: () => {}, dispose, setupGUI };

  // Instructional text
  const instructionsText = textSplats({
    text: "WASD + mouse to move\nSPACEBAR: Explosion!",
    font: "Arial",
    fontSize: 24,
    color: new THREE.Color(0xffffff),
    textAlign: "center",
    lineHeight: 1.3,
  });
  instructionsText.scale.setScalar(0.15 / 24);
  instructionsText.position.set(0, 0.2, 2.5);
  group.add(instructionsText);

  let totalTime = 0;
  const transitionParams = { autoTransition: true };

  function onKeyDown(e) {
    if (e.code === "Space") {
      e.preventDefault();
      if (transitionState.isTransitioning) completeTransition();
      startTransition();
      totalTime = 0;
    }
  }
  window.addEventListener("keydown", onKeyDown);

  function update(dt, t) {
    animationTime.value = t;
    // Update camera controls
    controls.update(camera);
    if (transitionParams.autoTransition) {
      if (!transitionState.isTransitioning) totalTime += dt;
      if (!transitionState.isTransitioning && totalTime >= 1.0) {
        startTransition();
        totalTime = 0;
      }
    }
    if (transitionState.isTransitioning) {
      transitionState.transitionTime += dt;
      uBirthTime.value = transitionState.transitionTime;
      if (transitionState.transitionTime >= transitionState.transitionDuration)
        completeTransition();
    }
    uDropTime.value += dt;
    const dying = splatMeshes[currentSplatName];
    const birthing = splatMeshes[nextSplatName];
    if (transitionState.isTransitioning) {
      if (dying) dying.updateVersion();
      if (birthing) birthing.updateVersion();
    } else {
      if (dying) dying.updateVersion();
    }
  }

  function setupGUI(folder) {
    const params = { explosionStrength: uExplosionStrength.value };
    folder
      .add(params, "explosionStrength", 0.0, 10.0, 0.1)
      .name("Explosion Strength")
      .onChange((v) => {
        uExplosionStrength.value = v;
      });
    folder.add(transitionParams, "autoTransition").name("Auto Transition");
    folder
      .add({ explode: () => startTransition() }, "explode")
      .name("Trigger Explosion");
    return folder;
  }

  function dispose() {
    disposed = true;
    window.removeEventListener("keydown", onKeyDown);
    // Disable controls to avoid interfering with other effects
    controls.fpsMovement.enable = false;
    controls.pointerControls.enable = false;
    scene.remove(group);
  }

  return { group, update, dispose, setupGUI };
}
