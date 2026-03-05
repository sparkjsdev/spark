
use std::cell::RefCell;
use js_sys::{Float32Array, Reflect, Uint8Array, Uint32Array};
use spark_lib::decoder::SplatEncoding;
use wasm_bindgen::prelude::*;

mod raycast;
use raycast::{raycast_packed_ellipsoids, raycast_ext_ellipsoids};


#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn simd_enabled() -> bool {
    cfg!(target_feature = "simd128")
}

const RAYCAST_BUFFER_COUNT: usize = 65536;

thread_local! {
    static RAYCAST_BUFFERS: RefCell<(Vec<u32>, Vec<u32>, Vec<f32>)> = RefCell::new((vec![0; RAYCAST_BUFFER_COUNT * 4], vec![0; RAYCAST_BUFFER_COUNT * 4], vec![0.0; RAYCAST_BUFFER_COUNT]));
}

#[wasm_bindgen]
pub fn get_raycast_buffer() -> Uint32Array {
    RAYCAST_BUFFERS.with_borrow_mut(|(buffer, _, _)| {
        unsafe { Uint32Array::view(&buffer) }
    })
}

#[wasm_bindgen]
pub fn get_raycast_buffer2() -> Uint32Array {
    RAYCAST_BUFFERS.with_borrow_mut(|(_, buffer, _)| {
        unsafe { Uint32Array::view(&buffer) }
    })
}

#[wasm_bindgen]
pub fn raycast_packed_buffer(
    origin_x: f32, origin_y: f32, origin_z: f32,
    dir_x: f32, dir_y: f32, dir_z: f32,
    min_opacity: f32, near: f32, far: f32,
    count: u32,
    ln_scale_min: f32, ln_scale_max: f32, lod_opacity: bool,
) -> Float32Array {
    RAYCAST_BUFFERS.with_borrow_mut(|(buffer, _, distances)| {
        let encoding = SplatEncoding {
            ln_scale_min,
            ln_scale_max,
            lod_opacity,
            ..Default::default()
        };

        distances.clear();
        let subbuffer = &buffer[0..(4 * count as usize)];
        raycast_packed_ellipsoids(
            subbuffer, distances,
            [origin_x, origin_y, origin_z], [dir_x, dir_y, dir_z],
            min_opacity, near, far, &encoding,
        );

        unsafe { Float32Array::view(&distances) }
    })
}

#[wasm_bindgen]
pub fn raycast_ext_buffers(
    origin_x: f32, origin_y: f32, origin_z: f32,
    dir_x: f32, dir_y: f32, dir_z: f32,
    min_opacity: f32, near: f32, far: f32,
    count: u32,
) -> Float32Array {
    RAYCAST_BUFFERS.with_borrow_mut(|(buffer, buffer2, distances)| {
        distances.clear();
        let subbuffer = &buffer[0..(4 * count as usize)];
        let subbuffer2 = &buffer2[0..(4 * count as usize)];
        raycast_ext_ellipsoids(
            subbuffer, subbuffer2, distances,
            [origin_x, origin_y, origin_z], [dir_x, dir_y, dir_z],
            min_opacity, near, far,
        );

        unsafe { Float32Array::view(&distances) }
    })
}

#[wasm_bindgen]
pub fn raycast_packed_splats(
    origin_x: f32, origin_y: f32, origin_z: f32,
    dir_x: f32, dir_y: f32, dir_z: f32,
    min_opacity: f32, near: f32, far: f32,
    num_splats: u32, packed_splats: Uint32Array,
    ln_scale_min: f32, ln_scale_max: f32, lod_opacity: bool,
) -> Float32Array {
    let mut distances = Vec::<f32>::new();
    let encoding = SplatEncoding {
        ln_scale_min,
        ln_scale_max,
        lod_opacity,
        ..Default::default()
    };

    _ = RAYCAST_BUFFERS.with_borrow_mut(|(buffer, _, _)| {
        let mut base = 0;
        while base < num_splats {
            let chunk_size = (RAYCAST_BUFFER_COUNT as u32).min(num_splats - base);
            let subarray = packed_splats.subarray(4 * base, 4 * (base + chunk_size));
            let subbuffer = &mut buffer[0..(4 * chunk_size as usize)];
            subarray.copy_to(subbuffer);

            raycast_packed_ellipsoids(
                subbuffer, &mut distances,
                [origin_x, origin_y, origin_z], [dir_x, dir_y, dir_z],
                min_opacity, near, far, &encoding,
            );

            base += chunk_size;
        }
    });

    let output = Float32Array::new_with_length(distances.len() as u32);
    output.copy_from(&distances);
    output
}

#[wasm_bindgen]
pub fn decode_rad_header(bytes: Uint8Array) -> Result<JsValue, JsValue> {
    let bytes = bytes.to_vec();
    let meta_chunks_start = match spark_lib::rad::decode_rad_header(&bytes) {
        Ok(meta_chunks_start) => meta_chunks_start,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    if let Some((meta, chunks_start)) = meta_chunks_start {
        let object = js_sys::Object::new();
        Reflect::set(&object, &JsValue::from_str("meta"), &serde_wasm_bindgen::to_value(&meta)?)?;
        Reflect::set(&object, &JsValue::from_str("chunksStart"), &JsValue::from_f64(chunks_start as f64))?;
        Ok(JsValue::from(object))
    } else {
        Ok(JsValue::null())
    }
}
