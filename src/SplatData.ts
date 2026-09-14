import type * as THREE from "three";

/**
 * Decoded RGB spherical-harmonic coefficients for a splat, grouped by band.
 * Arrays contain 9, 15, and 21 floats for SH1, SH2, and SH3 respectively.
 */
export type SplatSphericalHarmonics = {
  sh1?: Float32Array;
  sh2?: Float32Array;
  sh3?: Float32Array;
};

/** Decoded attributes returned by splat unpacking helpers. */
export type UnpackedSplat = {
  center: THREE.Vector3;
  scales: THREE.Vector3;
  quaternion: THREE.Quaternion;
  opacity: number;
  color: THREE.Color;
  sphericalHarmonics: SplatSphericalHarmonics;
};

/** Callback invoked by `forEachSplat`. Values are reused between invocations. */
export type ForEachSplatCallback = (
  index: number,
  center: THREE.Vector3,
  scales: THREE.Vector3,
  quaternion: THREE.Quaternion,
  opacity: number,
  color: THREE.Color,
  sphericalHarmonics: SplatSphericalHarmonics,
) => void;
