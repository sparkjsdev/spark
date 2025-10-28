
use std::array;

use glam::{I64Vec3, Mat3A, Quat, Vec3A};
use half::f16;
use ordered_float::OrderedFloat;
use smallvec::SmallVec;

use crate::decoder::{SetSplatEncoding, SplatEncoding, SplatInit, SplatProps, SplatReceiver};
use crate::splat_encode::{encode_packed_splat, encode_sh1, encode_sh2, encode_sh3, get_splat_tex_size};
use crate::symmat3::SymMat3;

#[derive(Debug, Clone, Default)]
pub struct Gsplat {
    pub center: Vec3A,
    pub opacity: f16,
    pub rgb: [f16; 3],
    pub ln_scales: [f16; 3],
    pub quaternion: [f16; 4],
}

#[derive(Debug, Clone, Default)]
pub struct GsplatExtra {
    pub weight: f32,
    pub level: i16,
    pub covariance: SymMat3,
    pub children: SmallVec<[usize; 8]>,
}

#[derive(Debug, Clone, Default)]
pub struct GsplatSH1(pub [[f16; 3]; 3]);

impl GsplatSH1 {
    pub fn new(rgb3: [Vec3A; 3]) -> Self {
        Self(rgb3.map(|rgb| rgb.to_array().map(|v| f16::from_f32(v))))
    }

    pub fn set_from_array(&mut self, rgb3: &[f32]) {
        self.0 = array::from_fn(|k|
            array::from_fn(|d| f16::from_f32(rgb3[k * 3 + d]))
        );
    }

    pub fn to_array(&self) -> [f32; 9] {
        [
            self.0[0][0].to_f32(), self.0[0][1].to_f32(), self.0[0][2].to_f32(),
            self.0[1][0].to_f32(), self.0[1][1].to_f32(), self.0[1][2].to_f32(),
            self.0[2][0].to_f32(), self.0[2][1].to_f32(), self.0[2][2].to_f32(),
        ]
    }
}

#[derive(Debug, Clone, Default)]
pub struct GsplatSH2(pub [[f16; 3]; 5]);

impl GsplatSH2 {
    pub fn new(rgb5: [Vec3A; 5]) -> Self {
        Self(rgb5.map(|rgb| rgb.to_array().map(|v| f16::from_f32(v))))
    }

    pub fn set_from_array(&mut self, rgb5: &[f32]) {
        self.0 = array::from_fn(|k|
            array::from_fn(|d| f16::from_f32(rgb5[k * 3 + d]))
        );
    }

    pub fn to_array(&self) -> [f32; 15] {
        [
            self.0[0][0].to_f32(), self.0[0][1].to_f32(), self.0[0][2].to_f32(),
            self.0[1][0].to_f32(), self.0[1][1].to_f32(), self.0[1][2].to_f32(),
            self.0[2][0].to_f32(), self.0[2][1].to_f32(), self.0[2][2].to_f32(),
            self.0[3][0].to_f32(), self.0[3][1].to_f32(), self.0[3][2].to_f32(),
            self.0[4][0].to_f32(), self.0[4][1].to_f32(), self.0[4][2].to_f32(),
        ]
    }
}

#[derive(Debug, Clone, Default)]
pub struct GsplatSH3(pub [[f16; 3]; 7]);

impl GsplatSH3 {
    pub fn new(rgb7: [Vec3A; 7]) -> Self {
        Self(rgb7.map(|rgb| rgb.to_array().map(|v| f16::from_f32(v))))
    }

    pub fn set_from_array(&mut self, rgb7: &[f32]) {
        self.0 = array::from_fn(|k|
            array::from_fn(|d| f16::from_f32(rgb7[k * 3 + d]))
        );
    }

    pub fn to_array(&self) -> [f32; 21] {
        [
            self.0[0][0].to_f32(), self.0[0][1].to_f32(), self.0[0][2].to_f32(),
            self.0[1][0].to_f32(), self.0[1][1].to_f32(), self.0[1][2].to_f32(),
            self.0[2][0].to_f32(), self.0[2][1].to_f32(), self.0[2][2].to_f32(),
            self.0[3][0].to_f32(), self.0[3][1].to_f32(), self.0[3][2].to_f32(),
            self.0[4][0].to_f32(), self.0[4][1].to_f32(), self.0[4][2].to_f32(),
            self.0[5][0].to_f32(), self.0[5][1].to_f32(), self.0[5][2].to_f32(),
            self.0[6][0].to_f32(), self.0[6][1].to_f32(), self.0[6][2].to_f32(),
        ]
    }
}

