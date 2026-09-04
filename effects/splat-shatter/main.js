import { SparkRenderer, SplatMesh, dyno } from "@sparkjsdev/spark";
import { GUI } from "lil-gui";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

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

window.addEventListener("resize", onWindowResize, false);
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

camera.position.set(0, 3, 5.5);
camera.lookAt(0, 1, 0);
camera.fov = 80;
camera.updateProjectionMatrix();

const keys = {};
window.addEventListener("keydown", (event) => {
  keys[event.key.toLowerCase()] = true;
});
window.addEventListener("keyup", (event) => {
  keys[event.key.toLowerCase()] = false;
});

const time = dyno.dynoFloat(0.0);
const effectStarted = dyno.dynoFloat(0.0);
const revealSpeed = dyno.dynoFloat(1.0);
const voronoiScale = dyno.dynoFloat(3.0);
const yBoundsMin = dyno.dynoFloat(0.0);
const yBoundsMax = dyno.dynoFloat(1.0);
const pieceYMin = dyno.dynoFloat(-32.0);
const pieceYMax = dyno.dynoFloat(32.0);
const objectCenter = dyno.dynoVec3(new THREE.Vector3(0, 0, 0));
/** World-space Y of the floor used for landing and bounce (shader). */
const FLOOR_Y = 0.6;
const groundY = dyno.dynoFloat(FLOOR_Y);
const flyStagger = dyno.dynoFloat(0.8);
const flySpeed = dyno.dynoFloat(3.5);
const flyFade = dyno.dynoFloat(0.0);
const flyGap = dyno.dynoFloat(0.58);
const flyBottomCutoff = dyno.dynoFloat(0.45);
// When explosion starts: zero scales for oversized / very anisotropic splats (tune in code).
const explodeCullMaxScale = dyno.dynoFloat(0.14);
const explodeCullStretchRatio = dyno.dynoFloat(22.0);

const gui = new GUI();
const guiParams = {
  revealSpeed: 0.5,
  voronoiScale: 2.0,
};

function syncFractureGuiToUniforms() {
  revealSpeed.value = guiParams.revealSpeed;
  voronoiScale.value = guiParams.voronoiScale;
  if (splatMesh) {
    updatePieceLayerBounds(splatMesh);
    splatMesh.updateVersion();
  }
}

gui
  .add(guiParams, "revealSpeed", 0.25, 1.5, 0.01)
  .name("Reveal speed")
  .onChange(syncFractureGuiToUniforms);
gui
  .add(guiParams, "voronoiScale", 1.0, 4.0, 0.1)
  .name("Voronoi scale")
  .onChange(syncFractureGuiToUniforms);

let effectStartTime = null;
/** Wall-clock animation time for camera orbit (runs before and after click). Effect uses `time` only after click. */
let orbitStartMs = null;
const hintEl = document.getElementById("breakHint");

gui
  .add(
    {
      resetTime() {
        effectStarted.value = 0;
        effectStartTime = null;
        time.value = 0;
        if (hintEl) hintEl.style.display = "";
        if (splatMesh) splatMesh.updateVersion();
      },
    },
    "resetTime",
  )
  .name("Reset");

if (window.matchMedia("(max-width: 768px)").matches) {
  gui.close();
}

