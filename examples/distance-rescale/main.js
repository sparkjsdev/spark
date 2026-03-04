import { PlyWriter, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { GUI } from "lil-gui";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";
import { setupInfiniteRotation } from "/examples/js/orbit-controls-utils.js";

// ============================================================================
// Scene Setup
// ============================================================================

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100000,
);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// Camera controls - using OrbitControls for reliability
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
setupInfiniteRotation(controls); // Enable infinite rotation without angle limits
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

  // Coordinate axes
  axesHelper: null,
  axesVisible: false,
};

let splatMesh = null;
const raycaster = new THREE.Raycaster();

// ============================================================================
// Visual Elements
// ============================================================================

let rayLineLength = 100; // Will be updated based on model size
const MARKER_SCREEN_SIZE = 0.03; // Constant screen-space size (percentage of screen height)
const POINT1_COLOR = 0x00ff00; // Green
const POINT2_COLOR = 0x0088ff; // Blue
const DISTANCE_LINE_COLOR = 0xffff00; // Yellow

function createMarker(color) {
  // Create a group to hold both the sphere and its outline
  // Use unit size - will be scaled dynamically based on camera distance
  const group = new THREE.Group();

  // Inner sphere (unit radius = 1)
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1000;
  group.add(mesh);

  // Outer ring/outline for better visibility
  const ringGeometry = new THREE.RingGeometry(1.2, 1.8, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 999;
  group.add(ring);

  // Make ring always face camera (billboard)
  group.userData.ring = ring;

  return group;
}

function createRayLine(origin, direction, color) {
  const farPoint = origin
    .clone()
    .add(direction.clone().multiplyScalar(rayLineLength));
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
  const farPoint = origin
    .clone()
    .add(direction.clone().multiplyScalar(rayLineLength));
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

function closestPointOnRay(viewRay, rayOrigin, rayDir, currentPoint) {
  // Find the point on the selection ray closest to the view ray
  const w0 = rayOrigin.clone().sub(viewRay.origin);
  const a = rayDir.dot(rayDir);
  const b = rayDir.dot(viewRay.direction);
  const c = viewRay.direction.dot(viewRay.direction);
  const d = rayDir.dot(w0);
  const e = viewRay.direction.dot(w0);

  const denom = a * c - b * b;
  if (Math.abs(denom) < 0.0001) {
    // Rays are nearly parallel - keep current point
    return currentPoint.clone();
  }

  const t = (b * e - c * d) / denom;

  // Very minimal clamping - just prevent going behind ray origin or too far
  const minT = 0.01; // Almost at ray origin
  const maxT = rayLineLength * 2; // Allow movement beyond visible ray line
  const clampedT = Math.max(minT, Math.min(maxT, t));
  return rayOrigin.clone().add(rayDir.clone().multiplyScalar(clampedT));
}

function checkMarkerHit(ndc) {
  raycaster.setFromCamera(ndc, camera);

  const objects = [];
  if (state.marker1) objects.push(state.marker1);
  if (state.marker2) objects.push(state.marker2);

  if (objects.length === 0) return null;

  // Use recursive=true to hit children (sphere and ring inside group)
  const hits = raycaster.intersectObjects(objects, true);
  if (hits.length > 0) {
    // Check if the hit object or its parent is marker1 or marker2
    let hitObj = hits[0].object;
    while (hitObj) {
      if (hitObj === state.marker1) return "point1";
      if (hitObj === state.marker2) return "point2";
      hitObj = hitObj.parent;
    }
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
// Coordinate Origin Transform
// ============================================================================

function transformOriginTo(newOrigin) {
  if (!splatMesh) return;

  console.log("Transforming origin to:", newOrigin.toFixed(2));

  // Calculate translation: move newOrigin to (0,0,0)
  const translation = newOrigin.clone().negate();

  // Transform all splat centers
  splatMesh.packedSplats.forEachSplat(
    (i, center, scales, quat, opacity, color) => {
      center.add(translation);
      splatMesh.packedSplats.setSplat(i, center, scales, quat, opacity, color);
    },
  );
  splatMesh.packedSplats.needsUpdate = true;

  // Transform axes helper if exists
  if (state.axesHelper) {
    state.axesHelper.position.add(translation);
  }

  // Reset measurements (user preference)
  resetSelection();

  // Transform camera to maintain view
  camera.position.add(translation);
  controls.target.add(translation);
  controls.update();

  updateInstructions(
    "Coordinate origin set. Click to select first measurement point",
  );
}

// ============================================================================
// Reset
// ============================================================================

function disposeObject(obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        for (const m of child.material) {
          m.dispose();
        }
      } else {
        child.material.dispose();
      }
    }
  });
}