impl Gsplat {
    pub fn new(center: Vec3A, opacity: f32, rgb: Vec3A, scales: Vec3A, quaternion: Quat) -> Self {
        Self {
            center,
            opacity: f16::from_f32(opacity),
            rgb: rgb.to_array().map(|v| f16::from_f32(v)),
            ln_scales: scales.to_array().map(|v| f16::from_f32(v.ln())),
            quaternion: quaternion.to_array().map(|v| f16::from_f32(v)),
        }
    }

    pub fn new_zero() -> Self {
        Self::default()
    }

    pub fn set_center(&mut self, center: Vec3A) {
        self.center = center;
    }

    pub fn set_opacity(&mut self, opacity: f32) {
        self.opacity = f16::from_f32(opacity);
    }

    pub fn opacity(&self) -> f32 {
        self.opacity.to_f32()
    }

    pub fn set_rgb(&mut self, rgb: Vec3A) {
        self.rgb = rgb.to_array().map(|v| f16::from_f32(v));
    }

    pub fn rgb(&self) -> Vec3A {
        Vec3A::from_array(self.rgb.map(|x| x.to_f32()))
    }

    pub fn set_scales(&mut self, scales: Vec3A) {
        self.ln_scales = scales.to_array().map(|v| f16::from_f32(v.ln()));
    }

    pub fn scales(&self) -> Vec3A {
        Vec3A::from_array(self.ln_scales.map(|x| x.to_f32().exp()))
    }

    pub fn set_quaternion(&mut self, quaternion: Quat) {
        self.quaternion = quaternion.to_array().map(|v| f16::from_f32(v));
    }

    pub fn quaternion(&self) -> Quat {
        Quat::from_array(self.quaternion.map(|x| x.to_f32()))
    }

    pub fn max_scale(&self) -> f32 {
        self.ln_scales[0].max(self.ln_scales[1]).max(self.ln_scales[2]).to_f32().exp()
    }

    pub fn area(&self) -> f32 {
        ellipsoid_area(self.scales())
    }

    pub fn dilation(&self) -> f32 {
        let opacity = self.opacity();
        if opacity > 1.0 {
            (1.0 + 2.0 * opacity.ln()).sqrt()
        } else {
            1.0
        }
    }

    pub fn feature_size(&self) -> f32 {
        2.0 * self.max_scale() * self.dilation()
    }

    pub fn grid(&self, step_size: f32) -> I64Vec3 {
        (self.center / step_size).floor().as_i64vec3()
    }
}

impl GsplatExtra {
    pub fn new(weight: f32, covariance: SymMat3, children: SmallVec<[usize; 8]>) -> Self {
        Self {
            weight,
            level: 0,
            covariance,
            children,
        }
    }

    pub fn new_from_gsplat(gsplat: &Gsplat) -> Self {
        let scales = gsplat.scales();
        let area = ellipsoid_area(scales);
        let weight = area * gsplat.opacity();
        let covariance = SymMat3::new_scale_quaternion(scales, gsplat.quaternion());
        Self::new(weight, covariance, SmallVec::new())
    }

    pub fn weight(&self) -> f32 {
        self.weight
    }
}


pub struct GsplatArray {
    pub max_sh_degree: usize,
    pub splats: Vec<Gsplat>,
    pub extras: Vec<GsplatExtra>,
    pub sh1: Vec<GsplatSH1>,
    pub sh2: Vec<GsplatSH2>,
    pub sh3: Vec<GsplatSH3>,
}

impl GsplatArray {
    pub fn new() -> Self {
        Self::new_capacity(0, 0)
    }

    pub fn len(&self) -> usize {
        self.splats.len()
    }

    pub fn new_capacity(capacity: usize, max_sh_degree: usize) -> Self {
        assert!(max_sh_degree <= 3, "SH degrees must be between 0 and 3");
        Self {
            max_sh_degree,
            splats: Vec::with_capacity(capacity),
            extras: Vec::with_capacity(capacity),
            sh1: Vec::with_capacity(if max_sh_degree >= 1 { capacity } else { 0 }),
            sh2: Vec::with_capacity(if max_sh_degree >= 2 { capacity } else { 0 }),
            sh3: Vec::with_capacity(if max_sh_degree >= 3 { capacity } else { 0 }),
        }
    }

