
precision highp float;
precision highp int;

#include <splatDefines>

uniform bool encodeLinear;
uniform float maxStdDev;
uniform float minAlpha;
uniform bool stochastic;
uniform float falloff;
uniform float time;

out vec4 fragColor;

in vec4 vRgba;
in vec2 vSplatUv;
flat in uint vSplatIndex;

void main() {
    vec4 rgba = vRgba;

    float z = dot(vSplatUv, vSplatUv);
    if (z > (maxStdDev * maxStdDev)) {
        discard;
    }

    rgba.a *= mix(1.0, exp(-0.5 * z), falloff);

    if (rgba.a < minAlpha) {
        discard;
    }
    if (encodeLinear) {
        rgba.rgb = srgbToLinear(rgba.rgb);
    }

    #ifdef STOCHASTIC
        const bool STEADY = false;
        uint uTime = STEADY ? 0u : floatBitsToUint(time);
        uvec2 coord = uvec2(gl_FragCoord.xy);
        uint state = uTime + 0x9e3779b9u * coord.x + 0x85ebca6bu * coord.y + 0xc2b2ae35u * uint(vSplatIndex);
        state = state * 747796405u + 2891336453u;
        uint hash = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
        hash = (hash >> 22u) ^ hash;
        float rand = float(hash) / 4294967296.0;
        if (rand < rgba.a) {
            fragColor = vec4(rgba.rgb, 1.0);
        } else {
            discard;
        }
    #else
        #ifdef PREMULTIPLIED_ALPHA
            fragColor = vec4(rgba.rgb * rgba.a, rgba.a);
        #else
            fragColor = rgba;
        #endif
    #endif
}
