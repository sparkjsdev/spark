import * as THREE from "three";
import { type IterableSplatData, Splat, type SplatData } from "./Splat";
import { DefaultSplatEncoding, type SplatEncoder } from "./encoding/encoder";

const tempCenter = new THREE.Vector3();
const tempScales = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();

/**
 * Combines multiple Splat objects into a single Splat object. The individual
 * world transforms are applied to the individual splats. Each splat must
 * have the same number of spherical harmonics and the underlying SplatData
 * must be iterable.
 * @param splats The splats to combine
 * @param options Additional options
 * @returns The combined splat
 */
export function mergeSplats<T>(
  splats: Array<Splat>,
  options?: {
    splatEncoder?: SplatEncoder<T> | (() => SplatEncoder<T>);
  },
): Splat | null {
  const numSh = splats[0].splatData.numSh;
  const splatEncoderFactory =
    options?.splatEncoder ?? DefaultSplatEncoding.createSplatEncoder;
  const splatEncoder =
    typeof splatEncoderFactory === "function"
      ? splatEncoderFactory()
      : splatEncoderFactory;

  // Sum the total amount of combined splats.
  const numSplats = splats.reduce(
    (acc, splat) => acc + splat.splatData.numSplats,
    0,
  );
  splatEncoder.allocate(numSplats, numSh);

  let newSplatIndex = 0;
  for (let i = 0; i < splats.length; ++i) {
    const splatData = splats[i].splatData;
    if (splatData.numSh !== numSh) {
      console.error(
        `SplatUtils: .mergeSplats() failed with splat at index ${i}. All splats must have the same amount of spherical harmonics.`,
      );
      return null;
    }

    if (!isIterableSplatData(splatData)) {
      console.error(
        `SplatUtils: .mergeSplats() failed with splat at index ${i}. All splats must have iterable splat data.`,
      );
      return null;
    }

    // Ensure matrix world is up to date
    splats[i].updateMatrixWorld();
    const splatScale = splats[i].getWorldScale(new THREE.Vector3());
    const splatRotation = splats[i].getWorldQuaternion(new THREE.Quaternion());

    splatData.iterateSplats(
      (
        _,
        x,
        y,
        z,
        scaleX,
        scaleY,
        scaleZ,
        quatX,
        quatY,
        quatZ,
        quatW,
        opacity,
        r,
        g,
        b,
        sh,
      ) => {
        // Apply splat transform
        tempCenter.set(x, y, z).applyMatrix4(splats[i].matrixWorld);
        tempScales.set(scaleX, scaleY, scaleZ).multiplyScalar(splatScale.x); // Assume uniform scaling
        tempQuat.set(quatX, quatY, quatZ, quatW).premultiply(splatRotation);

        splatEncoder.setSplat(
          newSplatIndex++,
          tempCenter.x,
          tempCenter.y,
          tempCenter.z,
          tempScales.x,
          tempScales.y,
          tempScales.z,
          tempQuat.x,
          tempQuat.y,
          tempQuat.z,
          tempQuat.w,
          opacity,
          r,
          g,
          b,
        );
        if (sh) {
          splatEncoder.setSplatSh(newSplatIndex, sh);
        }
      },
    );
  }

  return new Splat(splatEncoder.close());
}

export function isIterableSplatData(
  splatData: SplatData,
): splatData is IterableSplatData {
  return "iterateSplats" in splatData;
}
