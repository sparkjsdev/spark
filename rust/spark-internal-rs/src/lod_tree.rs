use std::{array, cell::RefCell, collections::BinaryHeap};

use ahash::AHashMap;
use glam::{Quat, Vec3A};
use half::f16;
use itertools::izip;
use js_sys::{Array, Object, Reflect, Uint32Array};
use ordered_float::OrderedFloat;
use spark_lib::splat_encode::{decode_lod_tree_children, decode_packed_splat_center, decode_packed_splat_opacity, decode_packed_splat_quat, decode_packed_splat_scale};
use wasm_bindgen::prelude::*;

use crate::packed_splats::PackedSplatsData;
use spark_lib::decoder::SplatGetter;

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

            let base_page = page_base >> 16;
            let base_chunk = chunk_base >> 16;
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

            let base_page = page_base >> 16;
            let base_chunk = chunk_base >> 16;
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
    cone_fovs: &[f32], cone_foveates: &[f32],
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
            let LodTree { splats, page_to_chunk, chunk_to_page } = &lod_tree;
            let i16 = index * 16;
            let right = Vec3A::from_slice(&view_to_objects[i16..(i16 + 3)]).normalize();
            let up = Vec3A::from_slice(&view_to_objects[(i16 + 4)..(i16 + 7)]).normalize();
            let forward = Vec3A::from_slice(&view_to_objects[(i16 + 8)..(i16 + 11)]).normalize().map(|x| -x);
            let origin = Vec3A::from_slice(&view_to_objects[(i16 + 12)..(i16 + 15)]);
            let output = Vec::new();
            let lod_scale = lod_scales[index];
            let outside_foveate = outside_foveates[index];
            let behind_foveate = behind_foveates[index];
            let cone_dot = if cone_fovs[index] > 0.0 { (0.5 * cone_fovs[index]).to_radians().cos() } else { 1.0 };
            let cone_foveate = cone_foveates[index];
            LodInstance { lod_id, splats, page_to_chunk, chunk_to_page, origin, forward, right, up, output, lod_scale, outside_foveate, behind_foveate, cone_dot, cone_foveate }
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
    let center = Vec3A::from_array(splat.center.map(|x| x.to_f32()));
    let delta = center - instance.origin;
    let distance = delta.length();
    let pixel_scale = splat.size.to_f32() / distance.max(1.0e-6);
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
        let t = ((1.0 - dot) / (1.0 - instance.cone_dot)).clamp(0.0, 1.0);
        let foveate = 1.0 - (1.0 - instance.cone_foveate) * t;
        foveate * pixel_scale
    }
}

