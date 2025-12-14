
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

        // Reconstruct view-space *axial* depth (-viewPos.z) from NDC Z (same as `splatFragment.glsl`).
        // NOTE: this is NOT the same as distance along the ray unless viewDir.z == -1.
        float ndcZ = vNdc.z;
        float depth = (2.0 * near * far) / (far + near - ndcZ * (far - near));
        // Convert axial depth to ray-parameter t (viewPos = t * viewDir), where depth = -viewPos.z = -t*viewDir.z.
        float rayT = depth / max(1e-6, -viewDir.z);

        float radius = abs(diskRadius);
        float radius2 = radius * radius;
        bool renderBehind = (diskRadius > 0.0);

        vec3 diskN = normalize(diskNormal);

        // Ray-plane intersection for plane (diskCenter, diskN), with ray origin at (0,0,0).
        // If `diskTwoSided` is false, only allow "see-through" when approaching from the front side.
        float denom = dot(viewDir, diskN);
        bool allowPortal = diskTwoSided ? (abs(denom) > 1e-6) : (denom < -1e-6);

        bool hitsDisk = false;
        float t = 0.0;
        if (allowPortal) {
            t = dot(diskCenter, diskN) / denom;
            if (t > 0.0) {
                vec3 q = t * viewDir - diskCenter; // intersection offset from center (in plane)
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
