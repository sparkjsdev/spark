#ifdef USE_PACKED_SPLAT

uniform usampler2DArray packedSplats;
uniform usampler2DArray packedShTexture;
uniform vec4 rgbMinMaxLnScaleMinMax;

const float LN_SCALE_MIN = -12.0;
const float LN_SCALE_MAX = 9.0;

const uint SPLAT_TEX_WIDTH_BITS = 11u;
const uint SPLAT_TEX_HEIGHT_BITS = 11u;
const uint SPLAT_TEX_DEPTH_BITS = 11u;
const uint SPLAT_TEX_LAYER_BITS = SPLAT_TEX_WIDTH_BITS + SPLAT_TEX_HEIGHT_BITS;

const uint SPLAT_TEX_WIDTH = 1u << SPLAT_TEX_WIDTH_BITS;
const uint SPLAT_TEX_HEIGHT = 1u << SPLAT_TEX_HEIGHT_BITS;
const uint SPLAT_TEX_DEPTH = 1u << SPLAT_TEX_DEPTH_BITS;

const uint SPLAT_TEX_WIDTH_MASK = SPLAT_TEX_WIDTH - 1u;
const uint SPLAT_TEX_HEIGHT_MASK = SPLAT_TEX_HEIGHT - 1u;
const uint SPLAT_TEX_DEPTH_MASK = SPLAT_TEX_DEPTH - 1u;

const uint F16_INF = 0x7c00u;

// Encode a quaternion (vec4) into a 24‐bit uint with folded octahedral mapping.
uint encodeQuatOctXy88R8(vec4 q) {
    // Ensure minimal representation: flip if q.w is negative.
    if (q.w < 0.0) {
        q = -q;
    }
    // Compute rotation angle: θ = 2 * acos(q.w) ∈ [0,π]
    float theta = 2.0 * acos(q.w);
    float halfTheta = theta * 0.5;
    float s = sin(halfTheta);
    // Recover the rotation axis; use a default if nearly zero rotation.
    vec3 axis = (abs(s) < 1e-6) ? vec3(1.0, 0.0, 0.0) : q.xyz / s;
    
    // --- Folded Octahedral Mapping (inline) ---
    // Compute p = (axis.x, axis.y) / (|axis.x|+|axis.y|+|axis.z|)
    float sum = abs(axis.x) + abs(axis.y) + abs(axis.z);
    vec2 p = vec2(axis.x, axis.y) / sum;
    // If axis.z < 0, fold the mapping.
    if (axis.z < 0.0) {
        float oldPx = p.x;
        p.x = (1.0 - abs(p.y)) * (p.x >= 0.0 ? 1.0 : -1.0);
        p.y = (1.0 - abs(oldPx)) * (p.y >= 0.0 ? 1.0 : -1.0);
    }
    // Remap from [-1,1] to [0,1]
    float u_f = p.x * 0.5 + 0.5;
    float v_f = p.y * 0.5 + 0.5;
    // Quantize to 8 bits (0 to 255)
    uint quantU = uint(clamp(round(u_f * 255.0), 0.0, 255.0));
    uint quantV = uint(clamp(round(v_f * 255.0), 0.0, 255.0));
    
    // --- Angle Quantization ---
    // Quantize θ ∈ [0,π] to 8 bits (0 to 255)
    uint angleInt = uint(clamp(round((theta / 3.14159265359) * 255.0), 0.0, 255.0));
    
    // Pack bits: bits [0–7]: quantU, [8–15]: quantV, [16–23]: angleInt.
    return (angleInt << 16u) | (quantV << 8u) | quantU;
}

