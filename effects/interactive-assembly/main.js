import { SplatMesh, dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  100,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", onWindowResize, false);
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Load painted bedroom splat
const splatURL = await getAssetFileURL("painted-bedroom.spz");
const bedroom = new SplatMesh({ url: splatURL });
bedroom.quaternion.set(1, 0, 0, 0);
bedroom.position.set(0, 0, 0);
scene.add(bedroom);

// Camera position for shader (will be updated in animation loop)
const cameraPos = dyno.dynoVec3(new THREE.Vector3(0, 0, 0));
const assemblyRadius = dyno.dynoFloat(7); // Radius within which blocks assemble

// Setup dynoshader for distance-based block separation
bedroom.objectModifier = dyno.dynoBlock(
  { gsplat: dyno.Gsplat },
  { gsplat: dyno.Gsplat },
  ({ gsplat }) => {
    const d = new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat,
        cameraPos: "vec3",
        assemblyRadius: "float",
      },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [
        dyno.unindent(`
          // Scalar hash function
          float hashF(vec3 p) { 
            return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); 
          }
          
          // Vector hash using scalar hash
          vec3 hash3(vec3 p) {
            return vec3(
              hashF(p),
              hashF(p + vec3(1.0, 0.0, 0.0)),
              hashF(p + vec3(0.0, 1.0, 0.0))
            );
          }
          
          // 2D rotation matrix
          mat2 rot(float a) {
            float s=sin(a),c=cos(a);
            return mat2(c,-s,s,c);
          }
        `),
      ],
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          
          vec3 localPos = ${inputs.gsplat}.center;
          vec3 scales = ${inputs.gsplat}.scales;
          
          // Grid cell calculation
          float gridSize = .25;
          vec3 cellIndex = floor(localPos / gridSize);
          vec3 cellHash = hash3(cellIndex);
          
          // Calculate cell center position
          vec3 cellCenter = cellIndex * gridSize + gridSize * 0.5;
          
          // Calculate distance from camera to cell AABB (in object space)
          vec3 cellMin = cellIndex * gridSize;
          vec3 cellMax = cellMin + vec3(gridSize);
          vec3 closestPoint = clamp(${inputs.cameraPos}, cellMin, cellMax);
          float distToCamera = length(closestPoint - ${inputs.cameraPos});
          
          // Calculate separation factor based on distance
          // When far: separation = 1.0 (fully disassembled)
          // When near: separation = 0.0 (fully assembled)
          // Smooth transition between innerRadius and outerRadius
          float innerRadius = ${inputs.assemblyRadius} * 0.4;
          float outerRadius = ${inputs.assemblyRadius};
          float separation = smoothstep(innerRadius, outerRadius, distToCamera);
          
          // Randomized offset per cell
          vec3 cellOffset = (cellHash - 0.5) * gridSize * 10. * separation;

          vec3 finalCellCenter = cellCenter + cellOffset;
          vec3 cellLocalPos = localPos - (cellIndex * gridSize + gridSize * 0.5);
          
          // Cube rotation per cell (more rotation when separated)
          float randomOffset = length(cellHash) * 2.0;
          float rotAngle = separation * randomOffset * 2.0;
          
          cellLocalPos.xy *= rot(rotAngle * 0.7);
          cellLocalPos.xz *= rot(rotAngle * 0.5);
          
          // Displacement from cell center (more displacement when separated)
          vec3 displacement = cellOffset * separation * 10.;
          
          ${outputs.gsplat}.center = finalCellCenter + cellLocalPos + displacement;
          
          // Scale animation (smaller when far, normal when near)
          float scaleFactor = 1.0 - separation;
          ${outputs.gsplat}.scales = scales * scaleFactor;
        `),
    });

    gsplat = d.apply({
      gsplat,
      cameraPos: cameraPos,
      assemblyRadius: assemblyRadius,
    }).gsplat;

    return { gsplat };
  },
);

// Update generator to apply modifier
bedroom.updateGenerator();

// Camera rotation (pitch and yaw)
let pitch = 0;
let yaw = 0;
const mouseSensitivity = 0.002;

// Mouse controls for camera rotation
let isMouseDown = false;
let lastMouseX = 0;
let lastMouseY = 0;

renderer.domElement.addEventListener("mousedown", (event) => {
  isMouseDown = true;
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
  renderer.domElement.requestPointerLock().catch(() => {
    // Pointer lock not available, continue with regular mouse tracking
  });
});

document.addEventListener("mouseup", () => {
  isMouseDown = false;
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
});

// Handle pointer lock change
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== renderer.domElement) {
    isMouseDown = false;
  }
});

// Handle mouse movement with pointer lock
document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement === renderer.domElement) {
    // Pointer is locked, use movementX/Y
    yaw -= event.movementX * mouseSensitivity;
    pitch -= event.movementY * mouseSensitivity;

    // Limit pitch to avoid gimbal lock
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
  } else if (isMouseDown) {
    // Pointer not locked, calculate delta manually
    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;

    yaw -= deltaX * mouseSensitivity;
    pitch -= deltaY * mouseSensitivity;

    // Limit pitch to avoid gimbal lock
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  }
});

// Keyboard controls for WASD movement
const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
};

const moveSpeed = 0.01;

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "w") keys.w = true;
  if (key === "a") keys.a = true;
  if (key === "s") keys.s = true;
  if (key === "d") keys.d = true;
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (key === "w") keys.w = false;
  if (key === "a") keys.a = false;
  if (key === "s") keys.s = false;
  if (key === "d") keys.d = false;
});

renderer.setAnimationLoop(function animate(time) {
  // Update camera rotation based on pitch and yaw
  const euler = new THREE.Euler(pitch, yaw, 0, "YXZ");
  camera.quaternion.setFromEuler(euler);

  // WASD movement relative to camera orientation
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();

  camera.getWorldDirection(direction);
  right.crossVectors(direction, camera.up).normalize();

  if (keys.w) {
    camera.position.addScaledVector(direction, moveSpeed);
  }
  if (keys.s) {
    camera.position.addScaledVector(direction, -moveSpeed);
  }
  if (keys.a) {
    camera.position.addScaledVector(right, -moveSpeed);
  }
  if (keys.d) {
    camera.position.addScaledVector(right, moveSpeed);
  }

  // Update camera position in shader (transform to object space)
  const worldCameraPos = camera.position.clone();
  const objectCameraPos = bedroom.worldToLocal(worldCameraPos);
  cameraPos.value = objectCameraPos;

  // Update splat mesh to apply shader changes
  bedroom.updateVersion();

  renderer.render(scene, camera);
});