    pub fn compute_extras(&mut self) {
        while self.extras.len() < self.splats.len() {
            let splat = &self.splats[self.extras.len()];
            self.extras.push(GsplatExtra::new_from_gsplat(splat));
        }
    }

    pub fn push_splat(
        &mut self,
        splat: Gsplat,
        sh1: Option<GsplatSH1>,
        sh2: Option<GsplatSH2>,
        sh3: Option<GsplatSH3>,
    ) -> usize {
        let index = self.splats.len();
        
        self.splats.push(splat);
        
        if self.max_sh_degree >= 1 {
            assert!(sh1.is_some(), "SH1 must be provided");
            self.sh1.push(sh1.unwrap());
        }

        if self.max_sh_degree >= 2 {
            assert!(sh2.is_some(), "SH2 must be provided");
            self.sh2.push(sh2.unwrap());
        }

        if self.max_sh_degree >= 3 {
            assert!(sh3.is_some(), "SH3 must be provided");
            self.sh3.push(sh3.unwrap());
        }

        index
    }

    pub const ROOT_INDEX: usize = 0;

    pub fn count(&self) -> usize {
        self.splats.len()
    }

    pub fn get(&self, index: usize) -> &Gsplat {
        &self.splats[index]
    }

    pub fn new_merged(&mut self, indices: &[usize], _debug: bool) -> usize {
        let new_index = self.splats.len();

        let total_weight = indices.iter()
            .map(|&index| self.extras[index as usize].weight())
            .sum::<f32>()
            .max(1.0e-100);

        let center: Vec3A = indices.iter().fold(Vec3A::ZERO, |center, &index| {
            let splat = &self.splats[index as usize];
            let weight = self.extras[index as usize].weight() / total_weight;
            splat.center.mul_add(Vec3A::splat(weight), center)
        });
        let rgb: Vec3A = indices.iter().fold(Vec3A::ZERO, |rgb, &index| {
            let splat = &self.splats[index as usize];
            let weight = self.extras[index as usize].weight() / total_weight;
            splat.rgb().mul_add(Vec3A::splat(weight), rgb)
        });

        let mut total_cov = SymMat3::new_zeros();
        // let filter2 = (0.6 * step).powi(2);
        let filter2 = 0.0;
        for &index in indices {
            let splat = &self.splats[index as usize];
            let extra = &self.extras[index as usize];
            let weight = extra.weight() / total_weight;
            let delta = splat.center - center;
            let cov: SymMat3 = extra.covariance.into();
            let xx = delta.x * delta.x + cov.xx() + filter2;
            let yy = delta.y * delta.y + cov.yy() + filter2;
            let zz = delta.z * delta.z + cov.zz() + filter2;
            let xy = delta.x * delta.y + cov.xy();
            let xz = delta.x * delta.z + cov.xz();
            let yz = delta.y * delta.z + cov.yz();
            total_cov.add_weighted(&SymMat3::new([xx, yy, zz, xy, xz, yz]), weight);
        }

        let (vals, vecs) = total_cov.positive_eigens();
        let scales = Vec3A::from_array(vals.map(|v| v.max(0.0).sqrt()));
        assert!(scales.x.is_finite() && scales.y.is_finite() && scales.z.is_finite());

        let basis = Mat3A::from_cols(vecs[0], vecs[1], vecs[2]);
        let quaternion = Quat::from_mat3a(&basis);

        let opacity = (total_weight / ellipsoid_area(scales)).min(1000.0);
        let children: SmallVec<[usize; 8]> = indices.iter().copied().collect();

        self.splats.push(Gsplat::new(center, opacity, rgb, scales, quaternion));
        self.extras.push(GsplatExtra::new(total_weight, total_cov, children));

        if self.max_sh_degree >= 1 {
            let mut total = [Vec3A::ZERO; 3];
            for &index in indices {
                let weight = self.extras[index as usize].weight() / total_weight;
                let sh1 = &self.sh1[index as usize];
                total = std::array::from_fn(|i| {
                    let rgb = Vec3A::from_array(sh1.0[i].map(|v| v.to_f32()));
                    rgb.mul_add(Vec3A::splat(weight), total[i])
                })
            }
            self.sh1.push(GsplatSH1::new(total));
        }

        if self.max_sh_degree >= 2 {
            let mut total = [Vec3A::ZERO; 5];
            for &index in indices {
                let weight = self.extras[index as usize].weight() / total_weight;
                let sh2 = &self.sh2[index as usize];
                total = std::array::from_fn(|i| {
                    let rgb = Vec3A::from_array(sh2.0[i].map(|v| v.to_f32()));
                    rgb.mul_add(Vec3A::splat(weight), total[i])
                })
            }
            self.sh2.push(GsplatSH2::new(total));
        }

        if self.max_sh_degree >= 3 {
            let mut total = [Vec3A::ZERO; 7];
            for &index in indices {
                let weight = self.extras[index as usize].weight() / total_weight;
                let sh3 = &self.sh3[index as usize];
                total = std::array::from_fn(|i| {
                    let rgb = Vec3A::from_array(sh3.0[i].map(|v| v.to_f32()));
                    rgb.mul_add(Vec3A::splat(weight), total[i])
                })
            }
            self.sh3.push(GsplatSH3::new(total));
        }

        new_index
    }

