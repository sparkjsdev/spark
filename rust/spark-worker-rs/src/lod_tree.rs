use std::{array, cell::{Ref, RefCell}, collections::BinaryHeap, rc::Rc};

use ahash::{AHashMap, AHashSet};
use glam::{Vec3, Vec3A};
use half::f16;
use itertools::izip;
use js_sys::{Array, Object, Reflect, Uint32Array};
use ordered_float::OrderedFloat;
use smallvec::SmallVec;
use wasm_bindgen::prelude::*;

const MAX_SPLAT_CHUNK: usize = 65536;

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
struct FourHeap<T: Ord> {
    data: Vec<T>,
}

#[allow(dead_code)]
impl<T: Ord> FourHeap<T> {
    fn new() -> Self {
        Self { data: Vec::new() }
    }

    fn push(&mut self, value: T) {
        self.data.push(value);
        let mut index = self.data.len() - 1;
        while index > 0 {
            let parent = (index - 1) / 4;
            if self.data[parent] >= self.data[index] {
                break;
            }
            self.data.swap(parent, index);
            index = parent;
        }
    }

    fn peek(&self) -> Option<&T> {
        self.data.first()
    }

    fn len(&self) -> usize {
        self.data.len()
    }

    fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    fn pop(&mut self) -> Option<T> {
        let last = self.data.pop()?;
        if self.data.is_empty() {
            return Some(last);
        }

        let root = std::mem::replace(&mut self.data[0], last);
        let len = self.data.len();
        let mut index = 0usize;
        loop {
            let child0 = index * 4 + 1;
            if child0 >= len {
                break;
            }

            let child_end = (child0 + 4).min(len);
            let mut max_child = child0;
            for child in (child0 + 1)..child_end {
                if self.data[child] > self.data[max_child] {
                    max_child = child;
                }
            }

            if self.data[index] >= self.data[max_child] {
                break;
            }
            self.data.swap(index, max_child);
            index = max_child;
        }

        Some(root)
    }

    fn drain(&mut self) -> std::vec::Drain<'_, T> {
        self.data.drain(..)
    }

    fn clear(&mut self) {
        self.data.clear();
    }
}

type Frontier<T> = BinaryHeap<T>;

#[derive(Debug, Clone, Default)]
struct LodSplat {
    center: [f16; 3],
    size: f16,
    child_start: u32,
    child_count: u16,
}

impl LodSplat {
    fn new_f16(center: [f16; 3], size: f16, child_start: u32, child_count: u16) -> Self {
        Self { center, size, child_start, child_count }
    }

    #[allow(dead_code)]
    fn new(center: Vec3, size: f32, child_start: u32, child_count: u16) -> Self {
        let center = center.to_array().map(|x| f16::from_f32(x));
        let size = f16::from_f32(size);
        Self::new_f16(center, size, child_start, child_count)
    }

    fn center(&self) -> Vec3A {
        Vec3A::from_array(self.center.map(|x| x.to_f32()))
    }

    fn size(&self) -> f32 {
        self.size.to_f32()
    }
}

// #[derive(Debug, Clone, Default)]
// struct LodSplat {
//     center: Vec3,
//     size: f32,
//     child_start: u32,
//     child_count: u16,
// }

// impl LodSplat {
//     fn new_f16(center: [f16; 3], size: f16, child_start: u32, child_count: u16) -> Self {
//         let center = Vec3::from_array(center.map(|x| x.to_f32()));
//         let size = size.to_f32();
//         Self::new(center, size, child_start, child_count)
//     }

//     fn new(center: Vec3, size: f32, child_start: u32, child_count: u16) -> Self {
//         Self { center, size, child_start, child_count }
//     }

//     fn center(&self) -> Vec3A {
//         self.center.to_vec3a()
//     }

//     fn size(&self) -> f32 {
//         self.size
//     }
// }

#[derive(Debug, Clone, Default)]
struct LodTree {
    splats: Rc<RefCell<Vec<LodSplat>>>,
    skip_splats: Rc<RefCell<Vec<SmallVec<[u32; 4]>>>>,
    page_to_chunk: Vec<u32>,
    chunk_to_page: Vec<u32>,
}

struct LodState {
    next_id: u32,
    lod_trees: AHashMap<u32, LodTree>,
    frontier: Frontier<(OrderedFloat<f32>, u32, u32)>,
    output: Vec<(u32, u32)>,
    touched: Vec<(u32, u32)>,
    touched_set: AHashSet<(u32, u32)>,
    buffer: Vec<u32>,
}

impl LodState {
    fn new() -> Self {
        Self {
            next_id: 1000,
            lod_trees: AHashMap::new(),
            frontier: Frontier::new(),
            output: Vec::new(),
            touched: Vec::new(),
            touched_set: AHashSet::new(),
            buffer: Vec::new(),
        }
    }
}

