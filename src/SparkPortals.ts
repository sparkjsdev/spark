import * as THREE from "three";
import {
  NewSparkRenderer,
  type NewSparkRendererOptions,
} from "./NewSparkRenderer";

/**
 * Fragment shader for portal disk clipping.
 * - diskRadius > 0: render "behind portal" only through the disk
 * - diskRadius < 0: render "in front of portal" everywhere except behind disk
 *
 * Note: This shader uses view-space uniforms and works correctly in non-VR mode.
 * In VR mode, visual disk meshes are used instead due to stereo rendering complexity.
 */
export const DISK_PORTAL_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

#include <splatDefines>

uniform float near;
uniform float far;
uniform mat4 projectionMatrix;
uniform bool encodeLinear;
uniform float time;
uniform bool debugFlag;
uniform float maxStdDev;
uniform float minAlpha;
uniform bool disableFalloff;
uniform float falloff;

// Portal disk in VIEW space (computed on CPU before render)
uniform vec3 diskCenter;
uniform vec3 diskNormal;
uniform float diskRadius;
uniform bool diskTwoSided;

out vec4 fragColor;

in vec4 vRgba;
in vec2 vSplatUv;
in vec3 vNdc;
flat in uint vSplatIndex;
flat in float adjustedStdDev;

void main() {
    if (diskRadius != 0.0) {
        // Portal rendering:
        // - diskRadius > 0: render "behind portal" only through the disk (discard outside or in-front-of plane).
        // - diskRadius < 0: render "in front of portal" everywhere, but discard fragments behind the plane when looking through the disk.

        // View ray direction from NDC (view space is -Z forward).
        vec3 viewDir = normalize(vec3(
            vNdc.x / projectionMatrix[0][0],
            vNdc.y / projectionMatrix[1][1],
            -1.0
        ));

        // Reconstruct view-space *axial* depth (-viewPos.z) from NDC Z.
        float ndcZ = vNdc.z;
        float depth = (2.0 * near * far) / (far + near - ndcZ * (far - near));
        // Convert axial depth to ray-parameter t (viewPos = t * viewDir).
        float rayT = depth / max(1e-6, -viewDir.z);

        float radius = abs(diskRadius);
        float radius2 = radius * radius;
        bool renderBehind = (diskRadius > 0.0);

        vec3 diskN = normalize(diskNormal);

        // Ray-plane intersection for plane (diskCenter, diskN), with ray origin at (0,0,0).
        float denom = dot(viewDir, diskN);
        bool allowPortal = diskTwoSided ? (abs(denom) > 1e-6) : (denom < -1e-6);

        bool hitsDisk = false;
        float t = 0.0;
        if (allowPortal) {
            t = dot(diskCenter, diskN) / denom;
            if (t > 0.0) {
                vec3 q = t * viewDir - diskCenter;
                hitsDisk = (dot(q, q) <= radius2);
            }
        }

        // Small bias to avoid flicker at the plane.
        float eps = 1e-4 * max(1.0, abs(t));

        if (renderBehind) {
            // Behind-pass: only render through the portal disk, and only behind the plane along the ray.
            if (!hitsDisk) discard;
            if (rayT <= t + eps) discard;
        } else {
            // Front-pass: render everything, except when the ray goes through the disk, discard what's behind the plane.
            if (hitsDisk && (rayT >= t - eps)) discard;
        }
    }

    vec4 rgba = vRgba;

    float z2 = dot(vSplatUv, vSplatUv);
    if (z2 > (adjustedStdDev * adjustedStdDev)) {
        discard;
    }

    float a = rgba.a;
    float shifted = sqrt(z2) - max(0.0, a - 1.0);
    float exponent = -0.5 * max(1.0, a) * sqr(max(0.0, shifted));
    rgba.a = min(1.0, a) * exp(exponent);

    if (rgba.a < minAlpha) {
        discard;
    }
    if (encodeLinear) {
        rgba.rgb = srgbToLinear(rgba.rgb);
    }

    #ifdef PREMULTIPLIED_ALPHA
        fragColor = vec4(rgba.rgb * rgba.a, rgba.a);
    #else
        fragColor = rgba;
    #endif
}
`;

/**
 * Callback function called when a portal is crossed.
 * @param pair The portal pair that was crossed
 * @param fromEntry True if crossing from entry to exit, false if crossing from exit to entry
 */
export type PortalCrossCallback = (
  pair: PortalPair,
  fromEntry: boolean,
) => void | Promise<void>;

/**
 * A pair of connected portals. Walking through one teleports you to the other.
 */
export interface PortalPair {
  /** First portal endpoint */
  entryPortal: THREE.Object3D;
  /** Second portal endpoint */
  exitPortal: THREE.Object3D;
  /** Radius of this portal pair's disks */
  radius: number;
  /** Optional callback function called when this portal is crossed */
  onCross?: PortalCrossCallback;
  /** Scratch matrix for tracking portal position before frame updates */
  _entryBefore: THREE.Matrix4;
  /** Scratch matrix for tracking portal position before frame updates */
  _exitBefore: THREE.Matrix4;
}

export interface SparkPortalsOptions {
  /** The THREE.WebGLRenderer */
  renderer: THREE.WebGLRenderer;
  /** The scene to render */
  scene: THREE.Scene;
  /** The main camera */
  camera: THREE.PerspectiveCamera;
  /** The local frame (parent of camera, used for teleportation) */
  localFrame: THREE.Group;
  /** Options passed to both NewSparkRenderer instances */
  sparkOptions?: Partial<NewSparkRendererOptions>;
  /** Default portal disk radius for new pairs (default: 1.0) */
  defaultPortalRadius?: number;
  /** Epsilon for portal crossing detection (default: 1e-6) */
  portalCrossEps?: number;
}

/**
 * SparkPortals
 *
 * Portal implementation to connect two non-contiguous areas of a scene.
 * Supports multiple portal pairs - each pair connects two locations.
 *
 * The rough approach is to use two NewSparkRenderers: one for the "front"/portal
 * view (portalRenderer), and one for the "behind portal" pass (behindRenderer).
 *
 * Example:
 * ```typescript
 * const portals = new SparkPortals({ renderer, scene, camera, localFrame });
 *
 * // Add a portal pair
 * const pair = portals.addPortalPair();
 * pair.entryPortal.position.set(0, 0, -1);
 * pair.exitPortal.position.set(-3, 0, -4.5);
 *
 * // Add another pair
 * const pair2 = portals.addPortalPair({ radius: 0.5 });
 * pair2.entryPortal.position.set(5, 0, 0);
 * pair2.exitPortal.position.set(10, 0, 0);
 *
 * // In animation loop:
 * portals.animateLoopHook();
 * ```
 */
export class SparkPortals {
  /** The THREE.WebGLRenderer */
  renderer: THREE.WebGLRenderer;
  /** The scene to render */
  scene: THREE.Scene;
  /** The main camera */
  camera: THREE.PerspectiveCamera;
  /** The local frame (parent of camera, used for teleportation) */
  localFrame: THREE.Group;

  /** Primary renderer with portal shader (added to scene) */
  portalRenderer: NewSparkRenderer;
  /** Secondary renderer for behind-portal pass (not in scene) */
  behindRenderer: NewSparkRenderer;
  /** Secondary camera for behind-portal view */
  camera2: THREE.PerspectiveCamera;

  /** All portal pairs */
  portalPairs: PortalPair[] = [];
  /** Default radius for new portal pairs */
  defaultPortalRadius: number;
  /** Epsilon for portal crossing detection */
  portalCrossEps: number;

  /** Used to detect crossing between frames */
  private lastCameraWorld = new THREE.Vector3().setScalar(Number.NaN);

  // Preallocated objects for scratch work to avoid per frame allocations
  private scratch = {
    quat: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    center0: new THREE.Vector3(),
    center1: new THREE.Vector3(),
    normal0: new THREE.Vector3(),
    normal1: new THREE.Vector3(),
    centerT: new THREE.Vector3(),
    normalT: new THREE.Vector3(),
    prevCameraWorld: new THREE.Vector3(),
    currCameraWorld: new THREE.Vector3(),
    hit: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    camWorld: new THREE.Matrix4(),
    newCamWorld: new THREE.Matrix4(),
    invCamLocal: new THREE.Matrix4(),
    newLocalFrame: new THREE.Matrix4(),
    cameraWorldPos: new THREE.Vector3(),
    viewDir: new THREE.Vector3(),
    portalCenter: new THREE.Vector3(),
    toPortal: new THREE.Vector3(),
  };

  constructor(options: SparkPortalsOptions) {
    this.renderer = options.renderer;
    this.scene = options.scene;
    this.camera = options.camera;
    this.localFrame = options.localFrame;
    this.defaultPortalRadius = options.defaultPortalRadius ?? 1.0;
    this.portalCrossEps = options.portalCrossEps ?? 1e-6;

    const sparkOpts = options.sparkOptions ?? {};

    // Primary renderer with portal shader (view-space uniforms for non-VR mode)
    this.portalRenderer = new NewSparkRenderer({
      renderer: this.renderer,
      extraUniforms: {
        diskCenter: { value: new THREE.Vector3() },
        diskNormal: { value: new THREE.Vector3() },
        diskRadius: { value: 0 },
        diskTwoSided: { value: false },
      },
      fragmentShader: DISK_PORTAL_FRAGMENT_SHADER,
      ...sparkOpts,
    });
    this.scene.add(this.portalRenderer);

    // Secondary renderer for behind-portal pass
    // enableDriveLod: false prevents this renderer from driving LOD updates,
    // avoiding race conditions with portalRenderer's pager operations
    this.behindRenderer = new NewSparkRenderer({
      renderer: this.renderer,
      enableDriveLod: false,
      ...sparkOpts,
    });

    // Secondary camera for behind-portal view
    this.camera2 = this.camera.clone();
    this.scene.add(this.camera2);
  }

  /**
   * Set view-space portal uniforms for shader clipping.
   * Used in non-VR mode only.
   */
  private setPortalDiskUniforms(
    camera: THREE.Camera,
    portal: THREE.Object3D,
    radius: number,
    twoSided: boolean,
  ): void {
    camera.updateMatrixWorld(true);
    portal.updateMatrixWorld(true);

    const inverseCamera = camera.matrixWorld.clone().invert();
    const portalInCamera = portal.matrixWorld.clone().premultiply(inverseCamera);
    const portalQuat = new THREE.Quaternion();

    const uniforms = this.portalRenderer.uniforms as typeof this.portalRenderer.uniforms & {
      diskCenter: { value: THREE.Vector3 };
      diskNormal: { value: THREE.Vector3 };
      diskRadius: { value: number };
      diskTwoSided: { value: boolean };
    };

    portalInCamera.decompose(
      uniforms.diskCenter.value,
      portalQuat,
      new THREE.Vector3(),
    );

    uniforms.diskNormal.value.set(0, 0, 1).applyQuaternion(portalQuat);
    uniforms.diskRadius.value = radius;
    uniforms.diskTwoSided.value = twoSided;
  }

  /** Disable shader-based portal clipping */
  private clearPortalDiskUniforms(): void {
    const uniforms = this.portalRenderer.uniforms as typeof this.portalRenderer.uniforms & {
      diskRadius: { value: number };
    };
    uniforms.diskRadius.value = 0;
  }

  /**
   * Add a new portal pair to the system.
   * @param options Optional configuration for this pair
   * @returns The created PortalPair - position the entryPortal and exitPortal as needed
   */
  addPortalPair(options?: {
    radius?: number;
    onCross?: PortalCrossCallback;
  }): PortalPair {
    const pair: PortalPair = {
      entryPortal: new THREE.Object3D(),
      exitPortal: new THREE.Object3D(),
      radius: options?.radius ?? this.defaultPortalRadius,
      onCross: options?.onCross,
      _entryBefore: new THREE.Matrix4(),
      _exitBefore: new THREE.Matrix4(),
    };

    this.scene.add(pair.entryPortal);
    this.scene.add(pair.exitPortal);
    this.portalPairs.push(pair);

    return pair;
  }

  /**
   * Remove a portal pair from the system.
   */
  removePortalPair(pair: PortalPair): void {
    const index = this.portalPairs.indexOf(pair);
    if (index !== -1) {
      this.scene.remove(pair.entryPortal);
      this.scene.remove(pair.exitPortal);
      this.portalPairs.splice(index, 1);
    }
  }

  /**
   * Get transform from entry portal to exit portal.
   */
  getEntryToExitTransform(pair: PortalPair): THREE.Matrix4 {
    return pair.entryPortal.matrixWorld
      .clone()
      .invert()
      .premultiply(pair.exitPortal.matrixWorld);
  }

  /**
   * Get transform from exit portal to entry portal.
   */
  getExitToEntryTransform(pair: PortalPair): THREE.Matrix4 {
    return pair.exitPortal.matrixWorld
      .clone()
      .invert()
      .premultiply(pair.entryPortal.matrixWorld);
  }

  /** Extract portal plane from matrix */
  private getPortalPlane(
    matrix: THREE.Matrix4,
    outCenter: THREE.Vector3,
    outNormal: THREE.Vector3,
  ): void {
    matrix.decompose(outCenter, this.scratch.quat, this.scratch.scale);
    outNormal.set(0, 0, 1).applyQuaternion(this.scratch.quat).normalize();
  }

  /**
   * Detect if the user path crosses over a portal. If so, return the parametric position (0,1)
   * along the segment where the crossing occurs. If not, return null.
   */
  private getSegmentDiskCrossing(
    prevCam: THREE.Vector3,
    currCam: THREE.Vector3,
    beforeMatrix: THREE.Matrix4,
    afterMatrix: THREE.Matrix4,
    radius: number,
  ): number | null {
    this.getPortalPlane(
      beforeMatrix,
      this.scratch.center0,
      this.scratch.normal0,
    );
    this.getPortalPlane(
      afterMatrix,
      this.scratch.center1,
      this.scratch.normal1,
    );

    const startPlaneDist = this.scratch.offset
      .copy(prevCam)
      .sub(this.scratch.center0)
      .dot(this.scratch.normal0);
    const endPlaneDist = this.scratch.offset
      .copy(currCam)
      .sub(this.scratch.center1)
      .dot(this.scratch.normal1);

    if (
      (startPlaneDist > this.portalCrossEps &&
        endPlaneDist > this.portalCrossEps) ||
      (startPlaneDist < -this.portalCrossEps &&
        endPlaneDist < -this.portalCrossEps)
    ) {
      return null;
    }

    const denom = startPlaneDist - endPlaneDist;
    if (Math.abs(denom) < this.portalCrossEps) return null;

    const t = startPlaneDist / denom;
    if (t < 0 || t > 1) return null;

    this.scratch.hit.lerpVectors(prevCam, currCam, t);
    this.scratch.centerT
      .copy(this.scratch.center0)
      .lerp(this.scratch.center1, t);
    this.scratch.normalT
      .copy(this.scratch.normal0)
      .lerp(this.scratch.normal1, t)
      .normalize();

    this.scratch.offset.copy(this.scratch.hit).sub(this.scratch.centerT);
    this.scratch.offset.addScaledVector(
      this.scratch.normalT,
      -this.scratch.offset.dot(this.scratch.normalT),
    );

    if (this.scratch.offset.lengthSq() > radius * radius) return null;
    return t;
  }

  /** Teleport camera through portal */
  private teleport(transform: THREE.Matrix4): void {
    this.scratch.camWorld.copy(this.camera.matrixWorld);
    this.scratch.newCamWorld.copy(this.scratch.camWorld).premultiply(transform);
    this.scratch.invCamLocal.copy(this.camera.matrix).invert();
    this.scratch.newLocalFrame
      .copy(this.scratch.newCamWorld)
      .multiply(this.scratch.invCamLocal);

    this.scratch.newLocalFrame.decompose(
      this.localFrame.position,
      this.localFrame.quaternion,
      this.localFrame.scale,
    );
    this.localFrame.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
  }

  /**
   * Check for portal crossing and teleport if needed.
   * Checks all portal pairs and takes the earliest crossing.
   * Call this after updating controls but before render().
   */
  updateTeleportation(): void {
    if (this.portalPairs.length === 0) return;

    this.camera.getWorldPosition(this.scratch.currCameraWorld);
    if (!Number.isFinite(this.lastCameraWorld.x)) {
      this.lastCameraWorld.copy(this.scratch.currCameraWorld);
      return;
    }

    this.scratch.prevCameraWorld.copy(this.lastCameraWorld);

    // Store portal matrices before any updates and find earliest crossing
    let earliestT: number | null = null;
    let crossedPair: PortalPair | null = null;
    let crossedEntry = true; // true = crossed entry portal, false = crossed exit portal

    for (const pair of this.portalPairs) {
      pair.entryPortal.updateMatrixWorld(true);
      pair.exitPortal.updateMatrixWorld(true);
      pair._entryBefore.copy(pair.entryPortal.matrixWorld);
      pair._exitBefore.copy(pair.exitPortal.matrixWorld);

      // Check entry portal crossing
      const entryT = this.getSegmentDiskCrossing(
        this.scratch.prevCameraWorld,
        this.scratch.currCameraWorld,
        pair._entryBefore,
        pair.entryPortal.matrixWorld,
        pair.radius,
      );

      if (entryT !== null && (earliestT === null || entryT < earliestT)) {
        earliestT = entryT;
        crossedPair = pair;
        crossedEntry = true;
      }

      // Check exit portal crossing
      const exitT = this.getSegmentDiskCrossing(
        this.scratch.prevCameraWorld,
        this.scratch.currCameraWorld,
        pair._exitBefore,
        pair.exitPortal.matrixWorld,
        pair.radius,
      );

      if (exitT !== null && (earliestT === null || exitT < earliestT)) {
        earliestT = exitT;
        crossedPair = pair;
        crossedEntry = false;
      }
    }

    // No portal crossed
    if (crossedPair === null) {
      this.lastCameraWorld.copy(this.scratch.currCameraWorld);
      return;
    }

    // Teleport through the crossed portal
    if (crossedEntry) {
      this.teleport(this.getEntryToExitTransform(crossedPair));
    } else {
      this.teleport(this.getExitToEntryTransform(crossedPair));
    }

    this.camera.getWorldPosition(this.lastCameraWorld);

    // Call the portal's onCross callback if provided
    if (crossedPair.onCross) {
      // Call async callback but don't await (updateTeleportation is synchronous)
      // Errors will be logged but won't block teleportation
      Promise.resolve(crossedPair.onCross(crossedPair, crossedEntry)).catch(
        (error) => {
          console.error("Error in portal onCross callback:", error);
        },
      );
    }
  }

  /**
   * Find the most relevant portal for rendering (closest to camera view direction).
   * Returns the portal pair and which portal (entry or exit) is primary.
   */
  private findPrimaryPortal(): {
    pair: PortalPair;
    primaryIsEntry: boolean;
    primaryPortal: THREE.Object3D;
    otherPortal: THREE.Object3D;
  } | null {
    if (this.portalPairs.length === 0) return null;

    this.camera.getWorldPosition(this.scratch.cameraWorldPos);
    this.camera.getWorldDirection(this.scratch.viewDir);

    let bestScore = Number.NEGATIVE_INFINITY;
    let bestPair: PortalPair | null = null;
    let bestIsEntry = true;

    for (const pair of this.portalPairs) {
      // Score entry portal
      pair.entryPortal.getWorldPosition(this.scratch.portalCenter);
      this.scratch.toPortal
        .copy(this.scratch.portalCenter)
        .sub(this.scratch.cameraWorldPos);
      const entryDist = this.scratch.toPortal.length();
      const entryScore =
        this.scratch.toPortal.normalize().dot(this.scratch.viewDir) / entryDist;

      if (entryScore > bestScore) {
        bestScore = entryScore;
        bestPair = pair;
        bestIsEntry = true;
      }

      // Score exit portal
      pair.exitPortal.getWorldPosition(this.scratch.portalCenter);
      this.scratch.toPortal
        .copy(this.scratch.portalCenter)
        .sub(this.scratch.cameraWorldPos);
      const exitDist = this.scratch.toPortal.length();
      const exitScore =
        this.scratch.toPortal.normalize().dot(this.scratch.viewDir) / exitDist;

      if (exitScore > bestScore) {
        bestScore = exitScore;
        bestPair = pair;
        bestIsEntry = false;
      }
    }

    if (!bestPair) return null;

    return {
      pair: bestPair,
      primaryIsEntry: bestIsEntry,
      primaryPortal: bestIsEntry ? bestPair.entryPortal : bestPair.exitPortal,
      otherPortal: bestIsEntry ? bestPair.exitPortal : bestPair.entryPortal,
    };
  }

  /**
   * Render the scene with portals using two-pass rendering.
   * Renders the most relevant portal pair (closest to camera view).
   * Call this instead of renderer.render() in your animation loop.
   *
   * In VR mode, shader-based clipping is disabled due to stereo rendering
   * complexity. Applications can add their own visual fallbacks if needed.
   */
  render(): void {
    const isVR = this.renderer.xr.isPresenting;
    const primary = this.findPrimaryPortal();

    // No portals - just render normally
    if (!primary) {
      this.clearPortalDiskUniforms();
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const { pair, primaryIsEntry, primaryPortal, otherPortal } = primary;

    // VR mode: disable shader clipping, just render normally
    // Applications can add their own visual fallbacks to portal.entryPortal/exitPortal
    if (isVR) {
      this.clearPortalDiskUniforms();
      this.renderer.autoClear = true;
      this.portalRenderer.render(this.scene, this.camera);
      return;
    }

    // Non-VR mode: use shader-based portal clipping

    // Compute camera2 position (transformed through portal)
    const camera2Matrix = primaryIsEntry
      ? this.camera.matrixWorld
          .clone()
          .premultiply(this.getEntryToExitTransform(pair))
      : this.camera.matrixWorld
          .clone()
          .premultiply(this.getExitToEntryTransform(pair));
    camera2Matrix.decompose(
      this.camera2.position,
      this.camera2.quaternion,
      this.camera2.scale,
    );
    this.camera2.updateMatrixWorld(true);

    // Share lodInstances from portalRenderer to behindRenderer BEFORE Pass 1.
    // This uses previous frame's lodInstances (computed with main camera),
    // ensuring both passes use consistent splat selections to avoid flickering.
    this.shareLodInstances();

    // Pass 1: Behind portal view (uses shared lodInstances)
    this.setPortalDiskUniforms(this.camera2, otherPortal, pair.radius, true);
    this.renderer.autoClear = true;
    this.behindRenderer.render(this.scene, this.camera2);

    // Pass 2: Main view (updates portalRenderer's lodInstances for next frame)
    this.setPortalDiskUniforms(this.camera, primaryPortal, -pair.radius, true);
    this.renderer.autoClear = false;
    this.portalRenderer.render(this.scene, this.camera);
  }

  /**
   * Share lodInstances from portalRenderer to behindRenderer.
   * Uses previous frame's values to ensure both passes render consistent splats.
   */
  private shareLodInstances(): void {
    // Clear and copy lodInstances from portalRenderer to behindRenderer
    this.behindRenderer.lodInstances.clear();
    for (const [mesh, data] of this.portalRenderer.lodInstances) {
      this.behindRenderer.lodInstances.set(mesh, data);
    }
  }

  /**
   * Convenience hook for animation loop.
   * Calls updateTeleportation() then render().
   */
  animateLoopHook(): void {
    this.updateTeleportation();
    this.render();
  }

  /** Update camera2 aspect ratio on window resize */
  updateAspect(aspect: number): void {
    this.camera2.aspect = aspect;
    this.camera2.updateProjectionMatrix();
  }

  /** Dispose of resources */
  dispose(): void {
    this.scene.remove(this.portalRenderer);
    this.scene.remove(this.camera2);

    for (const pair of this.portalPairs) {
      this.scene.remove(pair.entryPortal);
      this.scene.remove(pair.exitPortal);
    }
    this.portalPairs = [];

    this.portalRenderer.dispose();
    this.behindRenderer.dispose();
  }
}