function resetSelection() {
  // Remove and dispose visual elements
  disposeObject(state.marker1);
  state.marker1 = null;
  disposeObject(state.marker2);
  state.marker2 = null;
  disposeObject(state.rayLine1);
  state.rayLine1 = null;
  disposeObject(state.rayLine2);
  state.rayLine2 = null;
  disposeObject(state.distanceLine);
  state.distanceLine = null;

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
      state.point1,
    );
    state.point1.copy(newPoint);
    state.marker1.position.copy(newPoint);
  } else if (state.dragging === "point2") {
    newPoint = closestPointOnRay(
      raycaster.ray,
      state.ray2Origin,
      state.ray2Direction,
      state.point2,
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

// Double-click handler for setting coordinate origin
renderer.domElement.addEventListener("dblclick", (event) => {
  if (event.button !== 0) return; // Only left button

  if (!splatMesh) return;

  const ndc = getMouseNDC(event);
  const hitPoint = getHitPoint(ndc);

  if (!hitPoint) {
    console.log("Double-click missed model");
    return;
  }

  transformOriginTo(hitPoint);
});

// Drag and drop handlers
const onDragover = (e) => {
  e.preventDefault();
  // Add visual feedback
  renderer.domElement.style.outline = "3px solid #00ff00";
};

const onDragLeave = (e) => {
  e.preventDefault();
  renderer.domElement.style.outline = "none";
};

const onDrop = (e) => {
  e.preventDefault();
  renderer.domElement.style.outline = "none";

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    loadSplatFile(files[0]);
  } else {
    console.warn("No files dropped");
  }
};

renderer.domElement.addEventListener("dragover", onDragover);
renderer.domElement.addEventListener("dragleave", onDragLeave);
renderer.domElement.addEventListener("drop", onDrop);

// ============================================================================
// GUI
// ============================================================================

const gui = new GUI();
const guiParams = {
  measuredDistance: "0.0000",
  newDistance: 1.0,
  loadPlyFile: () => {
    // Trigger file input click
    document.getElementById("file-input").click();
  },
  toggleAxes: () => toggleAxes(),
  reset: resetSelection,
  rescale: () => rescaleModel(guiParams.newDistance),
  exportPly: exportPly,
};

// Add load button at the top
gui.add(guiParams, "loadPlyFile").name("Load PLY File");
gui.add(guiParams, "toggleAxes").name("Toggle Axes");

// Measurement controls
gui
  .add(guiParams, "measuredDistance")
  .name("Measured Distance")
  .listen()
  .disable();
gui.add(guiParams, "newDistance").name("New Distance");
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
  updateInstructions("Loading model...");

  try {
    if (typeof urlOrFile === "string") {
      // Load from URL
      console.log("Loading from URL:", urlOrFile);
      splatMesh = new SplatMesh({ url: urlOrFile });
    } else {
      // Load from File object
      console.log("Loading from file:", urlOrFile.name);
      const arrayBuffer = await urlOrFile.arrayBuffer();
      console.log("File size:", arrayBuffer.byteLength, "bytes");
      splatMesh = new SplatMesh({ fileBytes: new Uint8Array(arrayBuffer) });
    }

    // No fixed rotation applied - users can rotate freely with OrbitControls
    scene.add(splatMesh);

    await splatMesh.initialized;
    console.log(`Loaded ${splatMesh.packedSplats.numSplats} splats`);

    // Auto-center camera on the model
    centerCameraOnModel();

    // Create or update coordinate axes
    createOrUpdateAxes();

    updateInstructions("Click on the model to select first measurement point");
  } catch (error) {
    console.error("Error loading splat:", error);
    updateInstructions("Error loading model. Check console for details.");
  }
}

