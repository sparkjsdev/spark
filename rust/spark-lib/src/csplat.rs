use glam::{Mat3A, Quat, Vec3, Vec3A};
use half::f16;
use smallvec::SmallVec;

use crate::{decoder::{SetSplatEncoding, SplatEncoding, SplatGetter, SplatInit, SplatProps, SplatReceiver}, splat_encode::{decode_quat_oct888, decode_scale8, encode_quat_oct888, encode_scale8}, symmat3::SymMat3, tsplat::{Tsplat, TsplatArray, ellipsoid_area}};

#[derive(Clone, Default)]
pub struct Csplat {
    pub center: Vec3,
    pub opacity: f16,
    pub rgb: [u8; 3],
    pub scales: [u8; 3],
    pub octrot: [u8; 3],
}

impl std::fmt::Debug for Csplat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Csplat(center: {:?}, opacity: {:?}, rgb: {:?}, scales: {:?}, quaternion: {:?})", self.center(), self.opacity(), self.rgb(), self.scales(), self.quaternion())
    }
}

impl Csplat {
    pub fn new(center: Vec3A, opacity: f32, rgb: Vec3A, scales: Vec3A, quaternion: Quat) -> Self {
        Self {
            center: center.to_vec3(),
            opacity: f16::from_f32(opacity),
            rgb: rgb.to_array().map(|v| (v * 255.0).clamp(0.0, 255.0).round() as u8),
            scales: scales.to_array().map(|v| encode_scale8(v, SplatEncoding::default().ln_scale_min, SplatEncoding::default().ln_scale_max)),
            octrot: encode_quat_oct888(quaternion.to_array()),
        }
    }

    pub fn new_zero() -> Self {
        Self::default()
    }
}

impl Tsplat for Csplat {
    fn center(&self) -> Vec3A {
        self.center.to_vec3a()
    }

    fn opacity(&self) -> f32 {
        self.opacity.to_f32()
    }

    fn rgb(&self) -> Vec3A {
        Vec3A::from_array(self.rgb.map(|x| x as f32 / 255.0))
    }

    fn scales(&self) -> Vec3A {
        Vec3A::from_array(self.scales.map(|x| decode_scale8(x, SplatEncoding::default().ln_scale_min, SplatEncoding::default().ln_scale_max)))
    }

    fn quaternion(&self) -> Quat {
        Quat::from_array(decode_quat_oct888(self.octrot))
    }

    fn set_center(&mut self, center: Vec3A) {
        self.center = center.to_vec3();
    }
    
    fn set_opacity(&mut self, opacity: f32) {
        self.opacity = f16::from_f32(opacity);
    }

    fn set_rgb(&mut self, rgb: Vec3A) {
        self.rgb = rgb.to_array().map(|v| (v * 255.0).clamp(0.0, 255.0).round() as u8);
    }

    fn set_scales(&mut self, scales: Vec3A) {
        self.scales = scales.to_array().map(|v| encode_scale8(v, SplatEncoding::default().ln_scale_min, SplatEncoding::default().ln_scale_max));
    }

    fn set_quaternion(&mut self, quaternion: Quat) {
        self.octrot = encode_quat_oct888(quaternion.to_array());
    }

    fn max_scale(&self) -> f32 {
        let max = self.scales[0].max(self.scales[1]).max(self.scales[2]);
        decode_scale8(max, SplatEncoding::default().ln_scale_min, SplatEncoding::default().ln_scale_max)
    }
}

pub struct CsplatArray {
    pub max_sh_degree: usize,
    pub splats: Vec<Csplat>,
    pub children: Vec<SmallVec<[u32; 4]>>,
    pub sh1: Vec<[i8; 9]>,
    pub sh2: Vec<[i8; 15]>,
    pub sh3: Vec<[i8; 21]>,
}

impl TsplatArray for CsplatArray {
    type Splat = Csplat;

    fn new_capacity(capacity: usize, max_sh_degree: usize) -> Self {
        assert!(max_sh_degree <= 3, "SH degrees must be between 0 and 3");
        Self {
            max_sh_degree,
            splats: Vec::with_capacity(capacity),
            children: Vec::new(),//Vec::with_capacity(capacity),
            sh1: Vec::with_capacity(if max_sh_degree >= 1 { capacity } else { 0 }),
            sh2: Vec::with_capacity(if max_sh_degree >= 2 { capacity } else { 0 }),
            sh3: Vec::with_capacity(if max_sh_degree >= 3 { capacity } else { 0 }),
        }
    }

    fn max_sh_degree(&self) -> usize {
        self.max_sh_degree
    }

    fn set_max_sh_degree(&mut self, max_sh_degree: usize) {
        assert!(max_sh_degree <= 3, "SH degrees must be between 0 and 3");
        self.max_sh_degree = max_sh_degree;
    }

