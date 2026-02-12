use std::{array, collections::{BinaryHeap, VecDeque}};

use glam::{Mat3A, Vec3A};
use ordered_float::OrderedFloat;
use smallvec::{SmallVec, smallvec};

use crate::{ordering::{morton_coord16_to_index, morton_coord24_to_index}, tsplat::{Tsplat, TsplatArray}};

const ROOT_SIZE: usize = 65536;
const CHUNK_SIZE: usize = 65536;
const BATCH_SIZE: usize = 64 * 1024;
const MIN_BATCH_SIZE: usize = 8 * 1024;
const STD_DEVS: f32 = 1.5;
const SLICE_FACTOR: f32 = 3.0;

#[derive(Clone, Copy, Debug)]
pub enum Axis { X, Y, Z }

impl Axis {
    pub fn index(&self) -> usize {
        match self {
            Axis::X => 0,
            Axis::Y => 1,
            Axis::Z => 2,
        }
    }

    pub fn get_vec3(&self, v: Vec3A) -> f32 {
        match self {
            Axis::X => v.x,
            Axis::Y => v.y,
            Axis::Z => v.z,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Aabb {
    pub min: Vec3A,
    pub max: Vec3A,
}

impl Aabb {
    pub fn empty() -> Self {
        Self {
            min: Vec3A::splat(f32::INFINITY),
            max: Vec3A::splat(f32::NEG_INFINITY),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.min.x > self.max.x || self.min.y > self.max.y || self.min.z > self.max.z
    }

    pub fn all() -> Self {
        Self {
            min: Vec3A::splat(f32::NEG_INFINITY),
            max: Vec3A::splat(f32::INFINITY),
        }
    }

    pub fn extend(&self, other: &Aabb) -> Self {
        Self {
            min: self.min.min(other.min),
            max: self.max.max(other.max),
        }
    }

    pub fn add_point(&self, point: Vec3A) -> Self {
        self.extend(&Aabb { min: point, max: point })
    }

    pub fn intersect(&self, o: &Aabb) -> Self {
        Self {
            min: self.min.max(o.min),
            max: self.max.min(o.max),
        }
    }

    pub fn volume(&self) -> f32 {
        let extent = self.extent();
        extent.x * extent.y * extent.z
    }

    pub fn overlaps(&self, o: &Aabb) -> bool {
        // inclusive overlap
        self.min.x <= o.max.x && self.max.x >= o.min.x &&
        self.min.y <= o.max.y && self.max.y >= o.min.y &&
        self.min.z <= o.max.z && self.max.z >= o.min.z
    }

    pub fn center(&self) -> Vec3A {
        (self.min + self.max) * 0.5
    }

    pub fn extent(&self) -> Vec3A {
        self.max - self.min
    }

    // pub fn from_tsplat_indices<TA: TsplatArray>(splats: &TA, indices: &[usize]) -> Self {
    //     indices.iter().fold(Aabb::empty(), |a, &i| a.extend(&splat_aabb(splats.get(i), STD_DEVS)))
    // }

    pub fn longest_axis(&self) -> (Axis, f32) {
        let extent = self.extent();
        if extent.x >= extent.y && extent.x >= extent.z {
            (Axis::X, extent.x)
        } else if extent.y >= extent.z {
            (Axis::Y, extent.y)
        } else {
            (Axis::Z, extent.z)
        }
    }

    pub fn from_splat<TS: Tsplat>(s: &TS, std_devs: f32) -> Self {
        let clamped_scales = s.scales().max(Vec3A::splat(1.0e-3));
        // k-sigma radii in local frame
        let r = clamped_scales * std_devs;
    
        // Tight AABB half-extents for rotated ellipsoid:
        // half = |R| * r
        let rmat = Mat3A::from_quat(s.quaternion());
        let half = rmat.abs() * r;
    
        let center = s.center();
        Self {
            min: center - half,
            max: center + half,
        }
    }    
}

// fn compute_subtree_children<TA: TsplatArray>(splats: &mut TA, index: usize, subtree_children: &mut Vec<usize>) {
//     let mut total = 0;
//     for child in splats.get_children(index) {
//         compute_subtree_children(splats, child, subtree_children);
//         total += subtree_children[child] + 1;
//     }
//     subtree_children[index] = total;
// }

fn max_child_size<TA: TsplatArray>(splats: &TA, parent: usize) -> f32 {
    let children = splats.get_children(parent);
    let max = children.iter().map(|&child| OrderedFloat(splats.get(child).feature_size())).max();
    max.map(|x| x.0).unwrap_or(0.0)
}

fn subtree_count_above_size<TA: TsplatArray>(splats: &TA, parent: usize, size_limit: f32) -> usize {
    if splats.get_child_count_start(parent).0 == 0 {
        return 0;
    }
    if max_child_size(splats, parent) < size_limit {
        return 1;
    }
    let children = splats.get_children(parent); 
    let mut total = children.len();
    for child in children {
        total += subtree_count_above_size(splats, child, size_limit);
    }
    total
}

fn subtree_count_above_size_total<TA: TsplatArray>(splats: &TA, parents: &[usize], size_limit: f32) -> usize {
    parents.iter().map(|&parent| subtree_count_above_size(splats, parent, size_limit)).sum()
}

fn subtree_above_size<TA: TsplatArray>(
    splats: &TA, parent: usize, size_limit: f32,
) -> (SmallVec<[SmallVec<[usize; 8]>; 4]>, SmallVec<[usize; 8]>) {
    if splats.get_child_count_start(parent).0 == 0 {
        return (smallvec![], smallvec![parent]);
    }

    if max_child_size(splats, parent) < size_limit {
        return (smallvec![], smallvec![parent]);
    }
    
    let mut levels: SmallVec<[_; 4]> = smallvec![smallvec![parent]];
    let mut below = SmallVec::new();

    for child in splats.get_children(parent) {
        let (child_levels, child_below) = subtree_above_size(splats, child, size_limit);
        below.extend(child_below);

        for (index, child_level) in child_levels.into_iter().enumerate() {
            while index >= levels.len() {
                levels.push(smallvec![]);
            }
            levels[index].extend(child_level);
        }
    }
    (levels, below)
}

fn subtree_above_size_all<TA: TsplatArray>(
    splats: &TA, parents: &[usize], size_limit: f32,
) -> (Vec<Vec<usize>>, Vec<usize>) {
    let mut levels: Vec<Vec<usize>> = Vec::new();
    let mut below = Vec::new();

    for &parent in parents {
        let (child_levels, child_below) = subtree_above_size(splats, parent, size_limit);
        below.extend(child_below);

        for (index, child_level) in child_levels.into_iter().enumerate() {
            while index >= levels.len() {
                levels.push(Vec::new());
            }
            levels[index].extend(child_level);
        }
    }
    (levels, below)
}

fn old_make_batches<TA: TsplatArray>(
    splats: &TA, parents: Vec<usize>, size_limit: f32,
) -> (Vec<Vec<usize>>, Vec<usize>) {
    let mut aabb = Aabb::empty();
    for &parent in &parents {
        aabb = aabb.add_point(splats.get(parent).center());
    }
    let (axis, extent) = aabb.longest_axis();

    let mut output_batch = extent < 1.0e-6;
    if !output_batch {
        let total: usize = parents.iter().map(|&parent| subtree_count_above_size(splats, parent, size_limit)).sum();
        if total <= BATCH_SIZE {
            output_batch = true;
        }
    }

    if output_batch {
        let (levels, below) = subtree_above_size_all(splats, &parents, size_limit);

        let mut output = Vec::new();

        for mut level in levels {
            let mut aabb = Aabb::empty();
            for &parent in &level {
                aabb = aabb.add_point(splats.get(parent).center());
            }

            level.sort_by_key(|&parent| {
                let center = splats.get(parent).center();
                let coord = (center - aabb.min) / aabb.extent() * 16777215.0;
                let coord = coord.clamp(Vec3A::ZERO, Vec3A::splat(16777215.0)).round();
                morton_coord24_to_index([coord.x as u32, coord.y as u32, coord.z as u32])
            });
            output.extend(level);
        }

        return (vec![output], below);
    }

    let split = axis.get_vec3(aabb.center());
    let (a, b): (Vec<usize>, Vec<usize>) = parents.into_iter().partition(|&parent| {
        axis.get_vec3(splats.get(parent).center()) < split
    });

    let (mut batches, mut below) = old_make_batches(splats, a, size_limit);
    let (batches_b, below_b) = old_make_batches(splats, b, size_limit);
    
    batches.extend(batches_b);
    below.extend(below_b);

    (batches, below)
}

pub fn morton_tree<TA: TsplatArray>(splats: &mut TA, root: usize, logger: impl Fn(&str)) {
    let mut indices = Vec::new();
    indices.push(root);

    let mut size_limit = splats.get(root).feature_size();
    let mut active = vec![root];

    while !active.is_empty() {
        logger(&format!("chunk_tree: size_limit={}, active.len={}", size_limit, active.len()));
        let mut next_active = Vec::new();
        let mut additional = Vec::new();

        while !active.is_empty() {
            let (mut current, below): (Vec<usize>, Vec<usize>) = active.into_iter().partition(|&parent| {
                splats.get(parent).feature_size() >= size_limit
            });
            next_active.extend(below);

            let mut aabb = Aabb::empty();
            for &parent in &current {
                aabb = aabb.add_point(splats.get(parent).center());
            }

            current.sort_by_key(|&parent| {
                let center = splats.get(parent).center();
                let coord = (center - aabb.min) / aabb.extent() * 16777215.0;
                let coord = coord.clamp(Vec3A::ZERO, Vec3A::splat(16777215.0)).round();
                morton_coord24_to_index([coord.x as u32, coord.y as u32, coord.z as u32])
            });

            for parent in current {
                let children = splats.get_children(parent);
                if !children.is_empty() {
                    let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
                    splats.set_children(parent, &new_children);
                    for child in children {
                        indices.push(child);
                        additional.push(child);
                    }
                }
            }
            active = additional;
            additional = Vec::new();
        }

        active = next_active;
        size_limit /= SLICE_FACTOR;
    }

    assert_eq!(indices.len(), splats.len());
    splats.permute(&indices);
}

fn batch_recurse<TA: TsplatArray>(splats: &mut TA, indices: &mut Vec<usize>, batch: &[usize], logger: &impl Fn(&str)) {
    let mut priority = BinaryHeap::new();
    for &parent in batch {
        priority.push((OrderedFloat(splats.get(parent).feature_size()), parent));
    }

    let start_index = indices.len();
    let end_index = start_index + if start_index == 0 { 1048576 } else { BATCH_SIZE };

    while let Some((OrderedFloat(size), parent)) = priority.pop() {
        let children = splats.get_children(parent);
        if (indices.len() + children.len()) > end_index {
            priority.push((OrderedFloat(size), parent));
            logger(&format!("output batch chunk, #splats = {}", indices.len() - start_index));
            break;
        }
        let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
        splats.set_children(parent, &new_children);

        for child in children {
            indices.push(child);
            priority.push((OrderedFloat(splats.get(child).feature_size()), child));
        }
    }

    if !priority.is_empty() {
        let mut aabb = Aabb::empty();
        for &(_, parent) in priority.iter() {
            // aabb = aabb.add_point(splats.get(parent).center());
            aabb = aabb.extend(&Aabb::from_splat(&splats.get(parent), STD_DEVS));
        }

        if aabb.extent().max_element() >= (3.0 * aabb.extent().min_element()) {
            let axis = aabb.longest_axis().0;
            let split = axis.get_vec3(aabb.center());
            let (a, b): (Vec<usize>, Vec<usize>) = priority.into_iter()
                .map(|(_, parent)| parent).partition(|&parent| {
                    axis.get_vec3(splats.get(parent).center()) < split
                });
            println!("split axis={:?}, extent={:?}, split={}, a.len={}, b.len={}", axis, aabb.extent(), split, a.len(), b.len());

            let mut batches = [a, b];
            batches.sort_by_key(|b| b.len());
            for batch in batches {
                batch_recurse(splats, indices, &batch, logger);
            }
            return;
        }
    
        let mut octants: [Vec<usize>; 8] = array::from_fn(|_| Vec::new());
        let split = aabb.center();

        for (_, parent) in priority {
            let center = splats.get(parent).center();
            let octant =  if center.x < split.x { 0 } else { 1 }
                + if center.y < split.y { 0 } else { 2 }
                + if center.z < split.z { 0 } else { 4 };
            octants[octant].push(parent);
        }

        octants.sort_by_key(|o| o.len());

        println!("octant lengths: {:?}", octants.iter().map(|o| o.len()).collect::<Vec<usize>>());

        for batch in octants {
            batch_recurse(splats, indices, &batch, logger);
        }
    }
}

pub fn older_chunk_tree<TA: TsplatArray>(splats: &mut TA, root: usize, logger: impl Fn(&str)) {
    let mut indices = Vec::new();
    indices.push(root);

    batch_recurse(splats, &mut indices, &[root], &logger);

    assert_eq!(indices.len(), splats.len());
    splats.permute(&indices);
}

pub fn chunk_tree_size<TA: TsplatArray>(splats: &mut TA, root: usize, logger: impl Fn(&str)) {
    let mut indices = Vec::new();
    indices.push(root);

    let mut batches = VecDeque::new();
    batches.push_back(vec![root]);

    while let Some(batch) = batches.pop_front() {
        let mut priority = BinaryHeap::new();
        for parent in batch {
            priority.push((OrderedFloat(splats.get(parent).feature_size()), parent));
        }
    
        let start_index = indices.len();
        let end_index = (start_index + MIN_BATCH_SIZE).div_ceil(BATCH_SIZE) * BATCH_SIZE;
    
        while let Some((OrderedFloat(size), parent)) = priority.pop() {
            let children = splats.get_children(parent);
            if (indices.len() + children.len()) > end_index {
                priority.push((OrderedFloat(size), parent));
                logger(&format!("output batch chunk, chunk_rel = {}", indices.len() as f32 / 65536.0));
                break;
            }
            let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
            splats.set_children(parent, &new_children);
    
            for child in children {
                indices.push(child);
                priority.push((OrderedFloat(splats.get(child).feature_size()), child));
            }
        }
    
        if priority.is_empty() {
            // logger(&format!("output terminal chunk, chunk_rel = {}", indices.len() as f32 / 65536.0));
        } else {
            let mut aabb = Aabb::empty();
            for &(_, parent) in priority.iter() {
                // aabb = aabb.add_point(splats.get(parent).center());
                aabb = aabb.extend(&Aabb::from_splat(&splats.get(parent), STD_DEVS));
            }
    
            if aabb.extent().max_element() >= (3.0 * aabb.extent().min_element()) {
                let axis = aabb.longest_axis().0;
                let split = axis.get_vec3(aabb.center());
                let (a, b): (Vec<usize>, Vec<usize>) = priority.into_iter()
                    .map(|(_, parent)| parent).partition(|&parent| {
                        axis.get_vec3(splats.get(parent).center()) < split
                    });
                println!("split axis={:?}, extent={:?}, split={}, a.len={}, b.len={}", axis, aabb.extent(), split, a.len(), b.len());
    
                let mut new_batches = [a, b];
                new_batches.sort_by_key(|b| -(b.len() as isize));
                for batch in new_batches {
                    batches.push_back(batch);
                }
                continue;
            }
        
            let mut octants: [Vec<usize>; 8] = array::from_fn(|_| Vec::new());
            let split = aabb.center();
    
            for (_, parent) in priority {
                let center = splats.get(parent).center();
                let octant =  if center.x < split.x { 0 } else { 1 }
                    + if center.y < split.y { 0 } else { 2 }
                    + if center.z < split.z { 0 } else { 4 };
                octants[octant].push(parent);
            }
    
            println!("octant lengths: {:?}", octants.iter().map(|o| o.len()).collect::<Vec<usize>>());
            
            // Resort into Hilbert order
            let mut octants = octants.into_iter().map(|o| Some(o)).collect::<Vec<_>>();
            let octants = [0, 1, 3, 2, 6, 7, 5, 4].map(|i| octants[i].take().unwrap());
            for batch in octants {
                batches.push_back(batch);
            }
        }
    }

    assert_eq!(indices.len(), splats.len());
    splats.permute(&indices);
}

pub fn chunk_tree_only_size<TA: TsplatArray>(splats: &mut TA, root: usize, _logger: impl Fn(&str)) {
    let mut indices = Vec::new();
    indices.push(root);

    let mut priority = BinaryHeap::new();
    priority.push((OrderedFloat(splats.get(root).feature_size()), root));

    while let Some((OrderedFloat(_size), parent)) = priority.pop() {
        let children = splats.get_children(parent);
        let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
        splats.set_children(parent, &new_children);

        for child in children {
            indices.push(child);
            priority.push((OrderedFloat(splats.get(child).feature_size()), child));
        }
    }

    assert_eq!(indices.len(), splats.len());
    splats.permute(&indices);
}

pub fn chunk_tree_rows<TA: TsplatArray>(splats: &mut TA, root: usize, _logger: impl Fn(&str)) {
    let mut indices = Vec::new();
    indices.push(root);

    let mut queue = VecDeque::new();
    queue.push_back(root);

    while let Some(parent) = queue.pop_front() {
        let children = splats.get_children(parent);
        let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
        splats.set_children(parent, &new_children);

        for child in children {
            indices.push(child);
            queue.push_back(child);
        }
    }

    assert_eq!(indices.len(), splats.len());
    splats.permute(&indices);
}

pub fn chunk_tree_dfs<TA: TsplatArray>(splats: &mut TA, root: usize, _logger: impl Fn(&str)) {
    let mut indices = Vec::new();
    indices.push(root);

    fn recurse<TA: TsplatArray>(splats: &mut TA, indices: &mut Vec<usize>, parent: usize) {
        let children = splats.get_children(parent);
        let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
        splats.set_children(parent, &new_children);

        for &child in &children {
            indices.push(child);
        }
        for child in children {
            recurse(splats, indices, child);
        }
    }

    recurse(splats, &mut indices, root);

    assert_eq!(indices.len(), splats.len());
    splats.permute(&indices);
}

pub fn chunk_tree_morton<TA: TsplatArray>(splats: &mut TA, root: usize, logger: impl Fn(&str)) {
    let mut indices = Vec::new();
    indices.push(root);

    let mut batches = VecDeque::new();
    batches.push_back(vec![root]);

    while let Some(mut batch) = batches.pop_front() {
        let mut aabb = Aabb::empty();
        for &parent in batch.iter() {
            aabb = aabb.add_point(splats.get(parent).center());
            // aabb = aabb.extend(&Aabb::from_splat(&splats.get(parent), STD_DEVS));
        }

        batch.sort_by_key(|&parent| {
            let center = splats.get(parent).center();
            let coord = (center - aabb.min) / aabb.extent() * 65535.0;
            let coord = coord.clamp(Vec3A::ZERO, Vec3A::splat(65535.0)).round();
            morton_coord16_to_index([coord.x as u16, coord.y as u16, coord.z as u16])
        });

        let mut ordering = VecDeque::from(batch);
    
        let start_index = indices.len();
        let end_index = (start_index + MIN_BATCH_SIZE).div_ceil(BATCH_SIZE) * BATCH_SIZE;
    
        while let Some(parent) = ordering.pop_front() {
            let children = splats.get_children(parent);
            if (indices.len() + children.len()) > end_index {
                ordering.push_front(parent);
                logger(&format!("output batch chunk, chunk_rel = {}", indices.len() as f32 / 65536.0));
                break;
            }
            let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
            splats.set_children(parent, &new_children);
    
            for child in children {
                indices.push(child);
                ordering.push_back(child);
            }
        }
    
        if ordering.is_empty() {
            // logger(&format!("output terminal chunk, chunk_rel = {}", indices.len() as f32 / 65536.0));
        } else {
            let mut aabb = Aabb::empty();
            for &parent in ordering.iter() {
                aabb = aabb.add_point(splats.get(parent).center());
                // aabb = aabb.extend(&Aabb::from_splat(&splats.get(parent), STD_DEVS));
            }
    
            if aabb.extent().max_element() >= (3.0 * aabb.extent().min_element()) {
                let axis = aabb.longest_axis().0;
                let split = axis.get_vec3(aabb.center());
                let (a, b): (Vec<usize>, Vec<usize>) = ordering.into_iter()
                    .partition(|&parent| {
                        axis.get_vec3(splats.get(parent).center()) < split
                    });
                println!("split axis={:?}, extent={:?}, split={}, a.len={}, b.len={}", axis, aabb.extent(), split, a.len(), b.len());
    
                let mut new_batches = [a, b];
                new_batches.sort_by_key(|b| -(b.len() as isize));
                for batch in new_batches {
                    batches.push_back(batch);
                }
                continue;
            }
        
            let mut octants: [Vec<usize>; 8] = array::from_fn(|_| Vec::new());
            let split = aabb.center();
    
            for parent in ordering {
                let center = splats.get(parent).center();
                let octant =  if center.x < split.x { 0 } else { 1 }
                    + if center.y < split.y { 0 } else { 2 }
                    + if center.z < split.z { 0 } else { 4 };
                octants[octant].push(parent);
            }
    
            println!("octant lengths: {:?}", octants.iter().map(|o| o.len()).collect::<Vec<usize>>());
            
            // Resort into Hilbert order
            let mut octants = octants.into_iter().map(|o| Some(o)).collect::<Vec<_>>();
            let octants = [0, 1, 3, 2, 6, 7, 5, 4].map(|i| octants[i].take().unwrap());
            for batch in octants {
                batches.push_back(batch);
            }
        }
    }

    assert_eq!(indices.len(), splats.len());
    splats.permute(&indices);
}

pub fn chunk_tree<TA: TsplatArray>(splats: &mut TA, root: usize, logger: impl Fn(&str)) {
    chunk_tree_morton(splats, root, logger);
}