// Decode a 24‐bit encoded uint into a quaternion (vec4) using the folded octahedral inverse.
vec4 decodeQuatOctXy88R8(uint encoded) {
    // Extract the fields.
    uint quantU = encoded & uint(0xFFu);               // bits 0–7
    uint quantV = (encoded >> 8u) & uint(0xFFu);         // bits 8–15
    uint angleInt = encoded >> 16u;                      // bits 16–23

    // Recover u and v in [0,1], then map to [-1,1].
    float u_f = float(quantU) / 255.0;
    float v_f = float(quantV) / 255.0;
    vec2 f = vec2(u_f * 2.0 - 1.0, v_f * 2.0 - 1.0);

    vec3 axis = vec3(f.xy, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-axis.z, 0.0);
    axis.x += (axis.x >= 0.0) ? -t : t;
    axis.y += (axis.y >= 0.0) ? -t : t;
    axis = normalize(axis);

    // Decode the angle θ ∈ [0,π].
    float theta = (float(angleInt) / 255.0) * 3.14159265359;
    float halfTheta = theta * 0.5;
    float s = sin(halfTheta);
    float w = cos(halfTheta);

    return vec4(axis * s, w);
}

// Pack a Gsplat into a uvec4
uvec4 encodePackedSplat(
    vec3 center, vec3 scales, vec4 quaternion, vec4 rgba, vec4 rgbMinMaxLnScaleMinMax
) {
    float rgbMin = rgbMinMaxLnScaleMinMax.x;
    float rgbMax = rgbMinMaxLnScaleMinMax.y;
    vec3 encRgb = (rgba.rgb - vec3(rgbMin)) / (rgbMax - rgbMin);
    uvec4 uRgba = uvec4(round(clamp(vec4(encRgb, rgba.a) * 255.0, 0.0, 255.0)));

    uint uQuat = encodeQuatOctXy88R8(quaternion);
    uvec3 uQuat3 = uvec3(uQuat & 0xffu, (uQuat >> 8u) & 0xffu, (uQuat >> 16u) & 0xffu);

    // Encode scales in three uint8s, where 0=>0.0 and 1..=255 stores log scale
    float lnScaleMin = rgbMinMaxLnScaleMinMax.z;
    float lnScaleMax = rgbMinMaxLnScaleMinMax.w;
    float lnScaleScale = 254.0 / (lnScaleMax - lnScaleMin);
    uvec3 uScales = uvec3(
        (scales.x == 0.0) ? 0u : uint(round(clamp((log(scales.x) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u,
        (scales.y == 0.0) ? 0u : uint(round(clamp((log(scales.y) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u,
        (scales.z == 0.0) ? 0u : uint(round(clamp((log(scales.z) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u
    );

    // Pack it all into 4 x uint32
    uint word0 = uRgba.r | (uRgba.g << 8u) | (uRgba.b << 16u) | (uRgba.a << 24u);
    uint word1 = packHalf2x16(center.xy);
    uint word2 = packHalf2x16(vec2(center.z, 0.0)) | (uQuat3.x << 16u) | (uQuat3.y << 24u);
    uint word3 = uScales.x | (uScales.y << 8u) | (uScales.z << 16u) | (uQuat3.z << 24u);
    return uvec4(word0, word1, word2, word3);
}

// Pack a Gsplat into a uvec4
uvec4 encodePackedSplatDefault(vec3 center, vec3 scales, vec4 quaternion, vec4 rgba) {
    return encodePackedSplat(center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));
}

void decodePackedSplat(uvec4 packed, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba, vec4 rgbMinMaxLnScaleMinMax) {
    uint word0 = packed.x, word1 = packed.y, word2 = packed.z, word3 = packed.w;

    uvec4 uRgba = uvec4(word0 & 0xffu, (word0 >> 8u) & 0xffu, (word0 >> 16u) & 0xffu, (word0 >> 24u) & 0xffu);
    float rgbMin = rgbMinMaxLnScaleMinMax.x;
    float rgbMax = rgbMinMaxLnScaleMinMax.y;
    rgba = (vec4(uRgba) / 255.0);
    rgba.rgb = rgba.rgb * (rgbMax - rgbMin) + rgbMin;

    center = vec4(
        unpackHalf2x16(word1),
        unpackHalf2x16(word2 & 0xffffu)
    ).xyz;

    uvec3 uScales = uvec3(word3 & 0xffu, (word3 >> 8u) & 0xffu, (word3 >> 16u) & 0xffu);
    float lnScaleMin = rgbMinMaxLnScaleMinMax.z;
    float lnScaleMax = rgbMinMaxLnScaleMinMax.w;
    float lnScaleScale = (lnScaleMax - lnScaleMin) / 254.0;
    scales = vec3(
        (uScales.x == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.x - 1u) * lnScaleScale),
        (uScales.y == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.y - 1u) * lnScaleScale),
        (uScales.z == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.z - 1u) * lnScaleScale)
    );


    uint uQuat = ((word2 >> 16u) & 0xFFFFu) | ((word3 >> 8u) & 0xFF0000u);
    quaternion = decodeQuatOctXy88R8(uQuat);
}

ivec3 splatTexCoord(uint index) {
    uint x = index & SPLAT_TEX_WIDTH_MASK;
    uint y = (index >> SPLAT_TEX_WIDTH_BITS) & SPLAT_TEX_HEIGHT_MASK;
    uint z = index >> SPLAT_TEX_LAYER_BITS;
    return ivec3(x, y, z);
}

// Unpack a Gsplat from a uvec4
void decodePackedSplatDefault(uint splatIndex, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba) {
    ivec3 texCoord = splatTexCoord(splatIndex);
    uvec4 packed = texelFetch(packedSplats, texCoord, 0);
    decodePackedSplat(packed, center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));
}

// Unpack spherical harmonics
#ifdef NUM_SH
vec4 unpackSint8(uint packed) {
    return vec4((ivec4(packed) << ivec4(24u, 16u, 8u, 0u)) >> 24u) / 127.0;
}

void decodePackedSphericalHarmonics(uint splatIndex, out vec3[3] sh1, out vec3[5] sh2, out vec3[7] sh3) {
    ivec3 texCoord = splatTexCoord(splatIndex);
    texCoord.x *= NUM_PACKED_SH;

    uvec4 packedA = texelFetch(packedShTexture, texCoord, 0);
    vec4 a1 = unpackSint8(packedA.x);
    vec4 a2 = unpackSint8(packedA.y);
    vec4 a3 = unpackSint8(packedA.z);
    vec4 a4 = unpackSint8(packedA.w);

    sh1[0] = a1.xyz;
    sh1[1] = vec3(a1.w, a2.xy);
    sh1[2] = vec3(a2.zw, a3.x);

#if NUM_PACKED_SH > 1
    uvec4 packedB = texelFetch(packedShTexture, texCoord + ivec3(1, 0, 0), 0);
    vec4 b1 = unpackSint8(packedB.x);
    vec4 b2 = unpackSint8(packedB.y);
    vec4 b3 = unpackSint8(packedB.z);
    vec4 b4 = unpackSint8(packedB.w);

    sh2[0] = vec3(a3.yzw);
    sh2[1] = vec3(a4.xyz);
    sh2[2] = vec3(a4.w, b1.xy);
    sh2[3] = vec3(b1.zw, b2.x);
    sh2[4] = vec3(b2.yzw);

#if NUM_PACKED_SH > 2
    uvec4 packedC = texelFetch(packedShTexture, texCoord + ivec3(2, 0, 0), 0);
    vec4 c1 = unpackSint8(packedC.x);
    vec4 c2 = unpackSint8(packedC.y);
    vec4 c3 = unpackSint8(packedC.z);
    vec4 c4 = unpackSint8(packedC.w);

    sh3[0] = vec3(b3.xyz);
    sh3[1] = vec3(b3.w, b4.xy);
    sh3[2] = vec3(b4.zw, c1.x);
    sh3[3] = vec3(c1.yzw);
    sh3[4] = vec3(c2.xyz);
    sh3[5] = vec3(c2.w, c3.xy);
    sh3[6] = vec3(c3.zw, c4.x);
#endif
#endif
}
#endif

#endif