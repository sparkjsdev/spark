import {
  SparkControls,
  SparkRenderer,
  SplatMesh,
  dyno,
} from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const spark = new SparkRenderer({ renderer });
scene.add(spark);

const camera = new THREE.PerspectiveCamera(
  50,
  canvas.clientWidth / canvas.clientHeight,
  0.01,
  2000,
);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);
scene.add(camera);

function handleResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", handleResize);

// Camera controls with mouse and WASD enabled
const controls = new SparkControls({ canvas: renderer.domElement });
controls.fpsMovement.enable = true; // Enable WASD movement
controls.pointerControls.enable = true; // Enable mouse controls

// Dyno shader with time and shockwave function
function passthroughDyno(timeUniform, hitpointUniform) {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const shader = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          time: "float",
          hitpoint: "vec3",
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
           vec3 shockwave(vec3 center, float t, vec3 hitpoint) {
             vec3 direction = center - hitpoint;
             float distance = length(direction);
             center += normalize(direction)*sin(t*4.-distance*5.)*exp(-t)*smoothstep(t*2.,0.,distance)*.5;
             return center;
           }
           vec4 shockwaveColor(vec4 rgba, vec3 center, float t, vec3 hitpoint) {
             vec3 direction = center - hitpoint;
             float distance = length(direction);
             float wave = sin(t*4.-distance*5.)*exp(-t*.7)*smoothstep(t*2.,0.,distance);
             float brightness = pow(abs(wave),3.) * 10.; // Increase brightness on wave crests
             rgba.rgb += brightness;
             return rgba;
           }
        `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          // Apply shockwave function to position
          ${outputs.gsplat}.center = shockwave(${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint});
          // Apply shockwave function to color
          ${outputs.gsplat}.rgba = shockwaveColor(${inputs.gsplat}.rgba, ${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint});
        `),
      });
      return {
        gsplat: shader.apply({
          gsplat,
          time: timeUniform,
          hitpoint: hitpointUniform,
        }).gsplat,
      };
    },
  );
}

async function run() {
  // Time and hitpoint uniforms for dyno shader
  const timeUniform = dyno.dynoFloat(0.0);
  const hitpointUniform = dyno.dynoVec3(new THREE.Vector3(0, 0, 1000)); // Initialize far away to avoid initial effect

  // Load valley.spz
  const splatURL = await getAssetFileURL("valley.spz");
  const valley = new SplatMesh({ url: splatURL });
  await valley.initialized;

  // Fix orientation - rotate 180 degrees around X axis
  valley.rotateX(Math.PI);

  // Apply dyno shader with time and hitpoint uniforms
  valley.objectModifier = passthroughDyno(timeUniform, hitpointUniform);
  valley.updateGenerator();

  scene.add(valley);

  // Raycaster for click detection
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 1.0 }; // Increased threshold for better hit detection

  // Simple time counter that resets on click
  let timeCounter = 0;

  // Click event listener to set hitpoint and reset time
  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(valley, false);
    const hit = hits?.length ? hits[0] : null;

    if (!hit) {
      return;
    }

    const localPoint = valley.worldToLocal(hit.point.clone());
    // Don't invert Y or Z - keep original coordinates

    hitpointUniform.value.copy(localPoint);
    timeCounter = 0; // Reset time counter
  });

  renderer.setAnimationLoop((timeMs) => {
    // Increment time counter each frame
    timeCounter += 0.016; // ~60fps increment
    timeUniform.value = timeCounter;

    // Update dyno uniforms to propagate to the mesh each frame
    valley.updateVersion();

    controls.update(camera);
    renderer.render(scene, camera);
  });
}

run();
