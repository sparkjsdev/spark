
precision highp float;
precision highp int;

#include <splatDefines>

uniform float near;
uniform float far;
uniform bool encodeLinear;
uniform float time;
uniform bool debugFlag;
uniform float maxStdDev;
uniform float minAlpha;
uniform bool disableFalloff;
uniform float falloff;

out vec4 fragColor;

in vec4 vRgba;
in vec2 vSplatUv;
in vec3 vNdc;
flat in uint vSplatIndex;
flat in float adjustedStdDev;

#include <logdepthbuf_pars_fragment>

void main() {
    vec4 rgba = vRgba;

    float z2 = dot(vSplatUv, vSplatUv);
    if (z2 > (adjustedStdDev * adjustedStdDev)) {
        discard;
    }

    if (false) {
    // if (debugFlag) {
        float a = rgba.a;
        float shifted = sqrt(z2) - max(0.0, a - 1.0);
        float exponent = -0.5 * max(1.0, a) * sqr(max(0.0, shifted));
        float min1a = min(1.0, a);
        rgba.a = mix(min1a, min1a * exp(exponent), falloff);
    } else {
        // New falloff function, more or less equivalent
        if (rgba.a <= 1.0) {
            rgba.a = mix(rgba.a, rgba.a * exp(-0.5 * z2), falloff);
        } else {
            float a = exp((rgba.a*rgba.a - 1.0) / 2.718281828459045);
            float alpha = 1.0 - pow(1.0 - exp(-0.5 * z2), a);
            rgba.a = mix(1.0, alpha, falloff);
        }
    }

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

    #include <logdepthbuf_fragment>
}
