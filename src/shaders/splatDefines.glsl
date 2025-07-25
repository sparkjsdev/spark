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
const float PI = 3.1415926535897932384626433832795;

const float INFINITY = 1.0 / 0.0;
const float NEG_INFINITY = -INFINITY;

float sqr(float x) {
    return x * x;
}

float pow4(float x) {
    float x2 = x * x;
    return x2 * x2;
}

float pow8(float x) {
    float x4 = pow4(x);
    return x4 * x4;
}

vec3 srgbToLinear(vec3 rgb) {
    return pow(rgb, vec3(2.2));
}

vec3 linearToSrgb(vec3 rgb) {
    return pow(rgb, vec3(1.0 / 2.2));
}

// uint encodeQuatXyz888(vec4 q) {
//     // Encode quaternion in three int8s, flipping sign to remove ambiguity
//     vec3 quat3 = (q.w < 0.0) ? -q.xyz : q.xyz;
//     ivec3 iQuat3 = ivec3(round(clamp(quat3 * 127.0, -127.0, 127.0)));
//     uvec3 uQuat3 = uvec3(iQuat3) & 0xffu;
//     return (uQuat3.x << 16u) | (uQuat3.y << 8u) | uQuat3.z;
// }

// vec4 decodeQuatXyz888(uint encoded) {
//     ivec3 iQuat3 = ivec3(
//         int(encoded << 24u) >> 24,
//         int(encoded << 16u) >> 24,
//         int(encoded << 8u) >> 24
//     );
//     vec4 quat = vec4(vec3(iQuat3) / 127.0, 0.0);
//     quat.w = sqrt(max(0.0, 1.0 - dot(quat.xyz, quat.xyz)));
//     return quat;
// }

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

// // Encode a quaternion (vec4) into a 24‐bit uint by converting it to Euler angles.
// // We assume the quaternion is normalized.
// // Euler angles (roll, pitch, yaw) are assumed in radians in the range [-PI, PI].
// // Each angle is normalized: value = (angle + PI) / (2*PI) and quantized to 8 bits.
// uint encodeQuatEulerXyz888(vec4 q) {
//     // Compute roll (x), pitch (y) and yaw (z) using Tait–Bryan angles.
//     float sinr_cosp = 2.0 * (q.w * q.x + q.y * q.z);
//     float cosr_cosp = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);
//     float roll = atan(sinr_cosp, cosr_cosp);
    
//     float sinp = 2.0 * (q.w * q.y - q.z * q.x);
//     float pitch = abs(sinp) >= 1.0 ? (sign(sinp) * 1.57079632679) : asin(sinp);
    
//     float siny_cosp = 2.0 * (q.w * q.z + q.x * q.y);
//     float cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
//     float yaw = atan(siny_cosp, cosy_cosp);
    
//     // Normalize each angle from [-PI, PI] to [0, 1]
//     float normRoll  = (roll  + 3.14159265359) / (2.0 * 3.14159265359);
//     float normPitch = (pitch + 3.14159265359) / (2.0 * 3.14159265359);
//     float normYaw   = (yaw   + 3.14159265359) / (2.0 * 3.14159265359);
    
//     // Quantize each normalized angle to 8 bits (0..255)
//     uint rollQ  = uint(round(normRoll  * 255.0));
//     uint pitchQ = uint(round(normPitch * 255.0));
//     uint yawQ   = uint(round(normYaw   * 255.0));
    
//     // Pack into a 24-bit uint:
//     //   Bits 0..7   : rollQ,
//     //   Bits 8..15  : pitchQ,
//     //   Bits 16..23 : yawQ.
//     return (yawQ << 16u) | (pitchQ << 8u) | rollQ;
// }

// // Decode a 24‐bit uint into a quaternion (vec4) by unpacking 8‐bit quantized Euler angles.
// // The Euler angles are assumed to be stored in the order: roll, pitch, yaw (each in [0,255]) corresponding to [-PI, PI].
// // Convert the Euler angles to a quaternion using the Tait–Bryan (roll, pitch, yaw) formula.
// vec4 decodeQuatEulerXyz888(uint encoded) {
//     // Unpack each 8-bit field.
//     uint rollQ  = encoded & 0xFFu;
//     uint pitchQ = (encoded >> 8u)  & 0xFFu;
//     uint yawQ   = (encoded >> 16u) & 0xFFu;
    
//     // Convert back to the [0,1] range.
//     float normRoll  = float(rollQ)  / 255.0;
//     float normPitch = float(pitchQ) / 255.0;
//     float normYaw   = float(yawQ)   / 255.0;
    
//     // Map from [0,1] back to [-PI, PI].
//     float roll  = normRoll  * (2.0 * 3.14159265359) - 3.14159265359;
//     float pitch = normPitch * (2.0 * 3.14159265359) - 3.14159265359;
//     float yaw   = normYaw   * (2.0 * 3.14159265359) - 3.14159265359;
    