thread_local! {
    static STATE: RefCell<LodState> = RefCell::new(LodState::new());
}

fn set_lod_tree_data(state: &mut LodState, lod_id: u32, page_base: u32, chunk_base: u32, count: u32, lod_tree_data: &Uint32Array) {
    let lod_tree = state.lod_trees.get(&lod_id).unwrap();
    let mut splats = lod_tree.splats.borrow_mut();
    let mut skip_splats = lod_tree.skip_splats.borrow_mut();

    if state.buffer.is_empty() {
        state.buffer.resize(MAX_SPLAT_CHUNK * 4, 0);
    }

    if page_base + count > splats.len() as u32 {
        let new_size = (splats.len() * 2).max((page_base + count) as usize);
        splats.resize_with(new_size, Default::default);
        // skip_splats.resize_with(new_size, || SmallVec::new());
    }

    let mut index = 0;
    while index < count {
        let chunk = (count - index).min(MAX_SPLAT_CHUNK as u32);
        let buffer = &mut state.buffer[0..(chunk * 4) as usize];
        lod_tree_data.subarray((index * 4) as u32, ((index + chunk) * 4) as u32).copy_to(buffer);

        for i in 0..chunk {
            let i4 = i * 4;
            let words: [u32; 4] = array::from_fn(|j| buffer[i4 as usize + j]);
            let center = [
                f16::from_bits((words[0] & 0xffff) as u16),
                f16::from_bits((words[0] >> 16) as u16),
                f16::from_bits((words[1] & 0xffff) as u16),
            ];
            let size = f16::from_bits((words[1] >> 16) as u16);
            let child_count = (words[2] & 0xffff) as u16;
            let child_start = words[3];

            splats[(page_base + index + i) as usize] = LodSplat::new_f16(center, size, child_start, child_count);
        }
        index += chunk;
    }

    // let mut terminal: SmallVec<[u32; 64]> = SmallVec::new();
    // let mut frontier: SmallVec<[u32; 64]> = SmallVec::new();
    // let mut active = Vec::new();

    // let mut offset = 0;
    // while offset < count {
    //     let chunk = (count - offset).min(MAX_SPLAT_CHUNK as u32);
    //     active.clear();
    //     active.extend((0..chunk).map(|_| 1u8));

    //     for index in 0..chunk {
    //         let paged_index = page_base + offset + index;
    //         skip_splats[paged_index as usize].clear();

    //         if active[index as usize] == 0 {
    //             continue;
    //         }

    //         frontier.push(index);

    //         while let Some(i) = frontier.pop() {
    //             let paged_index = page_base + offset + i;
    //             let LodSplat { child_count, child_start, .. } = splats[paged_index as usize];
    //             if child_count == 0 {
    //                 terminal.push(i);
    //             } else {
    //                 assert!(child_start >= chunk_base);
    //                 let child_base = child_start - chunk_base - offset;
    //                 let child_end = child_base + child_count as u32;
    //                 if child_end <= chunk {
    //                     for child_i in (child_base..child_end).rev() {
    //                         assert!(active[child_i as usize] != 0, "index: {}, i: {}, child_i: {}, child_start: {}, child_count: {}, child_base: {}, child_end: {}, chunk: {}, offset: {}, paged_index: {}, frontier: {:?}, terminal: {:?}", index, i, child_i, child_start, child_count, child_base, child_end, chunk, offset, paged_index, frontier, terminal);
    //                         // if active[child_index as usize] != 0 {
    //                             active[child_i as usize] = 0;
    //                             frontier.push(child_i);
    //                         // }
    //                     }
    //                 }  else {
    //                     terminal.push(i);
    //                 }
    //             }
    //         }

    //         skip_splats[paged_index as usize].extend(terminal.drain(..).map(|i| chunk_base + offset + i));
    //     }
    //     offset += chunk;
    // }
}

#[wasm_bindgen]
pub fn new_lod_tree(capacity: u32) -> Result<Object, JsValue> {
    STATE.with_borrow_mut(|state| {
        let lod_id = state.next_id;
        let splats = Vec::with_capacity(capacity as usize);
        let splats = Rc::new(RefCell::new(splats));
        // let skip_splats = Vec::with_capacity(capacity as usize);
        let skip_splats = Vec::new();
        let skip_splats = Rc::new(RefCell::new(skip_splats));
        let page_capacity = capacity.div_ceil(65536);
        let page_to_chunk = Vec::with_capacity(page_capacity as usize);
        let chunk_to_page: Vec<u32> = Vec::with_capacity(page_capacity as usize);
        state.lod_trees.insert(lod_id, LodTree { splats, skip_splats, page_to_chunk, chunk_to_page });
        state.next_id += 1;

        let result = Object::new();
        Reflect::set(&result, &JsValue::from_str("lodId"), &JsValue::from(lod_id)).unwrap();

        Ok(result)
    })
}