function createMatrixDynoshader() {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const shader = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          time: "float",
          effectStarted: "float",
          revealSpeed: "float",
          voronoiScale: "float",
          yBoundsMin: "float",
          yBoundsMax: "float",
          pieceYMin: "float",
          pieceYMax: "float",
          objectCenter: "vec3",
          groundY: "float",
          flyStagger: "float",
          flySpeed: "float",
          flyFade: "float",
          flyGap: "float",
          flyBottomCutoff: "float",
          explodeCullMaxScale: "float",
          explodeCullStretchRatio: "float",
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
            mat2 rot(float a) {
              a = radians(a);
              float s = sin(a);
              float c = cos(a);
              mat2 m = mat2(c, -s, s, c);
              return m;
            }
            vec3 hash3(vec3 p) {
              p = fract(p * vec3(0.1031, 0.1030, 0.0973));
              p += dot(p, p.yxz + 33.33);
              return fract((p.xxy + p.yxx) * p.zyx);
            }

            float voronoi3DFractureLines(vec3 p) {
              vec3 i = floor(p);
              vec3 f = fract(p);
              float f1 = 8.0;
              float f2 = 8.0;
              for (int zz = -1; zz <= 1; zz++) {
                for (int yy = -1; yy <= 1; yy++) {
                  for (int xx = -1; xx <= 1; xx++) {
                    vec3 b = vec3(float(xx), float(yy), float(zz));
                    vec3 r = b + hash3(i + b) - f;
                    float d = length(r);
                    if (d < f1) {
                      f2 = f1;
                      f1 = d;
                    } else if (d < f2) {
                      f2 = d;
                    }
                  }
                }
              }
              float edgeGap = f2 - f1;
              float lineWidth = 0.05;
              return 1.0 - step(lineWidth, edgeGap);
            }

            vec3 voronoiWinningCell(vec3 p) {
              vec3 i = floor(p);
              vec3 f = fract(p);
              float f1 = 8.0;
              vec3 bestB = vec3(0.0);
              for (int zz = -1; zz <= 1; zz++) {
                for (int yy = -1; yy <= 1; yy++) {
                  for (int xx = -1; xx <= 1; xx++) {
                    vec3 b = vec3(float(xx), float(yy), float(zz));
                    vec3 r = b + hash3(i + b) - f;
                    float d = length(r);
                    if (d < f1) {
                      f1 = d;
                      bestB = b;
                    }
                  }
                }
              }
              return i + bestB;
            }

            float irregularEdge(vec2 xz) {
              vec2 q = xz * 2.4;
              float n =
                sin(q.x * 1.9 + q.y * 2.3 + 0.7) * 0.55
                + sin(q.x * -3.1 + q.y * 2.7) * 0.28
                + sin(q.x * 6.2 + q.y * 5.1 + 1.3) * 0.14
                + sin(q.x * 11.0 - q.y * 8.3) * 0.08;
              n += (hash3(vec3(xz * 3.1, 1.7)).x - 0.5) * 0.35;
              return n * 0.22;
            }

            vec4 quatAxisAngle(vec3 axis, float angle) {
              vec3 nAxis = normalize(axis);
              float halfAngle = angle * 0.5;
              float s = sin(halfAngle);
              return vec4(nAxis * s, cos(halfAngle));
            }
          `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          if (${inputs.effectStarted} > 0.5) {
          vec3 p = ${inputs.gsplat}.center;
          vec4 col = ${inputs.gsplat}.rgba;
          vec3 scales = ${inputs.gsplat}.scales;
          vec3 p2 = p;
          vec3 pr = p;
          pr.xz *= rot(38.);
          vec3 pv = pr * ${inputs.voronoiScale};
          vec3 winCell = voronoiWinningCell(pv);
          float lines = voronoi3DFractureLines(pv);
          float ySpan = max(${inputs.yBoundsMax} - ${inputs.yBoundsMin}, 1e-5);
          float hNorm = clamp((p.y - ${inputs.yBoundsMin}) / ySpan, 0.0, 1.0);
          float reveal = clamp(${inputs.time} * ${inputs.revealSpeed}, 0.0, 1.0);
          float edge = irregularEdge(pr.xz);
          float thresh = clamp(reveal + edge * (1.0 - reveal), 0.0, 1.0);
          float fractureZone = 1.0 - step(thresh, hNorm);
          col.rgb *= mix(1.0, 1.0 - lines * 0.8, fractureZone);

          float rs = max(${inputs.revealSpeed}, 0.01);
          float revealEndT = 1.0 / rs;
          float canFly = step(revealEndT + ${inputs.flyGap}, ${inputs.time});
          float tFly = max(0.0, ${inputs.time} - revealEndT - ${inputs.flyGap});
          float pySpan = max(${inputs.pieceYMax} - ${inputs.pieceYMin}, 1.0);
          float layerNorm = clamp((winCell.y - ${inputs.pieceYMin}) / pySpan, 0.0, 1.0);
          float flyableSpan = max(1.0 - ${inputs.flyBottomCutoff}, 1e-5);
          float flyLayerNorm = clamp((layerNorm - ${inputs.flyBottomCutoff}) / flyableSpan, 0.0, 1.0);
          float canLiftOff = step(${inputs.flyBottomCutoff}, layerNorm);
          float layerDelay = pow(1.0 - flyLayerNorm, 1.35) * ${inputs.flyStagger};
          float randomDelay =
            hash3(winCell * 1.31).x * 0.08
            + hash3(winCell.zxy * 2.17).x * 0.04;
          float flyDelay = max(layerDelay + randomDelay, 0.0);
          float localFly = max(0.0, tFly - flyDelay);
          float fullFracture = step(0.999, reveal);
          float explodeStarted = fullFracture * canFly;
          float phaseActive = explodeStarted * canLiftOff * step(flyDelay, tFly);
          float maxAxis = max(scales.x, max(scales.y, scales.z));
          float minAxis = min(scales.x, min(scales.y, scales.z));
          float stretch = maxAxis / max(minAxis, 1e-7);
          float cullOversized = max(
            step(${inputs.explodeCullMaxScale}, maxAxis),
            step(${inputs.explodeCullStretchRatio}, stretch)
          );
          scales *= mix(vec3(1.0), vec3(0.0), explodeStarted * cullOversized);

          vec3 rnd = hash3(winCell + vec3(3.7, 1.1, 9.2));
          float explodeAzimuth = hash3(winCell + vec3(9.1, 2.3, 5.7)).x * 6.2831853;
          vec3 blastDir = vec3(cos(explodeAzimuth), 0.0, sin(explodeAzimuth));
          float heightBoost = mix(0.5, 1.0, flyLayerNorm);
          float burstSpeed = ${inputs.flySpeed} * heightBoost * (0.88 + rnd.x * 0.38);
          vec3 launchVel = blastDir * burstSpeed;
          launchVel.y += mix(0.15, 1.05, flyLayerNorm) + rnd.z * mix(0.1, 0.45, flyLayerNorm);
          float gravity = 12.0;
          vec3 airPos = p2 + launchVel * localFly;
          airPos.y -= 0.5 * gravity * localFly * localFly;

          float yToGround = max(p2.y - ${inputs.groundY}, 0.0);
          float landT = (launchVel.y + sqrt(max(launchVel.y * launchVel.y + 2.0 * gravity * yToGround, 0.0))) / gravity;
          float settleT = max(localFly - landT, 0.0);
          vec3 landPos = p2 + launchVel * landT;
          landPos.y = ${inputs.groundY};
          vec2 slideVel = launchVel.xz * (0.4 + rnd.x * 0.18);
          float slideDrag = 5.8 + rnd.y * 1.8;
          vec2 slideOff = slideVel * (1.0 - exp(-settleT * slideDrag)) / slideDrag;
          float bounceAmp = 0.18 + rnd.z * 0.16;
          float bounce = exp(-settleT * 7.5) * sin(settleT * 18.0) * bounceAmp;

          float landed = step(landT, localFly);
          vec3 settledPos = vec3(landPos.x + slideOff.x, ${inputs.groundY} + max(bounce, 0.0), landPos.z + slideOff.y);
          vec3 motionPos = mix(airPos, settledPos, landed);
          float fade = exp(-settleT * ${inputs.flyFade});
          col.a *= mix(1.0, fade, phaseActive);

          float spinTravel = min(localFly, landT) * 1.35 + (1.0 - exp(-settleT * 6.5)) * 0.22;
          float spinAngle = spinTravel * (5.0 + rnd.z * 7.0);
          vec3 spinAxis = normalize(vec3(rnd.z - 0.5, 0.2 + rnd.x * 0.7, rnd.y - 0.5));
          vec4 spinQ = quatAxisAngle(spinAxis, spinAngle);
          float flatProgress = smoothstep(0.0, max(landT * 0.9, 1e-3), localFly);
          vec4 flatQ = quatAxisAngle(vec3(1.0, 0.0, 0.0), -1.5707963 * flatProgress);

          vec3 pOut = mix(p2, motionPos, phaseActive);
          ${outputs.gsplat}.center = pOut;
          ${outputs.gsplat}.rgba = vec4(col);
          ${outputs.gsplat}.scales = scales;
          }
        `),
      });

      return {
        gsplat: shader.apply({
          gsplat,
          time: time,
          effectStarted: effectStarted,
          revealSpeed: revealSpeed,
          voronoiScale: voronoiScale,
          yBoundsMin: yBoundsMin,
          yBoundsMax: yBoundsMax,
          pieceYMin: pieceYMin,
          pieceYMax: pieceYMax,
          objectCenter: objectCenter,
          groundY: groundY,
          flyStagger: flyStagger,
          flySpeed: flySpeed,
          flyFade: flyFade,
          flyGap: flyGap,
          flyBottomCutoff: flyBottomCutoff,
          explodeCullMaxScale: explodeCullMaxScale,
          explodeCullStretchRatio: explodeCullStretchRatio,
        }).gsplat,
      };
    },
  );
}

