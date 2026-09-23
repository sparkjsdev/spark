
pub mod tsplat;
#[cfg(feature = "gsplat")]
pub mod gsplat;
#[cfg(feature = "csplat")]
pub mod csplat;
pub mod symmat3;
#[cfg(feature = "quick_lod")]
pub mod quick_lod;
#[cfg(feature = "tiny_lod")]
pub mod tiny_lod;
#[cfg(feature = "bhatt_lod")]
pub mod bhatt_lod;
#[cfg(feature = "ply")]
pub mod ply;
#[cfg(feature = "spz")]
pub mod spz;
#[cfg(feature = "antisplat")]
pub mod antisplat;
#[cfg(feature = "ksplat")]
pub mod ksplat;
#[cfg(feature = "sogs")]
pub mod sogs;
#[cfg(feature = "rad")]
pub mod rad;
pub mod decoder;
pub mod splat_encode;
pub mod ordering;
pub mod chunk_tree;
pub mod sh_clustering;

#[cfg(not(any(feature = "gsplat", feature = "csplat")))]
compile_error!("at least one of \"gsplat\" and \"csplat\" must be enabled");

#[cfg(test)]
mod tests {
    use super::{
        antisplat::{AntiSplatDecoder, AntiSplatEncoder},
        gsplat::*,
        ksplat::{KsplatDecoder, KsplatEncoder},
        spz::{SpzDecoder, SpzEncoder},
    };
    use super::decoder::ChunkReceiver;
    use glam::{Quat, Vec3A};
    use crate::tsplat::TsplatArray;

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
    fn antisplat_roundtrip_basic() {
        let mut arr = GsplatArray::new_capacity(2, 0);
        let splat_a = make_splat([0.1, 0.2, -0.3], 0.8, [0.3, 0.6, 0.9], [0.4, 0.5, 0.6], [0.0, 0.1, 0.2, 0.95]);
        let splat_b = make_splat([-1.2, 3.4, 5.6], 0.4, [0.9, 0.1, 0.2], [1.0, 1.1, 1.2], [-0.3, 0.4, -0.5, 0.6]);
        arr.push_splat(splat_a, None, None, None);
        arr.push_splat(splat_b, None, None, None);

        let encoded = AntiSplatEncoder::new(arr).encode().expect("encode ok");
        let mut dec = AntiSplatDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.max_sh_degree, 0);
        assert_eq!(out.len(), 2);

        let a = &out.splats[0];
        assert!(approx(a.center.x, 0.1, 1e-6));
        assert!(approx(a.center.y, 0.2, 1e-6));
        assert!(approx(a.center.z, -0.3, 1e-6));
        assert!(approx(a.opacity.to_f32(), 0.8, 0.01));

