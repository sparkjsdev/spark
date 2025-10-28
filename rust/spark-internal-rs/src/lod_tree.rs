use std::{array, cell::RefCell, collections::BinaryHeap};

use ahash::AHashMap;
use glam::Vec3A;
use half::f16;
use js_sys::{Array, Object, Reflect, Uint32Array};
use ordered_float::OrderedFloat;
use wasm_bindgen::prelude::*;


struct LodSplat {
    center: [f16; 3],
    size: f16,
    child_start: u32,
    child_count: u16,
}

const MAX_SPLAT_CHUNK: usize = 16384;

struct LodState {
    next_id: u32,
    lod_trees: AHashMap<u32, Vec<LodSplat>>,
    frontier: BinaryHeap<(OrderedFloat<f32>, u32, u32)>,
    buffer: Vec<u32>,
}

impl LodState {
    fn new() -> Self {
        Self {
            next_id: 0,
            lod_trees: AHashMap::new(),
            frontier: BinaryHeap::new(),
            buffer: Vec::new(),
        }
    }
}

thread_local! {
    static STATE: RefCell<LodState> = RefCell::new(LodState::new());
}

#[wasm_bindgen]
pub fn init_lod_tree(num_splats: u32, lod_tree: Uint32Array) -> u32 {
    STATE.with_borrow_mut(|state| {
        if state.buffer.is_empty() {
            state.buffer.resize(MAX_SPLAT_CHUNK * 4, 0);
        }
        let num_splats = num_splats as usize;
        let mut tree = Vec::with_capacity(num_splats);
        let mut base = 0;

        while base < num_splats {
            let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
            let buffer = &mut state.buffer[0..(count * 4)];
            lod_tree.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_to(buffer);

            for i in 0..count {
                let i4 = i * 4;
                let words: [u32; 4] = array::from_fn(|j| buffer[i4 + j]);
                let center = [
                    f16::from_bits((words[0] & 0xffff) as u16),
                    f16::from_bits((words[0] >> 16) as u16),
                    f16::from_bits((words[1] & 0xffff) as u16),
                ];
                let size = f16::from_bits((words[1] >> 16) as u16);
                let child_count = (words[2] & 0xffff) as u16;
                let child_start = words[3];
                tree.push(LodSplat { center, size, child_count, child_start });
            }
            base += count;
        }

        let lod_id = state.next_id;
        state.lod_trees.insert(lod_id, tree);
        state.next_id += 1;
        lod_id
    })
}

#[wasm_bindgen]
pub fn dispose_lod_tree(lod_id: u32) {
    STATE.with_borrow_mut(|state| {
        state.lod_trees.remove(&lod_id);
    })
}

struct LodInstance<'a> {
    splats: &'a [LodSplat],
    origin: Vec3A,
    forward: Vec3A,
    right: Vec3A,
    up: Vec3A,
    output: Vec<u32>,
}

#[wasm_bindgen]
pub fn traverse_lod_trees(
    max_splats: u32, pixel_scale_limit: f32,
    fov_x_degrees: f32, fov_y_degrees: f32,
    outside_foveate: f32, behind_foveate: f32,
    lod_ids: &[u32], view_to_objects: &[f32],
) -> Array {
    let max_splats = max_splats as usize;
    let num_instances = lod_ids.len();
    assert_eq!(view_to_objects.len(), num_instances * 16);

    let x_limit = (0.5 * fov_x_degrees).to_radians().tan();
    let y_limit = (0.5 * fov_y_degrees).to_radians().tan();

    STATE.with_borrow_mut(|state| {
        let LodState { lod_trees, ref mut frontier, .. } = state;
        frontier.clear();

        let mut instances: Vec<_> = lod_ids.iter().enumerate().map(|(index, &lod_id)| {
            let splats = lod_trees.get(&lod_id).unwrap();
            let i16 = index * 16;
            let right = Vec3A::from_slice(&view_to_objects[i16..(i16 + 3)]).normalize();
            let up = Vec3A::from_slice(&view_to_objects[(i16 + 4)..(i16 + 7)]).normalize();
            let forward = Vec3A::from_slice(&view_to_objects[(i16 + 8)..(i16 + 11)]).normalize().map(|x| -x);
            let origin = Vec3A::from_slice(&view_to_objects[(i16 + 12)..(i16 + 15)]);
            let output = Vec::new();
            LodInstance { splats, origin, forward, right, up, output }
        }).collect();

        let mut num_splats = 0;

        for (inst_index, instance) in instances.iter().enumerate() {
            let pixel_scale = compute_pixel_scale(
                &instance.splats[0], instance, 
                x_limit, y_limit, outside_foveate, behind_foveate,
            );
            frontier.push((OrderedFloat(pixel_scale), inst_index as u32, 0));
            num_splats += 1;
        }

        while let Some(&(OrderedFloat(pixel_scale), inst_index, splat_index)) = frontier.peek() {
            let instance = &mut instances[inst_index as usize];
            if pixel_scale <= pixel_scale_limit {
                break;
            }

            let LodSplat { child_count, child_start, .. } = instance.splats[splat_index as usize];
            if child_count == 0 {
                _ = frontier.pop();
                instance.output.push(splat_index);
            } else {
                let new_num_splats = num_splats - 1 + child_count as usize;
                if new_num_splats > max_splats {
                    break;
                }

                _ = frontier.pop();
                for child in 0..child_count {
                    let child_index = child_start + child as u32;
                    let pixel_scale = compute_pixel_scale(
                        &instance.splats[child_index as usize], instance,
                        x_limit, y_limit, outside_foveate, behind_foveate,
                    );
                    if pixel_scale <= pixel_scale_limit {
                        instance.output.push(child_index);
                    } else {
                        frontier.push((OrderedFloat(pixel_scale), inst_index, child_index));
                    }
                }
                num_splats = new_num_splats;
            }
        }

        for (_, inst_index, splat_index) in frontier.drain() {
            instances[inst_index as usize].output.push(splat_index);
        }

        let results = Array::new();
        for instance in instances.iter_mut() {
            instance.output.sort_unstable();
            let rows = instance.output.len().div_ceil(16384);
            let capacity = rows * 16384;
            let output = Uint32Array::new_with_length(capacity as u32);
            output.subarray(0, instance.output.len() as u32).copy_from(&instance.output);

            let result = Object::new();
            Reflect::set(&result, &JsValue::from_str("numSplats"), &JsValue::from(instance.output.len() as u32)).unwrap();
            Reflect::set(&result, &JsValue::from_str("indices"), &JsValue::from(output)).unwrap();
            results.push(&JsValue::from(result));
        }

        results
    })
}

fn compute_pixel_scale(
    splat: &LodSplat, instance: &LodInstance, 
    x_limit: f32, y_limit: f32, outside_foveate: f32, behind_foveate: f32,
) -> f32 {
    let center = Vec3A::from_array(splat.center.map(|x| x.to_f32()));
    let delta = center - instance.origin;
    let distance = delta.length();
    let pixel_scale = splat.size.to_f32() / distance.max(1.0e-6);
    let forward = delta.dot(instance.forward);
    if forward <= 0.0 {
        behind_foveate * pixel_scale
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
            1.0 - frustum_pos * (1.0 - outside_foveate)
        } else {
            outside_foveate - 1.0 / frustum_pos * (behind_foveate - outside_foveate)
        };
        foveate * pixel_scale
    }
}
