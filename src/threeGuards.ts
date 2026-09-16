import type * as THREE from "three";

// Three.js marks its objects with a boolean such as `isVector3`. Testing that
// instead of instanceof keeps the checks working when an application and Spark
// resolve "three" to different copies of the module, where instanceof fails.

type Marker<T> = Extract<keyof T, `is${string}`>;

function guard<T>(marker: Marker<T>): (value: unknown) => value is T {
  return (value: unknown): value is T =>
    (value as Record<string, unknown> | null | undefined)?.[marker] === true;
}

export const isCamera = guard<THREE.Camera>("isCamera");
export const isMatrix2 = guard<THREE.Matrix2>("isMatrix2");
export const isMatrix3 = guard<THREE.Matrix3>("isMatrix3");
export const isMatrix4 = guard<THREE.Matrix4>("isMatrix4");
export const isMesh = guard<THREE.Mesh>("isMesh");
export const isMeshStandardMaterial = guard<THREE.MeshStandardMaterial>(
  "isMeshStandardMaterial",
);
export const isOrthographicCamera = guard<THREE.OrthographicCamera>(
  "isOrthographicCamera",
);
export const isPerspectiveCamera = guard<THREE.PerspectiveCamera>(
  "isPerspectiveCamera",
);
export const isQuaternion = guard<THREE.Quaternion>("isQuaternion");
export const isTexture = guard<THREE.Texture>("isTexture");
export const isVector2 = guard<THREE.Vector2>("isVector2");
export const isVector3 = guard<THREE.Vector3>("isVector3");
export const isVector4 = guard<THREE.Vector4>("isVector4");
