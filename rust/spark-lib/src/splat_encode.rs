use std::array;

use half::f16;
use crate::decoder::SplatEncoding;

pub const SPLAT_TEX_WIDTH_BITS: usize = 11;
pub const SPLAT_TEX_HEIGHT_BITS: usize = 11;
pub const SPLAT_TEX_DEPTH_BITS: usize = 11;
pub const SPLAT_TEX_LAYER_BITS: usize = SPLAT_TEX_WIDTH_BITS + SPLAT_TEX_HEIGHT_BITS;

pub const SPLAT_TEX_WIDTH: usize = 1 << SPLAT_TEX_WIDTH_BITS;
pub const SPLAT_TEX_HEIGHT: usize = 1 << SPLAT_TEX_HEIGHT_BITS;
pub const SPLAT_TEX_DEPTH: usize = 1 << SPLAT_TEX_DEPTH_BITS;
pub const SPLAT_TEX_MIN_HEIGHT: usize = 1;
pub const SPLAT_TEX_LAYER_SIZE: usize = SPLAT_TEX_WIDTH * SPLAT_TEX_HEIGHT;

pub const SPLAT_TEX_WIDTH_MASK: usize = SPLAT_TEX_WIDTH - 1;
pub const SPLAT_TEX_HEIGHT_MASK: usize = SPLAT_TEX_HEIGHT - 1;
pub const SPLAT_TEX_DEPTH_MASK: usize = SPLAT_TEX_DEPTH - 1;

pub fn get_splat_tex_size(num_splats: usize) -> (usize, usize, usize, usize) {
    let width = SPLAT_TEX_WIDTH;
    let height = num_splats.div_ceil(SPLAT_TEX_WIDTH).clamp(SPLAT_TEX_MIN_HEIGHT, SPLAT_TEX_HEIGHT);
    let depth = num_splats.div_ceil(SPLAT_TEX_LAYER_SIZE).max(1);
    let max_splats = width * height * depth;
    (width, height, depth, max_splats)
}

pub fn encode_packed_splat(packed: &mut [u32], center: [f32; 3], opacity: f32, rgb: [f32; 3], scale: [f32; 3], quat_xyzw: [f32; 4], encoding: &SplatEncoding) {
    let SplatEncoding { rgb_min, rgb_max, ln_scale_min, ln_scale_max, lod_opacity, .. } = encoding;

    let u_rgb = rgb.map(|x| float_to_u8(x, *rgb_min, *rgb_max));
    let u_a = float_to_u8(opacity, 0.0, if *lod_opacity { 2.0 } else { 1.0 });
    let u_center = center.map(|x| f16::from_f32(x).to_bits());
    let u_quat = encode_quat_oct888(quat_xyzw);
    let u_scale = scale.map(|x| encode_scale8(x, *ln_scale_min, *ln_scale_max));

    packed[0] = (u_rgb[0] as u32) | ((u_rgb[1] as u32) << 8) | ((u_rgb[2] as u32) << 16) | ((u_a as u32) << 24);
    packed[1] = (u_center[0] as u32) | ((u_center[1] as u32) << 16);
    packed[2] = (u_center[2] as u32) | ((u_quat[0] as u32) << 16) | ((u_quat[1] as u32) << 24);
    packed[3] = (u_scale[0] as u32) | ((u_scale[1] as u32) << 8) | ((u_scale[2] as u32) << 16) | ((u_quat[2] as u32) << 24);
}

pub fn encode_packed_splat_center(packed: &mut [u32], center: [f32; 3]) {
    let u_center = center.map(|x| f16::from_f32(x).to_bits());
    packed[1] = (u_center[0] as u32) | ((u_center[1] as u32) << 16);
    packed[2] = (packed[2] & 0xffff0000) | (u_center[2] as u32);
}

pub fn decode_packed_splat_center(packed: &[u32]) -> [f32; 3] {
    let x = f16::from_bits((packed[1] & 0xffff) as u16).to_f32();
    let y = f16::from_bits((packed[1] >> 16) as u16).to_f32();
    let z = f16::from_bits((packed[2] & 0xffff) as u16).to_f32();
    [x, y, z]
}