    pub fn retain<F: (Fn(&Gsplat) -> bool)>(&mut self, f: F) {
        let keep: Vec<bool> = self.splats.iter().map(|splat| f(splat)).collect();
        let mut bits = keep.iter();
        self.splats.retain(|_splat| *bits.next().unwrap());
        if !self.extras.is_empty() {
            let mut bits = keep.iter();
            self.extras.retain(|_extra| *bits.next().unwrap());
        }
        if !self.sh1.is_empty() {
            let mut bits = keep.iter();
            self.sh1.retain(|_sh1| *bits.next().unwrap());
        }
        if !self.sh2.is_empty() {
            let mut bits = keep.iter();
            self.sh2.retain(|_sh2| *bits.next().unwrap());
        }
        if !self.sh3.is_empty() {
            let mut bits = keep.iter();
            self.sh3.retain(|_sh3| *bits.next().unwrap());
        }
    }

    pub fn permute(&mut self, index_map: &[usize]) {
        assert_eq!(index_map.len(), self.splats.len());
        let swaps = compute_swaps(index_map);
        apply_swaps(&mut self.splats, &swaps);
        if !self.extras.is_empty() {
            apply_swaps(&mut self.extras, &swaps);
        }
        if !self.sh1.is_empty() {
            apply_swaps(&mut self.sh1, &swaps);
        }
        if !self.sh2.is_empty() {
            apply_swaps(&mut self.sh2, &swaps);
        }
        if !self.sh3.is_empty() {
            apply_swaps(&mut self.sh3, &swaps);
        }
    }

    pub fn sort_by<F: (Fn(&Gsplat) -> f32)>(&mut self, f: F) {
        let mut index_map = Vec::with_capacity(self.splats.len());
        index_map.extend(0..self.splats.len());
        index_map.sort_by_key(|&index| OrderedFloat(f(&self.splats[index])));
        self.permute(&index_map);
    }

    pub fn to_packed_array(&self, encoding: &SplatEncoding) -> (usize, Vec<u32>) {
        let (_, _, _, max_splats) = get_splat_tex_size(self.splats.len());
        let mut packed = Vec::new();
        packed.resize(max_splats * 4, 0);

        for i in 0..self.splats.len() {
            let i4 = i * 4;
            encode_packed_splat(
                &mut packed[i4..i4 + 4],
                self.splats[i].center.to_array(),
                self.splats[i].opacity(),
                self.splats[i].rgb().to_array(),
                self.splats[i].scales().to_array(),
                self.splats[i].quaternion().to_array(),
                encoding
            );
        }

        (self.splats.len(), packed)
    }

    pub fn to_packed_sh1(&self, encoding: &SplatEncoding) -> Vec<u32> {
        if self.max_sh_degree < 1 {
            return Vec::new();
        }
        let (_, _, _, max_splats) = get_splat_tex_size(self.splats.len());
        let mut sh1 = Vec::new();
        sh1.resize(max_splats * 2, 0);
        let SplatEncoding { sh1_min, sh1_max, .. } = encoding;

        for i in 0..self.splats.len() {
            let i2 = i * 2;
            let encoded = encode_sh1(&self.sh1[i].to_array(), *sh1_min, *sh1_max);
            for w in 0..2 {
                sh1[i2 + w] = encoded[w];
            }
        }
        sh1
    }