#[wasm_bindgen]
pub fn new_shared_lod_tree(orig_lod_id: u32) -> Result<Object, JsValue> {
    STATE.with_borrow_mut(|state| {
        let lod_tree = state.lod_trees.get(&orig_lod_id).unwrap();
        let splats = lod_tree.splats.clone();
        let skip_splats = lod_tree.skip_splats.clone();
        let page_to_chunk = Vec::with_capacity(lod_tree.page_to_chunk.capacity());
        let chunk_to_page = Vec::with_capacity(lod_tree.chunk_to_page.capacity());

        let new_lod_id = state.next_id;
        state.next_id += 1;
        state.lod_trees.insert(new_lod_id, LodTree { splats, skip_splats, page_to_chunk, chunk_to_page });

        let result = Object::new();
        Reflect::set(&result, &JsValue::from_str("lodId"), &JsValue::from(new_lod_id)).unwrap();
        Ok(result)
    })
}

#[wasm_bindgen]
pub fn init_lod_tree(num_splats: u32, lod_tree: Uint32Array) -> Result<Object, JsValue> {
    STATE.with_borrow_mut(|state| {
        let lod_id = state.next_id;
        let pages = num_splats.div_ceil(65536);
        let splats = Vec::with_capacity(num_splats as usize);
        let splats = Rc::new(RefCell::new(splats));
        // let skip_splats = Vec::with_capacity(num_splats as usize);
        let skip_splats = Vec::new();
        let skip_splats = Rc::new(RefCell::new(skip_splats));
        let page_to_chunk = (0..pages).map(|page| page as u32).collect();
        let chunk_to_page: Vec<u32> = (0..pages).map(|chunk| chunk as u32).collect();
        state.lod_trees.insert(lod_id, LodTree { splats, skip_splats, page_to_chunk, chunk_to_page });
        state.next_id += 1;

        set_lod_tree_data(state, lod_id, 0, 0, num_splats, &lod_tree);

        let result = Object::new();
        Reflect::set(&result, &JsValue::from_str("lodId"), &JsValue::from(lod_id)).unwrap();

        Ok(result)
    })
}

#[wasm_bindgen]
pub fn dispose_lod_tree(lod_id: u32) {
    STATE.with_borrow_mut(|state| {
        state.lod_trees.remove(&lod_id);
    })
}

#[wasm_bindgen]
pub fn update_lod_trees(lod_ids: &[u32], page_bases: &[u32], chunk_bases: &[u32], counts: &[u32], lod_trees: &Array) -> Result<Object, JsValue> {
    STATE.with_borrow_mut(|state| {
        for (&lod_id, &page_base, &chunk_base, &count, lod_tree_data) in izip!(lod_ids, page_bases, chunk_bases, counts, lod_trees.iter()) {
            let lod_tree = state.lod_trees.get_mut(&lod_id).unwrap();
            let pages = count.div_ceil(65536);
            let base_page = page_base >> 16;
            let base_chunk = chunk_base >> 16;

            if (base_page + pages) > lod_tree.page_to_chunk.len() as u32 {
                lod_tree.page_to_chunk.resize((base_page + pages) as usize, 0xFFFFFFFF);
            }
            if (base_chunk + pages) > lod_tree.chunk_to_page.len() as u32 {
                lod_tree.chunk_to_page.resize((base_chunk + pages) as usize, 0xFFFFFFFF);
            }

            if lod_tree_data.is_falsy() {
                for page in 0..pages {
                    lod_tree.page_to_chunk[(base_page + page) as usize] = 0xFFFFFFFF;
                    lod_tree.chunk_to_page[(base_chunk + page) as usize] = 0xFFFFFFFF;
                }    
            } else {
                for page in 0..pages {
                    lod_tree.page_to_chunk[(base_page + page) as usize] = base_chunk + page;
                    lod_tree.chunk_to_page[(base_chunk + page) as usize] = base_page + page;
                }

                let lod_tree_data = Uint32Array::from(lod_tree_data);
                set_lod_tree_data(state, lod_id, page_base, chunk_base, count, &lod_tree_data);
            }
        }

        let result = Object::new();
        // for (&lod_id, lod_tree) in state.lod_trees.iter() {
        //     let entry = Object::new();
        //     Reflect::set(&entry, &JsValue::from_str("pageToChunk"), &JsValue::from(lod_tree.page_to_chunk.clone())).unwrap();
        //     Reflect::set(&entry, &JsValue::from_str("chunkToPage"), &JsValue::from(lod_tree.chunk_to_page.clone())).unwrap();
        //     Reflect::set(&result, &JsValue::from_str(lod_id.to_string().as_str()), &JsValue::from(entry)).unwrap();
        // }
        Ok(result)
    })
}