        let b = &out.splats[1];
        assert!(approx(b.center.x, -1.2, 1e-6));
        assert!(approx(b.center.y, 3.4, 1e-6));
        assert!(approx(b.center.z, 5.6, 1e-6));
        assert!(approx(b.opacity.to_f32(), 0.4, 0.01));
    }

    #[test]
    fn ksplat_roundtrip_basic() {
        let mut arr = GsplatArray::new_capacity(1, 1);
        let splat = make_splat([0.01, -0.02, 0.03], 0.5, [0.25, 0.5, 0.75], [0.9, 1.0, 1.1], [0.2, -0.3, 0.4, 0.8]);
        let sh1_vals: [f32; 9] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
        let mut sh1 = GsplatSH1::default();
        sh1.set_from_array(&sh1_vals);
        arr.push_splat(splat, Some(sh1), None, None);

        let encoded = KsplatEncoder::new(arr).encode().expect("encode ok");
        let mut dec = KsplatDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.len(), 1);
        assert_eq!(out.max_sh_degree, 1);
        let got = out.sh1[0].to_array();
        for i in 0..9 {
            assert!(approx(got[i], sh1_vals[i], 1e-3), "sh1[{i}] {} vs {}", got[i], sh1_vals[i]);
        }
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

    // Undoes the gzip framing SpzEncoder puts around the payload
    fn spz_payload(encoded: &[u8]) -> Vec<u8> {
        miniz_oxide::inflate::decompress_to_vec(&encoded[10..encoded.len() - 8]).expect("inflate ok")
    }

    fn spz_version(payload: &[u8]) -> u32 {
        u32::from_le_bytes(payload[4..8].try_into().unwrap())
    }

    #[test]
    fn spz_roundtrip_version2_quaternion() {
        let mut arr = GsplatArray::new_capacity(1, 0);
        let quat = [0.1, 0.2, 0.3, 0.9273618];
        arr.push_splat(make_splat([0.1, 0.2, 0.3], 0.7, [0.2, 0.5, 0.8], [0.5, 0.6, 0.7], quat), None, None, None);

        let encoded = SpzEncoder::new(arr).with_version(2).with_fractional_bits(12).encode().expect("encode ok");
        assert_eq!(spz_version(&spz_payload(&encoded)), 2);

        let mut dec = SpzDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.len(), 1);
        let got = out.splats[0].quaternion.map(|v| v.to_f32());
        for i in 0..4 { assert!(approx(got[i], quat[i], 0.02), "quat[{}] {} vs {}", i, got[i], quat[i]); }
    }

    #[test]
    fn spz_roundtrip_default_version_quaternion() {
        // One case per largest component, which selects the packing. The largest
        // decodes positive, so a negative one returns the negated rotation.
        let cases = [
            ([0.9273618, 0.1, 0.2, 0.3], [0.9273618, 0.1, 0.2, 0.3]),
            ([0.1, 0.9273618, 0.2, 0.3], [0.1, 0.9273618, 0.2, 0.3]),
            ([0.1, 0.2, 0.9273618, 0.3], [0.1, 0.2, 0.9273618, 0.3]),
            ([0.1, 0.2, 0.3, 0.9273618], [0.1, 0.2, 0.3, 0.9273618]),
            ([0.1, 0.2, 0.3, -0.9273618], [-0.1, -0.2, -0.3, 0.9273618]),
            // Not unit length, so it has to be normalised before packing
            ([0.2, 0.4, 0.6, 1.8547236], [0.1, 0.2, 0.3, 0.9273618]),
        ];
        let mut arr = GsplatArray::new_capacity(cases.len(), 0);
        for (quat, _) in cases {
            arr.push_splat(make_splat([0.1, 0.2, 0.3], 0.7, [0.2, 0.5, 0.8], [0.5, 0.6, 0.7], quat), None, None, None);
        }

        let encoded = SpzEncoder::new(arr).with_fractional_bits(12).encode().expect("encode ok");
        assert_eq!(spz_version(&spz_payload(&encoded)), 3);

        let mut dec = SpzDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.len(), cases.len());
        for (s, (_, want)) in cases.iter().enumerate() {
            let got = out.splats[s].quaternion.map(|v| v.to_f32());
            for i in 0..4 { assert!(approx(got[i], want[i], 0.02), "splat {} quat[{}] {} vs {}", s, i, got[i], want[i]); }
        }
    }

    #[test]
    fn spz_writes_non_finite_quaternion_as_identity() {
        // One NaN or infinite component, in each position
        let mut cases = Vec::new();
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for k in 0..4 {
                let mut quat = [0.0, 0.0, 0.0, 1.0];
                quat[k] = bad;
                cases.push(quat);
            }
        }
        let mut arr = GsplatArray::new_capacity(cases.len(), 0);
        for &quat in &cases {
            arr.push_splat(make_splat([0.1, 0.2, 0.3], 0.7, [0.2, 0.5, 0.8], [0.5, 0.6, 0.7], quat), None, None, None);
        }

        let encoded = SpzEncoder::new(arr).with_fractional_bits(12).encode().expect("encode ok");
        assert_eq!(spz_version(&spz_payload(&encoded)), 3);

        let mut dec = SpzDecoder::new(GsplatArray::new());
        dec.push(&encoded).expect("push ok");
        dec.finish().expect("finish ok");
        let out = dec.into_splats();

        assert_eq!(out.len(), cases.len());
        for (s, quat) in cases.iter().enumerate() {
            let got = out.splats[s].quaternion.map(|v| v.to_f32());
            assert_eq!(got, [0.0, 0.0, 0.0, 1.0], "splat {} from {:?}", s, quat);
        }
    }

    #[test]
    fn spz_rejects_unwritable_version() {
        let mut arr = GsplatArray::new_capacity(1, 0);
        arr.push_splat(make_splat([0.0, 0.0, 0.0], 0.5, [0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.0, 0.0, 0.0, 1.0]), None, None, None);
        assert!(SpzEncoder::new(arr).with_version(1).encode().is_err());
    }
}

#[cfg(test)]
mod ply_tests {
    use super::{gsplat::*, ply::{PlyEncoder, PlyDecoder}};
    use super::decoder::ChunkReceiver;
    use glam::{Quat, Vec3A};
    use crate::tsplat::TsplatArray;

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
