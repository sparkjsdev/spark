use glam::{Vec3A, Quat};

use spark_lib::gsplat::GsplatArray;
use spark_lib::tsplat::TsplatArray;
use spark_lib::tsplat::Tsplat;
use serde::{Deserialize, Serialize};

use spark_lib::decoder::SplatReceiver;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformOptions {
    pub translation: [f32; 3],
    pub rotation: [f32; 4],
    pub scale: f32,
    pub clip: Option<[f32; 6]>,
    #[serde(rename = "opacityThreshold")]
    pub opacity_threshold: f32,
}

pub fn transform_gsplatarray(gsplats: &mut GsplatArray, transform_options: TransformOptions) {
    let translation = Vec3A::from_array(transform_options.translation);
    let quaternion = Quat::from_array(transform_options.rotation);
    let scale = Vec3A::splat(transform_options.scale);

    let clip = transform_options.clip.map(|clip| (Vec3A::from_slice(&clip[..3]), Vec3A::from_slice(&clip[3..])));

    let mut out_index = 0;
    for splat_index in 0..gsplats.splats.len() {
        let in_splat = gsplats.get(splat_index);

        let mut center = in_splat.center();
        // Transform center
        center = quaternion * (center * scale) + translation;

        // Check clip box
        let clipped = match clip {
            Some((min, max)) => (center.cmplt(min)).any() || (center.cmpgt(max)).any(),
            None => false
        };
        if clipped {
            continue;
        }

        // Check opacity threshold
        let opacity = in_splat.opacity();
        if opacity < transform_options.opacity_threshold {
            continue;
        }

        let mut scales = in_splat.scales();
        let mut quat = in_splat.quaternion();
        let rgb = in_splat.rgb();

        gsplats.set_center(out_index, 1, &center.to_array());

        scales *= scale;
        gsplats.set_scale(out_index, 1, &scales.to_array());

        quat *= quaternion;
        gsplats.set_quat(out_index, 1, &quat.to_array());

        gsplats.set_rgb(out_index, 1, &rgb.to_array());
        gsplats.set_opacity(out_index, 1, &[opacity]);

        gsplats.set_sh1(out_index, 1, gsplats.get_sh1(splat_index).as_slice());
        gsplats.set_sh2(out_index, 1, gsplats.get_sh2(splat_index).as_slice());
        gsplats.set_sh3(out_index, 1, gsplats.get_sh3(splat_index).as_slice());

        out_index += 1;
    }

    gsplats.truncate(out_index);
}