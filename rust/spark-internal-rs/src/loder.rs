
use std::{array, cell::RefCell, collections::BinaryHeap};

use ahash::AHashMap;
use glam::Vec3A;
use half::f16;
use js_sys::{Uint16Array, Uint32Array};
use ordered_float::OrderedFloat;
use wasm_bindgen::prelude::wasm_bindgen;

struct LodSplat {
    center: [f16; 3],
    size: f16,
    // center: Vec3A,
    // size: f32,
    child_start: u32,
    child_count: u16,
}

const BUFFER_SIZE: usize = 65536;

struct LodInitBuffers {
    packed: Vec<u32>,
    counts: Vec<u16>,
    starts: Vec<u32>,
}

impl LodInitBuffers {
    fn new() -> Self {
        Self {
            packed: vec![0; BUFFER_SIZE * 4],
            counts: vec![0; BUFFER_SIZE],
            starts: vec![0; BUFFER_SIZE],
        }
    }
}

struct LodState {
    next_lod_id: u32,
    lod_splats: AHashMap<u32, Vec<LodSplat>>,
    init_buffers: LodInitBuffers,
    output: Vec<u32>,
    frontier: BinaryHeap<(OrderedFloat<f32>, u32)>,
}

impl LodState {
    fn new() -> Self {
        Self {
            next_lod_id: 0,
            lod_splats: AHashMap::new(),
            init_buffers: LodInitBuffers::new(),
            output: Vec::new(),
            frontier: BinaryHeap::new(),
        }
    }
}

thread_local! {
    static STATE: RefCell<LodState> = RefCell::new(LodState::new());
}

#[wasm_bindgen]
pub fn lod_init(
    num_splats: u32, packed_splats: Uint32Array, ln_scale_min: f32, ln_scale_max: f32,
    child_counts: Uint16Array, child_starts: Uint32Array,
) -> u32 {
    STATE.with_borrow_mut(|state| {
        let mut splats: Vec<LodSplat> = Vec::with_capacity(num_splats as usize);
        let LodInitBuffers { packed, counts, starts } = &mut state.init_buffers;

        let mut base = 0;
        while base < num_splats {
            let chunk_size = (BUFFER_SIZE as u32).min(num_splats - base);
            let packed = &mut packed[0..(4 * chunk_size as usize)];
            packed_splats.subarray(4 * base, 4 * (base + chunk_size)).copy_to(packed);
            let starts = &mut starts[0..(chunk_size as usize)];
            child_starts.subarray(base, base + chunk_size).copy_to(starts);
            let counts = &mut counts[0..(chunk_size as usize)];
            child_counts.subarray(base, base + chunk_size).copy_to(counts);

            for i in 0..chunk_size {
                let i4 = (i * 4) as usize;
                let splat = &packed[i4..i4 + 4];
                let center = extract_center(splat);
                let opacity = extract_opacity(splat);
                let scales = extract_scale(splat, ln_scale_min, ln_scale_max);
                
                let opacity = if opacity <= 0.5 { opacity * 2.0 } else { opacity * 8.0 - 3.0 };
                let stddevs = opacity.max(1.0);
                let size = 2.0 * stddevs * scales[0].max(scales[1]).max(scales[2]);
                splats.push(LodSplat {
                    center: array::from_fn(|i| f16::from_f32(center[i])),
                    size: f16::from_f32(size),
                    // center: Vec3A::from(center),
                    // size,
                    child_start: starts[i as usize],
                    child_count: counts[i as usize],
                });
            }
            base += chunk_size
        }

        let lod_id = state.next_lod_id;
        state.next_lod_id += 1;

        state.lod_splats.insert(lod_id, splats);
        lod_id
    })
}

#[wasm_bindgen]
pub fn lod_dispose(lod_id: u32) {
    STATE.with_borrow_mut(|state| {
        state.lod_splats.remove(&lod_id);
    });
}

fn extract_opacity(packed: &[u32]) -> f32 {
    ((packed[0] >> 24) as u8) as f32 / 255.0
}

fn extract_center(packed: &[u32]) -> [f32; 3] {
    let x = f16::from_bits(packed[1] as u16).to_f32();
    let y = f16::from_bits((packed[1] >> 16) as u16).to_f32();
    let z = f16::from_bits(packed[2] as u16).to_f32();
    [x, y, z]
}