    pub fn to_packed_sh2(&self, encoding: &SplatEncoding) -> Vec<u32> {
        if self.max_sh_degree < 2 {
            return Vec::new();
        }
        let (_, _, _, max_splats) = get_splat_tex_size(self.splats.len());
        let mut sh2 = Vec::new();
        sh2.resize(max_splats * 4, 0);
        let SplatEncoding { sh2_min, sh2_max, .. } = encoding;
        
        for i in 0..self.splats.len() {
            let i4 = i * 4;
            let encoded = encode_sh2(&self.sh2[i].to_array(), *sh2_min, *sh2_max);
            for w in 0..4 {
                sh2[i4 + w] = encoded[w];
            }
        }
        sh2
    }

    pub fn to_packed_sh3(&self, encoding: &SplatEncoding) -> Vec<u32> {
        if self.max_sh_degree < 3 {
            return Vec::new();
        }
        let (_, _, _, max_splats) = get_splat_tex_size(self.splats.len());
        let mut sh3 = Vec::new();
        sh3.resize(max_splats * 4, 0);
        let SplatEncoding { sh3_min, sh3_max, .. } = encoding;

        for i in 0..self.splats.len() {
            let i4 = i * 4;
            let encoded = encode_sh3(&self.sh3[i].to_array(), *sh3_min, *sh3_max);
            for w in 0..4 {
                sh3[i4 + w] = encoded[w];
            }
        }
        sh3
    }
}

fn ellipsoid_area(scales: Vec3A) -> f32 {
    const P: f32 = 1.6075;
    let numerator = (scales.x * scales.y).powf(P) + (scales.x * scales.z).powf(P) + (scales.y * scales.z).powf(P);
    4.0 * std::f32::consts::PI * (numerator / 3.0).powf(1.0 / P)
}

impl SplatReceiver for GsplatArray {
    fn init_splats(&mut self, init: &SplatInit) -> anyhow::Result<()> {
        self.max_sh_degree = init.max_sh_degree;
        self.splats.resize_with(init.num_splats, Default::default);

        self.sh1.clear();
        if self.max_sh_degree >= 1 {
            self.sh1.resize_with(init.num_splats, Default::default);
        }

        self.sh2.clear();
        if self.max_sh_degree >= 2 {
            self.sh2.resize_with(init.num_splats, Default::default);
        }

        self.sh3.clear();
        if self.max_sh_degree >= 3 {
            self.sh3.resize_with(init.num_splats, Default::default);
        }

        self.extras.clear();
        if init.lod_tree {
            self.extras.resize_with(init.num_splats, Default::default);
        }

        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    fn debug(&self, value: usize) {
        println!("debug: {}", value);
    }

    fn set_encoding(&mut self, _encoding: &SetSplatEncoding) -> anyhow::Result<()> {
        Ok(())
    }

    fn set_batch(&mut self, base: usize, count: usize, batch: &SplatProps) {
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let splat = &mut self.splats[base + i];
            splat.set_center(Vec3A::from_slice(&batch.center[i3..i3 + 3]));
            splat.set_opacity(batch.opacity[i]);
            splat.set_rgb(Vec3A::from_slice(&batch.rgb[i3..i3 + 3]));
            splat.set_scales(Vec3A::from_slice(&batch.scale[i3..i3 + 3]));
            splat.set_quaternion(Quat::from_slice(&batch.quat[i4..i4 + 4]));
        }

        self.set_sh(base, count, batch.sh1, batch.sh2, batch.sh3);

        if !batch.child_count.is_empty() && !batch.child_start.is_empty() {
            self.set_child_start(base, count, batch.child_start);
            self.set_child_count(base, count, batch.child_count);
        }
    }

    fn set_center(&mut self, base: usize, count: usize, center: &[f32]) {
        for i in 0..count {
            let i3 = i * 3;
            self.splats[base + i].set_center(Vec3A::from_slice(&center[i3..i3 + 3]));
        }
    }

