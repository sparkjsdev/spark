use glam::{I64Vec3, Quat, Vec3A};
use ordered_float::OrderedFloat;

pub trait Tsplat: std::fmt::Debug + Clone + Default {
    fn center(&self) -> Vec3A;
    fn opacity(&self) -> f32;
    fn rgb(&self) -> Vec3A;
    fn scales(&self) -> Vec3A;
    fn quaternion(&self) -> Quat;

    fn set_center(&mut self, center: Vec3A);
    fn set_opacity(&mut self, opacity: f32);
    fn set_rgb(&mut self, rgb: Vec3A);
    fn set_scales(&mut self, scales: Vec3A);
    fn set_quaternion(&mut self, quaternion: Quat);

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

    fn distance(&self, other: &Self) -> f32 {
        self.center().distance(other.center())
    }
}

pub trait TsplatArray {
    type Splat: Tsplat;

    fn new() -> Self where Self: Sized { Self::new_capacity(0, 0) }
    fn new_capacity(capacity: usize, max_sh_degree: usize) -> Self;

    fn max_sh_degree(&self) -> usize;
    fn set_max_sh_degree(&mut self, max_sh_degree: usize);

    fn len(&self) -> usize;
    fn get(&self, index: usize) -> &Self::Splat;
    fn get_mut(&mut self, index: usize) -> &mut Self::Splat;

    fn prepare_extra(&mut self);
    fn new_merged(&mut self, indices: &[usize], filter_size: f32) -> usize;
    fn set_children(&mut self, parent: usize, children: &[usize]);

    fn retain<F: (FnMut(&mut Self::Splat) -> bool)>(&mut self, f: F);
    fn permute(&mut self, index_map: &[usize]);
    fn new_from_index_map(&mut self, index_map: &[usize]) -> Self;
    fn clone_subset(&self, start: usize, count: usize) -> Self;

    fn sort_by<F: (Fn(&Self::Splat) -> f32)>(&mut self, f: F) {
        let mut index_map = Vec::with_capacity(self.len());
        index_map.extend(0..self.len());
        index_map.sort_by_key(|&index| OrderedFloat(f(&self.get(index))));
        self.permute(&index_map);
    }
}

pub fn ellipsoid_area(scales: Vec3A) -> f32 {
    const P: f32 = 1.6075;
    let numerator = (scales.x * scales.y).powf(P) + (scales.x * scales.z).powf(P) + (scales.y * scales.z).powf(P);
    4.0 * std::f32::consts::PI * (numerator / 3.0).powf(1.0 / P)
}
