import { SplatMesh, dyno } from "@sparkjsdev/spark";
import GUI from "lil-gui";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

// Create loading overlay
const loadingOverlay = document.createElement("div");
loadingOverlay.id = "loading-overlay";
loadingOverlay.innerHTML = "Loading...";
loadingOverlay.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  font-family: system-ui, sans-serif;
  font-size: 24px;
  z-index: 1000;
  transition: opacity 0.3s;
`;
document.body.appendChild(loadingOverlay);

function showLoading() {
  loadingOverlay.style.display = "flex";
  loadingOverlay.style.opacity = "1";
}

function hideLoading() {
  loadingOverlay.style.opacity = "0";
  setTimeout(() => {
    loadingOverlay.style.display = "none";
  }, 300);
}

// Cache for loaded splat meshes
const splatCache = new Map();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

// Initialize camera with elevated perspective
camera.position.set(0, 2, 2.5);
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

// Animation timing variables
const animateT = dyno.dynoFloat(0);
let baseTime = 0;
let splatLoaded = false;

// Camera orbit parameters
let cameraAngle = 0;
const cameraRadius = 3;
const cameraHeight = 2;
const rotationSpeed = 0.2;

// Panoramic rotation for Pieces effect
let panoramicAngle = 0;
const panoramicSpeed = 0.15;
const panoramicRadius = 5;

// Available visual effects configuration
const effectParams = {
  effect: "Magic",
};

let splatMesh = null;

/**
 * Loads and configures splat mesh based on selected effect
 * @param {string} effect - The effect type (Magic, Spread, Unroll, Twister, Rain, or Pieces)
 */
async function loadSplatForEffect(effect) {
  // Remove current splat from scene (but keep in cache)
  if (splatMesh) {
    scene.remove(splatMesh);
    splatMesh = null;
  }

  // Configure splat file and positioning per effect
  let splatFileName;
  let position;
  if (effect === "Magic") {
    splatFileName = "primerib-tamos.spz";
    position = [0, 0, 0];
  } else if (effect === "Spread") {
    splatFileName = "valley.spz";
    position = [0, 1, 1];
  } else if (effect === "Unroll") {
    splatFileName = "burger-from-amboy.spz";
    position = [0, 0, 0];
  } else if (effect === "Twister" || effect === "Rain") {
    splatFileName = "sutro.zip";
    position = [0, -1, 1];
  } else if (effect === "Pieces") {
    splatFileName = "greyscale-bedroom.spz";
    position = [2, 2, -5];
  }

  const splatURL = await getAssetFileURL(splatFileName);

  // Check if splat is already cached
  if (splatCache.has(splatURL)) {
    // Use cached splat
    splatMesh = splatCache.get(splatURL);
  } else {
    // Load new splat and show loading
    showLoading();
    splatMesh = new SplatMesh({ url: splatURL });
    await splatMesh.initialized;
    splatCache.set(splatURL, splatMesh);
    hideLoading();
  }

  // Configure position and transforms
  splatMesh.quaternion.set(1, 0, 0, 0);
  splatMesh.position.set(position[0], position[1], position[2]);
  splatMesh.scale.set(1, 1, 1);

  // Apply special scaling/rotation per effect
  if (effect === "Unroll") {
    splatMesh.scale.set(1.5, 1.5, 1.5);
  } else if (effect === "Twister" || effect === "Rain") {
    splatMesh.scale.set(0.8, 0.8, 0.8);
  } else if (effect === "Pieces") {
    splatMesh.rotation.set(Math.PI, Math.PI, 0);
    panoramicAngle = 0;
  }

  scene.add(splatMesh);

  // Reset animation timing
  splatLoaded = false;
  baseTime = 0;
  animateT.value = 0;

  // Apply visual effects to the loaded splat
  setupSplatModifier();

  splatLoaded = true;
}

// Initialize user interface
const gui = new GUI();
const effectFolder = gui.addFolder("Effects");

// Effect selector dropdown
effectFolder
  .add(effectParams, "effect", [
    "Magic",
    "Spread",
    "Pieces",
    "Unroll",
    "Twister",
    "Rain",
  ])
  .name("Effect Type")
  .onChange(async () => {
    await loadSplatForEffect(effectParams.effect);
  });

// Animation controls
const guiControls = {
  resetTime: () => {
    baseTime = 0;
    animateT.value = 0;
  },
};
effectFolder.add(guiControls, "resetTime").name("Reset Time");
effectFolder.open();

/**
 * Configures visual effects shader for the current splat mesh
 */
function setupSplatModifier() {
  splatMesh.objectModifier = dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, t: "float", effectType: "int" },
        outTypes: { gsplat: dyno.Gsplat },
        // GLSL utility functions for effects
        globals: () => [
          dyno.unindent(`
            // Pseudo-random hash function (returns vec3)
            vec3 hash(vec3 p) {
              p = fract(p * 0.3183099 + 0.1);
              p *= 17.0;
              return fract(vec3(p.x * p.y * p.z, p.x + p.y * p.z, p.x * p.y + p.z));
            }
            
            // Scalar hash function for Pieces effect
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

            // 3D Perlin-style noise function
            vec3 noise(vec3 p) {
              vec3 i = floor(p);
              vec3 f = fract(p);
              f = f * f * (3.0 - 2.0 * f);
              
              vec3 n000 = hash(i + vec3(0,0,0));
              vec3 n100 = hash(i + vec3(1,0,0));
              vec3 n010 = hash(i + vec3(0,1,0));
              vec3 n110 = hash(i + vec3(1,1,0));
              vec3 n001 = hash(i + vec3(0,0,1));
              vec3 n101 = hash(i + vec3(1,0,1));
              vec3 n011 = hash(i + vec3(0,1,1));
              vec3 n111 = hash(i + vec3(1,1,1));
              
              vec3 x0 = mix(n000, n100, f.x);
              vec3 x1 = mix(n010, n110, f.x);
              vec3 x2 = mix(n001, n101, f.x);
              vec3 x3 = mix(n011, n111, f.x);
              
              vec3 y0 = mix(x0, x1, f.y);
              vec3 y1 = mix(x2, x3, f.y);
              
              return mix(y0, y1, f.z);
            }

            // 2D rotation matrix
            mat2 rot(float a) {
              float s=sin(a),c=cos(a);
              return mat2(c,-s,s,c);
            }
            // Twister weather effect
            vec4 twister(vec3 pos, vec3 scale, float t) {
              vec3 h = hash(pos);
              float s = smoothstep(0., 8., t*t*.1 - length(pos.xz)*2.);
              pos.y = mix(-10., pos.y, pow(s, 2.*h.x));
              pos.xz = mix(pos.xz*.5, pos.xz, pow(s, 2.*h.x));
              float rotationTime = t * (1.0 - s) * 0.2;
              pos.xz *= rot(rotationTime + pos.y*15.*(1.-s)*exp(-1.*length(pos.xz)));
              return vec4(pos, s*s*s*s);
            }

            // Rain weather effect
            vec4 rain(vec3 pos, vec3 scale, float t) {
              vec3 h = hash(pos);
              float s = pow(smoothstep(0., 5., t*t*.1 - length(pos.xz)*2. + 1.), .5 + h.x);
              float y = pos.y;
              pos.y = min(-10. + s*15., pos.y);
              pos.xz = mix(pos.xz*.3, pos.xz, s);
              pos.xz *= rot(t*.3);
              return vec4(pos, smoothstep(-10., y, pos.y));
            }
          `),
        ],
        // Main effect shader logic
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          float t = ${inputs.t};
          float s = smoothstep(0.,10.,t-4.5)*10.;
          vec3 scales = ${inputs.gsplat}.scales;
          vec3 localPos = ${inputs.gsplat}.center;
          float l = length(localPos.xz);
          
          if (${inputs.effectType} == 1) {
            // Magic Effect: Complex twister with noise and radial reveal
            float border = abs(s-l-.5);
            localPos *= 1.-.2*exp(-20.*border);
            vec3 finalScales = mix(scales,vec3(0.002),smoothstep(s-.5,s,l+.5));
            ${outputs.gsplat}.center = localPos + .1*noise(localPos.xyz*2.+t*.5)*smoothstep(s-.5,s,l+.5);
            ${outputs.gsplat}.scales = finalScales;
            float at = atan(localPos.x,localPos.z)/3.1416;
            ${outputs.gsplat}.rgba *= step(at,t-3.1416);
            ${outputs.gsplat}.rgba += exp(-20.*border) + exp(-50.*abs(t-at-3.1416))*.5;
            
          } else if (${inputs.effectType} == 2) {
            // Spread Effect: Gentle radial emergence with scaling
            float tt = t*t*.4+.5;
            localPos.xz *= min(1.,.3+max(0.,tt*.05));
            ${outputs.gsplat}.center = localPos;
            ${outputs.gsplat}.scales = max(mix(vec3(0.0),scales,min(tt-7.-l*2.5,1.)),mix(vec3(0.0),scales*.2,min(tt-1.-l*2.,1.)));
            ${outputs.gsplat}.rgba = mix(vec4(.3),${inputs.gsplat}.rgba,clamp(tt-l*2.5-3.,0.,1.));
            
          } else if (${inputs.effectType} == 3) {
            // Unroll Effect: Rotating helix with vertical reveal
            localPos.xz *= rot((localPos.y*50.-20.)*exp(-t));
            ${outputs.gsplat}.center = localPos * (1.-exp(-t)*2.);
            ${outputs.gsplat}.scales = mix(vec3(0.002),scales,smoothstep(.3,.7,t+localPos.y-2.));
            ${outputs.gsplat}.rgba = ${inputs.gsplat}.rgba*step(0.,t*.5+localPos.y-.5);
          } else if (${inputs.effectType} == 4) {
            // Twister Effect: swirling weather reveal
            vec4 effectResult = twister(localPos, scales, t);
            ${outputs.gsplat}.center = effectResult.xyz;
            ${outputs.gsplat}.scales = mix(vec3(.002), scales, pow(effectResult.w, 12.));
            float s = effectResult.w;
            // Also apply a spin (self-rotation) so each splat rotates about its own center.
            float spin = -t * 0.3 * (1.0 - s);
            vec4 spinQ = vec4(0.0, sin(spin*0.5), 0.0, cos(spin*0.5));
            ${outputs.gsplat}.quaternion = quatQuat(spinQ, ${inputs.gsplat}.quaternion);
          } else if (${inputs.effectType} == 5) {
            // Rain Effect: falling streaks
            vec4 effectResult = rain(localPos, scales, t);
            ${outputs.gsplat}.center = effectResult.xyz;
            ${outputs.gsplat}.scales = mix(vec3(.005), scales, pow(effectResult.w, 30.));
            // Also apply a spin (self-rotation) so each splat rotates about its own center.
            float spin = -t*.3;
            vec4 spinQ = vec4(0.0, sin(spin*0.5), 0.0, cos(spin*0.5));
            ${outputs.gsplat}.quaternion = quatQuat(spinQ, ${inputs.gsplat}.quaternion);
          } else if (${inputs.effectType} == 6) {
            // Pieces Effect: 3D grid separation with rotation
            float gridSize = 1.;
            vec3 pivot = vec3(0.0, 1.5, 0.0);
            
            // Grid cell calculation (needed early for time offset)
            vec3 cellIndex = floor(localPos / gridSize);
            vec3 cellHash = hash3(cellIndex);
            
            // Per-cell time offset based on hash (staggered assembly)
            float timeOffset = hashF(cellIndex) * 2.0;
            float cellTime = max(0.0, t - timeOffset);
            
            // Animated separation: fast linear drop then exponential decay
            float minThreshold = 0.2;
            float fastSpeed = 2.0;
            float slowSpeed = 2.5;
            float timeToReachMin = (5.0 - minThreshold) / fastSpeed;
            float separation;
            if (cellTime < timeToReachMin) {
              separation = 5.0 - cellTime * fastSpeed;
            } else {
              float slowTime = cellTime - timeToReachMin;
              separation = minThreshold * exp(-slowTime * slowSpeed);
            }
            separation = max(0.0, separation);
            
            // Randomized offset per cell
            float separationFactor = separation / 5.0;
            vec3 cellOffset = (cellHash - 0.5) * gridSize * 1.2 * separationFactor;
            
            vec3 cellCenter = cellIndex * gridSize + gridSize * 0.5 + cellOffset;
            vec3 cellLocalPos = localPos - (cellIndex * gridSize + gridSize * 0.5);
            
            // Cube rotation per cell
            float randomOffset = length(cellHash) * 2.0;
            float rotAngle = (cellTime + randomOffset) * separation * (1.0 - hashF(cellIndex) * 0.5);
            
            cellLocalPos.xy *= rot(rotAngle * 0.7);
            cellLocalPos.xz *= rot(rotAngle * 0.5);
            
            // Displacement from pivot
            vec3 dirFromPivot = cellCenter - pivot;
            vec3 displacement = dirFromPivot * separation;
            
            ${outputs.gsplat}.center = (cellCenter + displacement) + cellLocalPos;
            
            // Scale animation for entry (using cellTime for staggered reveal)
            float tScale = smoothstep(3.0, 5.0, cellTime);
            ${outputs.gsplat}.scales = mix(vec3(0.003) * smoothstep(5.0, 4.0, separation), scales, clamp(tScale * 8.0 - length(localPos) + 1.0, 0.0, 1.0));
          }
        `),
      });

      // Map effect names to shader integer constants
      const effectType =
        effectParams.effect === "Magic"
          ? 1
          : effectParams.effect === "Spread"
            ? 2
            : effectParams.effect === "Unroll"
              ? 3
              : effectParams.effect === "Twister"
                ? 4
                : effectParams.effect === "Rain"
                  ? 5
                  : 6;

      gsplat = d.apply({
        gsplat,
        t: animateT,
        effectType: dyno.dynoInt(effectType),
      }).gsplat;

      return { gsplat };
    },
  );

  // Apply shader modifications to splat mesh
  splatMesh.updateGenerator();
}