pub fn encode_packed_splat_opacity(packed: &mut [u32], opacity: f32, encoding: &SplatEncoding) {
    let SplatEncoding { lod_opacity, .. } = encoding;
    let u_a = float_to_u8(opacity, 0.0, if *lod_opacity { 2.0 } else { 1.0 });
    packed[0] = (packed[0] & 0x00ffffff) | ((u_a as u32) << 24);
}

pub fn decode_packed_splat_opacity(packed: &[u32], encoding: &SplatEncoding) -> f32 {
    let SplatEncoding { lod_opacity, .. } = encoding;
    let u_a = (packed[0] >> 24) & 0xff;
    u8_to_float(u_a as u8, 0.0, if *lod_opacity { 2.0 } else { 1.0 })
}

pub fn encode_packed_splat_rgb(packed: &mut [u32], rgb: [f32; 3], encoding: &SplatEncoding) {
    let SplatEncoding { rgb_min, rgb_max, .. } = encoding;
    let u_rgb = rgb.map(|x| float_to_u8(x, *rgb_min, *rgb_max));
    packed[0] = (packed[0] & 0xff000000) | (u_rgb[0] as u32) | ((u_rgb[1] as u32) << 8) | ((u_rgb[2] as u32) << 16);
}

pub fn decode_packed_splat_rgb(packed: &[u32], encoding: &SplatEncoding) -> [f32; 3] {
    let SplatEncoding { rgb_min, rgb_max, .. } = encoding;
    let u_rgb = [packed[0] as u8, (packed[0] >> 8) as u8, (packed[0] >> 16) as u8];
    u_rgb.map(|x| u8_to_float(x, *rgb_min, *rgb_max))
}

pub fn encode_packed_splat_rgba(packed: &mut [u32], rgba: [f32; 4], encoding: &SplatEncoding) {
    let SplatEncoding { rgb_min, rgb_max, lod_opacity, .. } = encoding;
    let u_rgb = rgba.map(|x| float_to_u8(x, *rgb_min, *rgb_max));
    let u_a = float_to_u8(rgba[3], 0.0, if *lod_opacity { 2.0 } else { 1.0 });
    packed[0] = (u_rgb[0] as u32) | ((u_rgb[1] as u32) << 8) | ((u_rgb[2] as u32) << 16) | ((u_a as u32) << 24);
}

pub fn decode_packed_splat_rgba(packed: &[u32], encoding: &SplatEncoding) -> [f32; 4] {
    let SplatEncoding { rgb_min, rgb_max, lod_opacity, .. } = encoding;
    let u_rgb = [packed[0] as u8, (packed[0] >> 8) as u8, (packed[0] >> 16) as u8];
    let u_a = (packed[0] >> 24) & 0xff;
    [
        u8_to_float(u_rgb[0], *rgb_min, *rgb_max),
        u8_to_float(u_rgb[1], *rgb_min, *rgb_max),
        u8_to_float(u_rgb[2], *rgb_min, *rgb_max),
        u8_to_float(u_a as u8, 0.0, if *lod_opacity { 2.0 } else { 1.0 }),
    ]
}

pub fn encode_packed_splat_scale(packed: &mut [u32], scale: [f32; 3], encoding: &SplatEncoding) {
    let SplatEncoding { ln_scale_min, ln_scale_max, .. } = encoding;
    let u_scale = scale.map(|x| encode_scale8(x, *ln_scale_min, *ln_scale_max));
    packed[3] = (packed[3] & 0xff000000) | (u_scale[0] as u32) | ((u_scale[1] as u32) << 8) | ((u_scale[2] as u32) << 16);
}

pub fn decode_packed_splat_scale(packed: &[u32], encoding: &SplatEncoding) -> [f32; 3] {
    let SplatEncoding { ln_scale_min, ln_scale_max, .. } = encoding;
    let u_scale = [packed[3] as u8, (packed[3] >> 8) as u8, (packed[3] >> 16) as u8];
    u_scale.map(|x| decode_scale8(x, *ln_scale_min, *ln_scale_max))
}

pub fn encode_packed_splat_quat(packed: &mut [u32], quat_xyzw: [f32; 4]) {
    let u_quat = encode_quat_oct888(quat_xyzw);
    packed[2] = (packed[2] & 0x0000ffff) | ((u_quat[0] as u32) << 16) | ((u_quat[1] as u32) << 24);
    packed[3] = (packed[3] & 0x00ffffff) | (u_quat[2] as u32) << 24;
}

