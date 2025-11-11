precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;
precision highp sampler2DArray;
precision highp usampler2DArray;
precision highp isampler2DArray;
precision highp sampler3D;
precision highp usampler3D;
precision highp isampler3D;

#include <splatDefines>
#include <packedSplat>
#include <extendedSplat>

#define decodeSplat SPLAT_DECODE_FN

uniform uint targetLayer;
uniform int targetBase;
uniform int targetCount;

uniform bool sortRadial;
uniform float sortDepthBias;
uniform bool sort360;

uniform mat4 splatModelViewMatrix;

out vec4 target;

float computeSort(vec3 splatCenter, bool sortRadial, float sortDepthBias, bool sort360) {
    // FIXME: Check active flag?
    float biasedDepth = dot(splatCenter, vec3(0, 0, -1)) + sortDepthBias;
    if (!sort360 && (biasedDepth <= 0.0)) {
        return INFINITY;
    }
    return sortRadial ? length(splatCenter) : biasedDepth;
}

void main() {
    int targetIndex = int(targetLayer << SPLAT_TEX_LAYER_BITS) + int(uint(gl_FragCoord.y) << SPLAT_TEX_WIDTH_BITS) + int(gl_FragCoord.x);
    int index = (targetIndex - targetBase);

    if ((index >= 0) && (index < targetCount)) {
        vec3 center, scales;
        vec4 quaternion, rgba;

        // Compute distance
#ifdef SORT32
        decodeSplat(uint(index), center, scales, quaternion, rgba);
        center = (splatModelViewMatrix * vec4(center, 1.0)).xyz;
        float metric = computeSort(center, sortRadial, sortDepthBias, sort360);

        uint packed = floatBitsToUint(metric);
#else
        decodeSplat(uint(index * 2), center, scales, quaternion, rgba);
        center = (splatModelViewMatrix * vec4(center, 1.0)).xyz;
        float metric1 = computeSort(center, sortRadial, sortDepthBias, sort360);

        decodeSplat(uint(index * 2 + 1), center, scales, quaternion, rgba);
        center = (splatModelViewMatrix * vec4(center, 1.0)).xyz;
        float metric2 = computeSort(center, sortRadial, sortDepthBias, sort360);

        uint packed = packHalf2x16(vec2(metric1, metric2));
#endif

        uvec4 uTarget = uvec4(packed & 0xffu, (packed >> 8u) & 0xffu, (packed >> 16u) & 0xffu, (packed >> 24u) & 0xffu);
        target = vec4(uTarget) / 255.0;
    } else {
        target = vec4(0);
    }
}
