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

// Dyno uniforms
const time = dyno.dynoFloat(0.0);
const glowSpeed = dyno.dynoFloat(3.0);

const gui = new GUI();
const guiParams = {
  glowSpeed: 3.0,
};

gui
  .add(guiParams, "glowSpeed", 1.0, 10.0, 0.1)
  .name("Glow Speed")
  .onChange((value) => {
    glowSpeed.value = value;
    if (splatMesh) splatMesh.updateVersion();
  });

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
          glowSpeed: "float",
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
            float hash(float p) {
              return fract(sin(p * 127.1) * 43758.5453);
            }
            float fractal(vec2 p, float t) {
                float m = 100.;
                float id = floor(min(abs(p.x),abs(p.y))*30.);
                p.y+=2.+t*hash(id)*0.1;
                float y = p.y;
                p*=.1;
                p=fract(p);
                for (int i=0; i<7; i++) {
                    p = abs(p) / clamp((p.x * p.y), 0.5, 3.) - 1.;
                    if (i>1) m = min(m, abs(p.x)+step(fract(p.y*.5+t*.5+float(i)*.2),0.7)+step(fract(y*.2+t*.6+hash(id)*.3),0.5));
                }
                //m = step(m, 0.02);
                m = exp(-m*50.)*1.5;
                return m;
            }
          `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};  
          vec3 p = ${inputs.gsplat}.center;
          if (p.y+p.x > 12.-${inputs.time}*2.) {
            vec4 col = ${inputs.gsplat}.rgba;
            col.rgb = 1.-pow(col.rgb,vec3(2.))*1.5;
            vec3 p2 = p;
            p.xz*=rot(38.);
            float f = fractal(p.xy, ${inputs.time})+fractal(p.zy,${inputs.time});
            p2.y += sin(${inputs.time}*5.+p.x*10.+p.z*10.)*.005;
            col.rgb *= .7;
            col.rgb += f * (.5+length(col.rgb)*.5);
            col.rgb *= vec3(.2,.8,0.);
            ${outputs.gsplat}.rgba = vec4(col);
            ${outputs.gsplat}.scales = vec3(.004)+f*.003;
            ${outputs.gsplat}.center = p2;
          }
        `),
      });

      return {
        gsplat: shader.apply({
          gsplat,
          time: time,
          glowSpeed: glowSpeed,
        }).gsplat,
      };
    },
  );
}

let splatMesh = null;
let isSplatLoaded = false;

async function loadSplat() {
  const splatURL = await getAssetFileURL("greyscale-bedroom.spz");
  splatMesh = new SplatMesh({ url: splatURL });
  splatMesh.rotation.set(Math.PI, Math.PI, 0);
  splatMesh.position.set(0, 2.0, 2.0);
  scene.add(splatMesh);

  await splatMesh.initialized;

  splatMesh.worldModifier = createMatrixDynoshader();
  splatMesh.updateGenerator();
  isSplatLoaded = true;
}

loadSplat().catch((error) => {
  console.error("Error loading splat:", error);
});

let startTime = null;

renderer.setAnimationLoop((tMs) => {
  if (!isSplatLoaded) return;

  if (startTime === null) startTime = tMs;
  const t = (tMs - startTime) * 0.001;
  time.value = t;

  const camPos = new THREE.Vector3(0, 2, 5);
  camera.position.copy(camPos);
  // Rotate lookAt continuously 360 degrees around camera position
  const lookAtRadius = 5.0;
  const lookAtX = camPos.x + Math.sin(t * 0.2) * lookAtRadius;
  const lookAtY = camPos.y;
  const lookAtZ = camPos.z + Math.cos(t * 0.2) * lookAtRadius;
  camera.lookAt(lookAtX, lookAtY, lookAtZ);

  if (splatMesh) {
    splatMesh.updateVersion();
  }

  renderer.render(scene, camera);
});
