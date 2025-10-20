
precision highp float;
precision highp int;
precision highp usampler2DArray;

#include <splatDefines>
#include <packedSplat>
#include <extendedSplat>

#define decodeSplat SPLAT_DECODE_FN
#define decodeSplatSh SPLAT_SH_DECODE_FN

#ifdef STOCHASTIC
#define splatIndex uint(gl_InstanceID)
#else
attribute uint splatIndex;
#endif

#ifdef USE_BATCHING
uniform highp sampler2D batchingTexture;
mat4 getBatchingMatrix( const in uint i ) {
    int size = textureSize( batchingTexture, 0 ).x;
    int j = int( i ) * 4;
    int x = j % size;
    int y = j / size;
    vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
    vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
    vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
    vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
    return mat4( v1, v2, v3, v4 );
}
#endif

out vec4 vRgba;
out vec2 vSplatUv;
flat out uint vSplatIndex;

uniform float opacity;

uniform vec2 renderSize;
uniform uint numSplats;
uniform vec4 renderToViewQuat;
uniform float maxStdDev;
uniform float minPixelRadius;
uniform float maxPixelRadius;
uniform float minAlpha;
uniform bool enable2DGS;
uniform float blurAmount;
uniform float preBlurAmount;
uniform float clipXY;
uniform float focalAdjustment;

// Shader hooks
#ifdef HOOK_GLOBAL
{{HOOK_GLOBAL}}
#endif

#ifdef HOOK_UNIFORMS
{{HOOK_UNIFORMS}}
#endif

#ifdef HOOK_OBJECT_MODIFIER
void _shader_hook_object_modifier(inout vec3 center, inout vec3 scales, inout vec4 quaternion, inout vec4 rgba) {
    {{HOOK_OBJECT_MODIFIER}}
}
#endif

#ifdef HOOK_WORLD_MODIFIER
void _shader_hook_world_modifier(inout vec3 center, inout vec3 scales, inout vec4 quaternion, inout vec4 rgba) {
    {{HOOK_WORLD_MODIFIER}}
}
#endif

#ifdef HOOK_SPLAT_COLOR
vec4 _shader_hook_splat_color(in vec3 center, in vec3 scales, in vec4 quaternion, inout vec4 rgba, in vec3 viewCenter) {
    {{HOOK_SPLAT_COLOR}}
    return rgba;
}
#endif


void main() {
    // Default to outside the frustum so it's discarded if we return early
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);

    if (uint(gl_InstanceID) >= numSplats) {
        return;
    }

    // Decode Splat data
    vec3 center, scales;
    vec4 quaternion, rgba;
    uint sIndex = splatIndex & 0x3FFFFFu;
    uint objectIndex = splatIndex >> 26u;
    decodeSplat(sIndex, center, scales, quaternion, rgba);
#ifdef HOOK_OBJECT_MODIFIER
    _shader_hook_object_modifier(center, scales, quaternion, rgba);
#endif

#ifdef USE_BATCHING
    mat4 splatModelMatrix = getBatchingMatrix(objectIndex);
#else
    mat4 splatModelMatrix = modelMatrix;