function centerCameraOnModel() {
  if (!splatMesh) {
    console.warn("centerCameraOnModel: no splatMesh");
    return;
  }

  try {
    // Use built-in getBoundingBox method
    const bbox = splatMesh.getBoundingBox(true);
    console.log("Bounding box:", bbox);

    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    console.log(
      "Center:",
      center.x.toFixed(2),
      center.y.toFixed(2),
      center.z.toFixed(2),
    );
    console.log(
      "Size:",
      size.x.toFixed(2),
      size.y.toFixed(2),
      size.z.toFixed(2),
    );
    console.log("Max dimension:", maxDim.toFixed(2));

    if (maxDim === 0 || !Number.isFinite(maxDim)) {
      console.warn("Invalid bounding box size");
      return;
    }

    // Update ray line length based on model scale
    rayLineLength = maxDim * 5; // 5x model size
    console.log("Ray line length:", rayLineLength.toFixed(2));

    // Position camera to see the entire model
    const fov = camera.fov * (Math.PI / 180);
    const cameraDistance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

    camera.position.set(center.x, center.y, center.z + cameraDistance);
    camera.lookAt(center);
    camera.near = cameraDistance * 0.001;
    camera.far = cameraDistance * 10;
    camera.updateProjectionMatrix();

    // Update OrbitControls target
    controls.target.copy(center);
    controls.update();

    console.log(
      "Camera position:",
      camera.position.x.toFixed(2),
      camera.position.y.toFixed(2),
      camera.position.z.toFixed(2),
    );
    console.log("Camera far:", camera.far);
  } catch (error) {
    console.error("Error computing bounding box:", error);
  }
}

function createOrUpdateAxes() {
  if (!splatMesh) return;

  // Remove existing axes
  if (state.axesHelper) {
    scene.remove(state.axesHelper);
    state.axesHelper.dispose();
  }

  // Get model bounding box to size axes appropriately
  const bbox = splatMesh.getBoundingBox(true);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);

  // Create axes helper (1.5x model size)
  state.axesHelper = new THREE.AxesHelper(maxDim * 1.5);
  state.axesHelper.visible = state.axesVisible;
  scene.add(state.axesHelper);
}

function toggleAxes() {
  if (!splatMesh) {
    console.warn("No model loaded");
    return;
  }

  state.axesVisible = !state.axesVisible;

  if (!state.axesHelper) {
    createOrUpdateAxes();
  } else {
    state.axesHelper.visible = state.axesVisible;
  }

  // Update instructions to show state
  const stateText = state.axesVisible ? "shown" : "hidden";
  console.log(`Axes ${stateText}`);
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

function updateMarkerScale(marker) {
  if (!marker) return;

  // Calculate distance from camera to marker
  const distance = camera.position.distanceTo(marker.position);

  // Calculate scale to maintain constant screen size
  // Based on FOV and desired screen percentage
  const fov = camera.fov * (Math.PI / 180);
  const scale = distance * Math.tan(fov / 2) * MARKER_SCREEN_SIZE;

  marker.scale.setScalar(scale);

  // Billboard: make ring face camera
  if (marker.userData.ring) {
    marker.userData.ring.lookAt(camera.position);
  }
}

renderer.setAnimationLoop(() => {
  controls.update();

  // Update marker scales to maintain constant screen size
  updateMarkerScale(state.marker1);
  updateMarkerScale(state.marker2);

  renderer.render(scene, camera);
});
