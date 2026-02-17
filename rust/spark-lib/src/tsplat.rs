use glam::{I64Vec3, Quat, Vec3A};
use ordered_float::OrderedFloat;
use smallvec::SmallVec;

use crate::symmat3::SymMat3;

pub trait Tsplat: std::fmt::Debug {
    fn center(&self) -> Vec3A;
    fn opacity(&self) -> f32;
    fn rgb(&self) -> Vec3A;
    fn scales(&self) -> Vec3A;
    fn quaternion(&self) -> Quat;

    fn max_scale(&self) -> f32 { self.scales().max_element() }
    
    fn area(&self) -> f32 { ellipsoid_area(self.scales()) }

    fn dilation(&self) -> f32 {
        let opacity = self.opacity();
        if opacity > 1.0 {
            (1.0 + 2.0 * opacity.ln()).sqrt()
        } else {
            1.0
        }
    }

    fn lod_opacity(&self) -> f32 {
        let opacity = self.opacity();
        if opacity > 1.0 {
            (1.0 + core::f32::consts::E * opacity.ln()).sqrt()
        } else {
            1.0
        }
    }
    
    fn feature_size(&self) -> f32 {
        2.0 * self.max_scale() * self.lod_opacity()
    }

    fn grid(&self, step_size: f32) -> I64Vec3 {
        (self.center() / step_size).floor().as_i64vec3()
    }

    fn grid_i32(&self, step_size: f32) -> [i32; 3] {
        (self.center() / step_size).floor().to_array().map(|x| x as i32)
    }

    fn distance(&self, other: &Self) -> f32 {
        self.center().distance(other.center())
    }
}

pub trait TsplatMut: Tsplat {
    fn set_center(&mut self, center: Vec3A);
    fn set_opacity(&mut self, opacity: f32);
    fn set_rgb(&mut self, rgb: Vec3A);
    fn set_scales(&mut self, scales: Vec3A);
    fn set_quaternion(&mut self, quaternion: Quat);
}

pub trait TsplatArray {
    type Splat<'a>: Tsplat where Self: 'a;
    type SplatMut<'a>: TsplatMut where Self: 'a;

    fn new() -> Self where Self: Sized { Self::new_capacity(0, 0) }
    fn new_capacity(capacity: usize, max_sh_degree: usize) -> Self;

    fn max_sh_degree(&self) -> usize;
    fn set_max_sh_degree(&mut self, max_sh_degree: usize);

    fn len(&self) -> usize;
    fn get(&self, index: usize) -> Self::Splat<'_>;
    fn get_mut(&mut self, index: usize) -> Self::SplatMut<'_>;

    fn prepare_children(&mut self);
    fn has_children(&self) -> bool;
    fn new_merged(&mut self, indices: &[usize], filter_size: f32) -> usize;
    fn set_children(&mut self, parent: usize, children: &[usize]);
    fn get_children(&self, parent: usize) -> SmallVec<[usize; 8]>;
    fn get_child_count_start(&self, index: usize) -> (usize, usize);
    fn clear_children(&mut self);

    fn get_sh1(&self, index: usize) -> [f32; 9];
    fn get_sh2(&self, index: usize) -> [f32; 15];
    fn get_sh3(&self, index: usize) -> [f32; 21];

    fn similarity(&self, a: usize, b: usize) -> f32;

    fn retain<F: (FnMut(Self::SplatMut<'_>) -> bool)>(&mut self, f: F);
    fn retain_children<F: (FnMut(Self::SplatMut<'_>, &[usize]) -> bool)>(&mut self, f: F);
    fn permute(&mut self, index_map: &[usize]);
    fn truncate(&mut self, count: usize);
    fn new_from_index_map(&mut self, index_map: &[usize]) -> Self;
    fn clone_subset(&self, start: usize, count: usize) -> Self;

    fn sort_by<F: (Fn(Self::Splat<'_>) -> f32)>(&mut self, f: F) {
        let mut index_map = Vec::with_capacity(self.len());
        index_map.extend(0..self.len());
        index_map.sort_by_key(|&index| OrderedFloat(f(self.get(index))));
        self.permute(&index_map);
    }

    fn inject_rgba8(&mut self, rgba: &[u8]) {
        for i in 0..self.len() {
            let i4 = i * 4;
            let opacity = rgba[i4 + 3] as f32 / 255.0;
            let rgb = Vec3A::from_array(std::array::from_fn(|d| rgba[i4 + d] as f32 / 255.0));
            let mut splat = self.get_mut(i);
            splat.set_opacity(opacity);
            splat.set_rgb(rgb);
        }
    }

    fn remove_invalid(&mut self) {
        self.retain(|splat| {
            splat.opacity() > 0.0 && splat.max_scale() > 0.0 &&
            splat.quaternion().is_finite() && splat.quaternion().length() > 0.0
        });
    }
}

pub fn ellipsoid_area(scales: Vec3A) -> f32 {
    const P: f32 = 1.6075;
    let numerator = (scales.x * scales.y).powf(P) + (scales.x * scales.z).powf(P) + (scales.y * scales.z).powf(P);
    4.0 * std::f32::consts::PI * (numerator / 3.0).powf(1.0 / P)
}

pub fn compute_swaps(index_map: &[usize]) -> Vec<(usize, usize)> {
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

pub fn apply_swaps<T>(data: &mut [T], swaps: &[(usize, usize)]) {
    for &(a, b) in swaps {
        data.swap(a, b);
    }
}

pub fn bhattacharyya_distance(a: &impl Tsplat, b: &impl Tsplat) -> f32 {
    let cov_a = SymMat3::new_scale_quaternion(a.scales(), a.quaternion());
    let cov_b = SymMat3::new_scale_quaternion(b.scales(), b.quaternion());
    let sigma = SymMat3::new_average(&cov_a, &cov_b);
    let Some(inv) = sigma.inverse() else {
        return 0.0;
    };

    let delta = b.center() - a.center();
    let quad = inv.xx() * delta.x * delta.x
        + inv.yy() * delta.y * delta.y
        + inv.zz() * delta.z * delta.z
        + 2.0 * inv.xy() * delta.x * delta.y
        + 2.0 * inv.xz() * delta.x * delta.z
        + 2.0 * inv.yz() * delta.y * delta.z;
    let term1 = 0.125 * quad;

    let det_sigma = sigma.determinant();
    let det_a = cov_a.determinant();
    let det_b = cov_b.determinant();
    let term2 = 0.5 * (det_sigma / (det_a * det_b).sqrt()).ln();

    term1 + term2
}

pub fn bhattacharyya_coeff(a: &impl Tsplat, b: &impl Tsplat) -> f32 {
    (-bhattacharyya_distance(a, b)).exp()
}

pub fn similarity_metric(a: &impl Tsplat, b: &impl Tsplat) -> f32 {
    let spatial = bhattacharyya_coeff(a, b);

    let color_a = a.rgb();
    let color_b = b.rgb();
    let color_delta2 = (color_a - color_b).length_squared();

    let metric = spatial * (-color_delta2).exp();
    if metric.is_nan() {
        return 0.0;
    }
    metric
}
