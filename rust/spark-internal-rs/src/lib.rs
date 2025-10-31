
use std::cell::RefCell;
use js_sys::{Float32Array, Object, Reflect, Uint16Array, Uint32Array};
use spark_lib::decoder::{ChunkReceiver, MultiDecoder, SplatFileType};
use spark_lib::gsplat::GsplatArray as GsplatArrayInner;
use wasm_bindgen::prelude::*;

use crate::{decoder::ChunkDecoder, packed_splats::PackedSplatsData};

mod sort;
use sort::{sort_internal, SortBuffers, sort32_internal, Sort32Buffers};

mod raycast;
use raycast::{raycast_ellipsoids, raycast_spheres};

mod decoder;
mod packed_splats;

mod lod_tree;
pub use lod_tree::{init_lod_tree, dispose_lod_tree, traverse_lod_trees};


#[wasm_bindgen]
pub fn simd_enabled() -> bool {
    cfg!(target_feature = "simd128")
}

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

#[wasm_bindgen]
pub fn decode_to_packedsplats(file_type: Option<String>, path_name: Option<String>) -> Result<ChunkDecoder, JsValue> {
    let file_type = if let Some(file_type) = file_type {
        match SplatFileType::from_enum_str(&file_type) {
            Ok(file_type) => Some(file_type),
            Err(err) => { return Err(JsValue::from(err.to_string())); },
        }
    } else {
        None
    };

    let splats = PackedSplatsData::new();
    let decoder = MultiDecoder::new(splats, file_type, path_name.as_deref());
    let on_finish = |receiver: Box<dyn ChunkReceiver>| {
        let decoder: Box<MultiDecoder<PackedSplatsData>> = receiver.into_any().downcast().unwrap();
        let file_type = decoder.file_type.unwrap();
        let object = decoder.into_splats().into_splat_object();
        Reflect::set(&object, &JsValue::from_str("fileType"), &JsValue::from(file_type.to_enum_str())).unwrap();
        Ok(JsValue::from(object))
    };

    let decoder = ChunkDecoder::new(Box::new(decoder), Box::new(on_finish));
    Ok(decoder)
}

#[wasm_bindgen]
#[allow(non_snake_case)]
pub struct GsplatArray {
    pub numSplats: usize,
    pub maxShDegree: usize,
    inner: GsplatArrayInner,
}

impl GsplatArray {
    pub fn new(inner: GsplatArrayInner) -> Self {
        Self {
            numSplats: inner.len(),
            maxShDegree: inner.max_sh_degree,
            inner,
        }
    }
}

#[wasm_bindgen]
impl GsplatArray {
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn has_lod(&self) -> bool {
        !self.inner.extras.is_empty()
    }

    pub fn quick_lod(&mut self, lod_base: f32) {
        spark_lib::quick_lod::compute_lod_tree(&mut self.inner, lod_base);
    }

    pub fn to_packedsplats(&self) -> Result<Object, JsValue> {
        let splats = match PackedSplatsData::new_from_gsplat_array(&self.inner) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn to_packedsplats_lod(&self) -> Result<Object, JsValue> {
        let splats = match PackedSplatsData::new_from_gsplat_array_lod(&self.inner) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }
}

#[wasm_bindgen]
pub fn decode_to_gsplatarray(file_type: Option<String>, path_name: Option<String>) -> Result<ChunkDecoder, JsValue> {
    let file_type = if let Some(file_type) = file_type {
        match SplatFileType::from_enum_str(&file_type) {
            Ok(file_type) => Some(file_type),
            Err(err) => { return Err(JsValue::from(err.to_string())); },
        }
    } else {
        None
    };

    let splats = GsplatArrayInner::new();
    let decoder = MultiDecoder::new(splats, file_type, path_name.as_deref());
    let on_finish = |receiver: Box<dyn ChunkReceiver>| {
        let decoder: Box<MultiDecoder<GsplatArrayInner>> = receiver.into_any().downcast().unwrap();
        let gsplats = GsplatArray::new(decoder.into_splats());
        Ok(JsValue::from(gsplats))
    };

    let decoder = ChunkDecoder::new(Box::new(decoder), Box::new(on_finish));
    Ok(decoder)
}

#[wasm_bindgen]
pub fn packedsplats_to_gsplatarray(num_splats: u32, packed: Uint32Array, extra: Option<Object>) -> Result<GsplatArray, JsValue> {
    use crate::packed_splats::PackedSplatsData;
    let mut receiver = match PackedSplatsData::from_js_arrays(packed, num_splats as usize, extra.as_ref()) {
        Ok(r) => r,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    let inner = match receiver.to_gsplat_array() {
        Ok(inner) => inner,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    Ok(GsplatArray::new(inner))
}

#[wasm_bindgen]
pub fn quick_lod_packedsplats(num_splats: u32, packed: Uint32Array, extra: Option<Object>, lod_base: f32) -> Result<Object, JsValue> {
    let mut gs = packedsplats_to_gsplatarray(num_splats, packed, extra)?;
    gs.quick_lod(lod_base);
    gs.to_packedsplats()
}
