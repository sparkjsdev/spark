import {
  PlyWriter,
  SparkControls,
  SparkRenderer,
  SplatMesh,
} from "@sparkjsdev/spark";
import { GUI } from "lil-gui";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

// ============================================================================
// Scene Setup
// ============================================================================

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// Camera controls
const controls = new SparkControls({
  control: camera,
  canvas: renderer.domElement,
});
camera.position.set(0, 2, 5);
camera.lookAt(0, 0, 0);

window.addEventListener("resize", onWindowResize, false);
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================================
// State Management
// ============================================================================

const state = {
  // Point 1
  point1: null,
  ray1Origin: null,
  ray1Direction: null,
  marker1: null,
  rayLine1: null,

  // Point 2
  point2: null,
  ray2Origin: null,
  ray2Direction: null,
  marker2: null,
  rayLine2: null,

  // Measurement
  distanceLine: null,
  currentDistance: 0,

  // Interaction
  mode: "select1", // 'select1' | 'select2' | 'complete'
  dragging: null, // 'point1' | 'point2' | null
};

let splatMesh = null;
const raycaster = new THREE.Raycaster();

// ============================================================================
// Visual Elements
// ============================================================================

const MARKER_RADIUS = 0.02;
const POINT1_COLOR = 0x00ff00; // Green
const POINT2_COLOR = 0x0088ff; // Blue
const DISTANCE_LINE_COLOR = 0xffff00; // Yellow

function createMarker(color) {
  const geometry = new THREE.SphereGeometry(MARKER_RADIUS, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 999;
  return mesh;
}

function createRayLine(origin, direction, color) {
  const farPoint = origin.clone().add(direction.clone().multiplyScalar(100));
  const geometry = new THREE.BufferGeometry().setFromPoints([origin, farPoint]);
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.6,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 998;
  return line;
}

function updateRayLine(line, origin, direction) {
  const positions = line.geometry.attributes.position.array;
  const farPoint = origin.clone().add(direction.clone().multiplyScalar(100));
  positions[0] = origin.x;
  positions[1] = origin.y;
  positions[2] = origin.z;
  positions[3] = farPoint.x;
  positions[4] = farPoint.y;
  positions[5] = farPoint.z;
  line.geometry.attributes.position.needsUpdate = true;
}

function createDistanceLine() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: DISTANCE_LINE_COLOR,
    depthTest: false,
    linewidth: 2,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 997;
  return line;
}

function updateDistanceLine() {
  if (!state.distanceLine || !state.point1 || !state.point2) return;

  const positions = state.distanceLine.geometry.attributes.position.array;
  positions[0] = state.point1.x;
  positions[1] = state.point1.y;
  positions[2] = state.point1.z;
  positions[3] = state.point2.x;
  positions[4] = state.point2.y;
  positions[5] = state.point2.z;
  state.distanceLine.geometry.attributes.position.needsUpdate = true;
}

// ============================================================================
// Mouse / Touch Utilities
// ============================================================================

function getMouseNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

function getHitPoint(ndc) {
  if (!splatMesh) return null;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(splatMesh, false);
  if (hits && hits.length > 0) {
    return hits[0].point.clone();
  }
  return null;
}

// ============================================================================
// Point Selection
// ============================================================================

function selectPoint1(hitPoint) {
  state.point1 = hitPoint.clone();
  state.ray1Origin = camera.position.clone();
  state.ray1Direction = raycaster.ray.direction.clone();

  // Create marker
  if (state.marker1) scene.remove(state.marker1);
  state.marker1 = createMarker(POINT1_COLOR);
  state.marker1.position.copy(hitPoint);
  scene.add(state.marker1);

  // Create ray line
  if (state.rayLine1) scene.remove(state.rayLine1);
  state.rayLine1 = createRayLine(
    state.ray1Origin,
    state.ray1Direction,
    POINT1_COLOR,
  );
  scene.add(state.rayLine1);

  state.mode = "select2";
  updateInstructions("Click on the model to select second measurement point");
}

function selectPoint2(hitPoint) {
  state.point2 = hitPoint.clone();
  state.ray2Origin = camera.position.clone();
  state.ray2Direction = raycaster.ray.direction.clone();

  // Create marker
  if (state.marker2) scene.remove(state.marker2);
  state.marker2 = createMarker(POINT2_COLOR);
  state.marker2.position.copy(hitPoint);
  scene.add(state.marker2);

  // Create ray line
  if (state.rayLine2) scene.remove(state.rayLine2);
  state.rayLine2 = createRayLine(
    state.ray2Origin,
    state.ray2Direction,
    POINT2_COLOR,
  );
  scene.add(state.rayLine2);

  // Create distance line
  if (!state.distanceLine) {
    state.distanceLine = createDistanceLine();
    scene.add(state.distanceLine);
  }
  updateDistanceLine();

  state.mode = "complete";
  calculateDistance();
  updateInstructions("Drag markers to adjust position along ray lines");
}

