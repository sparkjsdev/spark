
precision highp float;
precision highp int;

#include <splatDefines>

uniform float near;
uniform float far;
uniform vec2 renderSize;
uniform mat4 projectionMatrix;
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
flat in uint vUse3DGUT;
flat in vec3 vCenterVS;
flat in vec3 vIsclRot0;
flat in vec3 vIsclRot1;
flat in vec3 vIsclRot2;

#include <logdepthbuf_pars_fragment>

void main() {
    vec4 rgba = vRgba;

    float z2 = dot(vSplatUv, vSplatUv);
    if (z2 > (adjustedStdDev * adjustedStdDev)) {
        discard;
    }

    if (vUse3DGUT == 1u) {
        vec2 ndc = vec2(
            (2.0 * gl_FragCoord.x / renderSize.x) - 1.0,
            (2.0 * gl_FragCoord.y / renderSize.y) - 1.0
        );
        vec3 rayDirVS = normalize(vec3(
            ndc.x / projectionMatrix[0][0],
            ndc.y / projectionMatrix[1][1],
            -1.0
        ));

        mat3 isclRot = mat3(vIsclRot0, vIsclRot1, vIsclRot2);
        vec3 gro = isclRot * (-vCenterVS);
        vec3 grd = normalize(isclRot * rayDirVS);
        vec3 gcrod = cross(grd, gro);
        z2 = dot(gcrod, gcrod);
    }

    if (rgba.a <= 1.0) {
        rgba.a = mix(rgba.a, rgba.a * exp(-0.5 * z2), falloff);
    } else {
        float a = exp((rgba.a*rgba.a - 1.0) / 2.718281828459045);
        float alpha = 1.0 - pow(1.0 - exp(-0.5 * z2), a);
        rgba.a = mix(1.0, alpha, falloff);
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
