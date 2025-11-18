use std::{array, cell::RefCell, collections::BinaryHeap};

use ahash::AHashMap;
use glam::Vec3A;
use half::f16;
use itertools::izip;
use js_sys::{Array, Object, Reflect, Uint32Array};
use ordered_float::OrderedFloat;
use wasm_bindgen::prelude::*;


const MAX_SPLAT_CHUNK: usize = 16384;

#[derive(Debug, Clone, Default)]
struct LodSplat {
    center: [f16; 3],
    size: f16,
    child_start: u32,
    child_count: u16,
}

#[derive(Debug, Clone, Default)]
struct LodTree {
    splats: Vec<LodSplat>,
    // For both mappings a 0 indicates "no chunk/value", except for
    // page and chunk 0, which map to each other by design.
    // This way we can resize and fill with "no value" easily.
    page_to_chunk: Vec<u32>,
    chunk_to_page: Vec<u32>,
}

struct LodState {
    next_id: u32,
    lod_trees: AHashMap<u32, LodTree>,
    frontier: BinaryHeap<(OrderedFloat<f32>, u32, u32)>,
    buffer: Vec<u32>,
}

impl LodState {
    fn new() -> Self {
        Self {
            next_id: 1000,
            lod_trees: AHashMap::new(),
            frontier: BinaryHeap::new(),
            buffer: Vec::new(),
        }
    }
}

thread_local! {
    static STATE: RefCell<LodState> = RefCell::new(LodState::new());
}

fn set_lod_tree_data(state: &mut LodState, lod_id: u32, base: u32, count: u32, lod_tree_data: &Uint32Array) {
    let lod_tree = state.lod_trees.entry(lod_id).or_insert_with(|| LodTree::default());

    if state.buffer.is_empty() {
        state.buffer.resize(MAX_SPLAT_CHUNK * 4, 0);
    }

    if base + count > lod_tree.splats.len() as u32 {
        let new_size = (lod_tree.splats.len() * 2).max((base + count) as usize);
        lod_tree.splats.resize_with(new_size, Default::default);
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

            lod_tree.splats[(base + index + i) as usize] = LodSplat { center, size, child_count, child_start };
        }
        index += chunk;
    }
}

