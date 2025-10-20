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

mat3 quaternionToMatrix(vec4 q) {
    return mat3(
        (1.0 - 2.0 * (q.y * q.y + q.z * q.z)),
        (2.0 * (q.x * q.y + q.w * q.z)),
        (2.0 * (q.x * q.z - q.w * q.y)),
        (2.0 * (q.x * q.y - q.w * q.z)),
        (1.0 - 2.0 * (q.x * q.x + q.z * q.z)),
        (2.0 * (q.y * q.z + q.w * q.x)),
        (2.0 * (q.x * q.z + q.w * q.y)),
        (2.0 * (q.y * q.z - q.w * q.x)),
        (1.0 - 2.0 * (q.x * q.x + q.y * q.y))
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

#ifdef NUM_SH
vec3 evaluateSH(vec3 viewDir, vec3 sh1[3], vec3 sh2[5], vec3 sh3[7]) {
    vec3 sh1Rgb = sh1[0] * (-0.4886025 * viewDir.y)
      + sh1[1] * (0.4886025 * viewDir.z)
      + sh1[2] * (-0.4886025 * viewDir.x);

#if NUM_SH == 1
    return sh1Rgb;
#else

    float xx = viewDir.x * viewDir.x;
    float yy = viewDir.y * viewDir.y;
    float zz = viewDir.z * viewDir.z;
    float xy = viewDir.x * viewDir.y;
    float yz = viewDir.y * viewDir.z;
    float zx = viewDir.z * viewDir.x;

    vec3 sh2Rgb = sh2[0] * (1.0925484 * xy)
      + sh2[1] * (-1.0925484 * yz)
      + sh2[2] * (0.3153915 * (2.0 * zz - xx - yy))
      + sh2[3] * (-1.0925484 * zx)
      + sh2[4] * (0.5462742 * (xx - yy));

#if NUM_SH == 2
    return sh1Rgb + sh2Rgb;
#else
    vec3 sh3Rgb = sh3[0] * (-0.5900436 * viewDir.y * (3.0 * xx - yy))
      + sh3[1] * (2.8906114 * xy * viewDir.z) +
      + sh3[2] * (-0.4570458 * viewDir.y * (4.0 * zz - xx - yy))
      + sh3[3] * (0.3731763 * viewDir.z * (2.0 * zz - 3.0 * xx - 3.0 * yy))
      + sh3[4] * (-0.4570458 * viewDir.x * (4.0 * zz - xx - yy))
      + sh3[5] * (1.4453057 * viewDir.z * (xx - yy))
      + sh3[6] * (-0.5900436 * viewDir.x * (xx - 3.0 * yy));

    return sh1Rgb + sh2Rgb + sh3Rgb;
#endif
#endif
}
#endif