import { SparkRenderer } from "@sparkjsdev/spark";
import { GUI } from "lil-gui";
import * as THREE from "three";

// Central renderer/scene/camera shared by effects
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
camera.position.set(0, 3, 8);
camera.lookAt(0, 0, 0);
scene.add(camera);

// Resize handling
function handleResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", handleResize);

// GUI
const gui = new GUI();
const params = { Effect: "Spherical" };
const effectFiles = {
  Spherical: () => import("./effects/spheric.js"),
  Explosion: () => import("./effects/explosion.js"),
  Flow: () => import("./effects/flow.js"),
  Morph: () => import("./effects/morph.js"),
};

let active = null; // { api, group }
let last = 0;
let effectFolder = null; // GUI folder for current effect
let switchCounter = 0; // guards concurrent effect switches

async function switchEffect(name) {
  const myToken = ++switchCounter;
  const loading = document.getElementById("loading");
  loading.textContent = `Loading ${name}...`;
  loading.style.display = "block";

  // Dispose previous
  if (active) {
    try {
      active.api.dispose?.();
    } catch {}
    if (active.group) scene.remove(active.group);
    active = null;
  }

  // Destroy previous GUI folder to avoid accumulation
  if (effectFolder) {
    try {
      effectFolder.destroy();
    } catch {}
    effectFolder = null;
  }

  const loader = effectFiles[name];
  if (!loader) return;
  const preChildren = new Set(scene.children);
  const mod = await loader();
  if (myToken !== switchCounter) {
    // A newer switch started; ignore this one
    return;
  }

  const context = { THREE, scene, camera, renderer, spark };
  const api = await mod.init(context);
  if (myToken !== switchCounter) {
    try {
      api.dispose?.();
    } catch {}
    // Remove any children added during this init
    for (const child of [...scene.children]) {
      if (!preChildren.has(child)) scene.remove(child);
    }
    return;
  }

  if (api.group) scene.add(api.group);
  active = { api, group: api.group };

  // Setup a per-effect GUI folder if exposed
  if (api.setupGUI) {
    effectFolder = gui.addFolder(name);
    api.setupGUI(effectFolder);
  }

  loading.style.display = "none";

  // Give focus back to the canvas so keyboard controls work immediately
  try {
    canvas.focus();
  } catch {}
}

gui.add(params, "Effect", Object.keys(effectFiles)).onChange(switchEffect);

// Animation loop
renderer.setAnimationLoop((timeMs) => {
  const t = timeMs * 0.001;
  const dt = t - (last || t);
  last = t;

  if (active?.api?.update) active.api.update(dt, t);
  renderer.render(scene, camera);
});

// Kickoff
switchEffect(params.Effect);
