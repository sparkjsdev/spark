import assert from "node:assert";
import * as THREE from "three";
import {
  isCamera,
  isMatrix2,
  isMatrix3,
  isMatrix4,
  isMesh,
  isMeshStandardMaterial,
  isOrthographicCamera,
  isPerspectiveCamera,
  isQuaternion,
  isTexture,
  isVector2,
  isVector3,
  isVector4,
} from "../src/threeGuards.js";

// Each guard accepts its own type and rejects another one
const cases: [string, (value: unknown) => boolean, object, object][] = [
  ["isCamera", isCamera, new THREE.PerspectiveCamera(), new THREE.Object3D()],
  ["isMatrix2", isMatrix2, new THREE.Matrix2(), new THREE.Matrix3()],
  ["isMatrix3", isMatrix3, new THREE.Matrix3(), new THREE.Matrix4()],
  ["isMatrix4", isMatrix4, new THREE.Matrix4(), new THREE.Matrix3()],
  ["isMesh", isMesh, new THREE.Mesh(), new THREE.Object3D()],
  [
    "isMeshStandardMaterial",
    isMeshStandardMaterial,
    new THREE.MeshStandardMaterial(),
    new THREE.MeshBasicMaterial(),
  ],
  [
    "isOrthographicCamera",
    isOrthographicCamera,
    new THREE.OrthographicCamera(),
    new THREE.PerspectiveCamera(),
  ],
  [
    "isPerspectiveCamera",
    isPerspectiveCamera,
    new THREE.PerspectiveCamera(),
    new THREE.OrthographicCamera(),
  ],
  ["isQuaternion", isQuaternion, new THREE.Quaternion(), new THREE.Vector4()],
  ["isTexture", isTexture, new THREE.Texture(), new THREE.Object3D()],
  ["isVector2", isVector2, new THREE.Vector2(), new THREE.Vector3()],
  ["isVector3", isVector3, new THREE.Vector3(), new THREE.Vector2()],
  ["isVector4", isVector4, new THREE.Vector4(), new THREE.Vector3()],
];

for (const [name, guard, match, other] of cases) {
  assert.ok(guard(match), `${name} match test Failed`);
  assert.ok(!guard(other), `${name} reject test Failed`);
  assert.ok(!guard(undefined), `${name} undefined test Failed`);
}

// Only the marker decides, so an object from a second copy of three passes
assert.ok(
  isPerspectiveCamera({ isCamera: true, isPerspectiveCamera: true }),
  "isPerspectiveCamera copy test Failed",
);