pub fn decode_packed_splat_quat(packed: &[u32]) -> [f32; 4] {
    let u_quat = [
        (packed[2] >> 16) as u8,
        (packed[2] >> 24) as u8,
        (packed[3] >> 24) as u8,
    ];
    decode_quat_oct888(u_quat)
}

pub fn encode_ext_splat(ext_a: &mut [u32], ext_b: &mut [u32], center: [f32; 3], opacity: f32, rgb: [f32; 3], scale: [f32; 3], quat_xyzw: [f32; 4]) {
    ext_a[0] = center[0].to_bits();
    ext_a[1] = center[1].to_bits();
    ext_a[2] = center[2].to_bits();
    ext_a[3] = f16::from_f32(opacity).to_bits() as u32;
    ext_b[0] = f16::from_f32(rgb[0]).to_bits() as u32 | ((f16::from_f32(rgb[1]).to_bits() as u32) << 16);
    ext_b[1] = f16::from_f32(rgb[2]).to_bits() as u32 | ((f16::from_f32(scale[0].ln()).to_bits() as u32) << 16);
    ext_b[2] = f16::from_f32(scale[1].ln()).to_bits() as u32 | ((f16::from_f32(scale[2].ln()).to_bits() as u32) << 16);
    ext_b[3] = encode_quat_oct101012(quat_xyzw);
}

pub fn encode_ext_splat_center(ext_a: &mut [u32], center: [f32; 3]) {
    ext_a[0] = center[0].to_bits();
    ext_a[1] = center[1].to_bits();
    ext_a[2] = center[2].to_bits();
}

pub fn decode_ext_splat_center(ext_a: &[u32]) -> [f32; 3] {
    [f32::from_bits(ext_a[0]), f32::from_bits(ext_a[1]), f32::from_bits(ext_a[2])]
}

pub fn encode_ext_splat_opacity(ext_a: &mut [u32], opacity: f32) {
    ext_a[3] = f16::from_f32(opacity).to_bits() as u32;
}

pub fn decode_ext_splat_opacity(ext_a: &[u32]) -> f32 {
    f16::from_bits(ext_a[3] as u16).to_f32()
}

pub fn encode_ext_splat_rgb(ext_b: &mut [u32], rgb: [f32; 3]) {
    ext_b[0] = f16::from_f32(rgb[0]).to_bits() as u32 | ((f16::from_f32(rgb[1]).to_bits() as u32) << 16);
    ext_b[1] = f16::from_f32(rgb[2]).to_bits() as u32 | (ext_b[1] & 0xffff0000);
}

pub fn decode_ext_splat_rgb(ext_b: &[u32]) -> [f32; 3] {
    [ext_b[0] as u16, (ext_b[0] >> 16) as u16, ext_b[1] as u16]
        .map(|x| f16::from_bits(x as u16).to_f32())
}

pub fn encode_ext_splat_rgba(ext_a: &mut [u32], ext_b: &mut [u32], rgba: [f32; 4]) {
    encode_ext_splat_opacity(ext_a, rgba[3]);
    encode_ext_splat_rgb(ext_b, [rgba[0], rgba[1], rgba[2]]);
}

pub fn decode_ext_splat_rgba(ext_a: &[u32], ext_b: &[u32]) -> [f32; 4] {
    let rgb = decode_ext_splat_rgb(ext_b);
    [rgb[0], rgb[1], rgb[2], decode_ext_splat_opacity(ext_a)]
}

pub fn encode_ext_splat_scale(ext_b: &mut [u32], scale: [f32; 3]) {
    ext_b[1] = (ext_b[1] & 0xffff) | ((f16::from_f32(scale[0].ln()).to_bits() as u32) << 16);
    ext_b[2] = f16::from_f32(scale[1].ln()).to_bits() as u32 | ((f16::from_f32(scale[2].ln()).to_bits() as u32) << 16);
}

pub fn decode_ext_splat_scale(ext_b: &[u32]) -> [f32; 3] {
    [(ext_b[1] >> 16) as u16, ext_b[2] as u16, (ext_b[2] >> 16) as u16]
        .map(|x| f16::from_bits(x as u16).to_f32().exp())
}

pub fn encode_ext_splat_quat(ext_b: &mut [u32], quat_xyzw: [f32; 4]) {
    ext_b[3] = encode_quat_oct101012(quat_xyzw);
}