struct LodInstance<'a> {
    lod_id: u32,
    splats: Ref<'a, Vec<LodSplat>>,
    page_to_chunk: &'a [u32],
    chunk_to_page: &'a [u32],
    origin: Vec3A,
    forward: Vec3A,
    right: Vec3A,
    up: Vec3A,
    output: Vec<u32>,
    lod_scale: f32,
    outside_foveate: f32,
    behind_foveate: f32,
    cone_dot0: f32,
    cone_dot: f32,
    cone_foveate: f32,
}

fn children_resident(child_count: u16, child_start: u32, instance: &LodInstance) -> bool {
    // Check endpoints, okay since child_count <= 65535
    for child in [child_start, child_start + child_count as u32 - 1] {
        if !is_resident(child, instance) {
            return false;
        }
    }
    true
}

fn is_resident(index: u32, instance: &LodInstance) -> bool {
    let chunk = (index >> 16) as usize;
    if chunk >= instance.chunk_to_page.len() {
        false
    } else {
        instance.chunk_to_page[chunk] != 0xFFFFFFFF
    }
}

#[wasm_bindgen]
pub fn traverse_lod_trees(
    max_splats: u32, pixel_scale_limit: f32,
    fov_x_degrees: f32, fov_y_degrees: f32,
    lod_ids: &[u32], root_pages: &[u32],
    view_to_objects: &[f32],
    lod_scales: &[f32], outside_foveates: &[f32], behind_foveates: &[f32],
    cone_fov0s: &[f32], cone_fovs: &[f32], cone_foveates: &[f32],
) -> anyhow::Result<Object, JsValue> {
    let max_splats = max_splats as usize;
    let num_instances = lod_ids.len();
    if view_to_objects.len() != num_instances * 16 {
        return Err(JsValue::from_str("Invalid view_to_objects length"));
    }
    if lod_scales.len() != num_instances {
        return Err(JsValue::from_str("Invalid lod_scales length"));
    }
    if outside_foveates.len() != num_instances {
        return Err(JsValue::from_str("Invalid outside_foveates length"));
    }
    if behind_foveates.len() != num_instances {
        return Err(JsValue::from_str("Invalid behind_foveates length"));
    }
    if cone_fov0s.len() != num_instances {
        return Err(JsValue::from_str("Invalid cone_fov0s length"));
    }
    if cone_fovs.len() != num_instances {
        return Err(JsValue::from_str("Invalid cone_fovs length"));
    }
    if cone_foveates.len() != num_instances {
        return Err(JsValue::from_str("Invalid cone_foveates length"));
    }
    
    let x_limit = (0.5 * fov_x_degrees).to_radians().tan();
    let y_limit = (0.5 * fov_y_degrees).to_radians().tan();

    STATE.with_borrow_mut(|state| {
        let LodState { lod_trees, ref mut frontier, .. } = state;
        frontier.clear();

        let mut instances: Vec<_> = lod_ids.iter().enumerate().map(|(index, &lod_id)| {
            let lod_tree = lod_trees.get(&lod_id).unwrap();
            let LodTree { splats, page_to_chunk, chunk_to_page, .. } = &lod_tree;
            let splats = splats.borrow();
            let i16 = index * 16;
            let right = Vec3A::from_slice(&view_to_objects[i16..(i16 + 3)]).normalize();
            let up = Vec3A::from_slice(&view_to_objects[(i16 + 4)..(i16 + 7)]).normalize();
            let forward = Vec3A::from_slice(&view_to_objects[(i16 + 8)..(i16 + 11)]).normalize().map(|x| -x);
            let origin = Vec3A::from_slice(&view_to_objects[(i16 + 12)..(i16 + 15)]);
            let output = Vec::new();
            let lod_scale = lod_scales[index];
            let outside_foveate = outside_foveates[index];
            let behind_foveate = behind_foveates[index];
            let cone_dot0 = if cone_fov0s[index] > 0.0 { (0.5 * cone_fov0s[index]).to_radians().cos() } else { 1.0 };
            let cone_dot = if cone_fovs[index] > 0.0 { (0.5 * cone_fovs[index]).to_radians().cos() } else { 1.0 };
            let cone_foveate = cone_foveates[index];
            LodInstance { lod_id, splats, page_to_chunk, chunk_to_page, origin, forward, right, up, output, lod_scale, outside_foveate, behind_foveate, cone_dot0, cone_dot, cone_foveate }
        }).collect();

        let mut num_splats = 0;
        let mut chunks: Vec<(u32, u32)> = Vec::new();
        let mut chunk_touched: AHashMap<u32, Vec<bool>> = AHashMap::new();

        let mut touch_chunk = |inst_index: u32, splat_index: u32| {
            let lod_id = lod_ids[inst_index as usize];
            let touched = chunk_touched.entry(lod_id).or_default();
            let chunk = (splat_index >> 16) as usize;
            if chunk >= touched.len() {
                touched.resize(chunk + 1, false);
            }
            if !touched[chunk] {
                touched[chunk] = true;
                chunks.push((lod_id, chunk as u32));
            }
        };

        for (inst_index, instance) in instances.iter().enumerate() {
            let root_page = root_pages[inst_index];
            let root_page = if root_page == 0xFFFFFFFF { 0 } else { root_page };
            let root_paged_index = root_page << 16;
            let inst_index = inst_index as u32;
            let pixel_scale = compute_pixel_scale(
                &instance.splats[root_paged_index as usize], instance, x_limit, y_limit,
            );
            frontier.push((OrderedFloat(pixel_scale), inst_index, root_paged_index));
            num_splats += 1;
            touch_chunk(inst_index, 0);
        }

        while let Some(&(OrderedFloat(pixel_scale), inst_index, paged_index)) = frontier.peek() {
            // touch_chunk(inst_index, splat_index);
            
            let instance = &mut instances[inst_index as usize];
            if pixel_scale <= pixel_scale_limit {
                break;
            }

            // let chunk = splat_index >> 16;
            // let page = instance.chunk_to_page[chunk as usize];
            // let paged_index = (page << 16) | (splat_index & 0xffff);

            let LodSplat { child_count, child_start, .. } = instance.splats[paged_index as usize];
            if child_count == 0 {
                _ = frontier.pop();
                instance.output.push(paged_index);
            } else {
                let new_num_splats = num_splats - 1 + child_count as usize;
                if new_num_splats > max_splats {
                    break;
                }

                _ = frontier.pop();

                touch_chunk(inst_index, child_start);
                touch_chunk(inst_index, child_start + child_count as u32 - 1);

                if !children_resident(child_count, child_start, instance) {
                    instance.output.push(paged_index);
                } else {
                    for child in 0..child_count {
                        let child_index = child_start + child as u32;
                        let child_chunk = child_index >> 16;
                        let child_page = instance.chunk_to_page[child_chunk as usize];
                        let paged_child_index = (child_page << 16) | (child_index & 0xffff);
                        let pixel_scale = compute_pixel_scale(
                            &instance.splats[paged_child_index as usize], instance, x_limit, y_limit,
                        );
                        if pixel_scale <= pixel_scale_limit {
                            instance.output.push(paged_child_index);
                            // touch_chunk(inst_index, child_index);
                        } else {
                            frontier.push((OrderedFloat(pixel_scale), inst_index, paged_child_index));
                        }
                    }
                    num_splats = new_num_splats;
                }
            }
        }

        for (_, inst_index, paged_index) in frontier.drain() {
            let instance = &mut instances[inst_index as usize];
            instance.output.push(paged_index);
            let page = (paged_index >> 16) as usize;
            let chunk = instance.page_to_chunk[page];
            let splat_index = (chunk << 16) | (paged_index & 0xffff);
            touch_chunk(inst_index, splat_index);
        }

        let instance_indices = Array::new();
        for instance in instances.iter_mut() {
            instance.output.sort_unstable();
            let rows = instance.output.len().div_ceil(16384);
            let capacity = rows * 16384;
            let output = Uint32Array::new_with_length(capacity as u32);
            output.subarray(0, instance.output.len() as u32).copy_from(&instance.output);

            let result = Object::new();
            Reflect::set(&result, &JsValue::from_str("lodId"), &JsValue::from(instance.lod_id)).unwrap();
            Reflect::set(&result, &JsValue::from_str("numSplats"), &JsValue::from(instance.output.len() as u32)).unwrap();
            Reflect::set(&result, &JsValue::from_str("indices"), &JsValue::from(output)).unwrap();
            instance_indices.push(&JsValue::from(result));
        }

        let out_chunks = Array::new();
        for &(inst_index, chunk) in chunks.iter() {
            let pair = Array::new();
            pair.push(&JsValue::from(inst_index));
            pair.push(&JsValue::from(chunk));
            out_chunks.push(&JsValue::from(pair));
        }

        let result = Object::new();
        Reflect::set(&result, &JsValue::from_str("instanceIndices"), &JsValue::from(instance_indices)).unwrap();
        Reflect::set(&result, &JsValue::from_str("chunks"), &JsValue::from(out_chunks)).unwrap();
        Ok(result)
    })
}

