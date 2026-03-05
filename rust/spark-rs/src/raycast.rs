use spark_lib::{
    decoder::SplatEncoding,
    splat_encode::{decode_ext_splat_center, decode_ext_splat_opacity, decode_ext_splat_quat, decode_ext_splat_scale, decode_packed_splat_center, decode_packed_splat_opacity, decode_packed_splat_quat, decode_packed_splat_scale},
};

pub fn raycast_packed_ellipsoids(
    buffer: &[u32], distances: &mut Vec<f32>, 
    origin: [f32; 3], dir: [f32; 3], min_opacity: f32, near: f32, far: f32,
    encoding: &SplatEncoding,
) {
    for packed in buffer.chunks(4) {
        let opacity = decode_packed_splat_opacity(packed, encoding);
        if opacity < min_opacity {
            continue;
        }
    
        let center = decode_packed_splat_center(packed);
        let scale = decode_packed_splat_scale(packed, encoding);
        let quat = decode_packed_splat_quat(packed);
        if let Some(t) = raycast_ellipsoid(origin, dir, opacity, center, scale, quat) {
            if t >= near && t <= far {
                distances.push(t);
            }
        }
    }
}

pub fn raycast_ext_ellipsoids(
    buffer: &[u32], buffer2: &[u32], distances: &mut Vec<f32>, 
    origin: [f32; 3], dir: [f32; 3], min_opacity: f32, near: f32, far: f32,
) {
    assert_eq!(buffer.len(), buffer2.len());
    for (ext_a, ext_b) in buffer.chunks(4).zip(buffer2.chunks(4)) {
        let opacity = decode_ext_splat_opacity(ext_a);
        if opacity < min_opacity {
            continue;
        }
    
        let center = decode_ext_splat_center(ext_a);
        let scale = decode_ext_splat_scale(ext_b);
        let quat = decode_ext_splat_quat(ext_b);
        if let Some(t) = raycast_ellipsoid(origin, dir, opacity, center, scale, quat) {
            if t >= near && t <= far {
                distances.push(t);
            }
        }
    }
}

fn raycast_ellipsoid(
    origin: [f32; 3], dir: [f32; 3],
    opacity: f32, center: [f32; 3], scale: [f32; 3], quat: [f32; 4],
) -> Option<f32> {
    let origin = vec3_sub(origin, center);
    let inv_quat = [-quat[0], -quat[1], -quat[2], quat[3]];

    // Model the Gsplat as an ellipsoid for higher quality raycasting
    let local_origin = quat_vec(inv_quat, origin);
    let local_dir = quat_vec(inv_quat, dir);

    let rescale = opacity.max(1.0) * 4.0 - 3.0;
    let scale = scale.map(|s| s * rescale);

    let min_scale = scale[0].max(scale[1]).max(scale[2]) * 0.01;
    if scale[2] < min_scale {
        // Treat it as a flat elliptical disk
        if local_dir[2].abs() < 1e-6 {
            return None;
        }
        let t = -local_origin[2] / local_dir[2];
        let p_x = local_origin[0] + t * local_dir[0];
        let p_y = local_origin[1] + t * local_dir[1];
        if sqr(p_x / scale[0]) + sqr(p_y / scale[1]) > 1.0 {
            return None;
        }
        Some(t)
    } else if scale[1] < min_scale {
        // Treat it as a flat elliptical disk
        if local_dir[1].abs() < 1e-6 {
            return None;
        }
        let t = -local_origin[1] / local_dir[1];
        let p_x = local_origin[0] + t * local_dir[0];
        let p_z = local_origin[2] + t * local_dir[2];
        if sqr(p_x / scale[0]) + sqr(p_z / scale[2]) > 1.0 {
            return None;
        }
        Some(t)
    } else if scale[0] < min_scale {
        // Treat it as a flat elliptical disk
        if local_dir[0].abs() < 1e-6 {
            return None;
        }
        let t = -local_origin[0] / local_dir[0];
        let p_y = local_origin[1] + t * local_dir[1];
        let p_z = local_origin[2] + t * local_dir[2];
        if sqr(p_y / scale[1]) + sqr(p_z / scale[2]) > 1.0 {
            return None;
        }
        Some(t)
    } else {
        let inv_scale = [1.0 / scale[0], 1.0 / scale[1], 1.0 / scale[2]];
        let local_origin = vec3_mul(local_origin, inv_scale);
        let local_dir = vec3_mul(local_dir, inv_scale);

        let a = vec3_dot(local_dir, local_dir);
        let b = vec3_dot(local_origin, local_dir);
        let c = vec3_dot(local_origin, local_origin) - 1.0;
        let discriminant = b * b - a * c;
        if discriminant < 0.0 {
            return None;
        }

        let t = (-b - discriminant.sqrt()) / a;
        Some(t)
    }
}

fn sqr(x: f32) -> f32 {
    x * x
}

fn vec3_sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn vec3_mul(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

fn vec3_dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn vec3_cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn quat_vec(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let q_vec = [q[0], q[1], q[2]];
    let uv = vec3_cross(q_vec, v);
    let uuv = vec3_cross(q_vec, uv);
    [
        v[0] + 2.0 * (q[3] * uv[0] + uuv[0]),
        v[1] + 2.0 * (q[3] * uv[1] + uuv[1]),
        v[2] + 2.0 * (q[3] * uv[2] + uuv[2]),
    ]
}
