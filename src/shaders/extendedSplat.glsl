#ifdef USE_EXTENDED_SPLAT

uniform usampler2DArray splatTexture1;
uniform usampler2DArray splatTexture2;
uniform usampler2DArray shTexture;

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


void decodeExtendedSplat(uvec4 packed1, uvec4 packed2, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba) {
    center = uintBitsToFloat(packed1.xyz);

    scales = vec3((uvec3(packed1.w) >> uvec3(0u, 10u, 20u)) & 1023u);
    float lnScaleScale = (LN_SCALE_MAX - LN_SCALE_MIN) / 1023.0;
    scales = exp(LN_SCALE_MIN + scales * lnScaleScale);

    quaternion = decodeQuatOctXy88R8(packed2.x);

    rgba = vec4((uvec4(packed2.y) >> uvec4(0u, 8u, 16u, 24u)) & 255u) / 255.0;
}

ivec3 splatTexCoord(uint index) {
    uint x = index & SPLAT_TEX_WIDTH_MASK;
    uint y = (index >> SPLAT_TEX_WIDTH_BITS) & SPLAT_TEX_HEIGHT_MASK;
    uint z = index >> SPLAT_TEX_LAYER_BITS;
    return ivec3(x, y, z);
}

// Unpack a Gsplat from a uvec4
void decodeExtendedSplatDefault(uint splatIndex, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba) {
    ivec3 texCoord = splatTexCoord(splatIndex);
    uvec4 packed1 = texelFetch(splatTexture1, texCoord, 0);
    uvec4 packed2 = texelFetch(splatTexture2, texCoord, 0);
    decodeExtendedSplat(packed1, packed2, center, scales, quaternion, rgba);
}

#ifdef NUM_SH
vec4 unpackSint8(uint packed) {
    return vec4((ivec4(packed) << ivec4(24u, 16u, 8u, 0u)) >> 24u) / 127.0;
}

void decodePackedSphericalHarmonics(uint splatIndex, out vec3[3] sh1, out vec3[5] sh2, out vec3[7] sh3) {
    ivec3 texCoord = splatTexCoord(splatIndex);
    texCoord.x *= NUM_PACKED_SH;

    uvec4 packedA = texelFetch(shTexture, texCoord, 0);
    vec4 a1 = unpackSint8(packedA.x);
    vec4 a2 = unpackSint8(packedA.y);
    vec4 a3 = unpackSint8(packedA.z);
    vec4 a4 = unpackSint8(packedA.w);

    sh1[0] = a1.xyz;
    sh1[1] = vec3(a1.w, a2.xy);
    sh1[2] = vec3(a2.zw, a3.x);

#if NUM_PACKED_SH > 1
    uvec4 packedB = texelFetch(shTexture, texCoord + ivec3(1, 0, 0), 0);
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
    uvec4 packedC = texelFetch(shTexture, texCoord + ivec3(2, 0, 0), 0);
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