fn compute_pixel_scale(
    splat: &LodSplat, instance: &LodInstance, 
    x_limit: f32, y_limit: f32,
) -> f32 {
    let center = splat.center();
    let delta = center - instance.origin;
    let distance = delta.length();
    let pixel_scale = splat.size() / distance.max(1.0e-6);
    let pixel_scale = pixel_scale * instance.lod_scale;
    
    let forward = delta.dot(instance.forward);
    if forward <= 0.0 {
        instance.behind_foveate * pixel_scale
    } else if instance.cone_dot == 1.0 {
        let right = delta.dot(instance.right);
        let x_pos = (right / forward) / x_limit;

        let up = delta.dot(instance.up);
        let y_pos = (up / forward) / y_limit;

        let frustum_pos = x_pos.abs().max(y_pos.abs());
        let foveate = if frustum_pos <= 1.0 {
            1.0 - frustum_pos * (1.0 - instance.outside_foveate)
        } else {
            instance.outside_foveate - 1.0 / frustum_pos * (instance.behind_foveate - instance.outside_foveate)
        };
        foveate * pixel_scale
    } else {
        let dot = forward / distance;
        if dot >= instance.cone_dot0 {
            pixel_scale
        } else {
            let t = ((dot - instance.cone_dot) / (instance.cone_dot0 - instance.cone_dot)).clamp(0.0, 1.0);
            let foveate = 1.0 - (1.0 - instance.cone_foveate) * (1.0 - t);
            foveate * pixel_scale
        }
    }
}

