use spark_lib::{
    decoder::SplatEncoding,
    splat_encode::{decode_ext_splat_center, decode_ext_splat_opacity, decode_ext_splat_quat, decode_ext_splat_scale, decode_packed_splat_center, decode_packed_splat_opacity, decode_packed_splat_quat, decode_packed_splat_scale},
};

pub fn raycast_packed_ellipsoids(
    buffer: &[u32], distances: &mut Vec<f32>, 
    origin: [f32; 3], dir: [f32; 3], min_opacity: f32, near: f32, far: f32,
    encoding: &SplatEncoding, edits: Option<&RaycastEdits>,
) {
    for packed in buffer.chunks(4) {
        let mut opacity = decode_packed_splat_opacity(packed, encoding);
        if edits.is_none() && opacity < min_opacity {
            continue;
        }

        let mut center = decode_packed_splat_center(packed);
        if let Some(edits) = edits {
            (center, opacity) = edits.apply(center, opacity);
            if opacity < min_opacity {
                continue;
            }
        }
    
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
    edits: Option<&RaycastEdits>,
) {
    assert_eq!(buffer.len(), buffer2.len());
    for (ext_a, ext_b) in buffer.chunks(4).zip(buffer2.chunks(4)) {
        let mut opacity = decode_ext_splat_opacity(ext_a);
        if edits.is_none() && opacity < min_opacity {
            continue;
        }

        let mut center = decode_ext_splat_center(ext_a);
        if let Some(edits) = edits {
            (center, opacity) = edits.apply(center, opacity);
            if opacity < min_opacity {
                continue;
            }
        }
    
        let scale = decode_ext_splat_scale(ext_b);
        let quat = decode_ext_splat_quat(ext_b);
        if let Some(t) = raycast_ellipsoid(origin, dir, opacity, center, scale, quat) {
            if t >= near && t <= far {
                distances.push(t);
            }
        }
    }
}

// CPU port of the SplatEdit RGBA-XYZ pass (defineSdfArray / defineEdit in
// SplatEdit.ts), so raycasts skip splats that edits make transparent and hit
// displaced splats where they are rendered. Only opacity and displacement are
// evaluated, as RGB does not affect raycasting. Keep in sync with the GLSL.
pub struct RaycastEdits<'a> {
    // Column-major 4x4 matrices, as in THREE.Matrix4.elements
    pub object_to_world: [f32; 16],
    pub world_to_object: [f32; 16],
    // SplatEdits.editData: 4 x u32 per edit
    pub edits: &'a [u32],
    // SplatEdits.sdfData: 8 x uvec4 per SDF
    pub sdfs: &'a [u32],
}

const SDF_STRIDE: usize = 32;
const SDF_FLAG_TYPE: u32 = 0xFF;
const SDF_FLAG_INVERT: u32 = 1 << 8;
const SDF_TYPE_ALL: u32 = 0;
const SDF_TYPE_PLANE: u32 = 1;
const SDF_TYPE_SPHERE: u32 = 2;
const SDF_TYPE_BOX: u32 = 3;
const SDF_TYPE_ELLIPSOID: u32 = 4;
const SDF_TYPE_CYLINDER: u32 = 5;
const SDF_TYPE_CAPSULE: u32 = 6;
const SDF_TYPE_INFINITE_CONE: u32 = 7;

const EDIT_FLAG_BLEND: u32 = 0xFF;
const EDIT_FLAG_INVERT: u32 = 0x100;
const EDIT_BLEND_MULTIPLY: u32 = 0;
const EDIT_BLEND_SET_RGB: u32 = 1;
const EDIT_BLEND_ADD_RGBA: u32 = 2;