pub fn decode_ext_splat_quat(ext_b: &[u32]) -> [f32; 4] {
    decode_quat_oct101012(ext_b[3])
}

pub fn float_to_u8(value: f32, min: f32, max: f32) -> u8 {
    ((value - min) / (max - min) * 255.0).clamp(0.0, 255.0).round() as u8
}

pub fn u8_to_float(value: u8, min: f32, max: f32) -> f32 {
    min + (value as f32 / 255.0) * (max - min)
}

pub fn encode_quat_oct888(quat_xyzw: [f32; 4]) -> [u8; 3] {
    let quat = if quat_xyzw[3] < 0.0 { quat_xyzw.map(|x| -x) } else { quat_xyzw };
    let theta = 2.0 * quat[3].clamp(0.0, 1.0).acos();
    let s = (theta * 0.5).sin();

    let axis = if s.abs() < 1e-6 { [1.0, 0.0, 0.0] } else { array::from_fn(|i| quat[i] / s) };
    let sum = axis[0].abs() + axis[1].abs() + axis[2].abs();
    let mut p: [f32; 2] = array::from_fn(|i| axis[i] / sum);
    if axis[2] < 0.0 {
        p = [
            (1.0 - p[1].abs()) * if p[0] >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - p[0].abs()) * if p[1] >= 0.0 { 1.0 } else { -1.0 },
        ];
    }
    let [u, v] = p.map(|x| float_to_u8(x, -1.0, 1.0));
    let r = float_to_u8(theta, 0.0, std::f32::consts::PI);
    [u, v, r]
}

pub fn decode_quat_oct888([u, v, r]: [u8; 3]) -> [f32; 4] {
    let [x, y] = [u, v].map(|x| x as f32 / 255.0 * 2.0 - 1.0);
    let z = 1.0 - x.abs() - y.abs();
    let t = (-z).max(0.0);
    let [x, y] = [x, y].map(|x| if x >= 0.0 { x - t } else { x + t });
    let length = (x * x + y * y + z * z).sqrt();
    let axis = [x / length, y / length, z / length];

    let half_theta = r as f32 / 255.0 * 0.5 * std::f32::consts::PI;
    let (s, w) = half_theta.sin_cos();
    [axis[0] * s, axis[1] * s, axis[2] * s, w]
}

pub fn encode_quat_oct101012(quat_xyzw: [f32; 4]) -> u32 {
    let quat = if quat_xyzw[3] < 0.0 { quat_xyzw.map(|x| -x) } else { quat_xyzw };
    let theta = 2.0 * quat[3].clamp(0.0, 1.0).acos();
    let s = (theta * 0.5).sin();

    let axis = if s.abs() < 1e-6 { [1.0, 0.0, 0.0] } else { array::from_fn(|i| quat[i] / s) };
    let sum = axis[0].abs() + axis[1].abs() + axis[2].abs();
    let mut p: [f32; 2] = array::from_fn(|i| axis[i] / sum);
    if axis[2] < 0.0 {
        p = [
            (1.0 - p[1].abs()) * if p[0] >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - p[0].abs()) * if p[1] >= 0.0 { 1.0 } else { -1.0 },
        ];
    }

    let [u, v] = p.map(|x| ((x * 0.5 + 0.5) * 1023.0).clamp(0.0, 1023.0).round() as u32);
    let r = (theta / std::f32::consts::PI * 4095.0).clamp(0.0, 4095.0).round() as u32;
    (r << 20) | (v << 10) | u
}

pub fn decode_quat_oct101012(encoded: u32) -> [f32; 4] {
    let [u, v, r] = [encoded & 0x3ff, (encoded >> 10) & 0x3ff, encoded >> 20];
    let [x, y] = [u as f32 / 1023.0 * 2.0 - 1.0, v as f32 / 1023.0 * 2.0 - 1.0];
    let z = 1.0 - x.abs() - y.abs();
    let t = (-z).max(0.0);
    let [x, y] = [x, y].map(|x| if x >= 0.0 { x - t } else { x + t });
    let length = (x * x + y * y + z * z).sqrt();
    let axis = [x / length, y / length, z / length];

    let half_theta = r as f32 / 4095.0 * 0.5 * std::f32::consts::PI;
    let (s, w) = half_theta.sin_cos();
    [axis[0] * s, axis[1] * s, axis[2] * s, w]
}

