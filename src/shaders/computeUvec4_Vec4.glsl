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

uniform uint targetLayer;
uniform int targetBase;
uniform int targetCount;

layout(location = 0) out uvec4 target;
layout(location = 1) out vec4 target3;

{{ GLOBALS }}

void produceSplat(int index) {
    {{ STATEMENTS }}
}

void main() {
    int targetIndex = int(targetLayer << SPLAT_TEX_LAYER_BITS) + int(uint(gl_FragCoord.y) << SPLAT_TEX_WIDTH_BITS) + int(gl_FragCoord.x);
    int index = targetIndex - targetBase;

    // Initial target to "null" splat
    target = uvec4(0u, 0u, 0u, 0u);

    // Initialize depthTarget to +infinity
    target3 = floatToVec4(1.0 / 0.0);

    if ((index >= 0) && (index < targetCount)) {
        produceSplat(index);
    }
}