let splatMesh = null;
let isSplatLoaded = false;

const ROT_38 = THREE.MathUtils.degToRad(38);

function worldToPvY(worldP, vScale) {
  const pr = worldP.clone();
  const c = Math.cos(ROT_38);
  const s = Math.sin(ROT_38);
  const nx = pr.x * c - pr.z * s;
  const nz = pr.x * s + pr.z * c;
  pr.x = nx;
  pr.z = nz;
  pr.multiplyScalar(vScale);
  return pr.y;
}

function updateWorldYBoundsFromSplat(mesh) {
  mesh.updateWorldMatrix(true, false);
  const lb = mesh.getBoundingBox(true);
  const center = new THREE.Vector3(
    (lb.min.x + lb.max.x) * 0.5,
    (lb.min.y + lb.max.y) * 0.5,
    (lb.min.z + lb.max.z) * 0.5,
  );
  center.applyMatrix4(mesh.matrixWorld);
  const corners = [
    new THREE.Vector3(lb.min.x, lb.min.y, lb.min.z),
    new THREE.Vector3(lb.max.x, lb.min.y, lb.min.z),
    new THREE.Vector3(lb.min.x, lb.max.y, lb.min.z),
    new THREE.Vector3(lb.max.x, lb.max.y, lb.min.z),
    new THREE.Vector3(lb.min.x, lb.min.y, lb.max.z),
    new THREE.Vector3(lb.max.x, lb.min.y, lb.max.z),
    new THREE.Vector3(lb.min.x, lb.max.y, lb.max.z),
    new THREE.Vector3(lb.max.x, lb.max.y, lb.max.z),
  ];
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < corners.length; i++) {
    corners[i].applyMatrix4(mesh.matrixWorld);
    if (corners[i].y < yMin) yMin = corners[i].y;
    if (corners[i].y > yMax) yMax = corners[i].y;
  }
  const pad = (yMax - yMin) * 0.02 + 1e-4;
  yBoundsMin.value = yMin - pad;
  yBoundsMax.value = yMax + pad;
  objectCenter.value.copy(center);
}