#[wasm_bindgen]
pub fn get_lod_tree_level(lod_id: u32, level: u32) -> anyhow::Result<Object, JsValue> {
    STATE.with_borrow_mut(|state| {
        let LodState { lod_trees, .. } = state;
        let lod_tree = lod_trees.get(&lod_id).unwrap();
        let splats = lod_tree.splats.borrow();

        let root_size = splats[0].size();
        let level_size = root_size / (1.25f32.powi(level as i32));

        let mut nodes = vec![0];
        let mut output_nodes = Vec::new();

        while !nodes.is_empty() {
            let mut new_nodes = Vec::new();
            for node in nodes {
                let splat = &splats[node as usize];
                let &LodSplat { child_count, child_start, .. } = splat;
                if splat.size() <= level_size {
                    output_nodes.push(node);
                } else {
                    for child in child_start..child_start + child_count as u32 {
                        new_nodes.push(child);
                    }
                }
            }
            nodes = new_nodes;
        }

        let output = Uint32Array::new_with_length(output_nodes.len() as u32);
        for (i, node) in output_nodes.into_iter().enumerate() {
            output.set_index(i as u32, node);
        }

        let result = Object::new();
        Reflect::set(&result, &JsValue::from_str("indices"), &JsValue::from(output)).unwrap();
        Ok(result)
    })
}