impl RaycastEdits<'_> {
    // Returns the edited object-space center and opacity of a splat.
    pub fn apply(&self, center: [f32; 3], opacity: f32) -> ([f32; 3], f32) {
        let num_sdfs = self.sdfs.len() / SDF_STRIDE;
        let mut pos = mat4_point(&self.object_to_world, center);
        let mut alpha = opacity;
        for edit in self.edits.chunks_exact(4) {
            let blend_mode = edit[0] & EDIT_FLAG_BLEND;
            let invert = (edit[0] & EDIT_FLAG_INVERT) != 0;
            let sdf_first = (edit[1] & 0xFFFF) as usize;
            let sdf_count = (edit[1] >> 16) as usize;
            let soft_edge = f32::from_bits(edit[2]);
            let sdf_smooth = f32::from_bits(edit[3]);

            let sdf_last = (sdf_first + sdf_count).min(num_sdfs);
            let (mut distance, sdf_alpha, displace) =
                self.evaluate_sdfs(sdf_first, sdf_last, pos, sdf_smooth);
            if invert {
                distance = -distance;
            }
            let modulate = if soft_edge == 0.0 {
                if distance < 0.0 { 1.0 } else { 0.0 }
            } else {
                (-distance / soft_edge + 0.5).clamp(0.0, 1.0)
            };

            let target = match blend_mode {
                EDIT_BLEND_MULTIPLY | EDIT_BLEND_SET_RGB => alpha * sdf_alpha,
                EDIT_BLEND_ADD_RGBA => alpha + sdf_alpha,
                _ => 1.0,
            };
            alpha += (target - alpha) * modulate;
            for d in 0..3 {
                pos[d] += displace[d] * modulate;
            }
        }
        (mat4_point(&self.world_to_object, pos), alpha)
    }

    // Port of evaluateSdfArray with numValues = 2: returns the blended
    // distance, alpha (values[0].w) and displacement (values[1].xyz).
    fn evaluate_sdfs(
        &self, sdf_first: usize, sdf_last: usize, pos: [f32; 3], smooth_k: f32,
    ) -> (f32, f32, [f32; 3]) {
        let mut distance_accum = if smooth_k == 0.0 { f32::INFINITY } else { 0.0 };
        let mut max_exp = f32::NEG_INFINITY;
        let mut out_alpha = 0.0;
        let mut out_displace = [0.0; 3];

        for index in sdf_first..sdf_last {
            let sdf = &self.sdfs[index * SDF_STRIDE..(index + 1) * SDF_STRIDE];
            let f = |i: usize| f32::from_bits(sdf[i]);
            let flags = sdf[3];
            let center = [f(0), f(1), f(2)];
            let quaternion = [f(4), f(5), f(6), f(7)];
            let scale = [f(8), f(9), f(10)];
            let sizes = [f(12), f(13), f(14), f(15)];
            let alpha = f(19);
            let displace = [f(20), f(21), f(22)];

            let p = vec3_add(quat_vec(quaternion, vec3_mul(pos, scale)), center);
            let mut distance = sdf_distance(flags & SDF_FLAG_TYPE, p, sizes);
            if (flags & SDF_FLAG_INVERT) != 0 {
                distance = -distance;
            }

            if smooth_k == 0.0 {
                if distance < distance_accum {
                    distance_accum = distance;
                    out_alpha = alpha;
                    out_displace = displace;
                }
            } else {
                let scaled_distance = -distance / smooth_k;
                if scaled_distance > max_exp {
                    let scale = (max_exp - scaled_distance).exp();
                    distance_accum *= scale;
                    out_alpha *= scale;
                    out_displace = out_displace.map(|d| d * scale);
                    max_exp = scaled_distance;
                }
                let weight = (scaled_distance - max_exp).exp();
                distance_accum += weight;
                out_alpha += weight * alpha;
                for d in 0..3 {
                    out_displace[d] += weight * displace[d];
                }
            }
        }

        if smooth_k == 0.0 {
            (distance_accum, out_alpha, out_displace)
        } else if distance_accum == 0.0 {
            // Very distant SDFs may result in 0 accumulation
            (f32::INFINITY, out_alpha, out_displace)
        } else {
            out_alpha /= distance_accum;
            out_displace = out_displace.map(|d| d / distance_accum);
            ((-distance_accum.ln() - max_exp) * smooth_k, out_alpha, out_displace)
        }
    }
}

fn sdf_distance(sdf_type: u32, p: [f32; 3], sizes: [f32; 4]) -> f32 {
    match sdf_type {
        SDF_TYPE_ALL => f32::NEG_INFINITY,
        SDF_TYPE_PLANE => p[2],
        SDF_TYPE_SPHERE => vec3_length(p) - sizes[3],
        SDF_TYPE_BOX => {
            let q = [0, 1, 2].map(|d| p[d].abs() - sizes[d] + sizes[3]);
            vec3_length(q.map(|v| v.max(0.0))) + q[0].max(q[1]).max(q[2]).min(0.0)
                - sizes[3]
        }
        SDF_TYPE_ELLIPSOID => {
            let s = [sizes[0], sizes[1], sizes[2]];
            let k0 = vec3_length([p[0] / s[0], p[1] / s[1], p[2] / s[2]]);
            let k1 = vec3_length(p.map(|v| v / vec3_dot(s, s)));
            k0 * (k0 - 1.0) / k1
        }
        SDF_TYPE_CYLINDER => {
            let d = [
                (p[0] * p[0] + p[2] * p[2]).sqrt() - sizes[3],
                p[1].abs() - sizes[1],
            ];
            d[0].max(d[1]).min(0.0) + (sqr(d[0].max(0.0)) + sqr(d[1].max(0.0))).sqrt()
        }
        SDF_TYPE_CAPSULE => {
            let half = 0.5 * sizes[1];
            let p = [p[0], p[1] - p[1].clamp(-half, half), p[2]];
            vec3_length(p) - sizes[3]
        }
        SDF_TYPE_INFINITE_CONE => {
            let angle = 0.25 * std::f32::consts::PI * sizes[3];
            let c = [angle.sin(), angle.cos()];
            let q = [(p[0] * p[0] + p[1] * p[1]).sqrt(), -p[2]];
            let k = (q[0] * c[0] + q[1] * c[1]).max(0.0);
            let d = (sqr(q[0] - c[0] * k) + sqr(q[1] - c[1] * k)).sqrt();
            if q[0] * c[1] - q[1] * c[0] < 0.0 { -d } else { d }
        }
        // Unknown types are undefined in GLSL; treat them as outside.
        _ => f32::INFINITY,
    }
}

