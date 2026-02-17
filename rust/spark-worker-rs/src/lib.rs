
use std::cell::RefCell;
use js_sys::{Object, Reflect, Uint8Array, Uint16Array, Uint32Array};
use spark_lib::decoder::{ChunkReceiver, MultiDecoder, SplatEncoding, SplatFileType, SplatGetter};
use spark_lib::gsplat::GsplatArray as GsplatArrayInner;
use spark_lib::csplat::CsplatArray as CsplatArrayInner;
use spark_lib::tsplat::TsplatArray;
use wasm_bindgen::prelude::*;

use crate::ext_splats::ExtSplatsData;
use crate::{decoder::ChunkDecoder, packed_splats::PackedSplatsData};

mod sort;
use sort::{sort_internal, SortBuffers, sort32_internal, Sort32Buffers};

mod decoder;
mod packed_splats;
mod ext_splats;

mod lod_tree;

#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn simd_enabled() -> bool {
    cfg!(target_feature = "simd128")
}

thread_local! {
    static SORT_BUFFERS: RefCell<SortBuffers> = RefCell::new(SortBuffers::default());
    static SORT32_BUFFERS: RefCell<Sort32Buffers> = RefCell::new(Sort32Buffers::default());
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
pub fn decode_to_packedsplats(file_type: Option<String>, path_name: Option<String>, encoding: JsValue) -> Result<ChunkDecoder, JsValue> {
    let encoding = if encoding.is_falsy() {
        SplatEncoding::default()
    } else {
        serde_wasm_bindgen::from_value(encoding)?
    };

    let file_type = if let Some(file_type) = file_type {
        match SplatFileType::from_enum_str(&file_type) {
            Ok(file_type) => Some(file_type),
            Err(err) => { return Err(JsValue::from(err.to_string())); },
        }
    } else {
        None
    };

    let splats = PackedSplatsData::new(encoding);
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
pub fn decode_to_extsplats(file_type: Option<String>, path_name: Option<String>) -> Result<ChunkDecoder, JsValue> {
    let file_type = if let Some(file_type) = file_type {
        match SplatFileType::from_enum_str(&file_type) {
            Ok(file_type) => Some(file_type),
            Err(err) => { return Err(JsValue::from(err.to_string())); },
        }
    } else {
        None
    };

    let splats = ExtSplatsData::new();
    let decoder = MultiDecoder::new(splats, file_type, path_name.as_deref());
    let on_finish = |receiver: Box<dyn ChunkReceiver>| {
        let decoder: Box<MultiDecoder<ExtSplatsData>> = receiver.into_any().downcast().unwrap();
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
        self.inner.has_lod_tree()
    }

    // pub fn quick_lod(&mut self, lod_base: f32, merge_filter: bool) {
    //     spark_lib::quick_lod::compute_lod_tree(&mut self.inner, lod_base, merge_filter, |s| web_sys::console::log_1(&JsValue::from(s)));
    //     // spark_lib::quick_lod::compute_lod_tree(&mut self.inner, lod_base, merge_filter, |_s| {});
    // }

    pub fn tiny_lod(&mut self, lod_base: f32, merge_filter: bool) {
        // let log = |s: &str| web_sys::console::log_1(&JsValue::from(s));
        let log = |_s: &str| {};
        self.inner.remove_invalid();
        spark_lib::tiny_lod::compute_lod_tree(&mut self.inner, lod_base, merge_filter, log);
        spark_lib::chunk_tree::chunk_tree(&mut self.inner, 0, log);
    }

    pub fn bhatt_lod(&mut self, lod_base: f32) {
        // let log = |s: &str| web_sys::console::log_1(&JsValue::from(s));
        let log = |_s: &str| {};
        self.inner.remove_invalid();
        spark_lib::bhatt_lod::compute_lod_tree(&mut self.inner, lod_base, log);
        spark_lib::chunk_tree::chunk_tree(&mut self.inner, 0, log);
    }

    pub fn to_packedsplats(&self, encoding: JsValue) -> Result<Object, JsValue> {
        let encoding = if encoding.is_falsy() {
            None
        } else {
            Some(serde_wasm_bindgen::from_value(encoding)?)
        };
        let splats = match PackedSplatsData::new_from_tsplat_array(&self.inner, encoding) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn to_packedsplats_lod(&self, encoding: JsValue) -> Result<Object, JsValue> {
        let encoding = if encoding.is_falsy() {
            None
        } else {
            Some(serde_wasm_bindgen::from_value(encoding)?)
        };
        let splats = match PackedSplatsData::new_from_tsplat_array_lod(&self.inner, encoding) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn to_extsplats(&self) -> Result<Object, JsValue> {
        let splats = match ExtSplatsData::new_from_tsplat_array(&self.inner) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn to_extsplats_lod(&self) -> Result<Object, JsValue> {
        let splats = match ExtSplatsData::new_from_tsplat_array_lod(&self.inner) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn inject_rgba8(&mut self, rgba: Uint8Array) {
        self.inner.inject_rgba8(&rgba.to_vec());
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
pub fn packedsplats_to_gsplatarray(num_splats: u32, packed: Uint32Array, extra: Option<Object>, encoding: JsValue) -> Result<GsplatArray, JsValue> {
    let encoding = serde_wasm_bindgen::from_value(encoding)?;
    let mut receiver = match PackedSplatsData::from_js_arrays(packed, num_splats as usize, extra.as_ref(), encoding) {
        Ok(receiver) => receiver,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    let splats = match receiver.to_gsplat_array() {
        Ok(inner) => inner,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    Ok(GsplatArray::new(splats))
}

#[wasm_bindgen]
#[allow(non_snake_case)]
pub struct CsplatArray {
    pub numSplats: usize,
    pub maxShDegree: usize,
    inner: CsplatArrayInner,
}

impl CsplatArray {
    pub fn new(inner: CsplatArrayInner) -> Self {
        Self {
            numSplats: inner.len(),
            maxShDegree: inner.max_sh_degree,
            inner,
        }
    }
}

#[wasm_bindgen]
impl CsplatArray {
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn has_lod(&self) -> bool {
        self.inner.has_children()
    }

    pub fn tiny_lod(&mut self, lod_base: f32, merge_filter: bool) {
        // let log = |s: &str| web_sys::console::log_1(&JsValue::from(s));
        let log = |_s: &str| {};
        self.inner.remove_invalid();
        spark_lib::tiny_lod::compute_lod_tree(&mut self.inner, lod_base, merge_filter, log);
        spark_lib::chunk_tree::chunk_tree(&mut self.inner, 0, log);
    }

    pub fn bhatt_lod(&mut self, lod_base: f32) {
        let log = |s: &str| web_sys::console::log_1(&JsValue::from(s));
        // let log = |_s: &str| {};
        self.inner.remove_invalid();
        spark_lib::bhatt_lod::compute_lod_tree(&mut self.inner, lod_base, log);
        spark_lib::chunk_tree::chunk_tree(&mut self.inner, 0, log);
    }

    pub fn to_packedsplats(&self) -> Result<Object, JsValue> {
        let encoding = self.inner.encoding.clone();
        let splats = match PackedSplatsData::new_from_tsplat_array(&self.inner, encoding) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn to_packedsplats_lod(&self) -> Result<Object, JsValue> {
        let encoding = self.inner.encoding.clone();
        let splats = match PackedSplatsData::new_from_tsplat_array_lod(&self.inner, encoding) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn to_extsplats(&self) -> Result<Object, JsValue> {
        let splats = match ExtSplatsData::new_from_tsplat_array(&self.inner) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn to_extsplats_lod(&self) -> Result<Object, JsValue> {
        let splats = match ExtSplatsData::new_from_tsplat_array_lod(&self.inner) {
            Err(err) => { return Err(JsValue::from(err.to_string())); },
            Ok(splats) => splats,
        };
        Ok(splats.into_splat_object())
    }

    pub fn inject_rgba8(&mut self, rgba: Uint8Array) {
        self.inner.inject_rgba8(&rgba.to_vec());
    }
}

#[wasm_bindgen]
pub fn decode_to_csplatarray(file_type: Option<String>, path_name: Option<String>, encoding: JsValue) -> Result<ChunkDecoder, JsValue> {
    let file_type = if let Some(file_type) = file_type {
        match SplatFileType::from_enum_str(&file_type) {
            Ok(file_type) => Some(file_type),
            Err(err) => { return Err(JsValue::from(err.to_string())); },
        }
    } else {
        None
    };

    let encoding = if encoding.is_falsy() {
        None
    } else {
        Some(serde_wasm_bindgen::from_value(encoding)?)
    };
    let splats = CsplatArrayInner::new_encoding(encoding);
    let decoder = MultiDecoder::new(splats, file_type, path_name.as_deref());
    let on_finish = |receiver: Box<dyn ChunkReceiver>| {
        let decoder: Box<MultiDecoder<CsplatArrayInner>> = receiver.into_any().downcast().unwrap();
        let gsplats = CsplatArray::new(decoder.into_splats());
        Ok(JsValue::from(gsplats))
    };

    let decoder = ChunkDecoder::new(Box::new(decoder), Box::new(on_finish));
    Ok(decoder)
}

#[wasm_bindgen]
pub fn packedsplats_to_csplatarray(num_splats: u32, packed: Uint32Array, extra: Option<Object>, encoding: JsValue) -> Result<CsplatArray, JsValue> {
    let encoding = serde_wasm_bindgen::from_value(encoding)?;
    let mut receiver = match PackedSplatsData::from_js_arrays(packed, num_splats as usize, extra.as_ref(), encoding) {
        Ok(receiver) => receiver,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    let splats = match receiver.to_csplat_array() {
        Ok(inner) => inner,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    Ok(CsplatArray::new(splats))
}

#[wasm_bindgen]
pub fn extsplats_to_gsplatarray(num_splats: u32, ext1: Uint32Array, ext2: Uint32Array, extra: Option<Object>) -> Result<GsplatArray, JsValue> {
    let mut receiver = match ExtSplatsData::from_js_arrays([ext1, ext2], num_splats as usize, extra.as_ref()) {
        Ok(receiver) => receiver,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    let splats = match receiver.to_gsplat_array() {
        Ok(inner) => inner,
        Err(err) => { return Err(JsValue::from(err.to_string())); }
    };
    Ok(GsplatArray::new(splats))
}

#[wasm_bindgen]
pub fn tiny_lod_packedsplats(num_splats: u32, packed: Uint32Array, extra: Option<Object>, lod_base: f32, merge_filter: bool, rgba: Option<Uint8Array>, encoding: JsValue) -> Result<Object, JsValue> {
    let mut gs = packedsplats_to_csplatarray(num_splats, packed, extra, encoding)?;
    if let Some(rgba) = rgba {
        gs.inject_rgba8(rgba);
    }
    gs.inner.remove_invalid();
    gs.tiny_lod(lod_base, merge_filter);
    gs.to_packedsplats_lod()
}

#[wasm_bindgen]
pub fn bhatt_lod_packedsplats(num_splats: u32, packed: Uint32Array, extra: Option<Object>, lod_base: f32, rgba: Option<Uint8Array>, encoding: JsValue) -> Result<Object, JsValue> {
    let mut gs = packedsplats_to_csplatarray(num_splats, packed, extra, encoding)?;
    if let Some(rgba) = rgba {
        gs.inject_rgba8(rgba);
    }
    gs.inner.remove_invalid();
    gs.bhatt_lod(lod_base);
    gs.to_packedsplats_lod()
}

#[wasm_bindgen]
pub fn tiny_lod_extsplats(num_splats: u32, ext1: Uint32Array, ext2: Uint32Array, extra: Option<Object>, lod_base: f32, merge_filter: bool, rgba: Option<Uint8Array>) -> Result<Object, JsValue> {
    let mut gs = extsplats_to_gsplatarray(num_splats, ext1, ext2, extra)?;
    if let Some(rgba) = rgba {
        gs.inject_rgba8(rgba);
    }
    gs.inner.remove_invalid();
    gs.tiny_lod(lod_base, merge_filter);
    gs.to_extsplats_lod()
}

#[wasm_bindgen]
pub fn bhatt_lod_extsplats(num_splats: u32, ext1: Uint32Array, ext2: Uint32Array, extra: Option<Object>, lod_base: f32, rgba: Option<Uint8Array>) -> Result<Object, JsValue> {
    let mut gs = extsplats_to_gsplatarray(num_splats, ext1, ext2, extra)?;
    if let Some(rgba) = rgba {
        gs.inject_rgba8(rgba);
    }
    gs.inner.remove_invalid();
    gs.bhatt_lod(lod_base);
    gs.to_extsplats_lod()
}
