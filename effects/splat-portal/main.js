import { SparkControls, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.setClearColor(0x000000, 1);

// Two independent scenes (world A and world B)
const sceneA = new THREE.Scene();
const sceneB = new THREE.Scene();
const sparkA = new SparkRenderer({ renderer });
const sparkB = new SparkRenderer({ renderer });
sceneA.add(sparkA);
sceneB.add(sparkB);

// Main camera (not parented to scenes)
const camera = new THREE.PerspectiveCamera(
  50,
  canvas.clientWidth / canvas.clientHeight,
  0.01,
  2000,
);
camera.position.set(0, 1, 3);
camera.lookAt(0, 1, 0);

// Offscreen render targets for portal views
const rtAtoB = new THREE.WebGLRenderTarget(
  canvas.clientWidth,
  canvas.clientHeight,
  {
    depthBuffer: true,
  },
);
rtAtoB.texture.minFilter = THREE.LinearFilter;
rtAtoB.texture.magFilter = THREE.LinearFilter;
rtAtoB.texture.generateMipmaps = false;
const rtBtoA = new THREE.WebGLRenderTarget(
  canvas.clientWidth,
  canvas.clientHeight,
  {
    depthBuffer: true,
  },
);
rtBtoA.texture.minFilter = THREE.LinearFilter;
rtBtoA.texture.magFilter = THREE.LinearFilter;
rtBtoA.texture.generateMipmaps = false;

function resizeRenderTargets(width, height) {
  const dpr =
    typeof renderer.getPixelRatio === "function"
      ? renderer.getPixelRatio()
      : window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(width * dpr));
  const h = Math.max(1, Math.floor(height * dpr));
  if (rtAtoB) {
    rtAtoB.setSize(w, h);
  }
  if (rtBtoA) {
    rtBtoA.setSize(w, h);
  }
}

function handleResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  resizeRenderTargets(w, h);
}
window.addEventListener("resize", handleResize);

// Camera controls with mouse and WASD enabled
const controls = new SparkControls({ canvas: renderer.domElement });
controls.fpsMovement.enable = true;
controls.pointerControls.enable = true;