#endif
    mat4 splatViewMatrix = viewMatrix * splatModelMatrix;

    // Compute viewDir for sh evaluation
    vec3 cameraInObjectSpace = (inverse(splatModelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vec3 viewDir = normalize(center - cameraInObjectSpace);

    // Transform into world space
    float modelScale = length(splatModelMatrix[0]);
    center = (splatModelMatrix * vec4(center, 1.0)).xyz;
    scales *= modelScale;
    rgba.a *= opacity;

#ifdef HOOK_WORLD_MODIFIER
    _shader_hook_world_modifier(center, scales, quaternion, rgba);
#endif

    if (rgba.a < minAlpha) {
        return;
    }
    bvec3 zeroScales = equal(scales, vec3(0.0));
    if (all(zeroScales)) {
        return;
    }

    // Compute the view space center of the splat
    vec3 viewCenter = (viewMatrix * vec4(center, 1.0)).xyz;

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

    // Record the splat index for entropy
    vSplatIndex = sIndex;

    // Compute view space quaternion of splat
    mat3 viewRotation = mat3(splatViewMatrix) * (1.0/modelScale) * quaternionToMatrix(quaternion);

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

        vec3 viewPos = viewCenter + viewRotation * offset;
        gl_Position = projectionMatrix * vec4(viewPos, 1.0);
        return;
    }

    // Compute NDC center of the splat
    vec3 ndcCenter = clipCenter.xyz / clipCenter.w;

    // Compute the 3D covariance matrix of the splat
    mat3 RS = matrixCompMult(viewRotation, mat3(vec3(scales.x), vec3(scales.y), vec3(scales.z)));
    mat3 cov3D = RS * transpose(RS);

    // Compute the Jacobian of the splat's projection at its center
    vec2 scaledRenderSize = renderSize * focalAdjustment;
    vec2 focal = 0.5 * scaledRenderSize * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);

    mat3 J;
    if(isOrthographic) {
        J = mat3(
            focal.x, 0.0, 0.0,
            0.0, focal.y, 0.0,
            0.0, 0.0, 0.0
        );
    } else {
        float invZ = 1.0 / viewCenter.z;
        vec2 J1 = focal * invZ;
        vec2 J2 = -(J1 * viewCenter.xy) * invZ;
        J = mat3(
            J1.x, 0.0, J2.x,
            0.0, J1.y, J2.y,
            0.0, 0.0, 0.0
        );
    }

    // Compute the 2D covariance by projecting the 3D covariance
    // and picking out the XY plane components.
    mat3 cov2D = transpose(J) * cov3D * J;
    float a = cov2D[0][0];
    float d = cov2D[1][1];
    float b = cov2D[0][1];

    // Optionally pre-blur the splat to match non-antialias optimized splats
    a += preBlurAmount;
    d += preBlurAmount;

    // Do convolution with a 0.5-pixel Gaussian for anti-aliasing: sqrt(0.3) ~= 0.5
    float detOrig = a * d - b * b;
    a += blurAmount;
    d += blurAmount;
    float det = a * d - b * b;

    // Compute anti-aliasing intensity scaling factor
    float blurAdjust = sqrt(max(0.0, detOrig / det));
    rgba.a *= blurAdjust;
    if (rgba.a < minAlpha) {
        return;
    }

    // Compute the eigenvalue and eigenvectors of the 2D covariance matrix
    float eigenAvg = 0.5 * (a + d);
    float eigenDelta = sqrt(max(0.0, eigenAvg * eigenAvg - det));
    float eigen1 = eigenAvg + eigenDelta;
    float eigen2 = eigenAvg - eigenDelta;

    vec2 eigenVec1 = normalize(vec2((abs(b) < 0.001) ? 1.0 : b, eigen1 - a));
    vec2 eigenVec2 = vec2(eigenVec1.y, -eigenVec1.x);

    float scale1 = min(maxPixelRadius, maxStdDev * sqrt(eigen1));
    float scale2 = min(maxPixelRadius, maxStdDev * sqrt(eigen2));
    if (scale1 < minPixelRadius && scale2 < minPixelRadius) {
        return;
    }

    // Compute the NDC coordinates for the ellipsoid's diagonal axes.
    vec2 pixelOffset = position.x * eigenVec1 * scale1 + position.y * eigenVec2 * scale2;
    vec2 ndcOffset = (2.0 / scaledRenderSize) * pixelOffset;
    vec3 ndc = vec3(ndcCenter.xy + ndcOffset, ndcCenter.z);

    // Evaluate spherical harmonics
    #if NUM_SH > 0
    vec3[3] sh1;
    vec3[5] sh2;
    vec3[7] sh3;
    decodeSplatSh(splatIndex, sh1, sh2, sh3);
    rgba.rgb += evaluateSH(viewDir, sh1, sh2, sh3);
    #endif

#ifdef HOOK_SPLAT_COLOR
    rgba = _shader_hook_splat_color(center, scales, quaternion, rgba, viewCenter);
#endif

    vRgba = rgba;
    vSplatUv = position.xy * maxStdDev;
    gl_Position = vec4(ndc.xy * clipCenter.w, clipCenter.zw);
}
