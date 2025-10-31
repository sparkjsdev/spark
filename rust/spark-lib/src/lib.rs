
pub mod gsplat;
pub mod symmat3;
pub mod quick_lod;
pub mod ply;
pub mod spz;
pub mod decoder;
pub mod splat_encode;

#[cfg(test)]
mod tests {
    use super::{gsplat::*, spz::{SpzEncoder, SpzDecoder}};
    use super::decoder::ChunkReceiver;
    use glam::{Quat, Vec3A};

    fn approx(a: f32, b: f32, eps: f32) -> bool { (a - b).abs() <= eps }

    fn make_splat(center: [f32;3], opacity: f32, rgb: [f32;3], scales: [f32;3], quat_xyzw: [f32;4]) -> Gsplat {
        Gsplat::new(
            Vec3A::from_array(center),
            opacity,
            Vec3A::from_array(rgb),
            Vec3A::from_array(scales),
            Quat::from_array(quat_xyzw),
        )
    }

    #[test]
    fn spz_roundtrip_sh_degree1_interleaving() {
        // Prepare a single splat with distinct RGB values per SH1 coefficient
        let mut arr = GsplatArray::new_capacity(1, 1);
        let splat = make_splat([0.1, 0.2, 0.3], 0.7, [0.2, 0.5, 0.8], [0.5, 0.6, 0.7], [0.1, 0.2, 0.3, 0.93]);
        let sh1_vals: [f32; 9] = [
            0.10, 0.40, 0.70, // c0: R,G,B
            0.20, 0.50, 0.80, // c1
            0.30, 0.60, 0.90, // c2
        ];
        let mut sh1 = GsplatSH1::default();
        sh1.set_from_array(&sh1_vals);
        arr.push_splat(splat, Some(sh1), None, None);

        // Encode -> Decode
        let encoded = SpzEncoder::new(arr).with_fractional_bits(12).encode().expect("encode ok");
        let mut dec = SpzDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.max_sh_degree, 1);
        assert_eq!(out.len(), 1);
        let got = out.sh1[0].to_array();
        // Due to quantization, allow a tolerance; ordering must remain RGB per coefficient
        for i in 0..9 {
            assert!(approx(got[i], sh1_vals[i], 0.12), "sh1[{}] got={} expect={}", i, got[i], sh1_vals[i]);
        }
    }

    #[test]
    fn spz_roundtrip_sh_degree2_interleaving() {
        let mut arr = GsplatArray::new_capacity(1, 2);
        let splat = make_splat([0.0, 0.0, 0.0], 0.9, [0.3, 0.6, 0.1], [0.8, 0.9, 1.0], [0.0, 0.0, 0.0, 1.0]);
        // 3 coeffs + 5 coeffs → 9 + 15 values
        let sh1_vals: [f32; 9] = [
            -0.3,  0.1,  0.4,
             0.2, -0.2,  0.5,
             0.0,  0.3, -0.1,
        ];
        let sh2_vals: [f32; 15] = [
            0.11, 0.21, 0.31,
            0.12, 0.22, 0.32,
            0.13, 0.23, 0.33,
            0.14, 0.24, 0.34,
            0.15, 0.25, 0.35,
        ];
        let mut sh1 = GsplatSH1::default(); sh1.set_from_array(&sh1_vals);
        let mut sh2 = GsplatSH2::default(); sh2.set_from_array(&sh2_vals);
        arr.push_splat(splat, Some(sh1), Some(sh2), None);

        let encoded = SpzEncoder::new(arr).with_fractional_bits(12).encode().expect("encode ok");
        let mut dec = SpzDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.max_sh_degree, 2);
        assert_eq!(out.len(), 1);
        let got1 = out.sh1[0].to_array();
        for i in 0..9 { assert!(approx(got1[i], sh1_vals[i], 0.15), "sh1[{}] {} vs {}", i, got1[i], sh1_vals[i]); }
        let got2 = out.sh2[0].to_array();
        for i in 0..15 { assert!(approx(got2[i], sh2_vals[i], 0.20), "sh2[{}] {} vs {}", i, got2[i], sh2_vals[i]); }
    }
}

#[cfg(test)]
mod ply_tests {
    use super::{gsplat::*, ply::{PlyEncoder, PlyDecoder}};
    use super::decoder::ChunkReceiver;
    use glam::{Quat, Vec3A};

    fn approx(a: f32, b: f32, eps: f32) -> bool { (a - b).abs() <= eps }

    fn make_splat(center: [f32;3], opacity: f32, rgb: [f32;3], scales: [f32;3], quat_xyzw: [f32;4]) -> Gsplat {
        Gsplat::new(
            Vec3A::from_array(center),
            opacity,
            Vec3A::from_array(rgb),
            Vec3A::from_array(scales),
            Quat::from_array(quat_xyzw),
        )
    }

    #[test]
    fn ply_roundtrip_sh_degree2() {
        // Build one splat with SH degree 2 so f_rest mapping is exercised
        let mut arr = GsplatArray::new_capacity(1, 2);
        let splat = make_splat([0.123, -0.456, 0.789], 0.73, [0.25, 0.6, 0.9], [0.7, 0.8, 0.9], [0.3, -0.4, 0.5, 0.7]);
        let sh1_vals: [f32; 9] = [
            -0.2, 0.0, 0.2,
             0.1, 0.3, 0.5,
            -0.4, -0.1, 0.7,
        ];
        let sh2_vals: [f32; 15] = [
            0.01, 0.02, 0.03,
            0.11, 0.12, 0.13,
            0.21, 0.22, 0.23,
            0.31, 0.32, 0.33,
            0.41, 0.42, 0.43,
        ];
        let mut sh1 = GsplatSH1::default(); sh1.set_from_array(&sh1_vals);
        let mut sh2 = GsplatSH2::default(); sh2.set_from_array(&sh2_vals);
        arr.push_splat(splat, Some(sh1), Some(sh2), None);

        // Encode to binary PLY
        let encoded = PlyEncoder::new(arr).encode().expect("encode ok");

        // Decode back
        let mut dec = PlyDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.max_sh_degree, 2);
        assert_eq!(out.len(), 1);

        let got1 = out.sh1[0].to_array();
        for i in 0..9 { assert!(approx(got1[i], sh1_vals[i], 3e-4), "sh1[{}] {} vs {}", i, got1[i], sh1_vals[i]); }
        let got2 = out.sh2[0].to_array();
        for i in 0..15 { assert!(approx(got2[i], sh2_vals[i], 3e-4), "sh2[{}] {} vs {}", i, got2[i], sh2_vals[i]); }
    }
}