// Portal helpers
function makePortalMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: null },
      portalPV: { value: new THREE.Matrix4() },
      portalBridge: { value: new THREE.Matrix4() },
      worldMatrix: { value: new THREE.Matrix4() },
      circleRadius: { value: 0.6 },
      time: { value: 0.0 },
      waveStrength: { value: 0.001 },
      waveSpeed: { value: 10.0 },
      waveFrequency: { value: 50.0 },
      edgeSoftness: { value: 0.2 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec2 vLocalXY;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vLocalXY = position.xy;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D tMap;
      uniform mat4 portalPV;
      uniform mat4 portalBridge;
      uniform float circleRadius;
      uniform float time;
      uniform float waveStrength;
      uniform float waveSpeed;
      uniform float waveFrequency;
      uniform float edgeSoftness;
      varying vec3 vWorldPosition;
      varying vec2 vLocalXY;
      void main() {
        float r = length(vLocalXY);
        if (r > circleRadius) discard;
        
        // Generate radial waves
        float wave = sin(r * waveFrequency - time * waveSpeed);
        float distortion = wave * waveStrength;
        
        // Deform UV radially based on wave
        vec2 direction = normalize(vLocalXY);
        vec2 offset = direction * distortion;
        
        vec4 targetPos = portalBridge * vec4(vWorldPosition, 1.0);
        vec4 clip = portalPV * targetPos;
        vec3 ndc = clip.xyz / max(clip.w, 1e-6);
        vec2 uv = ndc.xy * 0.5 + 0.5;
        
        // Apply wave distortion to UV
        uv += offset;
        
        // Clamp UVs instead of discarding to avoid black edges
        uv = clamp(uv, vec2(0.0), vec2(1.0));
        vec4 color = texture2D(tMap, uv);
        color+=offset.x*50.;
        
        // Edge fadeout by reducing brightness instead of alpha
        float edgeFade = 1.0 - smoothstep(circleRadius * (1.0 - edgeSoftness), circleRadius, r);
        color.rgb *= .1+edgeFade;
        
        gl_FragColor = color;
      }
    `,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
  return material;
}

function makePortal(radius) {
  const geom = new THREE.CircleGeometry(radius, 64);
  const mat = makePortalMaterial();
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 1000;
  return mesh;
}

function buildPVMatrix(cameraObj) {
  const pv = new THREE.Matrix4();
  pv.multiplyMatrices(cameraObj.projectionMatrix, cameraObj.matrixWorldInverse);
  return pv;
}

function buildPortalBridgeMatrix(sourcePortal, targetPortal) {
  // Bridge = targetPortal * Ry(PI) * inverse(sourcePortal)
  const invSrc = new THREE.Matrix4().copy(sourcePortal.matrixWorld).invert();
  const rotY180 = new THREE.Matrix4().makeRotationY(Math.PI);
  const tmp = new THREE.Matrix4().multiplyMatrices(rotY180, invSrc);
  const bridge = new THREE.Matrix4().multiplyMatrices(
    targetPortal.matrixWorld,
    tmp,
  );
  return bridge;
}

function computeLinkedCamera(
  sourcePortal,
  targetPortal,
  fromCamera,
  outCamera,
  clampRadius = 0,
) {
  // outCameraWorld = targetPortal * R_y(PI) * inverse(sourcePortal) * fromCameraWorld
  const invSrc = new THREE.Matrix4().copy(sourcePortal.matrixWorld).invert();
  const rotY180 = new THREE.Matrix4().makeRotationY(Math.PI);
  const tmp = new THREE.Matrix4().multiplyMatrices(
    invSrc,
    fromCamera.matrixWorld,
  );
  const withRot = new THREE.Matrix4().multiplyMatrices(rotY180, tmp);
  const dst = new THREE.Matrix4().multiplyMatrices(
    targetPortal.matrixWorld,
    withRot,
  );

  outCamera.matrixWorld.copy(dst);
  outCamera.matrixWorld.decompose(
    outCamera.position,
    outCamera.quaternion,
    outCamera.scale,
  );

  // Clamp camera position if radius is specified
  if (clampRadius > 0) {
    const targetPos = new THREE.Vector3();
    targetPortal.getWorldPosition(targetPos);

    const toCam = outCamera.position.clone().sub(targetPos);
    const distance = toCam.length();

    if (distance > clampRadius) {
      toCam.normalize().multiplyScalar(clampRadius);
      outCamera.position.copy(targetPos).add(toCam);
      outCamera.updateMatrixWorld(true);
    }
  }

  outCamera.projectionMatrix.copy(fromCamera.projectionMatrix);
  outCamera.updateMatrixWorld(true);
}

function transformPoseThroughPortal(sourcePortal, targetPortal, object3D) {
  const srcWorld = sourcePortal.matrixWorld;
  const dstWorld = targetPortal.matrixWorld;
  const invSrc = new THREE.Matrix4().copy(srcWorld).invert();
  const localMat = new THREE.Matrix4().multiplyMatrices(
    invSrc,
    object3D.matrixWorld,
  );
  const rotY180 = new THREE.Matrix4().makeRotationY(Math.PI);
  const dstMat = new THREE.Matrix4().multiplyMatrices(
    dstWorld,
    new THREE.Matrix4().multiplyMatrices(rotY180, localMat),
  );
  object3D.matrixWorld.copy(dstMat);
  object3D.matrixWorld.decompose(
    object3D.position,
    object3D.quaternion,
    object3D.scale,
  );
}

async function run() {
  // Load valley (world A)
  const valleyURL = await getAssetFileURL("valley.spz");
  const valley = new SplatMesh({ url: valleyURL });
  await valley.initialized;
  valley.rotateX(Math.PI);
  sceneA.add(valley);

  // Load sutro (world B)
  const sutroURL = await getAssetFileURL("sutro.zip");
  const sutro = new SplatMesh({ url: sutroURL });
  await sutro.initialized;
  sutro.rotateX(Math.PI); // Fix orientation
  sutro.position.set(0, 0, 0);
  sutro.scale.set(3.5, 3.5, 3.5);
  sceneB.add(sutro);

  // Portals in each world
  const portalRadius = 0.6;
  const portalA = makePortal(portalRadius);
  portalA.position.set(0, 1, -2);
  portalA.rotation.set(0, 0, 0);
  sceneA.add(portalA);

  const portalB = makePortal(portalRadius);
  portalB.position.set(-1, 1, -5);
  portalB.rotation.set(0, Math.PI, 0);
  sceneB.add(portalB);

  portalA.updateMatrixWorld(true);
  portalB.updateMatrixWorld(true);

  // Offscreen cameras
  const camAtoB = new THREE.PerspectiveCamera();
  const camBtoA = new THREE.PerspectiveCamera();

  // Teleportation tracking
  let activeWorld = "A";
  let lastPortalSide = -1; // -1 = behind portal, 1 = in front
  let teleportCooldown = 0;
  const TELEPORT_COOLDOWN_MS = 500; // 500ms cooldown
  const CROSSING_THRESHOLD = 0.3; // Distance threshold for crossing detection

  function getDistanceFromPortal(portal, pointWorld) {
    const local = pointWorld.clone();
    portal.worldToLocal(local);
    return local.z; // positive = in front, negative = behind
  }

  function withinRadius(portal, pointWorld, radius) {
    const local = pointWorld.clone();
    portal.worldToLocal(local);
    const d = Math.hypot(local.x, local.y);
    return d <= radius;
  }

  renderer.setAnimationLoop((timeMs) => {
    // Decrease cooldown timer
    if (teleportCooldown > 0) {
      teleportCooldown -= 16; // assuming ~60fps
    }

    // Controls and camera updates
    controls.update(camera);
    camera.updateMatrixWorld(true);

    // Update time for wave animation
    const time = timeMs * 0.001; // Convert to seconds
    portalA.material.uniforms.time.value = time;
    portalB.material.uniforms.time.value = time;

    // Prepare portal cameras
    portalA.updateMatrixWorld(true);
    portalB.updateMatrixWorld(true);

    computeLinkedCamera(portalA, portalB, camera, camAtoB, 3);
    computeLinkedCamera(portalB, portalA, camera, camBtoA, 3);

    // Render other worlds into targets (hide portals to avoid recursion/artifacts)
    const prevAVisible = portalA.visible;
    const prevBVisible = portalB.visible;
    portalA.visible = false;
    portalB.visible = false;

    renderer.setRenderTarget(rtAtoB);
    renderer.clear(true, true, true);
    renderer.render(sceneB, camAtoB);
    renderer.setRenderTarget(rtBtoA);
    renderer.clear(true, true, true);
    renderer.render(sceneA, camBtoA);
    renderer.setRenderTarget(null);

    portalA.visible = prevAVisible;
    portalB.visible = prevBVisible;

    // Update portal materials with PV matrices composed with portal bridges
    const pvA = buildPVMatrix(camAtoB);
    const pvB = buildPVMatrix(camBtoA);
    const bridgeAtoB = buildPortalBridgeMatrix(portalA, portalB);
    const bridgeBtoA = buildPortalBridgeMatrix(portalB, portalA);
    const matA = portalA.material;
    const matB = portalB.material;
    matA.uniforms.tMap.value = rtAtoB.texture;
    matA.uniforms.portalPV.value.copy(pvA);
    matA.uniforms.portalBridge.value.copy(bridgeAtoB);
    matB.uniforms.tMap.value = rtBtoA.texture;
    matB.uniforms.portalPV.value.copy(pvB);
    matB.uniforms.portalBridge.value.copy(bridgeBtoA);

    // Teleport logic when crossing the active world's portal
    if (teleportCooldown <= 0) {
      const camPos = camera.position.clone();
      const activePortal = activeWorld === "A" ? portalA : portalB;
      const distance = getDistanceFromPortal(activePortal, camPos);
      const currentSide = Math.sign(distance);
      const absDistance = Math.abs(distance);

      // Check if we're crossing the portal (from either side)
      const isCrossing =
        absDistance < CROSSING_THRESHOLD &&
        withinRadius(activePortal, camPos, portalRadius * 1.2);

      // Detect side change: going from front to back or back to front
      const sideChanged =
        lastPortalSide !== 0 && currentSide !== lastPortalSide;

      if (isCrossing && (sideChanged || absDistance < 0.1)) {
        const src = activeWorld === "A" ? portalA : portalB;
        const dst = activeWorld === "A" ? portalB : portalA;

        transformPoseThroughPortal(src, dst, camera);
        // Calculate forward direction relative to the destination portal
        const forward = new THREE.Vector3(0, 0, -1)
          .applyQuaternion(camera.quaternion)
          .multiplyScalar(0.2);
        camera.position.add(forward);
        camera.updateMatrixWorld(true);
        activeWorld = activeWorld === "A" ? "B" : "A";
        teleportCooldown = TELEPORT_COOLDOWN_MS;
        lastPortalSide = currentSide; // Update side tracking
      } else {
        lastPortalSide = currentSide;
      }
    }

    // Render active world to screen
    if (activeWorld === "A") {
      renderer.render(sceneA, camera);
    } else {
      renderer.render(sceneB, camera);
    }
  });
}

run();
