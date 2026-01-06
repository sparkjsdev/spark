import { NewSparkRenderer, NewSparkRendererOptions } from './NewSparkRenderer';
import * as THREE from "three";
/**
 * Fragment shader for portal disk clipping.
 * - diskRadius > 0: render "behind portal" only through the disk
 * - diskRadius < 0: render "in front of portal" everywhere except behind disk
 */
export declare const DISK_PORTAL_FRAGMENT_SHADER = "\nprecision highp float;\nprecision highp int;\n\n#include <splatDefines>\n\nuniform float near;\nuniform float far;\nuniform mat4 projectionMatrix;\nuniform bool encodeLinear;\nuniform float time;\nuniform bool debugFlag;\nuniform float maxStdDev;\nuniform float minAlpha;\nuniform bool disableFalloff;\nuniform float falloff;\n\nuniform vec3 diskCenter;\nuniform vec3 diskNormal;\nuniform float diskRadius;\nuniform bool diskTwoSided;\n\nout vec4 fragColor;\n\nin vec4 vRgba;\nin vec2 vSplatUv;\nin vec3 vNdc;\nflat in uint vSplatIndex;\nflat in float adjustedStdDev;\n\nvoid main() {\n    if (diskRadius != 0.0) {\n        // Portal rendering:\n        // - diskRadius > 0: render \"behind portal\" only through the disk (discard outside or in-front-of plane).\n        // - diskRadius < 0: render \"in front of portal\" everywhere, but discard fragments behind the plane when looking through the disk.\n\n        // View ray direction from NDC (view space is -Z forward).\n        vec3 viewDir = normalize(vec3(\n            vNdc.x / projectionMatrix[0][0],\n            vNdc.y / projectionMatrix[1][1],\n            -1.0\n        ));\n\n        // Reconstruct view-space *axial* depth (-viewPos.z) from NDC Z.\n        float ndcZ = vNdc.z;\n        float depth = (2.0 * near * far) / (far + near - ndcZ * (far - near));\n        // Convert axial depth to ray-parameter t (viewPos = t * viewDir).\n        float rayT = depth / max(1e-6, -viewDir.z);\n\n        float radius = abs(diskRadius);\n        float radius2 = radius * radius;\n        bool renderBehind = (diskRadius > 0.0);\n\n        vec3 diskN = normalize(diskNormal);\n\n        // Ray-plane intersection for plane (diskCenter, diskN), with ray origin at (0,0,0).\n        float denom = dot(viewDir, diskN);\n        bool allowPortal = diskTwoSided ? (abs(denom) > 1e-6) : (denom < -1e-6);\n\n        bool hitsDisk = false;\n        float t = 0.0;\n        if (allowPortal) {\n            t = dot(diskCenter, diskN) / denom;\n            if (t > 0.0) {\n                vec3 q = t * viewDir - diskCenter;\n                hitsDisk = (dot(q, q) <= radius2);\n            }\n        }\n\n        // Small bias to avoid flicker at the plane.\n        float eps = 1e-4 * max(1.0, abs(t));\n\n        if (renderBehind) {\n            // Behind-pass: only render through the portal disk, and only behind the plane along the ray.\n            if (!hitsDisk) discard;\n            if (rayT <= t + eps) discard;\n        } else {\n            // Front-pass: render everything, except when the ray goes through the disk, discard what's behind the plane.\n            if (hitsDisk && (rayT >= t - eps)) discard;\n        }\n    }\n\n    vec4 rgba = vRgba;\n\n    float z2 = dot(vSplatUv, vSplatUv);\n    if (z2 > (adjustedStdDev * adjustedStdDev)) {\n        discard;\n    }\n\n    float a = rgba.a;\n    float shifted = sqrt(z2) - max(0.0, a - 1.0);\n    float exponent = -0.5 * max(1.0, a) * sqr(max(0.0, shifted));\n    rgba.a = min(1.0, a) * exp(exponent);\n\n    if (rgba.a < minAlpha) {\n        discard;\n    }\n    if (encodeLinear) {\n        rgba.rgb = srgbToLinear(rgba.rgb);\n    }\n\n    #ifdef PREMULTIPLIED_ALPHA\n        fragColor = vec4(rgba.rgb * rgba.a, rgba.a);\n    #else\n        fragColor = rgba;\n    #endif\n}\n";
/**
 * Callback function called when a portal is crossed.
 * @param pair The portal pair that was crossed
 * @param fromEntry True if crossing from entry to exit, false if crossing from exit to entry
 */
export type PortalCrossCallback = (pair: PortalPair, fromEntry: boolean) => void | Promise<void>;
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
export declare class SparkPortals {
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
    portalPairs: PortalPair[];
    /** Default radius for new portal pairs */
    defaultPortalRadius: number;
    /** Epsilon for portal crossing detection */
    portalCrossEps: number;
    /** Used to detect crossing between frames */
    private lastCameraWorld;
    private scratch;
    constructor(options: SparkPortalsOptions);
    /**
     * Add a new portal pair to the system.
     * @param options Optional configuration for this pair
     * @returns The created PortalPair - position the entryPortal and exitPortal as needed
     */
    addPortalPair(options?: {
        radius?: number;
        onCross?: PortalCrossCallback;
    }): PortalPair;
    /**
     * Remove a portal pair from the system.
     */
    removePortalPair(pair: PortalPair): void;
    /**
     * Get transform from entry portal to exit portal.
     */
    getEntryToExitTransform(pair: PortalPair): THREE.Matrix4;
    /**
     * Get transform from exit portal to entry portal.
     */
    getExitToEntryTransform(pair: PortalPair): THREE.Matrix4;
    /** Set portal disk uniforms for shader clipping */
    private setPortalDiskUniforms;
    /** Extract portal plane from matrix */
    private getPortalPlane;
    /**
     * Detect if the user path crosses over a portal. If so, return the parametric position (0,1)
     * along the segment where the crossing occurs. If not, return null.
     */
    private getSegmentDiskCrossing;
    /** Teleport camera through portal */
    private teleport;
    /**
     * Check for portal crossing and teleport if needed.
     * Checks all portal pairs and takes the earliest crossing.
     * Call this after updating controls but before render().
     */
    updateTeleportation(): void;
    /**
     * Find the most relevant portal for rendering (closest to camera view direction).
     * Returns the portal pair and which portal (entry or exit) is primary.
     */
    private findPrimaryPortal;
    /**
     * Render the scene with portals using two-pass rendering.
     * Renders the most relevant portal pair (closest to camera view).
     * Call this instead of renderer.render() in your animation loop.
     */
    render(): void;
    /**
     * Share lodInstances from portalRenderer to behindRenderer.
     * Uses previous frame's values to ensure both passes render consistent splats.
     */
    private shareLodInstances;
    /**
     * Convenience hook for animation loop.
     * Calls updateTeleportation() then render().
     */
    animateLoopHook(): void;
    /** Update camera2 aspect ratio on window resize */
    updateAspect(aspect: number): void;
    /** Dispose of resources */
    dispose(): void;
}