#[wasm_bindgen]
pub fn new_traverse_lod_trees(
    max_splats: u32, pixel_scale_limit: f32, last_pixel_limit: Option<f32>,
    lod_ids: &[u32], root_pages: &[u32],
    view_to_objects: &[f32], lod_scales: &[f32],
    behind_foveates: &[f32], cone_foveates: &[f32],
    cone_fov0s: &[f32], cone_fovs: &[f32],
) -> anyhow::Result<Object, JsValue> {
    let max_splats = max_splats as usize;
    let num_instances = lod_ids.len();
    if view_to_objects.len() != num_instances * 16 {
        return Err(JsValue::from_str("Invalid view_to_objects length"));
    }
    if lod_scales.len() != num_instances {
        return Err(JsValue::from_str("Invalid lod_scales length"));
    }
    if behind_foveates.len() != num_instances {
        return Err(JsValue::from_str("Invalid behind_foveates length"));
    }
    if cone_foveates.len() != num_instances {
        return Err(JsValue::from_str("Invalid cone_foveates length"));
    }
    if cone_fov0s.len() != num_instances {
        return Err(JsValue::from_str("Invalid cone_fov0s length"));
    }
    if cone_fovs.len() != num_instances {
        return Err(JsValue::from_str("Invalid cone_fovs length"));
    }

    STATE.with_borrow_mut(|state| {
        let LodState { lod_trees, frontier, output, touched, touched_set, .. } = state;
        let instances: Vec<_> = lod_ids.iter().enumerate().map(|(index, &lod_id)| {
            let lod_tree = lod_trees.get(&lod_id).unwrap();
            let LodTree { splats, skip_splats, page_to_chunk, chunk_to_page } = &lod_tree;
            let i16 = index * 16;
            let forward = Vec3A::from_slice(&view_to_objects[(i16 + 8)..(i16 + 11)]).normalize().map(|x| -x);
            let origin = Vec3A::from_slice(&view_to_objects[(i16 + 12)..(i16 + 15)]);
            let lod_scale = lod_scales[index];
            let behind_foveate = behind_foveates[index];
            let cone_foveate = cone_foveates[index];
            let cone_dot0 = if cone_fov0s[index] > 0.0 { (0.5 * cone_fov0s[index]).to_radians().cos() } else { 1.0 };
            let cone_dot = if cone_fovs[index] > 0.0 { (0.5 * cone_fovs[index]).to_radians().cos() } else { 1.0 };
            (lod_id, splats.borrow(), skip_splats.borrow(), page_to_chunk, chunk_to_page, origin, forward, lod_scale, behind_foveate, cone_foveate, cone_dot0, cone_dot)
        }).collect();

        let mut num_splats = 0;
        frontier.clear();
        output.clear();
        output.reserve(max_splats as usize);
        touched.clear();
        touched_set.clear();

        for (inst_index, instance) in instances.iter().enumerate() {
            let (lod_id, splats, ..) = instance;
            let root_page = root_pages[inst_index];
            let root_page = if root_page == 0xFFFFFFFF { 0 } else { root_page };
            let root_index = root_page << 16;
            let pixel_scale = new_compute_pixel_scale(&splats[root_index as usize], instance);
            frontier.push((OrderedFloat(pixel_scale), inst_index as u32, root_index));
            num_splats += 1;

            if touched_set.insert((*lod_id, 0)) {
                touched.push((*lod_id, 0));
            }
        }
        
        let mut min_pixel_scale = f32::INFINITY;
        let skip_pixel_limit = last_pixel_limit.unwrap_or(f32::INFINITY);
        let mut pending_splats: Vec<(OrderedFloat<f32>, u32, u32)> = Vec::new();

        while let Some(&(OrderedFloat(pixel_scale), inst_index, paged_index)) = frontier.peek() {
            min_pixel_scale = min_pixel_scale.min(pixel_scale);
            if pixel_scale <= pixel_scale_limit {
                break;
            }

            let instance = &instances[inst_index as usize];
            let (lod_id, splats, skip_splats, _page_to_chunk, chunk_to_page, ..) = instance;
            let LodSplat { child_count, child_start, .. } = splats[paged_index as usize];

            // let skips = &skip_splats[paged_index as usize];
            // if skips.len() > 1 && pixel_scale > skip_pixel_limit {
            // // if skips.len() > 1 {
            //     let new_num_splats = num_splats - 1 + skips.len();
            //     if new_num_splats <= max_splats {
            //         let page = paged_index >> 16;
            //         for &child in skips.iter() {
            //             let child_chunk = (child >> 16) as usize;
            //             let child_page = chunk_to_page[child_chunk];
            //             assert_eq!(child_page, page, "paged_index: {}, skip_splats-2: {:?}, skip_splats-1: {:?}, skip_splats: {:?}, skip_splats+1: {:?}, skip_splats+2: {:?}, child: {}, child_chunk: {}, child_page: {}, page: {}, child_count: {}, child_start: {}", paged_index, skip_splats[paged_index as usize - 2], skip_splats[paged_index as usize - 1], skips, skip_splats[paged_index as usize + 1], skip_splats[paged_index as usize + 2], child, child_chunk, child_page, page, child_count, child_start);
            //             // let paged_index = (child_page << 16) | (child & 0xffff);
            //             let paged_index = (page << 16) | (child & 0xffff);
            //             let pixel_scale = new_compute_pixel_scale(&splats[paged_index as usize], instance);
            //             // if pixel_scale <= pixel_scale_limit {
            //             if pixel_scale <= skip_pixel_limit {
            //                 pending_splats.clear();
            //                 break;
            //             }
            //             pending_splats.push((OrderedFloat(pixel_scale), inst_index, paged_index));
            //         }

            //         if !pending_splats.is_empty() {
            //             _ = frontier.pop();
            //             frontier.extend(pending_splats.drain(..));       
            //             num_splats = new_num_splats;
            //             continue;
            //         }
            //     }
            // }

            if child_count == 0 {
                _ = frontier.pop();
                output.push((inst_index, paged_index));
                continue;
            }

            let new_num_splats = num_splats - 1 + child_count as usize;
            if new_num_splats > max_splats {
                break;
            }

            _ = frontier.pop();

            let first_chunk = child_start >> 16;
            if touched_set.insert((*lod_id, first_chunk)) {
                touched.push((*lod_id, first_chunk));
            }

            let last_chunk = (child_start + child_count as u32 - 1) >> 16;
            if last_chunk != first_chunk && touched_set.insert((*lod_id, last_chunk)) {
                touched.push((*lod_id, last_chunk));
            }

            if last_chunk as usize >= chunk_to_page.len() {
                output.push((inst_index, paged_index));
                continue;
            }
            let first_page = chunk_to_page[first_chunk as usize];
            let last_page = chunk_to_page[last_chunk as usize];

            if first_page == 0xFFFFFFFF || last_page == 0xFFFFFFFF {
                output.push((inst_index, paged_index));
                continue;
            }

            for child in child_start..child_start + child_count as u32 {
                let child_chunk = (child >> 16) as usize;
                let child_page = chunk_to_page[child_chunk];
                let paged_index = (child_page << 16) | (child & 0xffff);
                let pixel_scale = new_compute_pixel_scale(&splats[paged_index as usize], instance);
                if pixel_scale <= pixel_scale_limit {
                    output.push((inst_index, paged_index));
                } else {
                    frontier.push((OrderedFloat(pixel_scale), inst_index, paged_index));
                }
            }

            num_splats = new_num_splats;
        }

        for (_, inst_index, paged_index) in frontier.drain() {
            output.push((inst_index, paged_index));
        }

        let mut instance_counts = Vec::new();
        instance_counts.resize(num_instances, 0);
        for &(inst_index, _) in output.iter() {
            instance_counts[inst_index as usize] += 1;
        }

        let mut instance_outputs = Vec::with_capacity(num_instances);
        for counts in instance_counts {
            instance_outputs.push(Vec::with_capacity(counts));
        }

        for &(inst_index, paged_index) in output.iter() {
            instance_outputs[inst_index as usize].push(paged_index);
        }

        let instance_indices = Array::new();

        for (inst_index, instance_output) in instance_outputs.iter_mut().enumerate() {
            instance_output.sort_unstable();
            let rows = instance_output.len().div_ceil(16384);
            let capacity = rows * 16384;
            let output = Uint32Array::new_with_length(capacity as u32);
            output.subarray(0, instance_output.len() as u32).copy_from(&instance_output);

            let result = Object::new();
            let lod_id = instances[inst_index].0;
            Reflect::set(&result, &JsValue::from_str("lodId"), &JsValue::from(lod_id)).unwrap();
            Reflect::set(&result, &JsValue::from_str("numSplats"), &JsValue::from(instance_output.len() as u32)).unwrap();
            Reflect::set(&result, &JsValue::from_str("indices"), &JsValue::from(output)).unwrap();
            instance_indices.push(&JsValue::from(result));
        }

        let out_chunks = Array::new();

        for &(inst_index, chunk) in touched.iter() {
            let pair = Array::new();
            pair.push(&JsValue::from(inst_index));
            pair.push(&JsValue::from(chunk));
            out_chunks.push(&JsValue::from(pair));
        }

        let result = Object::new();
        Reflect::set(&result, &JsValue::from_str("pixelLimit"), &JsValue::from(min_pixel_scale)).unwrap();
        Reflect::set(&result, &JsValue::from_str("instanceIndices"), &JsValue::from(instance_indices)).unwrap();
        Reflect::set(&result, &JsValue::from_str("chunks"), &JsValue::from(out_chunks)).unwrap();
        Ok(result)
    })
}

