/**
 * Utility functions for OrbitControls configuration
 */

/**
 * Configures OrbitControls for infinite rotation without angle limits.
 *
 * @param {OrbitControls} controls - The OrbitControls instance to configure
 * @returns {OrbitControls} The configured controls instance
 *
 * @example
 * import { setupInfiniteRotation } from './orbit-controls-utils.js';
 *
 * const controls = new OrbitControls(camera, renderer.domElement);
 * setupInfiniteRotation(controls);
 */
export function setupInfiniteRotation(controls) {
  // Enable infinite horizontal rotation (azimuth)
  controls.minAzimuthAngle = Number.NEGATIVE_INFINITY;
  controls.maxAzimuthAngle = Number.POSITIVE_INFINITY;

  // Enable infinite vertical rotation (polar angle)
  controls.minPolarAngle = Number.NEGATIVE_INFINITY;
  controls.maxPolarAngle = Number.POSITIVE_INFINITY;

  return controls;
}