function updatePieceLayerBounds(mesh) {
  mesh.updateWorldMatrix(true, false);
  const lb = mesh.getBoundingBox(true);
  const corners = [
    new THREE.Vector3(lb.min.x, lb.min.y, lb.min.z),
    new THREE.Vector3(lb.max.x, lb.min.y, lb.min.z),
    new THREE.Vector3(lb.min.x, lb.max.y, lb.min.z),
    new THREE.Vector3(lb.max.x, lb.max.y, lb.min.z),
    new THREE.Vector3(lb.min.x, lb.min.y, lb.max.z),
    new THREE.Vector3(lb.max.x, lb.min.y, lb.max.z),
    new THREE.Vector3(lb.min.x, lb.max.y, lb.max.z),
    new THREE.Vector3(lb.max.x, lb.max.y, lb.max.z),
  ];
  const vs = voronoiScale.value;
  let pMin = Number.POSITIVE_INFINITY;
  let pMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < corners.length; i++) {
    corners[i].applyMatrix4(mesh.matrixWorld);
    const py = worldToPvY(corners[i], vs);
    const fl = Math.floor(py);
    if (fl < pMin) pMin = fl;
    if (fl > pMax) pMax = fl;
  }
  pieceYMin.value = pMin - 2;
  pieceYMax.value = pMax + 2;
}

async function loadSplat() {
  const splatURL = await getAssetFileURL("greyscale-bedroom.spz");
  splatMesh = new SplatMesh({ url: splatURL });
  splatMesh.rotation.set(Math.PI, Math.PI, 0);
  splatMesh.position.set(0, 2.0, 2.0);
  scene.add(splatMesh);

  await splatMesh.initialized;

  updateWorldYBoundsFromSplat(splatMesh);
  updatePieceLayerBounds(splatMesh);
  splatMesh.worldModifier = createMatrixDynoshader();
  splatMesh.updateGenerator();
  syncFractureGuiToUniforms();
  isSplatLoaded = true;
}

renderer.domElement.addEventListener("pointerdown", () => {
  if (effectStarted.value > 0.5) return;
  effectStarted.value = 1;
  effectStartTime = performance.now();
  if (hintEl) hintEl.style.display = "none";
  if (splatMesh) splatMesh.updateVersion();
});

loadSplat().catch((error) => {
  console.error("Error loading splat:", error);
});

renderer.setAnimationLoop((tMs) => {
  if (!isSplatLoaded) return;

  if (orbitStartMs === null) orbitStartMs = tMs;
  const orbitT = (tMs - orbitStartMs) * 0.001;

  if (effectStarted.value < 0.5) {
    time.value = 0;
  } else if (effectStartTime !== null) {
    time.value = (performance.now() - effectStartTime) * 0.001;
  }

  const camPos = new THREE.Vector3(0, 2, 5);
  camera.position.copy(camPos);
  const lookAtRadius = 5.0;
  const lookAtX = camPos.x + Math.sin(orbitT * 0.2) * lookAtRadius;
  const lookAtY = camPos.y;
  const lookAtZ = camPos.z + Math.cos(orbitT * 0.2) * lookAtRadius;
  camera.lookAt(lookAtX, lookAtY, lookAtZ);

  if (splatMesh) {
    splatMesh.updateVersion();
  }

  renderer.render(scene, camera);
});
