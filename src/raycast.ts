import init_wasm, { raycast_splats } from "spark-internal-rs";
import * as THREE from "three";
import type { Splat } from "./Splat";
import { LN_SCALE_MAX, LN_SCALE_MIN } from "./defines";
import { PackedSplats } from "./encoding/PackedSplats";

export function simpleRaycastMethod(
  splat: Splat,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
) {
  // At this point the ray intersects the bounding sphere.
  // Simply return the center of the Splat.
  const point = splat.getWorldPosition(new THREE.Vector3());
  intersects.push({
    distance: point.distanceTo(raycaster.ray.origin),
    point,
    object: splat,
  });
}

function preciseRaycastMethod(
  splat: Splat,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
) {
  const splatData = splat.splatData;
  if (!(splatData instanceof PackedSplats)) {
    throw new Error("Precise raycasting requires PackedSplats encoding");
  }

  const packedSplats = splatData as PackedSplats;

  const { near, far, ray } = raycaster;
  const worldToMesh = splat.matrixWorld.clone().invert();
  const worldToMeshRot = new THREE.Matrix3().setFromMatrix4(worldToMesh);
  const origin = ray.origin.clone().applyMatrix4(worldToMesh);
  const direction = ray.direction.clone().applyMatrix3(worldToMeshRot);

  const RAYCAST_ELLIPSOID = true;
  const distances = raycast_splats(
    origin.x,
    origin.y,
    origin.z,
    direction.x,
    direction.y,
    direction.z,
    near,
    far,
    packedSplats.numSplats,
    packedSplats.packedArray,
    RAYCAST_ELLIPSOID,
    packedSplats.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN,
    packedSplats.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX,
  );

  for (const distance of distances) {
    const point = ray.direction
      .clone()
      .multiplyScalar(distance)
      .add(ray.origin);
    intersects.push({
      distance,
      point,
      object: splat,
    });
  }
}

let wasmInitialized = false;
let wasmInitializing: ReturnType<typeof init_wasm> | null = null;

export async function createPreciseRaycastMethod() {
  // Lazy-init wasm
  if (!wasmInitialized) {
    if (!wasmInitializing) {
      wasmInitializing = init_wasm();
    }
    await wasmInitializing;
    wasmInitialized = true;
  }

  return preciseRaycastMethod;
}
