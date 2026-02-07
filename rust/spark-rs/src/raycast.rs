use half::f16;

const MIN_OPACITY: f32 = 0.1;

pub fn decode_scale(scale: u8, ln_scale_min: f32, ln_scale_max: f32) -> f32 {
    if scale == 0 {
        0.0
    } else {
        let ln_scale_scale = (ln_scale_max - ln_scale_min) / 254.0;
        (ln_scale_min + (scale - 1) as f32 * ln_scale_scale).exp()
    }
}

pub fn raycast_spheres(
    buffer: &[u32], distances: &mut Vec<f32>, 
    origin: [f32; 3], dir: [f32; 3], near: f32, far: f32,
    ln_scale_min: f32, ln_scale_max: f32,
) {
    let quad_a = vec3_dot(dir, dir);

    for packed in buffer.chunks(4) {
        let opacity = ((packed[0] >> 24) as u8) as f32 / 255.0;
        if opacity < MIN_OPACITY {
            continue;
        }

        let origin = vec3_sub(origin, extract_center(packed));
        let scale = extract_scale(packed, ln_scale_min, ln_scale_max);
        
        // Model the Gsplat as a sphere for faster approximate raycasting
        let radius = (scale[0] + scale[1] + scale[2]) / 3.0;

        let quad_b = vec3_dot(dir, origin);
        let quad_c = vec3_dot(origin, origin) - radius * radius;
        let discriminant = quad_b * quad_b - quad_a * quad_c;
        if discriminant < 0.0 {
            continue;
        }

        let t = (-quad_b - discriminant.sqrt()) / quad_a;
        if t >= near && t <= far {
            distances.push(t);
        }
    }
}

pub fn raycast_ellipsoids(
    buffer: &[u32], distances: &mut Vec<f32>, 
    origin: [f32; 3], dir: [f32; 3], near: f32, far: f32,
    ln_scale_min: f32, ln_scale_max: f32,
) {
    for packed in buffer.chunks(4) {
        let opacity = ((packed[0] >> 24) as u8) as f32 / 255.0;
        if opacity < MIN_OPACITY {
            continue;
        }
    
        let origin = vec3_sub(origin, extract_center(packed));
        let scale = extract_scale(packed, ln_scale_min, ln_scale_max);
        let quat = extract_quat(packed);
        let inv_quat = [-quat[0], -quat[1], -quat[2], quat[3]];

        // Model the Gsplat as an ellipsoid for higher quality raycasting
        let local_origin = quat_vec(inv_quat, origin);
        let local_dir = quat_vec(inv_quat, dir);

        let min_scale = scale[0].max(scale[1]).max(scale[2]) * 0.01;
        let t = if scale[2] < min_scale {
            // Treat it as a flat elliptical disk
            if local_dir[2].abs() < 1e-6 {
                continue;
            }
            let t = -local_origin[2] / local_dir[2];
            let p_x = local_origin[0] + t * local_dir[0];
            let p_y = local_origin[1] + t * local_dir[1];
            if sqr(p_x / scale[0]) + sqr(p_y / scale[1]) > 1.0 {
                continue;
            }
            t
        } else if scale[1] < min_scale {
            // Treat it as a flat elliptical disk
            if local_dir[1].abs() < 1e-6 {
                continue;
            }
            let t = -local_origin[1] / local_dir[1];
            let p_x = local_origin[0] + t * local_dir[0];
            let p_z = local_origin[2] + t * local_dir[2];
            if sqr(p_x / scale[0]) + sqr(p_z / scale[2]) > 1.0 {
                continue;
            }
            t
        } else if scale[0] < min_scale {
            // Treat it as a flat elliptical disk
            if local_dir[0].abs() < 1e-6 {
                continue;
            }
            let t = -local_origin[0] / local_dir[0];
            let p_y = local_origin[1] + t * local_dir[1];
            let p_z = local_origin[2] + t * local_dir[2];
            if sqr(p_y / scale[1]) + sqr(p_z / scale[2]) > 1.0 {
                continue;
            }
            t
        } else {
            let inv_scale = [1.0 / scale[0], 1.0 / scale[1], 1.0 / scale[2]];
            let local_origin = vec3_mul(local_origin, inv_scale);
            let local_dir = vec3_mul(local_dir, inv_scale);

            let a = vec3_dot(local_dir, local_dir);
            let b = vec3_dot(local_origin, local_dir);
            let c = vec3_dot(local_origin, local_origin) - 1.0;
            let discriminant = b * b - a * c;
            if discriminant < 0.0 {
                continue;
            }

            (-b - discriminant.sqrt()) / a
        };
        if t >= near && t <= far {
            distances.push(t);
        }
    }
}

fn extract_center(packed: &[u32]) -> [f32; 3] {
    let x = f16::from_bits(packed[1] as u16).to_f32();
    let y = f16::from_bits((packed[1] >> 16) as u16).to_f32();
    let z = f16::from_bits(packed[2] as u16).to_f32();
    [x, y, z]
}

fn extract_scale(packed: &[u32], ln_scale_min: f32, ln_scale_max: f32) -> [f32; 3] {
    let scale_x = decode_scale(packed[3] as u8, ln_scale_min, ln_scale_max);
    let scale_y = decode_scale((packed[3] >> 8) as u8, ln_scale_min, ln_scale_max);
    let scale_z = decode_scale((packed[3] >> 16) as u8, ln_scale_min, ln_scale_max);
    [scale_x, scale_y, scale_z]
}

fn extract_quat(packed: &[u32]) -> [f32; 4] {
    let quat_x = ((packed[2] >> 16) as i8) as f32 / 127.0;
    let quat_y = ((packed[2] >> 24) as i8) as f32 / 127.0;
    let quat_z = ((packed[3] >> 24) as i8) as f32 / 127.0;
    let quat_w = (1.0 - quat_x * quat_x - quat_y * quat_y - quat_z * quat_z).max(0.0).sqrt();
    [quat_x, quat_y, quat_z, quat_w]
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