pub fn encode_scale8(scale: f32, ln_scale_min: f32, ln_scale_max: f32) -> u8 {
    if scale == 0.0 {
        0
    } else {
        let n = (scale.ln() - ln_scale_min) / (ln_scale_max - ln_scale_min);
        1 + (n.clamp(0.0, 1.0) * 254.0).round() as u8
    }
}

pub fn decode_scale8(scale: u8, ln_scale_min: f32, ln_scale_max: f32) -> f32 {
    if scale == 0 {
        0.0
    } else {
        let ln_scale_scale = (ln_scale_max - ln_scale_min) / 254.0;
        (ln_scale_min + (scale - 1) as f32 * ln_scale_scale).exp()
    }
}

pub fn encode_ext_rgb(rgb: [f32; 3]) -> u32 {
    let abs_rgb = rgb.map(|x| x.abs());
    let max_abs = abs_rgb[0].max(abs_rgb[1].max(abs_rgb[2]));
    let base = (max_abs.log2().floor() + 15.0).clamp(0.0, 31.0).round() as i32;
    let divisor = ((base - 15) as f32).exp2() / 255.0;
    let u_rgb = abs_rgb.map(|x| (x / divisor).clamp(0.0, 255.0).round() as u32);
    let exp_signs = ((base as u32) << 3)
        | if rgb[0] < 0.0 { 0x1 } else { 0 }
        | if rgb[1] < 0.0 { 0x2 } else { 0 }
        | if rgb[2] < 0.0 { 0x4 } else { 0 };
    u_rgb[0] | (u_rgb[1] << 8) | (u_rgb[2] << 16) | (exp_signs << 24)
}

pub fn decode_ext_rgb(encoded: u32) -> [f32; 3] {
    let biased_base = (encoded >> 27) & 0x1f;
    let divisor = ((biased_base as i32 - 15) as f32).exp2() / 255.0;
    let u_rgb = [encoded & 0xff, (encoded >> 8) & 0xff, (encoded >> 16) & 0xff];
    let rgb = u_rgb.map(|x| x as f32 * divisor);
    [
        if (encoded & 0x1000000) != 0 { -rgb[0] } else { rgb[0] },
        if (encoded & 0x2000000) != 0 { -rgb[1] } else { rgb[1] },
        if (encoded & 0x4000000) != 0 { -rgb[2] } else { rgb[2] },
    ]
}

pub fn encode_sh1(sh1: &[f32], sh1_min: f32, sh1_max: f32) -> [u32; 2] {
    let sh1_mid = 0.5 * (sh1_min + sh1_max);
    let sh1_scale = 126.0 / (sh1_max - sh1_min);
    encode_sh1_internal(sh1, sh1_mid, sh1_scale)
}

pub fn encode_sh1_array(buffer: &mut [u32], sh1: &[f32], count: usize, sh1_min: f32, sh1_max: f32) {
    let sh1_mid = 0.5 * (sh1_min + sh1_max);
    let sh1_scale = 126.0 / (sh1_max - sh1_min);
    for i in 0..count {
        let [i2, i9] = [i * 2, i * 9];
        let encoded = encode_sh1_internal(&sh1[i9..i9 + 9], sh1_mid, sh1_scale);
        buffer[i2] = encoded[0];
        buffer[i2 + 1] = encoded[1];
    }
}

pub fn encode_sh1_internal(sh1: &[f32], sh1_mid: f32, sh1_scale: f32) -> [u32; 2] {
    let mut words = [0, 0];
    for i in 0..9 {
        let value = ((sh1[i] - sh1_mid) * sh1_scale).clamp(-63.0, 63.0).round() as i8 & 0x7f;
        let bit_start = i * 7;
        let word_start = bit_start / 32;
        let word_bit_start = word_start * 32;
        let bit_offset = bit_start - word_bit_start;

        words[word_start] |= (value as u32) << bit_offset;
        if (bit_start + 7) > (word_bit_start + 32) {
            words[word_start + 1] |= (value as u32) >> (32 - bit_offset);
        }
    }
    words
}

pub fn encode_sh2(sh2: &[f32], sh2_min: f32, sh2_max: f32) -> [u32; 4] {
    let sh2_mid = 0.5 * (sh2_min + sh2_max);
    let sh2_scale = 254.0 / (sh2_max - sh2_min);
    encode_sh2_internal(sh2, sh2_mid, sh2_scale)
}