#[wasm_bindgen]
pub fn init_lod_tree(num_splats: u32, lod_tree: Uint32Array) -> Result<Object, JsValue> {
    STATE.with_borrow_mut(|state| {
        let lod_id = state.next_id;
        let pages = num_splats.div_ceil(65536);
        let splats = Vec::with_capacity(num_splats as usize);
        let page_to_chunk = (0..pages).map(|page| page as u32).collect();
        let chunk_to_page: Vec<u32> = (0..pages).map(|chunk| chunk as u32).collect();
        let chunk_to_page_array = Uint32Array::new_with_length(chunk_to_page.len() as u32);
        chunk_to_page_array.copy_from(&chunk_to_page);
        state.lod_trees.insert(lod_id, LodTree { splats, page_to_chunk, chunk_to_page });
        state.next_id += 1;

        set_lod_tree_data(state, lod_id, 0, num_splats, &lod_tree);

        let result = Object::new();
        Reflect::set(&result, &JsValue::from_str("lodId"), &JsValue::from(lod_id)).unwrap();
        Reflect::set(&result, &JsValue::from_str("chunkToPage"), &JsValue::from(chunk_to_page_array)).unwrap();

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
pub fn insert_lod_trees(lod_ids: &[u32], page_bases: &[u32], chunk_bases: &[u32], counts: &[u32], lod_trees: &Array) -> Result<Object, JsValue> {
    let mut chunk_to_pages = AHashMap::<u32, Uint32Array>::new();
    STATE.with_borrow_mut(|state| {
        for (&lod_id, &page_base, &chunk_base, &count, lod_tree_data) in izip!(lod_ids, page_bases, chunk_bases, counts, lod_trees.iter()) {
            let lod_tree = state.lod_trees.entry(lod_id).or_insert_with(|| LodTree::default());
            let pages = count.div_ceil(65536);

            let base_page = page_base / 65536;
            let base_chunk = chunk_base / 65536;
            if (base_page + pages) > lod_tree.page_to_chunk.len() as u32 {
                lod_tree.page_to_chunk.resize((base_page + pages) as usize, 0);
            }
            if (base_chunk + pages) > lod_tree.chunk_to_page.len() as u32 {
                lod_tree.chunk_to_page.resize((base_chunk + pages) as usize, 0);
            }

            for page in 0..pages {
                lod_tree.page_to_chunk[(base_page + page) as usize] = base_chunk + page;
                lod_tree.chunk_to_page[(base_chunk + page) as usize] = base_page + page;
            }

            if !chunk_to_pages.contains_key(&lod_id) {
                let chunk_to_page_array = Uint32Array::new_with_length(lod_tree.chunk_to_page.len() as u32);
                chunk_to_page_array.copy_from(&lod_tree.chunk_to_page);
                chunk_to_pages.insert(lod_id, chunk_to_page_array);
            }
    
            let lod_tree_data = Uint32Array::from(lod_tree_data);
            set_lod_tree_data(state, lod_id, page_base, count, &lod_tree_data);
        }

        let result = Object::new();
        for (lod_id, chunk_to_page_array) in chunk_to_pages.drain() {
            Reflect::set(&result, &JsValue::from(lod_id), &JsValue::from(chunk_to_page_array)).unwrap();
        }
        Ok(result)
    })
}

#[wasm_bindgen]
pub fn clear_lod_trees(lod_ids: &[u32], page_bases: &[u32], chunk_bases: &[u32], counts: &[u32]) -> Result<Object, JsValue> {
    STATE.with_borrow_mut(|state| {
        let mut chunk_to_pages = AHashMap::<u32, Uint32Array>::new();
        
        for (&lod_id, &page_base, &chunk_base, &count) in izip!(lod_ids, page_bases, chunk_bases, counts) {
            let lod_tree = state.lod_trees.entry(lod_id).or_insert_with(|| LodTree::default());
            let pages = count.div_ceil(65536);

            let base_page = page_base / 65536;
            let base_chunk = chunk_base / 65536;
            for page in 0..pages {
                lod_tree.page_to_chunk[(base_page + page) as usize] = 0;
                lod_tree.chunk_to_page[(base_chunk + page) as usize] = 0;
            }

            if !chunk_to_pages.contains_key(&lod_id) {
                let chunk_to_page_array = Uint32Array::new_with_length(lod_tree.chunk_to_page.len() as u32);
                chunk_to_page_array.copy_from(&lod_tree.chunk_to_page);
                chunk_to_pages.insert(lod_id, chunk_to_page_array);
            }
        }

        let result = Object::new();
        for (lod_id, chunk_to_page_array) in chunk_to_pages.drain() {
            Reflect::set(&result, &JsValue::from(lod_id), &JsValue::from(chunk_to_page_array)).unwrap();
        }
        Ok(result)
    })
}

struct LodInstance<'a> {
    lod_id: u32,
    splats: &'a [LodSplat],
    chunk_to_page: &'a [u32],
    origin: Vec3A,
    forward: Vec3A,
    right: Vec3A,
    up: Vec3A,
    output: Vec<u32>,
    lod_scale: f32,
    outside_foveate: f32,
    behind_foveate: f32,
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
    let chunk = (index / 65536) as usize;
    if chunk != 0 {
        if chunk >= instance.chunk_to_page.len() {
            return false;
        } else if instance.chunk_to_page[chunk] == 0 {
            return false;
        }
    }
    true
}

#[wasm_bindgen]
pub fn traverse_lod_trees(
    max_splats: u32, pixel_scale_limit: f32,
    fov_x_degrees: f32, fov_y_degrees: f32,
    lod_ids: &[u32], view_to_objects: &[f32],
    lod_scales: &[f32], outside_foveates: &[f32], behind_foveates: &[f32],
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
    
    let x_limit = (0.5 * fov_x_degrees).to_radians().tan();
    let y_limit = (0.5 * fov_y_degrees).to_radians().tan();

    STATE.with_borrow_mut(|state| {
        let LodState { lod_trees, ref mut frontier, .. } = state;
        frontier.clear();

        let mut instances: Vec<_> = lod_ids.iter().enumerate().map(|(index, &lod_id)| {
            let lod_tree = lod_trees.get(&lod_id).unwrap();
            let LodTree { splats, page_to_chunk: _, chunk_to_page } = &lod_tree;
            let i16 = index * 16;
            let right = Vec3A::from_slice(&view_to_objects[i16..(i16 + 3)]).normalize();
            let up = Vec3A::from_slice(&view_to_objects[(i16 + 4)..(i16 + 7)]).normalize();
            let forward = Vec3A::from_slice(&view_to_objects[(i16 + 8)..(i16 + 11)]).normalize().map(|x| -x);
            let origin = Vec3A::from_slice(&view_to_objects[(i16 + 12)..(i16 + 15)]);
            let output = Vec::new();
            let lod_scale = lod_scales[index];
            let outside_foveate = outside_foveates[index];
            let behind_foveate = behind_foveates[index];
            LodInstance { lod_id, splats, chunk_to_page, origin, forward, right, up, output, lod_scale, outside_foveate, behind_foveate }
        }).collect();

        let mut num_splats = 0;
        let mut chunks: Vec<(u32, u32)> = Vec::new();
        let mut chunk_touched: AHashMap<u32, Vec<bool>> = AHashMap::new();

        let mut touch_chunk = |inst_index: u32, splat_index: u32| {
            let lod_id = lod_ids[inst_index as usize];
            let touched = chunk_touched.entry(lod_id).or_default();
            let chunk = (splat_index / 65536) as usize;
            if chunk >= touched.len() {
                touched.resize(chunk + 1, false);
            }
            if !touched[chunk] {
                touched[chunk] = true;
                chunks.push((lod_id, chunk as u32));
            }
        };

        for (inst_index, instance) in instances.iter().enumerate() {
            let inst_index = inst_index as u32;
            let pixel_scale = compute_pixel_scale(
                &instance.splats[0], instance, x_limit, y_limit,
            );
            frontier.push((OrderedFloat(pixel_scale), inst_index, 0));
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
            instances[inst_index as usize].output.push(paged_index);
            touch_chunk(inst_index, paged_index);
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
    let center = Vec3A::from_array(splat.center.map(|x| x.to_f32()));
    let delta = center - instance.origin;
    let distance = delta.length();
    let pixel_scale = splat.size.to_f32() / distance.max(1.0e-6);
    let pixel_scale = pixel_scale * instance.lod_scale;
    
    let forward = delta.dot(instance.forward);
    if forward <= 0.0 {
        instance.behind_foveate * pixel_scale
    } else {
        // let right = delta.dot(instance.right);
        // if (right / forward).abs() > x_limit {
        //     outside_foveate * pixel_scale
        // } else {
        //     let up = delta.dot(instance.up);
        //     if (up / forward).abs() > y_limit {
        //         outside_foveate * pixel_scale
        //     } else {
        //         pixel_scale
        //     }
        // }

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
    }
}
