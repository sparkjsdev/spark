import {
  ForgeRenderer,
  PointerControls,
  SplatMesh,
  VRButton,
  generators,
} from "@forge-gfx/forge";
import GUI from "lil-gui";
import * as THREE from "three";

export const SNOW_HEIGHT = 8;

async function main() {
  const canvas = document.getElementById("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas });
  const scene = new THREE.Scene();

  const forge = new ForgeRenderer({ renderer });
  scene.add(forge);

  const camera = new THREE.PerspectiveCamera(
    75,
    canvas.width / canvas.height,
    0.1,
    1000,
  );
  camera.position.set(-1, 12, 100);
  camera.rotateY((3 * Math.PI) / 2);
  scene.add(camera);

  const pointerControls = new PointerControls({ canvas });

  function handleResize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  handleResize();
  window.addEventListener("resize", handleResize);

  const splatURL =
    "https://asundqui-public.s3.us-west-2.amazonaws.com/gsplats/snow_street.spz";
  // "./snow_street_crop8.ply";
  const background = new SplatMesh({ url: splatURL });
  background.quaternion.set(1, 0, 0, 0);
  scene.add(background);

  const halfWidth = 25;
  const halfDepth = 50;
  const snowMinYClamp = -0.7;
  const cam = camera.position;

  const snowVolumeBox = new THREE.Box3(
    new THREE.Vector3(
      cam.x - halfWidth,
      cam.y - SNOW_HEIGHT / 1.5,
      cam.z - halfDepth,
    ),
    new THREE.Vector3(
      cam.x + halfWidth,
      cam.y + SNOW_HEIGHT * 2,
      cam.z + halfDepth,
    ),
  );

  const snow = generators.snowBox({
    ...generators.DEFAULT_SNOW,
    box: snowVolumeBox.clone(),
    minY: snowMinYClamp,
    color1: new THREE.Color(1.0, 1.0, 1.0),
    color2: new THREE.Color(0.91, 0.9, 0.97),
    density: 1000,
    maxScale: 0.01,
  });
  scene.add(snow.snow);

  const gui = new GUI({ title: "Clouds" });
  const controls = {
    fallVelocity: generators.DEFAULT_SNOW.fallVelocity,
    wanderScale: generators.DEFAULT_SNOW.wanderScale,
    wanderVariance: generators.DEFAULT_SNOW.wanderVariance,
    maxScale: 0.01,
    color1: new THREE.Color(1.0, 1.0, 1.0),
    color2: new THREE.Color(0.91, 0.9, 0.97),
    isPaused: false,
    fallDirection: new THREE.Vector3(0, -1, 0),
    windDirection: "No Direction",
    _previousFallVelocity: generators.DEFAULT_SNOW.fallVelocity,
    _previousWanderScale: generators.DEFAULT_SNOW.wanderScale,
    _previousWanderVariance: generators.DEFAULT_SNOW.wanderVariance,
  };

  // snow parameters
  gui.add(controls, "fallVelocity", 0.01, 0.5, 0.01).name("Fall Velocity");
  gui.add(controls, "wanderScale", 0.01, 1, 0.01).name("Wander Scale");
  gui.add(controls, "wanderVariance", 1, 5, 0.1).name("Wander Variance");
  gui.add(controls, "maxScale", 0.001, 0.05, 0.001).name("Snow Size");
  gui
    .add(controls, "isPaused")
    .name("Pause Snowfall")
    .onChange((value) => {
      if (value) {
        controls._previousFallVelocity = controls.fallVelocity;
        controls._previousWanderScale = controls.wanderScale;
        controls._previousWanderVariance = controls.wanderVariance;

        snow.fallVelocity.value = 0;
        snow.wanderScale.value = 0;
        snow.wanderVariance.value = 0;
      } else {
        snow.fallVelocity.value = controls._previousFallVelocity;
        snow.wanderScale.value = controls._previousWanderScale;
        snow.wanderVariance.value = controls._previousWanderVariance;
      }
    });

  // color
  const colorFolder = gui.addFolder("Snow Colors");
  colorFolder
    .addColor(controls, "color1")
    .onChange((value) => {
      snow.color1.value.set(value.r, value.g, value.b);
    })
    .name("Color 1");
  colorFolder
    .addColor(controls, "color2")
    .onChange((value) => {
      snow.color2.value.set(value.r, value.g, value.b);
    })
    .name("Color 2");

  const directionFolder = gui.addFolder("Wind Orientation");
  directionFolder
    .add(controls.fallDirection, "x", -1, 1, 0.1)
    .onChange(() => {
      controls.fallDirection.normalize();
      snow.fallDirection.value.copy(controls.fallDirection);
    })
    .name("East-West");
  directionFolder
    .add(controls.fallDirection, "z", -1, 1, 0.1)
    .onChange(() => {
      controls.fallDirection.normalize();
      snow.fallDirection.value.copy(controls.fallDirection);
    })
    .name("North-South");

  const windFolder = gui.addFolder("Wind Direction Presets");
  windFolder
    .add(controls, "windDirection", [
      "N",
      "NE",
      "E",
      "SE",
      "No Direction",
      "S",
      "SW",
      "W",
      "NW",
    ])
    .onChange((value) => {
      const directions = {
        N: new THREE.Vector3(0, -1, -1),
        NE: new THREE.Vector3(1, -1, -1),
        E: new THREE.Vector3(1, -1, 0),
        SE: new THREE.Vector3(1, -1, 1),
        "No Direction": new THREE.Vector3(0, -1, 0),
        S: new THREE.Vector3(0, -1, 1),
        SW: new THREE.Vector3(-1, -1, 1),
        W: new THREE.Vector3(-1, -1, 0),
        NW: new THREE.Vector3(-1, -1, -1),
      };
      controls.fallDirection.copy(directions[value]).normalize();
      snow.fallDirection.value.copy(controls.fallDirection);
    })
    .name("Wind Direction");

  const vrButton = VRButton.createButton(renderer);
  if (vrButton) document.body.appendChild(vrButton);

  let lastTime;
  renderer.setAnimationLoop((time) => {
    const t = time * 0.001;
    const dt = t - (lastTime ?? t);
    lastTime = t;

    pointerControls.update(dt, camera);

    if (!controls.isPaused) {
      snow.fallVelocity.value = controls.fallVelocity;
      snow.wanderScale.value = controls.wanderScale;
      snow.wanderVariance.value = controls.wanderVariance;
      snow.maxScale.value = controls.maxScale;
    }

    renderer.render(scene, camera);
  });
}

main().catch(console.error);