pub fn encode_sh2_array(buffer: &mut [u32], sh2: &[f32], count: usize, sh2_min: f32, sh2_max: f32) {
    let sh2_mid = 0.5 * (sh2_min + sh2_max);
    let sh2_scale = 254.0 / (sh2_max - sh2_min);
    for i in 0..count {
        let [i4, i15] = [i * 4, i * 15];
        let encoded = encode_sh2_internal(&sh2[i15..i15 + 15], sh2_mid, sh2_scale);
        buffer[i4] = encoded[0];
        buffer[i4 + 1] = encoded[1];
        buffer[i4 + 2] = encoded[2];
        buffer[i4 + 3] = encoded[3];
    }
}

pub fn encode_sh2_internal(sh2: &[f32], sh2_mid: f32, sh2_scale: f32) -> [u32; 4] {
    let bytes: [u8; 15] = array::from_fn(|i| 
        ((sh2[i] - sh2_mid) * sh2_scale).clamp(-127.0, 127.0).round() as i8 as u8
    );
    [
        (bytes[0] as u32) | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16) | ((bytes[3] as u32) << 24),
        (bytes[4] as u32) | ((bytes[5] as u32) << 8) | ((bytes[6] as u32) << 16) | ((bytes[7] as u32) << 24),
        (bytes[8] as u32) | ((bytes[9] as u32) << 8) | ((bytes[10] as u32) << 16) | ((bytes[11] as u32) << 24),
        (bytes[12] as u32) | ((bytes[13] as u32) << 8) | ((bytes[14] as u32) << 16) | 0,
    ]
}

pub fn encode_sh3(sh3: &[f32], sh3_min: f32, sh3_max: f32) -> [u32; 4] {
    let sh3_mid = 0.5 * (sh3_min + sh3_max);
    let sh3_scale = 62.0 / (sh3_max - sh3_min);
    encode_sh3_internal(sh3, sh3_mid, sh3_scale)
}

pub fn encode_sh3_array(buffer: &mut [u32], sh3: &[f32], count: usize, sh3_min: f32, sh3_max: f32) {
    let sh3_mid = 0.5 * (sh3_min + sh3_max);
    let sh3_scale = 62.0 / (sh3_max - sh3_min);
    for i in 0..count {
        let [i4, i21] = [i * 4, i * 21];
        let encoded = encode_sh3_internal(&sh3[i21..i21 + 21], sh3_mid, sh3_scale);
        buffer[i4] = encoded[0];
        buffer[i4 + 1] = encoded[1];
        buffer[i4 + 2] = encoded[2];
        buffer[i4 + 3] = encoded[3];
    }
}

pub fn encode_sh3_internal(sh3: &[f32], sh3_mid: f32, sh3_scale: f32) -> [u32; 4] {
    let mut words = [0, 0, 0, 0];
    for i in 0..21 {
        let value = ((sh3[i] - sh3_mid) * sh3_scale).clamp(-31.0, 31.0).round() as i8 & 0x3f;
        let bit_start = i * 6;
        let word_start = bit_start / 32;
        let word_bit_start = word_start * 32;
        let bit_offset = bit_start - word_bit_start;

        words[word_start] |= (value as u32) << bit_offset;
        if (bit_start + 6) > (word_bit_start + 32) {
            words[word_start + 1] |= (value as u32) >> (32 - bit_offset);
        }
    }
    words
}

pub fn encode_lod_tree(buffer: &mut [u32], center: &[f32], opacity: f32, scale: &[f32], child_count: u16, child_start: u32) {
    let center: [f16; 3] = array::from_fn(|d| f16::from_f32(center[d]));
    let max_scale = scale[0].max(scale[1]).max(scale[2]);
    let size = f16::from_f32(2.0 * opacity.max(1.0) * max_scale);
    buffer[0] = (center[0].to_bits() as u32) | ((center[1].to_bits() as u32) << 16);
    buffer[1] = (center[2].to_bits() as u32) | ((size.to_bits() as u32) << 16);
    buffer[2] = child_count as u32;
    buffer[3] = child_start as u32;
}

pub fn decode_lod_tree_children(buffer: &[u32]) -> (u16, u32) {
    let child_count = (buffer[2] & 0xffff) as u16;
    let child_start = buffer[3] as u32;
    (child_count, child_start)
}