fn mat4_point(m: &[f32; 16], v: [f32; 3]) -> [f32; 3] {
    [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    ]
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
        // Lagrange identity: b*b - a*c cancels catastrophically when |o| >> 1
        // (small splats seen from far away); a - |o x d|^2 is equivalent and stable.
        let cross = vec3_cross(local_origin, local_dir);
        let discriminant = a - vec3_dot(cross, cross);
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

fn vec3_add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
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

fn vec3_length(a: [f32; 3]) -> f32 {
    vec3_dot(a, a).sqrt()
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

#[cfg(test)]
mod tests {
    use super::*;

    // A tiny splat far from the ray origin: |local_origin| >> 1 in the unit-sphere
    // frame, so b*b - a*c cancels to noise in f32 even though the ray is aimed
    // exactly at the splat center. Fails with the old b*b - a*c discriminant,
    // passes with the Lagrange-identity version (a - |o x d|^2).
    #[test]
    fn raycast_hits_tiny_distant_splat_aimed_at_center() {
        let center = [1000.0_f32, 0.0, 1000.0];
        let dist = (center[0] * center[0] + center[2] * center[2]).sqrt();
        let dir = [center[0] / dist, 0.0, center[2] / dist];
        let origin = [0.0_f32, 0.0, 0.0];
        let scale = [0.005_f32, 0.005, 0.005];
        let quat = [0.0_f32, 0.0, 0.0, 1.0]; // identity rotation
        let opacity = 1.0_f32;

        let hit = raycast_ellipsoid(origin, dir, opacity, center, scale, quat);
        assert!(hit.is_some(), "expected a hit on a tiny distant splat aimed at its center");

        let t = hit.unwrap();
        let expected = dist - scale[0]; // near-surface hit, one radius short of the center
        assert!((t - expected).abs() < 0.01, "t={t} expected~{expected}");
    }

    const IDENTITY: [f32; 16] = [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];

    // Encodes an axis-aligned SDF at world `position` as SplatEdits.encodeSdf does.
    fn sdf(
        sdf_type: u32, invert: bool, position: [f32; 3], sizes: [f32; 4],
        opacity: f32, displace: [f32; 3],
    ) -> [u32; SDF_STRIDE] {
        let mut data = [0u32; SDF_STRIDE];
        let mut set = |i: usize, v: f32| data[i] = v.to_bits();
        // worldToSdf for a translation is the negated translation
        set(0, -position[0]);
        set(1, -position[1]);
        set(2, -position[2]);
        set(7, 1.0);
        set(8, 1.0);
        set(9, 1.0);
        set(10, 1.0);
        for (i, v) in sizes.into_iter().enumerate() {
            set(12 + i, v);
        }
        set(16, 1.0);
        set(17, 1.0);
        set(18, 1.0);
        set(19, opacity);
        for (i, v) in displace.into_iter().enumerate() {
            set(20 + i, v);
        }
        set(23, 1.0);
        data[3] = sdf_type | if invert { SDF_FLAG_INVERT } else { 0 };
        data
    }

    fn edit(blend_mode: u32, sdf_first: u32, sdf_count: u32, soft_edge: f32, sdf_smooth: f32) -> [u32; 4] {
        [blend_mode, sdf_first | (sdf_count << 16), soft_edge.to_bits(), sdf_smooth.to_bits()]
    }

    fn edits<'a>(edits: &'a [u32], sdfs: &'a [u32]) -> RaycastEdits<'a> {
        RaycastEdits { object_to_world: IDENTITY, world_to_object: IDENTITY, edits, sdfs }
    }

    // A crop box: hide everything outside a unit box at the origin.
    fn crop_box() -> ([u32; 4], [u32; SDF_STRIDE]) {
        (
            edit(EDIT_BLEND_MULTIPLY, 0, 1, 0.0, 0.0),
            sdf(SDF_TYPE_BOX, true, [0.0; 3], [1.0, 1.0, 1.0, 0.0], 0.0, [0.0; 3]),
        )
    }

    #[test]
    fn crop_box_hides_splats_outside_only() {
        let (edit, sdf) = crop_box();
        let edits = edits(&edit, &sdf);
        assert_eq!(edits.apply([0.5, 0.0, 0.0], 0.8), ([0.5, 0.0, 0.0], 0.8));
        assert_eq!(edits.apply([2.0, 0.0, 0.0], 0.8).1, 0.0);
    }

    #[test]
    fn soft_edge_fades_opacity_across_the_surface() {
        let edit = edit(EDIT_BLEND_MULTIPLY, 0, 1, 1.0, 0.0);
        let sdf = sdf(SDF_TYPE_SPHERE, false, [0.0; 3], [0.0, 0.0, 0.0, 1.0], 0.0, [0.0; 3]);
        let edits = edits(&edit, &sdf);
        // modulate = clamp(-distance / softEdge + 0.5): 0.5 on the surface
        assert!((edits.apply([1.0, 0.0, 0.0], 1.0).1 - 0.5).abs() < 1e-6);
        assert_eq!(edits.apply([0.0, 0.0, 0.0], 1.0).1, 0.0);
        assert_eq!(edits.apply([2.0, 0.0, 0.0], 1.0).1, 1.0);
    }

    #[test]
    fn smooth_blend_of_identical_sdfs_matches_single_sdf() {
        let single = sdf(SDF_TYPE_SPHERE, false, [0.0; 3], [0.0, 0.0, 0.0, 1.0], 0.25, [0.0; 3]);
        let pair = [single, single].concat();
        let edit = edit(EDIT_BLEND_MULTIPLY, 0, 2, 0.0, 0.1);
        let edits = edits(&edit, &pair);
        assert!((edits.apply([0.5, 0.0, 0.0], 1.0).1 - 0.25).abs() < 1e-6);
        assert_eq!(edits.apply([1.5, 0.0, 0.0], 1.0).1, 1.0);
    }

    #[test]
    fn displacement_moves_center_in_object_space() {
        let edit = edit(EDIT_BLEND_MULTIPLY, 0, 1, 0.0, 0.0);
        let sdf = sdf(SDF_TYPE_ALL, false, [0.0; 3], [0.0; 4], 1.0, [0.0, 1.0, 0.0]);
        // object_to_world scales by 2, so a world offset of 1 is 0.5 in object space
        let mut object_to_world = IDENTITY;
        let mut world_to_object = IDENTITY;
        for i in [0, 5, 10] {
            object_to_world[i] = 2.0;
            world_to_object[i] = 0.5;
        }
        let edits = RaycastEdits { object_to_world, world_to_object, edits: &edit, sdfs: &sdf };
        assert_eq!(edits.apply([1.0, 0.0, 0.0], 0.5), ([1.0, 0.5, 0.0], 0.5));
    }

    #[test]
    fn raycast_skips_splats_hidden_by_edits() {
        let encoding = SplatEncoding::default();
        let scale = [0.1, 0.1, 0.1];
        let quat = [0.0, 0.0, 0.0, 1.0];
        let mut buffer = [0u32; 8];
        // Outside the crop box, in front of the splat inside it
        spark_lib::splat_encode::encode_packed_splat(&mut buffer[0..4], [0.0, 0.0, 5.0], 1.0, [1.0; 3], scale, quat, &encoding);
        spark_lib::splat_encode::encode_packed_splat(&mut buffer[4..8], [0.0, 0.0, 0.0], 1.0, [1.0; 3], scale, quat, &encoding);
        let origin = [0.0, 0.0, 10.0];
        let dir = [0.0, 0.0, -1.0];

        let mut distances = Vec::new();
        raycast_packed_ellipsoids(&buffer, &mut distances, origin, dir, 0.2, 0.0, 100.0, &encoding, None);
        assert_eq!(distances.len(), 2);

        let (edit, sdf) = crop_box();
        distances.clear();
        raycast_packed_ellipsoids(&buffer, &mut distances, origin, dir, 0.2, 0.0, 100.0, &encoding, Some(&edits(&edit, &sdf)));
        assert_eq!(distances.len(), 1);
        assert!((distances[0] - 9.9).abs() < 0.01, "distance={}", distances[0]);
    }
}
