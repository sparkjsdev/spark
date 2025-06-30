
precision highp float;
precision highp int;
precision highp usampler2DArray;

#include <splatDefines>

attribute uint splatIndex;

out vec4 vRgba;
out vec2 vSplatUv;
out vec3 vNdc;

uniform vec2 renderSize;
uniform uint numSplats;
uniform vec4 renderToViewQuat;
uniform vec3 renderToViewPos;
uniform float maxStdDev;
uniform float time;
uniform float deltaTime;
uniform bool debugFlag;
uniform bool enable2DGS;
uniform float blurAmount;
uniform float preBlurAmount;
uniform float focalDistance;
uniform float apertureAngle;
uniform float clipXY;
uniform float renderScale;

uniform usampler2DArray packedSplats;

void main() {
    // Default to outside the frustum so it's discarded if we return early
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);

    if (uint(gl_InstanceID) >= numSplats) {
        return;
    }
    if (splatIndex == 0xffffffffu) {
        // Special value reserved for "no splat"
        return;
    }

    ivec3 texCoord = ivec3(
        splatIndex & SPLAT_TEX_WIDTH_MASK,
        (splatIndex >> SPLAT_TEX_WIDTH_BITS) & SPLAT_TEX_HEIGHT_MASK,
        splatIndex >> SPLAT_TEX_LAYER_BITS
    );
    uvec4 packed = texelFetch(packedSplats, texCoord, 0);

    vec3 center, scales;
    vec4 quaternion, rgba;
    unpackSplat(packed, center, scales, quaternion, rgba);

    if (rgba.a < MIN_ALPHA) {
        return;
    }
    bvec3 zeroScales = equal(scales, vec3(0.0));
    if (all(zeroScales)) {
        return;
    }

    // Compute the view space center of the splat
    vec3 viewCenter = quatVec(renderToViewQuat, center) + renderToViewPos;

    // Discard splats behind the camera
    if (viewCenter.z >= 0.0) {
        return;
    }

    // Compute the clip space center of the splat
    vec4 clipCenter = projectionMatrix * vec4(viewCenter, 1.0);

    // Discard splats outside near/far planes
    if (abs(clipCenter.z) >= clipCenter.w) {
        return;
    }

    // Discard splats more than clipXY times outside the XY frustum
    float clip = clipXY * clipCenter.w;
    if (abs(clipCenter.x) > clip || abs(clipCenter.y) > clip) {
        return;
    }

    // Compute view space quaternion of splat
    vec4 viewQuaternion = quatQuat(renderToViewQuat, quaternion);

    if (enable2DGS && any(zeroScales)) {
        vRgba = rgba;
        vSplatUv = position.xy * maxStdDev;

        vec3 offset;
        if (zeroScales.z) {
            offset = vec3(vSplatUv.xy * scales.xy, 0.0);
        } else if (zeroScales.y) {
            offset = vec3(vSplatUv.x * scales.x, 0.0, vSplatUv.y * scales.z);
        } else {
            offset = vec3(0.0, vSplatUv.xy * scales.yz);
        }

        vec3 viewPos = viewCenter + quatVec(viewQuaternion, offset);
        gl_Position = projectionMatrix * vec4(viewPos, 1.0);
        vNdc = gl_Position.xyz / gl_Position.w;
        return;
    }

    // Compute NDC center of the splat
    vec3 ndcCenter = clipCenter.xyz / clipCenter.w;

    // Compute the 3D covariance matrix of the splat
    mat3 RS = scaleQuaternionToMatrix(scales, viewQuaternion);
    mat3 cov3D = RS * transpose(RS);

    // Compute the Jacobian of the splat's projection at its center
    vec2 scaledRenderSize = renderSize * renderScale;
    vec2 focal = 0.5 * scaledRenderSize * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
    float invZ = 1.0 / viewCenter.z;
    vec2 J1 = focal * invZ;
    vec2 J2 = -(J1 * viewCenter.xy) * invZ;
    mat3 J = mat3(
        J1.x, 0.0, J2.x,
        0.0, J1.y, J2.y,
        0.0, 0.0, 0.0
    );

    // Compute the 2D covariance by projecting the 3D covariance
    // and picking out the XY plane components.
    // Keeping below because we may need it in the future
    // for skinning deformations.
    // mat3 W = transpose(mat3(viewMatrix));
    // mat3 T = W * J;
    // mat3 cov2D = transpose(T) * cov3D * T;
    mat3 cov2D = transpose(J) * cov3D * J;
    float a = cov2D[0][0];
    float d = cov2D[1][1];
    float b = cov2D[0][1];

    // Optionally pre-blur the splat to match non-antialias optimized splats
    a += preBlurAmount;
    d += preBlurAmount;

    float fullBlurAmount = blurAmount;
    if ((focalDistance > 0.0) && (apertureAngle > 0.0)) {
        float focusRadius = MAX_PIXEL_RADIUS;
        if (viewCenter.z < 0.0) {
            float focusBlur = abs((-viewCenter.z - focalDistance) / viewCenter.z);
            float apertureRadius = focal.x * tan(0.5 * apertureAngle);
            focusRadius = focusBlur * apertureRadius;
        }
        fullBlurAmount = clamp(sqr(focusRadius), blurAmount, sqr(MAX_PIXEL_RADIUS));
    }

    // Do convolution with a 0.5-pixel Gaussian for anti-aliasing: sqrt(0.3) ~= 0.5
    float detOrig = a * d - b * b;
    a += fullBlurAmount;
    d += fullBlurAmount;
    float det = a * d - b * b;

    // Compute anti-aliasing intensity scaling factor
    float blurAdjust = sqrt(max(0.0, detOrig / det));
    rgba.a *= blurAdjust;
    if (rgba.a < MIN_ALPHA) {
        return;
    }

    // Compute the eigenvalue and eigenvectors of the 2D covariance matrix
    float eigenAvg = 0.5 * (a + d);
    float eigenDelta = sqrt(max(0.0, eigenAvg * eigenAvg - det));
    float eigen1 = eigenAvg + eigenDelta;
    float eigen2 = eigenAvg - eigenDelta;

    vec2 eigenVec1 = normalize(vec2((abs(b) < 0.001) ? 1.0 : b, eigen1 - a));
    vec2 eigenVec2 = vec2(eigenVec1.y, -eigenVec1.x);

    float scale1 = position.x * min(MAX_PIXEL_RADIUS, maxStdDev * sqrt(eigen1));
    float scale2 = position.y * min(MAX_PIXEL_RADIUS, maxStdDev * sqrt(eigen2));

    // Compute the NDC coordinates for the ellipsoid's diagonal axes.
    vec2 pixelOffset = eigenVec1 * scale1 + eigenVec2 * scale2;
    vec2 ndcOffset = (2.0 / scaledRenderSize) * pixelOffset;
    vec3 ndc = vec3(ndcCenter.xy + ndcOffset, ndcCenter.z);

    vRgba = rgba;
    vSplatUv = position.xy * maxStdDev;
    vNdc = ndc;
    gl_Position = vec4(ndc.xy * clipCenter.w, clipCenter.zw);
}
