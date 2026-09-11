import { SplatMesh, dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

function compareFrontOrder(a, b) {
  const yDiff = b.y - a.y;
  if (Math.abs(yDiff) > 1e-4) {
    return yDiff;
  }
  const xDiff = a.x - b.x;
  if (Math.abs(xDiff) > 1e-4) {
    return xDiff;
  }
  return a.z - b.z;
}

function compareHorizontalOrder(a, b) {
  const xDiff = a.x - b.x;
  if (Math.abs(xDiff) > 1e-4) {
    return xDiff;
  }
  const yDiff = b.y - a.y;
  if (Math.abs(yDiff) > 1e-4) {
    return yDiff;
  }
  return a.z - b.z;
}

function buildRankMapping(srcNorm, tgtNorm, srcN, tgtN) {
  const srcOrder = new Array(srcN);
  const tgtOrder = new Array(tgtN);
  const partner = new Uint32Array(srcN);
  const sliceCount = Math.min(
    128,
    Math.max(24, Math.floor(Math.sqrt(srcN) * 0.35)),
  );

  for (let i = 0; i < srcN; i++) {
    srcOrder[i] = i;
  }
  for (let j = 0; j < tgtN; j++) {
    tgtOrder[j] = j;
  }

  srcOrder.sort((a, b) => compareFrontOrder(srcNorm[a], srcNorm[b]));
  tgtOrder.sort((a, b) => compareFrontOrder(tgtNorm[a], tgtNorm[b]));

  for (let slice = 0; slice < sliceCount; slice++) {
    const srcStart = Math.floor((slice * srcN) / sliceCount);
    const srcEnd = Math.floor(((slice + 1) * srcN) / sliceCount);
    const tgtStart = Math.floor((slice * tgtN) / sliceCount);
    const tgtEnd = Math.floor(((slice + 1) * tgtN) / sliceCount);
    if (srcEnd <= srcStart || tgtEnd <= tgtStart) {
      continue;
    }

    const srcSlice = srcOrder.slice(srcStart, srcEnd);
    const tgtSlice = tgtOrder.slice(tgtStart, tgtEnd);
    srcSlice.sort((a, b) => compareHorizontalOrder(srcNorm[a], srcNorm[b]));
    tgtSlice.sort((a, b) => compareHorizontalOrder(tgtNorm[a], tgtNorm[b]));

    const srcCount = srcSlice.length;
    const tgtCount = tgtSlice.length;
    for (let rank = 0; rank < srcCount; rank++) {
      const srcIndex = srcSlice[rank];
      const tgtRank = Math.min(
        tgtCount - 1,
        Math.floor((rank * tgtCount) / srcCount),
      );
      partner[srcIndex] = tgtSlice[tgtRank];
    }
  }

  return partner;
}

function setMorphTexel(data, texW, splatIndex, row, v) {
  const col = splatIndex % texW;
  const block = Math.floor(splatIndex / texW);
  const y = block * 4 + row;
  const o = (y * texW + col) * 4;
  data[o + 0] = v.x;
  data[o + 1] = v.y;
  data[o + 2] = v.z;
  data[o + 3] = v.w;
}

function createMorphModifier(morphT, morphSampler, texW) {
  const tw = String(texW);
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const shader = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          t: "float",
          morphTex: "sampler2D",
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          float tm = clamp(${inputs.t}, 0.0, 1.0);
          int si = ${inputs.gsplat}.index;
          int col = si % ${tw};
          int block = si / ${tw};
          int y0 = block * 4;
          vec4 t0 = texelFetch(${inputs.morphTex}, ivec2(col, y0 + 0), 0);
          vec4 t1 = texelFetch(${inputs.morphTex}, ivec2(col, y0 + 1), 0);
          vec4 t2 = texelFetch(${inputs.morphTex}, ivec2(col, y0 + 2), 0);
          vec4 t3 = texelFetch(${inputs.morphTex}, ivec2(col, y0 + 3), 0);
          vec3 tc = t0.xyz;
          vec4 tq = t1;
          vec3 ts = t2.xyz;
          vec4 trgba = vec4(t3.xyz, t3.w);
          vec3 c0 = ${inputs.gsplat}.center;
          vec4 q0 = ${inputs.gsplat}.quaternion;
          vec3 s0 = ${inputs.gsplat}.scales;
          vec4 rgba0 = ${inputs.gsplat}.rgba;
          if (dot(q0, tq) < 0.0) {
            tq = -tq;
          }
          ${outputs.gsplat}.center = mix(c0, tc, tm);
          ${outputs.gsplat}.quaternion = normalize(mix(q0, tq, tm));
          ${outputs.gsplat}.scales = mix(s0, ts, tm);
          ${outputs.gsplat}.rgba = mix(rgba0, trgba, tm);
        `),
      });
      return {
        gsplat: shader.apply({
          gsplat,
          t: morphT,
          morphTex: morphSampler,
        }).gsplat,
      };
    },
  );
}

export async function init({ scene, camera }) {
  const group = new THREE.Group();
  scene.add(group);
  let disposed = false;

  camera.position.set(0, 0, 5.2);
  camera.lookAt(0, 0, 0);

  const vWorld = new THREE.Vector3();
  const invPenguin = new THREE.Matrix4();
  const halfSpacing = 0;
  const splatRot = new THREE.Euler(Math.PI, 0, 0);

  const [urlPenguin, urlCat] = await Promise.all([
    getAssetFileURL("penguin.spz"),
    getAssetFileURL("cat.spz"),
  ]);

  const penguinMesh = new SplatMesh({ url: urlPenguin });
  penguinMesh.position.set(-halfSpacing, -1.5, 0);
  penguinMesh.rotation.copy(splatRot);

  const catMesh = new SplatMesh({ url: urlCat });
  catMesh.position.set(halfSpacing, -1.5, 0);
  catMesh.rotation.copy(splatRot);

  await Promise.all([penguinMesh.initialized, catMesh.initialized]);

  penguinMesh.updateMatrixWorld(true);
  catMesh.updateMatrixWorld(true);
  invPenguin.copy(penguinMesh.matrixWorld).invert();

  const nP = penguinMesh.numSplats;
  const nC = catMesh.numSplats;

  const srcWorld = new Array(nP);
  const tgtWorld = new Array(nC);
  const srcBox = new THREE.Box3();
  const tgtBox = new THREE.Box3();

  for (let i = 0; i < nP; i++) {
    srcWorld[i] = new THREE.Vector3();
  }
  for (let j = 0; j < nC; j++) {
    tgtWorld[j] = new THREE.Vector3();
  }

  penguinMesh.forEachSplat((i, center) => {
    vWorld.copy(center).applyMatrix4(penguinMesh.matrixWorld);
    srcWorld[i].copy(vWorld);
    srcBox.expandByPoint(vWorld);
  });

  catMesh.forEachSplat((j, center) => {
    vWorld.copy(center).applyMatrix4(catMesh.matrixWorld);
    tgtWorld[j].copy(vWorld);
    tgtBox.expandByPoint(vWorld);
  });

  const srcSize = new THREE.Vector3();
  const tgtSize = new THREE.Vector3();
  const srcMin = srcBox.min.clone();
  const tgtMin = tgtBox.min.clone();
  srcBox.getSize(srcSize);
  tgtBox.getSize(tgtSize);
  const srcSx = srcSize.x > 1e-6 ? srcSize.x : 1;
  const srcSy = srcSize.y > 1e-6 ? srcSize.y : 1;
  const srcSz = srcSize.z > 1e-6 ? srcSize.z : 1;
  const tgtSx = tgtSize.x > 1e-6 ? tgtSize.x : 1;
  const tgtSy = tgtSize.y > 1e-6 ? tgtSize.y : 1;
  const tgtSz = tgtSize.z > 1e-6 ? tgtSize.z : 1;

  const srcNorm = new Array(nP);
  const tgtNorm = new Array(nC);
  for (let i = 0; i < nP; i++) {
    srcNorm[i] = new THREE.Vector3(
      (srcWorld[i].x - srcMin.x) / srcSx,
      (srcWorld[i].y - srcMin.y) / srcSy,
      (srcWorld[i].z - srcMin.z) / srcSz,
    );
  }
  for (let j = 0; j < nC; j++) {
    tgtNorm[j] = new THREE.Vector3(
      (tgtWorld[j].x - tgtMin.x) / tgtSx,
      (tgtWorld[j].y - tgtMin.y) / tgtSy,
      (tgtWorld[j].z - tgtMin.z) / tgtSz,
    );
  }

  const partner = buildRankMapping(srcNorm, tgtNorm, nP, nC);
  const texW = Math.min(4096, Math.max(1, nP));
  const texH = 4 * Math.ceil(nP / texW);
  const morphData = new Float32Array(texW * texH * 4);

  const catCenters = new Float32Array(nC * 3);
  const catQuats = new Float32Array(nC * 4);
  const catScales = new Float32Array(nC * 3);
  const catRgb = new Float32Array(nC * 3);
  const catOpac = new Float32Array(nC);

  catMesh.forEachSplat((j, c, scales, q, opacity, color) => {
    catCenters[j * 3 + 0] = c.x;
    catCenters[j * 3 + 1] = c.y;
    catCenters[j * 3 + 2] = c.z;
    catQuats[j * 4 + 0] = q.x;
    catQuats[j * 4 + 1] = q.y;
    catQuats[j * 4 + 2] = q.z;
    catQuats[j * 4 + 3] = q.w;
    catScales[j * 3 + 0] = scales.x;
    catScales[j * 3 + 1] = scales.y;
    catScales[j * 3 + 2] = scales.z;
    catRgb[j * 3 + 0] = color.r;
    catRgb[j * 3 + 1] = color.g;
    catRgb[j * 3 + 2] = color.b;
    catOpac[j] = opacity;
  });

  const tc = new THREE.Vector3();
  const tq = new THREE.Vector4();
  const ts = new THREE.Vector3();
  const row0 = new THREE.Vector4();
  const row1 = new THREE.Vector4();
  const row2 = new THREE.Vector4();
  const row3 = new THREE.Vector4();

  for (let i = 0; i < nP; i++) {
    const j = partner[i];
    tc.set(catCenters[j * 3 + 0], catCenters[j * 3 + 1], catCenters[j * 3 + 2]);
    vWorld.copy(tc).applyMatrix4(catMesh.matrixWorld);
    vWorld.applyMatrix4(invPenguin);

    tq.set(
      catQuats[j * 4 + 0],
      catQuats[j * 4 + 1],
      catQuats[j * 4 + 2],
      catQuats[j * 4 + 3],
    );

    ts.set(catScales[j * 3 + 0], catScales[j * 3 + 1], catScales[j * 3 + 2]);

    row0.set(vWorld.x, vWorld.y, vWorld.z, 0);
    setMorphTexel(morphData, texW, i, 0, row0);
    row1.set(tq.x, tq.y, tq.z, tq.w);
    setMorphTexel(morphData, texW, i, 1, row1);
    row2.set(ts.x, ts.y, ts.z, catOpac[j]);
    setMorphTexel(morphData, texW, i, 2, row2);
    row3.set(
      catRgb[j * 3 + 0],
      catRgb[j * 3 + 1],
      catRgb[j * 3 + 2],
      catOpac[j],
    );
    setMorphTexel(morphData, texW, i, 3, row3);
  }

  catMesh.dispose();

  const morphTexture = new THREE.DataTexture(
    morphData,
    texW,
    texH,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  morphTexture.magFilter = THREE.NearestFilter;
  morphTexture.minFilter = THREE.NearestFilter;
  morphTexture.needsUpdate = true;

  const morphT = dyno.dynoFloat(0);
  const morphSampler = dyno.dynoSampler2D(morphTexture, "morphTarget");

  penguinMesh.objectModifier = createMorphModifier(morphT, morphSampler, texW);
  penguinMesh.updateGenerator();
  group.add(penguinMesh);

  const holdDuration = 1.0;
  const morphDuration = 1.0;
  const cycleDuration =
    holdDuration + morphDuration + holdDuration + morphDuration;
  let elapsed = 0;

  function update(dt) {
    elapsed += dt;
    const t = elapsed % cycleDuration;
    if (t < holdDuration) {
      morphT.value = 0;
    } else if (t < holdDuration + morphDuration) {
      morphT.value = (t - holdDuration) / morphDuration;
    } else if (t < holdDuration + morphDuration + holdDuration) {
      morphT.value = 1;
    } else {
      morphT.value =
        1 - (t - holdDuration - morphDuration - holdDuration) / morphDuration;
    }
    penguinMesh.updateVersion();
  }

  function dispose() {
    disposed = true;
    morphTexture.dispose();
    penguinMesh.dispose();
    scene.remove(group);
  }

  return { group, update, dispose };
}