// ============================================================================
// Drag Along Ray
// ============================================================================

function closestPointOnRay(viewRay, rayOrigin, rayDir) {
  // Find the point on the selection ray closest to the view ray
  const w0 = rayOrigin.clone().sub(viewRay.origin);
  const a = rayDir.dot(rayDir);
  const b = rayDir.dot(viewRay.direction);
  const c = viewRay.direction.dot(viewRay.direction);
  const d = rayDir.dot(w0);
  const e = viewRay.direction.dot(w0);

  const denom = a * c - b * b;
  if (Math.abs(denom) < 0.0001) {
    // Rays are nearly parallel
    return rayOrigin.clone().add(rayDir.clone().multiplyScalar(1));
  }

  const t = (b * e - c * d) / denom;

  // Clamp t to reasonable range
  const clampedT = Math.max(0.1, Math.min(100, t));
  return rayOrigin.clone().add(rayDir.clone().multiplyScalar(clampedT));
}

function checkMarkerHit(ndc) {
  raycaster.setFromCamera(ndc, camera);

  const objects = [];
  if (state.marker1) objects.push(state.marker1);
  if (state.marker2) objects.push(state.marker2);

  if (objects.length === 0) return null;

  const hits = raycaster.intersectObjects(objects);
  if (hits.length > 0) {
    return hits[0].object === state.marker1 ? "point1" : "point2";
  }
  return null;
}

// ============================================================================
// Distance Calculation
// ============================================================================

function calculateDistance() {
  if (!state.point1 || !state.point2) {
    state.currentDistance = 0;
    return;
  }

  state.currentDistance = state.point1.distanceTo(state.point2);
  updateDistanceDisplay(state.currentDistance);
  guiParams.measuredDistance = state.currentDistance.toFixed(4);
}

function updateDistanceDisplay(distance) {
  const display = document.getElementById("distance-display");
  const value = document.getElementById("distance-value");
  display.style.display = "block";
  value.textContent = distance.toFixed(4);
}

// ============================================================================
// Rescaling
// ============================================================================

function rescaleModel(newDistance) {
  if (!splatMesh || state.currentDistance <= 0) {
    console.warn("Cannot rescale: no model or zero distance");
    return;
  }

  const scaleFactor = newDistance / state.currentDistance;

  // Scale all splat centers and scales
  splatMesh.packedSplats.forEachSplat(
    (i, center, scales, quat, opacity, color) => {
      center.multiplyScalar(scaleFactor);
      scales.multiplyScalar(scaleFactor);
      splatMesh.packedSplats.setSplat(i, center, scales, quat, opacity, color);
    },
  );

  splatMesh.packedSplats.needsUpdate = true;

  // Update points and markers
  if (state.point1) {
    state.point1.multiplyScalar(scaleFactor);
    state.marker1.position.copy(state.point1);
    state.ray1Origin.multiplyScalar(scaleFactor);
    updateRayLine(state.rayLine1, state.ray1Origin, state.ray1Direction);
  }

  if (state.point2) {
    state.point2.multiplyScalar(scaleFactor);
    state.marker2.position.copy(state.point2);
    state.ray2Origin.multiplyScalar(scaleFactor);
    updateRayLine(state.rayLine2, state.ray2Origin, state.ray2Direction);
  }

  updateDistanceLine();
  state.currentDistance = newDistance;
  updateDistanceDisplay(newDistance);
  guiParams.measuredDistance = newDistance.toFixed(4);
}

// ============================================================================
// Reset
// ============================================================================

function resetSelection() {
  // Remove visual elements
  if (state.marker1) {
    scene.remove(state.marker1);
    state.marker1 = null;
  }
  if (state.marker2) {
    scene.remove(state.marker2);
    state.marker2 = null;
  }
  if (state.rayLine1) {
    scene.remove(state.rayLine1);
    state.rayLine1 = null;
  }
  if (state.rayLine2) {
    scene.remove(state.rayLine2);
    state.rayLine2 = null;
  }
  if (state.distanceLine) {
    scene.remove(state.distanceLine);
    state.distanceLine = null;
  }

  // Reset state
  state.point1 = null;
  state.point2 = null;
  state.ray1Origin = null;
  state.ray1Direction = null;
  state.ray2Origin = null;
  state.ray2Direction = null;
  state.currentDistance = 0;
  state.mode = "select1";
  state.dragging = null;

  // Update UI
  document.getElementById("distance-display").style.display = "none";
  guiParams.measuredDistance = "0.0000";
  updateInstructions("Click on the model to select first measurement point");
}

