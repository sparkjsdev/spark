
use std::cell::RefCell;
use js_sys::{Float32Array, Reflect, Uint8Array, Uint32Array};
use wasm_bindgen::prelude::*;

mod raycast;
use raycast::{raycast_ellipsoids, raycast_spheres};


#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn simd_enabled() -> bool {
    cfg!(target_feature = "simd128")
}

const RAYCAST_BUFFER_COUNT: u32 = 65536;

thread_local! {
    static RAYCAST_BUFFER: RefCell<Vec<u32>> = RefCell::new(vec![0; RAYCAST_BUFFER_COUNT as usize * 4]);
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