fn new_compute_pixel_scale<'a>(
    splat: &LodSplat,
    instance: &(u32, Ref<'a, Vec<LodSplat>>, Ref<'a, Vec<SmallVec<[u32; 4]>>>, &Vec<u32>, &Vec<u32>, Vec3A, Vec3A, f32, f32, f32, f32, f32),
) -> f32 {
    let &(_, _, _, _, _, origin, forward, lod_scale, behind_foveate, cone_foveate, cone_dot0, cone_dot) = instance;
    let center = splat.center();
    let delta = center - origin;
    let distance = delta.length().max(1.0e-6);
    let inv_distance = 1.0 / distance;
    let pixel_scale = splat.size() * inv_distance;
    let pixel_scale = pixel_scale * lod_scale;

    let forward_dot = delta.dot(forward);
    let foveate = if forward_dot <= 0.0 {
        behind_foveate
    } else {
        let dot = forward_dot * inv_distance;
        if dot >= cone_dot0 {
            1.0
        } else if dot >= cone_dot {
            let t = (dot - cone_dot) / (cone_dot0 - cone_dot);
            cone_foveate + (1.0 - cone_foveate) * t
        } else {
            let t = dot / cone_dot;
            behind_foveate + (cone_foveate - behind_foveate) * t
        }
    };
    foveate * pixel_scale
}