// Initialize with default effect
await loadSplatForEffect(effectParams.effect);

renderer.setAnimationLoop(function animate(time) {
  // Update animation timing
  if (splatLoaded) {
    baseTime += 1 / 60;
    animateT.value = baseTime;
  } else {
    animateT.value = 0;
  }

  // Handle camera based on effect type
  if (effectParams.effect === "Pieces") {
    // Panoramic rotation: camera stays fixed, lookAt rotates around
    panoramicAngle += panoramicSpeed * (1 / 30);
    camera.position.set(1, 2, -2);
    const lookX = 1 + Math.sin(panoramicAngle) * panoramicRadius;
    const lookZ = -2 + Math.cos(panoramicAngle) * panoramicRadius;
    camera.lookAt(lookX, 2, lookZ);

    // Animate FOV from wide angle to normal
    const fovProgress = Math.min(1, baseTime / 5); // 5 seconds to reach normal FOV
    const startFov = 150;
    const endFov = 80;
    camera.fov = startFov + (endFov - startFov) * fovProgress;
    camera.updateProjectionMatrix();
  } else {
    // Reset FOV to normal for other effects
    if (camera.fov !== 60) {
      camera.fov = 60;
      camera.updateProjectionMatrix();
    }

    // Orbit camera for other effects
    cameraAngle += rotationSpeed * (1 / 60);
    if (effectParams.effect === "Twister" || effectParams.effect === "Rain")
      cameraAngle = 0;
    camera.position.x = Math.cos(cameraAngle) * cameraRadius;
    camera.position.z = Math.sin(cameraAngle) * cameraRadius;
    camera.position.y = cameraHeight;

    // Adjust camera target based on current effect
    if (effectParams.effect === "Spread") {
      camera.lookAt(0, 1, 0);
    } else {
      camera.lookAt(0, 0, 0);
    }
  }

  // Update splat rendering if available
  if (splatMesh) {
    splatMesh.updateVersion();
  }

  renderer.render(scene, camera);
});