    fn set_opacity(&mut self, base: usize, count: usize, opacity: &[f32]) {
        for i in 0..count {
            self.splats[base + i].set_opacity(opacity[i]);
        }
    }

    fn set_rgb(&mut self, base: usize, count: usize, rgb: &[f32]) {
        for i in 0..count {
            let i3 = i * 3;
            self.splats[base + i].set_rgb(Vec3A::from_slice(&rgb[i3..i3 + 3]));
        }
    }

    fn set_rgba(&mut self, base: usize, count: usize, rgba: &[f32]) {
        for i in 0..count {
            let i4 = 4 * i;
            let splat = &mut self.splats[base + i];
            splat.set_rgb(Vec3A::from_slice(&rgba[i4..i4 + 3]));
            splat.set_opacity(rgba[i4 + 3]);
        }
    }

    fn set_scale(&mut self, base: usize, count: usize, scale: &[f32]) {
        for i in 0..count {
            let i3 = i * 3;
            self.splats[base + i].set_scales(Vec3A::from_slice(&scale[i3..i3 + 3]));
        }
    }

    fn set_quat(&mut self, base: usize, count: usize, quat: &[f32]) {
        for i in 0..count {
            let i4 = 4 * i;
            self.splats[base + i].set_quaternion(Quat::from_slice(&quat[i4..i4 + 4]));
        }
    }

    fn set_sh(&mut self, base: usize, count: usize, sh1: &[f32], sh2: &[f32], sh3: &[f32]) {
        if !sh1.is_empty() {
            self.set_sh1(base, count, sh1);
        }
        if !sh2.is_empty() {
            self.set_sh2(base, count, sh2);
        }
        if !sh3.is_empty() {
            self.set_sh3(base, count, sh3);
        }
    }

    fn set_sh1(&mut self, base: usize, count: usize, sh1: &[f32]) {
        if self.max_sh_degree >= 1 {
            for i in 0..count {
                let i9 = i * 9;
                self.sh1[base + i].set_from_array(&sh1[i9..i9 + 9]);
            }
        }
    }

    fn set_sh2(&mut self, base: usize, count: usize, sh2: &[f32]) {
        if self.max_sh_degree >= 2 {
            for i in 0..count {
                let i15 = i * 15;
                self.sh2[base + i].set_from_array(&sh2[i15..i15 + 15]);
            }
        }
    }

    fn set_sh3(&mut self, base: usize, count: usize, sh3: &[f32]) {
        if self.max_sh_degree >= 3 {
            for i in 0..count {
                let i21 = i * 21;
                self.sh3[base + i].set_from_array(&sh3[i21..i21 + 21]);
            }
        }
    }

    fn set_child_count(&mut self, base: usize, count: usize, child_count: &[u16]) {
        for i in 0..count {
            let mut child_index = *self.extras[base + i].children.get(0).unwrap_or(&0);
            self.extras[base + i].children.clear();
            self.extras[base + i].children.resize_with(child_count[i] as usize, || {
                let child = child_index;
                child_index += 1;
                child
            });
        }
    }

    fn set_child_start(&mut self, base: usize, count: usize, child_start: &[usize]) {
        for i in 0..count {
            let mut child_index = child_start[i];
            if child_index == 0 {
                self.extras[base + i].children.clear();
            } else {
                let count = self.extras[base + i].children.len().max(1);
                self.extras[base + i].children.clear();
                self.extras[base + i].children.resize_with(count, || {
                    let child = child_index;
                    child_index += 1;
                    child
                });
            }
        }
    }
}

fn compute_swaps(index_map: &[usize]) -> Vec<(usize, usize)> {
    let n = index_map.len();
    // dest_of_src[old] = new
    let mut dest_of_src = vec![0usize; n];
    for (new_i, &old_i) in index_map.iter().enumerate() {
        dest_of_src[old_i] = new_i;
    }

    let mut swaps = Vec::new();
    for i in 0..n {
        while dest_of_src[i] != i {
            let j = dest_of_src[i];
            swaps.push((i, j));
            dest_of_src.swap(i, j);
        }
    }
    swaps
}

fn apply_swaps<T>(data: &mut [T], swaps: &[(usize, usize)]) {
    for &(a, b) in swaps {
        data.swap(a, b);
    }
}