// ============================================================================
// PLY Export
// ============================================================================

function exportPly() {
  if (!splatMesh) {
    console.warn("No model to export");
    return;
  }

  const writer = new PlyWriter(splatMesh.packedSplats);
  writer.downloadAs("rescaled_model.ply");
}

// ============================================================================
// UI Updates
// ============================================================================

function updateInstructions(text) {
  document.getElementById("instructions").textContent = text;
}

// ============================================================================
// Event Handlers
// ============================================================================

let pointerDownPos = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
  pointerDownPos = { x: event.clientX, y: event.clientY };

  const ndc = getMouseNDC(event);

  // Check if clicking on a marker to start dragging
  const markerHit = checkMarkerHit(ndc);
  if (markerHit) {
    state.dragging = markerHit;
    controls.enabled = false;
    return;
  }
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;

  const ndc = getMouseNDC(event);
  raycaster.setFromCamera(ndc, camera);

  let newPoint;
  if (state.dragging === "point1") {
    newPoint = closestPointOnRay(
      raycaster.ray,
      state.ray1Origin,
      state.ray1Direction,
    );
    state.point1.copy(newPoint);
    state.marker1.position.copy(newPoint);
  } else {
    newPoint = closestPointOnRay(
      raycaster.ray,
      state.ray2Origin,
      state.ray2Direction,
    );
    state.point2.copy(newPoint);
    state.marker2.position.copy(newPoint);
  }

  updateDistanceLine();
  calculateDistance();
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (state.dragging) {
    state.dragging = null;
    controls.enabled = true;
    return;
  }

  // Check if it was a click (not a drag)
  if (pointerDownPos) {
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      pointerDownPos = null;
      return; // Was a drag, not a click
    }
  }

  if (!splatMesh) return;

  const ndc = getMouseNDC(event);
  const hitPoint = getHitPoint(ndc);

  if (!hitPoint) return;

  if (state.mode === "select1") {
    selectPoint1(hitPoint);
  } else if (state.mode === "select2") {
    selectPoint2(hitPoint);
  }

  pointerDownPos = null;
});

// ============================================================================
// GUI
// ============================================================================

const gui = new GUI();
const guiParams = {
  measuredDistance: "0.0000",
  newDistance: 1.0,
  reset: resetSelection,
  rescale: () => rescaleModel(guiParams.newDistance),
  exportPly: exportPly,
};

gui
  .add(guiParams, "measuredDistance")
  .name("Measured Distance")
  .listen()
  .disable();
gui.add(guiParams, "newDistance", 0.001, 100).name("New Distance");
gui.add(guiParams, "rescale").name("Apply Rescale");
gui.add(guiParams, "reset").name("Reset Points");
gui.add(guiParams, "exportPly").name("Export PLY");

// ============================================================================
// File Loading
// ============================================================================

async function loadSplatFile(urlOrFile) {
  // Remove existing splat mesh
  if (splatMesh) {
    scene.remove(splatMesh);
    splatMesh = null;
  }

  resetSelection();

  try {
    if (typeof urlOrFile === "string") {
      // Load from URL
      splatMesh = new SplatMesh({ url: urlOrFile });
    } else {
      // Load from File object
      const arrayBuffer = await urlOrFile.arrayBuffer();
      splatMesh = new SplatMesh({ fileBytes: new Uint8Array(arrayBuffer) });
    }

    splatMesh.rotation.x = Math.PI; // Common orientation fix
    scene.add(splatMesh);

    await splatMesh.initialized;
    console.log(`Loaded ${splatMesh.packedSplats.numSplats} splats`);
  } catch (error) {
    console.error("Error loading splat:", error);
  }
}

// File input handler
document
  .getElementById("file-input")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      await loadSplatFile(file);
    }
  });

// Load default asset
async function loadDefaultAsset() {
  try {
    const url = await getAssetFileURL("penguin.spz");
    if (url) {
      await loadSplatFile(url);
    }
  } catch (error) {
    console.error("Error loading default asset:", error);
  }
}

loadDefaultAsset();

// ============================================================================
// Render Loop
// ============================================================================

renderer.setAnimationLoop((time) => {
  controls.update(time);
  renderer.render(scene, camera);
});