fn extract_scale(packed: &[u32], ln_scale_min: f32, ln_scale_max: f32) -> [f32; 3] {
    let scales = [packed[3] as u8, (packed[3] >> 8) as u8, (packed[3] >> 16) as u8];
    let ln_scale_scale = (ln_scale_max - ln_scale_min) / 254.0;
    [
        if scales[0] == 0 { 0.0 } else { (ln_scale_min + (scales[0] - 1) as f32 * ln_scale_scale).exp() },
        if scales[1] == 0 { 0.0 } else { (ln_scale_min + (scales[1] - 1) as f32 * ln_scale_scale).exp() },
        if scales[2] == 0 { 0.0 } else { (ln_scale_min + (scales[2] - 1) as f32 * ln_scale_scale).exp() },
    ]
}

#[wasm_bindgen]
pub fn lod_compute(
    lod_id: u32,
    origin_x: f32, origin_y: f32, origin_z: f32,
    dir_x: f32, dir_y: f32, dir_z: f32,
    foveate: f32,
    pixel_scale_limit: f32,
    max_splats: u32,
) -> Uint32Array {
    let origin = [origin_x, origin_y, origin_z];
    let dir = [dir_x, dir_y, dir_z];
    // let origin = Vec3A::new(origin_x, origin_y, origin_z);
    // let dir = Vec3A::new(dir_x, dir_y, dir_z);

    STATE.with_borrow_mut(|state| {
        let LodState { lod_splats, output, frontier, .. } = state;
        let splats = lod_splats.get(&lod_id).unwrap();

        output.clear();
        output.reserve(max_splats as usize);

        frontier.clear();
        frontier.push((OrderedFloat(compute_pixel_scale(&splats[0], origin, dir, foveate)), 0));

        while let Some(&(OrderedFloat(pixel_scale), index)) = frontier.peek() {
            if pixel_scale <= pixel_scale_limit {
                // Everything is smaller than the pixel scale limit so we're done
                break;
            }

            let LodSplat { child_start, child_count, .. } = splats[index as usize];
            if child_count == 0 {
                _ = frontier.pop();
                output.push(index);
            } else {
                let new_size = output.len() + frontier.len() - 1 + child_count as usize;
                if new_size > max_splats as usize {
                    // Reached out splat budget so we're done
                    break;
                }

                _ = frontier.pop();
                frontier.extend((0..child_count).filter_map(|i| {
                    let child_index = child_start + i as u32;
                    let pixel_scale = compute_pixel_scale(&splats[child_index as usize], origin, dir, foveate);
                    if pixel_scale > pixel_scale_limit {
                        Some((OrderedFloat(pixel_scale), child_index))
                    } else {
                        output.push(child_index);
                        None
                    }
                }));
            }
        }

        output.extend(frontier.drain().map(|(_, index)| index));
        output.sort_unstable();

        let result = Uint32Array::new_with_length(output.len() as u32);
        result.copy_from(&output);
        result
    })
}

fn compute_pixel_scale(splat: &LodSplat, origin: [f32; 3], dir: [f32; 3], foveate: f32) -> f32 {
    let center: [f32; 3] = array::from_fn(|i| splat.center[i].to_f32());
    let delta: [f32; 3] = array::from_fn(|i| center[i] - origin[i]);
    let distance = (delta[0].powi(2) + delta[1].powi(2) + delta[2].powi(2)).sqrt().max(1.0e-6);
    let inv_distance = distance.recip();
    let dot = (delta[0] * dir[0] + delta[1] * dir[1] + delta[2] * dir[2]) * inv_distance;
    splat.size.to_f32() * dot.max(foveate) * inv_distance
}

// fn compute_pixel_scale(splat: &LodSplat, origin: Vec3A, dir: Vec3A, foveate: f32) -> f32 {
//     let delta = splat.center - origin;
//     let distance = delta.length().max(1.0e-6);
//     let inv_distance = 1.0 / distance;
//     let dot = delta.dot(dir) * inv_distance;
//     splat.size * dot.max(0.3) * inv_distance
// }