    fn len(&self) -> usize {
        self.splats.len()
    }

    fn get(&self, index: usize) -> &Csplat {
        &self.splats[index]
    }

    fn get_mut(&mut self, index: usize) -> &mut Csplat {
        &mut self.splats[index]
    }

    fn prepare_extra(&mut self) {
        self.children.resize_with(self.len(), || SmallVec::new());
    }

    fn new_merged(&mut self, indices: &[usize], step: f32) -> usize {
        // println!("new_merged: {:?}", indices);
        // for &index in indices {
        //     let splat = &self.splats[index];
        //     println!("splat: {:?}", splat);
        // }
        let new_index = self.splats.len();

        let mut weight: SmallVec<[f32; 32]> = indices.iter().map(|&index| {
            let splat = &self.splats[index];
            splat.area() * splat.opacity()
        }).collect();
        // println!("weight: {:?}", weight);

        let total_weight = weight.iter().sum::<f32>().max(1.0e-100);

        weight.iter_mut().for_each(|w| *w /= total_weight);
        // println!("normalized weight: {:?}", weight);

        let mut center = Vec3A::ZERO;
        let mut rgb = Vec3A::ZERO;

        for (i, &index) in indices.iter().enumerate() {
            let splat = &self.splats[index];
            let weight = weight[i];
            center = splat.center().mul_add(Vec3A::splat(weight), center);
            rgb = splat.rgb().mul_add(Vec3A::splat(weight), rgb);
            // println!("center: {:?}, rgb: {:?}, weight: {:?}", center, rgb, weight);
        }

        let mut total_cov = SymMat3::new_zeros();
        let filter2 = (0.5 * step).powi(2);

        for (i, &index) in indices.iter().enumerate() {
            let splat = &self.splats[index];
            let weight = weight[i];
            let delta = splat.center() - center;
            let cov = SymMat3::new_scale_quaternion(splat.scales(), splat.quaternion());
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

        self.splats.push(Csplat::new(center, opacity, rgb, scales, quaternion));
        // println!("new_splat: {:?}", self.splats.last().unwrap());
        
        if self.children.len() <= new_index {
            self.children.resize(new_index + 1, SmallVec::new());
        }
        self.children[new_index] = indices.iter().map(|&i| i as u32).collect();

        if self.max_sh_degree >= 1 {
            let mut total = [0.0; 9];
            for (i, &index) in indices.iter().enumerate() {
                let weight = weight[i];
                let sh1 = &self.sh1[index];
                total = std::array::from_fn(|i| {
                    total[i] + weight * sh1[i] as f32 / 127.0
                });
            }

            let total_i8 = total.map(|v| (v * 127.0).clamp(-127.0, 127.0).round() as i8);
            self.sh1.push(total_i8);
        }

        if self.max_sh_degree >= 2 {
            let mut total = [0.0; 15];
            for (i, &index) in indices.iter().enumerate() {
                let weight = weight[i];
                let sh2 = &self.sh2[index];
                total = std::array::from_fn(|i| {
                    total[i] + weight * sh2[i] as f32 / 127.0
                });
            }
            let total_i8 = total.map(|v| (v * 127.0).clamp(-127.0, 127.0).round() as i8);
            self.sh2.push(total_i8);
        }

        if self.max_sh_degree >= 3 {
            let mut total = [0.0; 21];
            for (i, &index) in indices.iter().enumerate() {
                let weight = weight[i];
                let sh3 = &self.sh3[index];
                total = std::array::from_fn(|i| {
                    total[i] + weight * sh3[i] as f32 / 127.0
                });
            }
            let total_i8 = total.map(|v| (v * 127.0).clamp(-127.0, 127.0).round() as i8);
            self.sh3.push(total_i8);
        }

        new_index
    }

    fn set_children(&mut self, parent: usize, children: &[usize]) {
        self.children[parent] = children.iter().map(|&i| i as u32).collect();
    }

    fn clear_children(&mut self) {
        self.children.clear();
    }

    fn retain<F: (FnMut(&mut Csplat) -> bool)>(&mut self, mut f: F) {
        let keep: Vec<bool> = self.splats.iter_mut().map(|splat| f(splat)).collect();
        let mut bits = keep.iter();

        self.splats.retain(|_splat| *bits.next().unwrap());
        if !self.children.is_empty() {
            let mut bits = keep.iter();
            self.children.retain(|_children| *bits.next().unwrap());
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

    fn retain_children<F: (FnMut(&mut Csplat, &[usize]) -> bool)>(&mut self, mut f: F) {
        let keep: Vec<bool> = self.splats.iter_mut().enumerate()
            .map(|(i, splat)| {
                if let Some(children) = self.children.get(i) {
                    let children: SmallVec<[usize; 4]> = children.iter().map(|&i| i as usize).collect();
                    f(splat, &children)
                } else {
                    f(splat, &[])
                }
            })
            .collect();
        let mut bits = keep.iter();

        self.splats.retain(|_splat| *bits.next().unwrap());
        if !self.children.is_empty() {
            let mut bits = keep.iter();
            self.children.retain(|_children| *bits.next().unwrap());
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

    fn permute(&mut self, index_map: &[usize]) {
        assert_eq!(index_map.len(), self.splats.len());
        let swaps = compute_swaps(index_map);
        apply_swaps(&mut self.splats, &swaps);
        if !self.children.is_empty() {
            apply_swaps(&mut self.children, &swaps);
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

    fn new_from_index_map(&mut self, index_map: &[usize]) -> Self {
        Self {
            max_sh_degree: self.max_sh_degree,
            splats: index_map.iter().map(|&i| self.splats[i as usize].clone()).collect(),
            children: if !self.children.is_empty() { index_map.iter().map(|&i| self.children[i as usize].clone()).collect() } else { Vec::new() },
            sh1: if !self.sh1.is_empty() { index_map.iter().map(|&i| self.sh1[i as usize].clone()).collect() } else { Vec::new() },
            sh2: if !self.sh2.is_empty() { index_map.iter().map(|&i| self.sh2[i as usize].clone()).collect() } else { Vec::new() },
            sh3: if !self.sh3.is_empty() { index_map.iter().map(|&i| self.sh3[i as usize].clone()).collect() } else { Vec::new() },
        }
    }

    fn clone_subset(&self, start: usize, count: usize) -> Self {
        Self {
            max_sh_degree: self.max_sh_degree,
            splats: self.splats[start..start + count].to_vec(),
            children: if self.children.is_empty() { Vec::new() } else { self.children[start..start + count].to_vec() },
            sh1: if self.sh1.is_empty() { Vec::new() } else { self.sh1[start..start + count].to_vec() },
            sh2: if self.sh2.is_empty() { Vec::new() } else { self.sh2[start..start + count].to_vec() },
            sh3: if self.sh3.is_empty() { Vec::new() } else { self.sh3[start..start + count].to_vec() },
        }
    }
}

impl CsplatArray {
    // pub fn push_splat(
    //     &mut self,
    //     splat: Csplat,
    //     sh1: Option<[i8; 9]>,
    //     sh2: Option<[i8; 15]>,
    //     sh3: Option<[i8; 21]>,
    // ) -> u32 {
    //     let index = self.splats.len() as u32;
    //     self.splats.push(splat);
    //     if self.max_sh_degree >= 1 {
    //         assert!(sh1.is_some(), "SH1 must be provided");
    //         self.sh1.push(sh1.unwrap());
    //     }
    //     if self.max_sh_degree >= 2 {
    //         assert!(sh2.is_some(), "SH2 must be provided");
    //         self.sh2.push(sh2.unwrap());
    //     }
    //     if self.max_sh_degree >= 3 {
    //         assert!(sh3.is_some(), "SH3 must be provided");
    //         self.sh3.push(sh3.unwrap());
    //     }
    //     index
    // }

    // pub fn inject_rgba8(&mut self, rgba: &[u8]) {
    //     for i in 0..self.splats.len() {
    //         let i4 = i * 4;
    //         self.splats[i].set_opacity(rgba[i4 + 3] as f32 / 255.0);
    //         let rgb = Vec3A::from_array(array::from_fn(|d| rgba[i4 + d] as f32 / 255.0));
    //         self.splats[i].set_rgb(rgb);
    //     }
    // }
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

impl SplatReceiver for CsplatArray {
    fn init_splats(&mut self, init: &SplatInit) -> anyhow::Result<()> {
        self.max_sh_degree = init.max_sh_degree;

        if !init.lod_tree {
            // Reserve 50% more space for interior nodes for LoD tree
            let est_lod_size = (init.num_splats as f32 * 1.5).ceil() as usize;
            self.splats.reserve(est_lod_size);
            self.children.reserve(est_lod_size);
            if self.max_sh_degree >= 1 {
                self.sh1.reserve(est_lod_size);
            }
            if self.max_sh_degree >= 2 {
                self.sh2.reserve(est_lod_size);
            }
            if self.max_sh_degree >= 3 {
                self.sh3.reserve(est_lod_size);
            }
        }

        self.splats.resize_with(init.num_splats, Default::default);

        if self.max_sh_degree >= 1 {
            self.sh1.resize_with(init.num_splats, Default::default);
        }
        if self.max_sh_degree >= 2 {
            self.sh2.resize_with(init.num_splats, Default::default);
        }
        if self.max_sh_degree >= 3 {
            self.sh3.resize_with(init.num_splats, Default::default);
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
            self.splats[base + i].set_center(Vec3A::from_slice(&batch.center[i3..i3 + 3]));
            self.splats[base + i].set_opacity(batch.opacity[i]);
            self.splats[base + i].set_rgb(Vec3A::from_slice(&batch.rgb[i3..i3 + 3]));
            self.splats[base + i].set_scales(Vec3A::from_slice(&batch.scale[i3..i3 + 3]));
            self.splats[base + i].set_quaternion(Quat::from_slice(&batch.quat[i4..i4 + 4]));
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
            let i4 = i * 4;
            self.splats[base + i].set_rgb(Vec3A::from_slice(&rgba[i4..i4 + 3]));
            self.splats[base + i].set_opacity(rgba[i4 + 3]);
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
            let i4 = i * 4;
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
                for k in 0..9 {
                    self.sh1[base + i][k] = (sh1[i9 + k] * (127.0 / 1.0)).clamp(-127.0, 127.0).round() as i8;
                }
            }
        }
    }

    fn set_sh2(&mut self, base: usize, count: usize, sh2: &[f32]) {
        if self.max_sh_degree >= 2 {
            for i in 0..count {
                let i15 = i * 15;
                for k in 0..15 {
                    self.sh2[base + i][k] = (sh2[i15 + k] * (127.0 / 1.0)).clamp(-127.0, 127.0).round() as i8;
                }
            }
        }
    }

    fn set_sh3(&mut self, base: usize, count: usize, sh3: &[f32]) {
        if self.max_sh_degree >= 3 {
            for i in 0..count {
                let i21 = i * 21;
                for k in 0..21 {
                    self.sh3[base + i][k] = (sh3[i21 + k] * (127.0 / 1.0)).clamp(-127.0, 127.0).round() as i8;
                }
            }
        }
    }

    fn set_child_count(&mut self, base: usize, count: usize, child_count: &[u16]) {
        for i in 0..count {
            let mut child_index = *self.children[base + i].get(0).unwrap_or(&0);
            self.children[base + i].clear();
            self.children[base + i].resize_with(child_count[i] as usize, || {
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
                self.children[base + i].clear();
            } else {
                let count = self.children[base + i].len().max(1);
                self.children[base + i].clear();
                self.children[base + i].resize_with(count, || {
                    let child = child_index;
                    child_index += 1;
                    child as u32
                });
            }
        }
    }
}

impl SplatGetter for CsplatArray {
    fn num_splats(&self) -> usize { self.len() }
    fn max_sh_degree(&self) -> usize { self.max_sh_degree }
    fn flag_antialias(&self) -> bool { true }
    fn has_lod_tree(&self) -> bool { !self.children.is_empty() }
    fn get_encoding(&mut self) -> SplatEncoding { SplatEncoding::default() }

    fn get_center(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let c = self.splats[base + i].center.to_array();
            out[i * 3 + 0] = c[0];
            out[i * 3 + 1] = c[1];
            out[i * 3 + 2] = c[2];
        }
    }

    fn get_opacity(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            out[i] = self.splats[base + i].opacity();
        }
    }

    fn get_rgb(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let r = self.splats[base + i].rgb().to_array();
            out[i * 3 + 0] = r[0];
            out[i * 3 + 1] = r[1];
            out[i * 3 + 2] = r[2];
        }
    }

    fn get_scale(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let s = self.splats[base + i].scales().to_array();
            out[i * 3 + 0] = s[0];
            out[i * 3 + 1] = s[1];
            out[i * 3 + 2] = s[2];
        }
    }

    fn get_quat(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let q = self.splats[base + i].quaternion().to_array();
            out[i * 4 + 0] = q[0];
            out[i * 4 + 1] = q[1];
            out[i * 4 + 2] = q[2];
            out[i * 4 + 3] = q[3];
        }
    }

    fn get_sh1(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if self.max_sh_degree >= 1 {
            for i in 0..count {
                for k in 0..9 {
                    out[i * 9 + k] = self.sh1[base + i][k] as f32 / 127.0;
                }
            }
        }
    }

    fn get_sh2(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if self.max_sh_degree >= 2 {
            for i in 0..count {
                for k in 0..15 {
                    out[i * 15 + k] = self.sh2[base + i][k] as f32 / 127.0;
                }
            }
        }
    }

    fn get_sh3(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if self.max_sh_degree >= 3 {
            for i in 0..count {
                for k in 0..21 {
                    out[i * 21 + k] = self.sh3[base + i][k] as f32 / 127.0;
                }
            }
        }
    }

    fn get_child_count(&mut self, base: usize, count: usize, out: &mut [u16]) {
        for i in 0..count {
            out[i] = self.children[base + i].len() as u16;
        }
    }

    fn get_child_start(&mut self, base: usize, count: usize, out: &mut [usize]) {
        for i in 0..count {
            out[i] = self.children[base + i].first().copied().unwrap_or(0) as usize;
        }
    }
}