//     // Convert Euler angles (roll, pitch, yaw) to quaternion.
//     float cr = cos(roll * 0.5);
//     float sr = sin(roll * 0.5);
//     float cp = cos(pitch * 0.5);
//     float sp = sin(pitch * 0.5);
//     float cy = cos(yaw * 0.5);
//     float sy = sin(yaw * 0.5);
    
//     // Tait-Bryan (roll, pitch, yaw) to quaternion conversion.
//     vec4 q;
//     q.w = cr * cp * cy + sr * sp * sy;
//     q.x = sr * cp * cy - cr * sp * sy;
//     q.y = cr * sp * cy + sr * cp * sy;
//     q.z = cr * cp * sy - sr * sp * cy;
    
//     return q;
// }

// Pack a Gsplat into a uvec4
uvec4 packSplatEncoding(
    vec3 center, vec3 scales, vec4 quaternion, vec4 rgba, vec4 rgbMinMaxLnScaleMinMax
) {
    float rgbMin = rgbMinMaxLnScaleMinMax.x;
    float rgbMax = rgbMinMaxLnScaleMinMax.y;
    vec3 encRgb = (rgba.rgb - vec3(rgbMin)) / (rgbMax - rgbMin);
    uvec4 uRgba = uvec4(round(clamp(vec4(encRgb, rgba.a) * 255.0, 0.0, 255.0)));

    uint uQuat = encodeQuatOctXy88R8(quaternion);
    // uint uQuat = encodeQuatXyz888(quaternion);
    // uint uQuat = encodeQuatEulerXyz888(quaternion);
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
uvec4 packSplat(vec3 center, vec3 scales, vec4 quaternion, vec4 rgba) {
    return packSplatEncoding(center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));
}

void unpackSplatEncoding(uvec4 packed, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba, vec4 rgbMinMaxLnScaleMinMax) {
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
    // quaternion = decodeQuatXyz888(uQuat);
    // quaternion = decodeQuatEulerXyz888(uQuat);
}

// Unpack a Gsplat from a uvec4
void unpackSplat(uvec4 packed, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba) {
    unpackSplatEncoding(packed, center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));
}

// Rotate vector v by quaternion q
vec3 quatVec(vec4 q, vec3 v) {
    // Rotate vector v by quaternion q
    vec3 t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

// Apply quaternion q1 after quaternion q2
vec4 quatQuat(vec4 q1, vec4 q2) {
    return vec4(
        q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
        q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
        q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
        q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
    );
}

mat3 scaleQuaternionToMatrix(vec3 s, vec4 q) {
    // Compute the matrix of scaling by s then rotating by q
    return mat3(
        s.x * (1.0 - 2.0 * (q.y * q.y + q.z * q.z)),
        s.x * (2.0 * (q.x * q.y + q.w * q.z)),
        s.x * (2.0 * (q.x * q.z - q.w * q.y)),
        s.y * (2.0 * (q.x * q.y - q.w * q.z)),
        s.y * (1.0 - 2.0 * (q.x * q.x + q.z * q.z)),
        s.y * (2.0 * (q.y * q.z + q.w * q.x)),
        s.z * (2.0 * (q.x * q.z + q.w * q.y)),
        s.z * (2.0 * (q.y * q.z - q.w * q.x)),
        s.z * (1.0 - 2.0 * (q.x * q.x + q.y * q.y))
    );
}

// Spherical lerp between two quaternions
vec4 slerp(vec4 q1, vec4 q2, float t) {
    // Compute the cosine of the angle between the two vectors
    float cosHalfTheta = dot(q1, q2);

    // If q1=q2 or q1=-q2 then theta = 0 and we can return q1
    if (abs(cosHalfTheta) >= 0.999) {
        return q1;
    }
    
    // If q1 and q2 are more than 180 degrees apart, 
    // we need to negate one to get the shortest path
    if (cosHalfTheta < 0.0) {
        q2 = -q2;
        cosHalfTheta = -cosHalfTheta;
    }

    // Calculate temporary values
    float halfTheta = acos(cosHalfTheta);
    float sinHalfTheta = sqrt(1.0 - cosHalfTheta * cosHalfTheta);

    // Calculate the interpolation factors
    float ratioA = sin((1.0 - t) * halfTheta) / sinHalfTheta;
    float ratioB = sin(t * halfTheta) / sinHalfTheta;

    // Calculate the interpolated quaternion
    return q1 * ratioA + q2 * ratioB;
}

ivec3 splatTexCoord(int index) {
    uint x = uint(index) & SPLAT_TEX_WIDTH_MASK;
    uint y = (uint(index) >> SPLAT_TEX_WIDTH_BITS) & SPLAT_TEX_HEIGHT_MASK;
    uint z = uint(index) >> SPLAT_TEX_LAYER_BITS;
    return ivec3(x, y, z);
}