#[wasm_bindgen]
pub fn traverse_bones(
    num_lod_splats: u32,
    lod_packed: Uint32Array,
    extra: Option<Object>,
    max_bone_splats: u32,
    num_splats: u32,
    packed: Option<Uint32Array>,
    compute_weights: bool,
    min_bone_opacity: f32,
) -> Result<Object, JsValue> {
    let mut lod_packed_data = match PackedSplatsData::from_js_arrays(lod_packed, num_lod_splats as usize, extra.as_ref()) {
        Ok(lod_packed_data) => lod_packed_data,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };

    let lod_splat_encoding = lod_packed_data.get_encoding();
    
    type Chunk = (usize, usize, Vec<u32>, Vec<u32>);
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut frontier = BinaryHeap::new();
    const CHUNK_SIZE: usize = 4096;

    let get_chunk_index = |chunks: &mut Vec<Chunk>, packed_data: &mut PackedSplatsData, index: usize| {
        for (chunk_index, (base, count, _packed, _lod_tree)) in chunks.iter().enumerate().rev() {
            if index >= *base && index < *base + *count {
                let i4 = 4 * (index - base);
                return (chunk_index, i4);
            }
        }

        let mut packed = vec![0; 4 * CHUNK_SIZE];
        let mut lod_tree = vec![0; 4 * CHUNK_SIZE];
        packed_data.get_packed_array(index, CHUNK_SIZE, &mut packed);
        let got_lod_tree = packed_data.get_lod_tree_array(index, CHUNK_SIZE, &mut lod_tree).is_some();
        assert!(got_lod_tree);
        
        chunks.push((index, CHUNK_SIZE, packed, lod_tree));
        return (chunks.len() - 1, 0);
    };

    let get_splat_data = |chunks: &mut Vec<Chunk>, packed_data: &mut PackedSplatsData, index: usize| {
        let (chunk_index, i4) = get_chunk_index(chunks, packed_data, index);
        let (_, _, packed, lod_tree) = &chunks[chunk_index];

        // let opacity = decode_packed_splat_opacity(&packed[i4..i4+4], &lod_splat_encoding);
        let scales = decode_packed_splat_scale(&packed[i4..i4+4], &lod_splat_encoding);
        let (child_count, child_start) = decode_lod_tree_children(&lod_tree[i4..i4+4]);

        // let metric = scales[0] * scales[1] * scales[2];
        // let metric = scales[0].max(scales[1]).max(scales[2]);
        // let metric = scales[0].max(scales[1]).max(scales[2]) * opacity;
        let metric = scales[0] + scales[1] + scales[2];
        (OrderedFloat(metric), index, child_count as usize, child_start as usize)
    };

    let mut output = Vec::new();
    frontier.push(get_splat_data(&mut chunks, &mut lod_packed_data, 0));

    while let Some((OrderedFloat(_volume), index, child_count, child_start)) = frontier.pop() {
        if child_count == 0 {
            output.push(index as u32)
        } else {
            // output.push(index as u32);

            let new_num_bones = output.len() + frontier.len() + child_count as usize;
            if new_num_bones > max_bone_splats as usize {
                output.push(index as u32);
                break;
            }

            for child in 0..child_count as usize {
                let child_index = child_start + child;
                frontier.push(get_splat_data(&mut chunks, &mut lod_packed_data, child_index));
            }
        }
    }

    for (_volume, index, _child_count, _child_start) in frontier.drain() {
        output.push(index as u32);
    }

    output.sort_unstable();

    output.retain(|&index| {
        let (chunk_index, i4) = get_chunk_index(&mut chunks, &mut lod_packed_data, index as usize);
        let (_, _, packed, _) = &chunks[chunk_index];
        let opacity = decode_packed_splat_opacity(&packed[i4..i4+4], &lod_splat_encoding);
        opacity >= min_bone_opacity
    });

    let mut index_mapping = AHashMap::new();
    for (new_index, &old_index) in output.iter().enumerate() {
        index_mapping.insert(old_index, new_index as u32);
    }

    let num_bones = output.len();
    let mut packed_out: Vec<u32> = Vec::with_capacity(num_bones * 4);
    let mut child_counts: Vec<u32> = Vec::with_capacity(num_bones);
    let mut child_starts: Vec<u32> = Vec::with_capacity(num_bones);

    let mut centers: Vec<glam::Vec3A> = Vec::with_capacity(num_bones);
    // let mut opacities: Vec<f32> = Vec::with_capacity(num_bones);
    let mut scales: Vec<glam::Vec3A> = Vec::with_capacity(num_bones);
    let mut quats: Vec<glam::Quat> = Vec::with_capacity(num_bones);

    for old_index in output {
        let (chunk_index, i4) = get_chunk_index(&mut chunks, &mut lod_packed_data, old_index as usize);
        let (_, _, packed, lod_tree) = &chunks[chunk_index];
        let packed = &packed[i4..i4+4];
        let (child_count, child_start) = decode_lod_tree_children(&lod_tree[i4..i4+4]);
        
        packed_out.extend_from_slice(packed);
        child_counts.push(child_count as u32);
        child_starts.push(*index_mapping.get(&child_start).unwrap_or(&0));

        centers.push(Vec3A::from_array(decode_packed_splat_center(packed)));
        // opacities.push(decode_packed_splat_opacity(packed, &lod_splat_encoding));
        let scale = Vec3A::from_array(decode_packed_splat_scale(packed, &lod_splat_encoding));
        scales.push(scale.max(Vec3A::splat(1.0e-4)));
        quats.push(Quat::from_array(decode_packed_splat_quat(packed)));
    }

    drop(chunks);

    let rows = num_bones.div_ceil(2048);
    let capacity = rows * 2048;
    packed_out.resize(capacity * 4, 0);

    let result = Object::new();
    Reflect::set(&result, &JsValue::from_str("numSplats"), &JsValue::from(num_bones)).unwrap();
    Reflect::set(&result, &JsValue::from_str("packed"), &JsValue::from(packed_out)).unwrap();   
    Reflect::set(&result, &JsValue::from_str("childCounts"), &JsValue::from(child_counts)).unwrap();
    Reflect::set(&result, &JsValue::from_str("childStarts"), &JsValue::from(child_starts)).unwrap();
    Reflect::set(&result, &JsValue::from_str("splatEncoding"), &serde_wasm_bindgen::to_value(&lod_splat_encoding).unwrap()).unwrap();

    if compute_weights {
        let mut lod_bone_weights: Vec<u16> = Vec::with_capacity(num_lod_splats as usize * 4);
        let mut bone_weights: Vec<u16> = Vec::with_capacity(num_splats as usize * 4);
        let mut top_bones: Vec<(f32, usize)> = Vec::new();

        let mut splat_centers = Vec::new();
        splat_centers.resize(CHUNK_SIZE * 3, 0.0);

        let find_top_bones = |num_bones: usize, centers: &[Vec3A], quats: &[Quat], scales: &[Vec3A], top_bones: &mut Vec<(f32, usize)>, splat_center: Vec3A| {
            top_bones.clear();
            for b in 0..num_bones {
                let bone_splat = splat_center - centers[b];
                let bone_splat = quats[b].inverse() * bone_splat;
                let bone_splat = bone_splat / scales[b];
                let bone_score = (bone_splat.length(), b);

                let n = top_bones.len();
                top_bones.push(bone_score); // Temporary, we'll shift as needed
                let mut j = n;
                while j > 0 && bone_score.0 < top_bones[j - 1].0 {
                    top_bones[j] = top_bones[j - 1];
                    j -= 1;
                }
                top_bones[j] = bone_score;

                // Drop the last element if we have more than 4
                if top_bones.len() > 4 {
                    top_bones.pop();
                }
            }

            // top_bones.truncate(1);

            let total_score = top_bones.iter().map(|(score, _)| (-score).exp()).sum::<f32>();

            let bone_weights: [u16; 4] = array::from_fn(|d| {
                let bone_weight = if d < top_bones.len() {
                    (top_bones[d].1, (-top_bones[d].0).exp() / total_score)
                } else {
                    (0, 0.0)
                };

                // if bone_weight.0 > 255 {
                //     panic!("Bone index out of range");
                // }
                let weight_u8 = (bone_weight.1 * 255.0).clamp(0.0, 255.0).round() as u8;
                let bone_index_u8 = bone_weight.0 as u8;
                let bone_weight_u16 = (bone_index_u8 as u16) << 8 | weight_u8 as u16;
                bone_weight_u16
            });
            bone_weights
        };

        let mut base = 0;
        while base < num_lod_splats as usize {
            let chunk_size = (num_lod_splats as usize - base).min(CHUNK_SIZE);
            lod_packed_data.get_center(base, chunk_size, &mut splat_centers);
            for i in 0..chunk_size {
                let i3 = i * 3;
                let splat_center = Vec3A::from_slice(&splat_centers[i3..i3+3]);
                let bone_weights_u16 = find_top_bones(num_bones, &centers, &quats, &scales, &mut top_bones, splat_center);
                lod_bone_weights.extend_from_slice(&bone_weights_u16);
            }
            base += chunk_size;
        }

        if let Some(packed) = packed {
            let mut packed_data = match PackedSplatsData::from_js_arrays(packed, num_splats as usize, None) {
                Ok(packed_data) => packed_data,
                Err(err) => { return Err(JsValue::from(err.to_string())); }
            };

            let mut base = 0;
            while base < num_splats as usize {
                let chunk_size = (num_splats as usize - base).min(CHUNK_SIZE);
                packed_data.get_center(base, chunk_size, &mut splat_centers);
                for i in 0..chunk_size {
                    let i3 = i * 3;
                    let splat_center = Vec3A::from_slice(&splat_centers[i3..i3+3]);
                    let bone_weights_u16 = find_top_bones(num_bones, &centers, &quats, &scales, &mut top_bones, splat_center);
                    bone_weights.extend_from_slice(&bone_weights_u16);
                }
                base += chunk_size;
            }
        }

        let lod_splat_rows = (num_lod_splats as usize).div_ceil(2048);
        let lod_splat_capacity = lod_splat_rows * 2048;
        lod_bone_weights.resize(lod_splat_capacity * 4, 0);

        let splat_rows = (num_splats as usize).div_ceil(2048);
        let splat_capacity = splat_rows * 2048;
        bone_weights.resize(splat_capacity * 4, 0);

        Reflect::set(&result, &JsValue::from_str("boneWeights"), &JsValue::from(bone_weights)).unwrap();
        Reflect::set(&result, &JsValue::from_str("lodBoneWeights"), &JsValue::from(lod_bone_weights)).unwrap();
    }
    
    Ok(result)
}
