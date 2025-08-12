
use std::cell::RefCell;
use js_sys::{Float32Array, Uint16Array, Uint32Array};
use wasm_bindgen::prelude::*;

mod sort;
use sort::{sort_internal, SortBuffers, sort32_internal, Sort32Buffers};

mod raycast;
use raycast::{raycast_ellipsoids, raycast_spheres};

const RAYCAST_BUFFER_COUNT: u32 = 65536;

thread_local! {
    static SORT_BUFFERS: RefCell<SortBuffers> = RefCell::new(SortBuffers::default());
    static SORT32_BUFFERS: RefCell<Sort32Buffers> = RefCell::new(Sort32Buffers::default());
    static RAYCAST_BUFFER: RefCell<Vec<u32>> = RefCell::new(vec![0; RAYCAST_BUFFER_COUNT as usize * 4]);
}

#[wasm_bindgen]
pub fn sort_splats(
    num_splats: u32, readback: Uint16Array, ordering: Uint32Array,
) -> u32 {
    let max_splats = readback.length() as usize;

    let active_splats = SORT_BUFFERS.with_borrow_mut(|buffers| {
        buffers.ensure_size(max_splats);
        let sub_readback = readback.subarray(0, num_splats);
        sub_readback.copy_to(&mut buffers.readback[..num_splats as usize]);

        let active_splats = match sort_internal(buffers, num_splats as usize) {
            Ok(active_splats) => active_splats,
            Err(err) => {
                wasm_bindgen::throw_str(&format!("{}", err));
            }
        };

        if active_splats > 0 {
            // Copy out ordering result
            let subarray = &buffers.ordering[..active_splats as usize];
            ordering.subarray(0, active_splats).copy_from(&subarray);
        }
        active_splats
    });

    active_splats
}

#[wasm_bindgen]
pub fn sort32_splats(
    num_splats: u32, readback: Uint32Array, ordering: Uint32Array,
) -> u32 {
    let max_splats = readback.length() as usize;

    let active_splats = SORT32_BUFFERS.with_borrow_mut(|buffers| {
        buffers.ensure_size(max_splats);
        let sub_readback = readback.subarray(0, num_splats);
        sub_readback.copy_to(&mut buffers.readback[..num_splats as usize]);

        let active_splats = match sort32_internal(buffers, max_splats, num_splats as usize) {
            Ok(active_splats) => active_splats,
            Err(err) => {
                wasm_bindgen::throw_str(&format!("{}", err));
            }
        };

        if active_splats > 0 {
            // Copy out ordering result
            let subarray = &buffers.ordering[..active_splats as usize];
            ordering.subarray(0, active_splats).copy_from(&subarray);
        }
        active_splats
    });

    active_splats
}

#[wasm_bindgen]
pub fn raycast_splats(
    origin_x: f32, origin_y: f32, origin_z: f32,
    dir_x: f32, dir_y: f32, dir_z: f32,
    near: f32, far: f32,
    num_splats: u32, packed_splats: Uint32Array,
    raycast_ellipsoid: bool,
    ln_scale_min: f32, ln_scale_max: f32,
) -> Float32Array {
    let mut distances = Vec::<f32>::new();

    _ = RAYCAST_BUFFER.with_borrow_mut(|buffer| {
        let mut base = 0;
        while base < num_splats {
            let chunk_size = RAYCAST_BUFFER_COUNT.min(num_splats - base);
            let subarray = packed_splats.subarray(4 * base, 4 * (base + chunk_size));
            let subbuffer = &mut buffer[0..(4 * chunk_size as usize)];
            subarray.copy_to(subbuffer);

            if raycast_ellipsoid {
                raycast_ellipsoids(subbuffer, &mut distances, [origin_x, origin_y, origin_z], [dir_x, dir_y, dir_z], near, far, ln_scale_min, ln_scale_max);
            } else {
                raycast_spheres(subbuffer, &mut distances, [origin_x, origin_y, origin_z], [dir_x, dir_y, dir_z], near, far, ln_scale_min, ln_scale_max);
            }

            base += chunk_size;
        }
    });

    let output = Float32Array::new_with_length(distances.len() as u32);
    output.copy_from(&distances);
    output
}
