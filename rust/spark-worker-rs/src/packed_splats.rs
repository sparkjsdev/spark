use std::array;

use js_sys::{Object, Reflect, Uint32Array};
use spark_lib::{
    csplat::CsplatArray, decoder::{SetSplatEncoding, SplatEncoding, SplatGetter, SplatInit, SplatProps, SplatPropsMut, SplatReceiver, copy_getter_to_receiver}, gsplat::GsplatArray, splat_encode::{
        decode_packed_splat_center, decode_packed_splat_opacity, decode_packed_splat_quat, decode_packed_splat_rgb, decode_packed_splat_scale, decode_sh1_internal_words, decode_sh2_internal_words, decode_sh3_internal_words, encode_lod_tree, encode_packed_splat, encode_packed_splat_center, encode_packed_splat_opacity, encode_packed_splat_quat, encode_packed_splat_rgb, encode_packed_splat_rgba, encode_packed_splat_scale, encode_sh1_array, encode_sh2_array, encode_sh3_array, get_decode_sh1_scale, get_decode_sh2_scale, get_decode_sh3_scale, get_splat_tex_size
    }, tsplat::{Tsplat, TsplatArray}
};
use wasm_bindgen::JsValue;

pub struct PackedSplatsData {
    pub max_splats: usize,
    pub num_splats: usize,
    pub max_sh_degree: usize,
    pub packed: Uint32Array,
    pub sh1: Option<Uint32Array>,
    pub sh2: Option<Uint32Array>,
    pub sh3: Option<Uint32Array>,
    pub lod_tree: Option<Uint32Array>,
    child_counts: Option<Vec<u16>>,
    child_starts: Option<Vec<u32>>,
    pub encoding: SplatEncoding,
    buffer: Vec<u32>,
    buffer_base: usize,
    buffer_count: usize,
    buffer_dirty: bool,
}

impl PackedSplatsData {
    pub fn new(encoding: SplatEncoding) -> Self {
        Self {
            max_splats: 0,
            num_splats: 0,
            max_sh_degree: 0,
            packed: Uint32Array::new_with_length(0),
            sh1: None,
            sh2: None,
            sh3: None,
            lod_tree: None,
            child_counts: None,
            child_starts: None,
            encoding,
            buffer: Vec::new(),
            buffer_base: 0,
            buffer_count: 0,
            buffer_dirty: false,
        }
    }

    pub fn into_splat_object(self) -> Object {
        let object = Object::new();
        Reflect::set(&object, &JsValue::from_str("maxSplats"), &JsValue::from(self.max_splats as u32)).unwrap();
        Reflect::set(&object, &JsValue::from_str("numSplats"), &JsValue::from(self.num_splats as u32)).unwrap();
        Reflect::set(&object, &JsValue::from_str("maxShDegree"), &JsValue::from(self.max_sh_degree as u32)).unwrap();
        Reflect::set(&object, &JsValue::from_str("packed"), &self.packed).unwrap();
        if let Some(sh1) = self.sh1.as_ref() {
            Reflect::set(&object, &JsValue::from_str("sh1"), &JsValue::from(sh1)).unwrap();
        }
        if let Some(sh2) = self.sh2.as_ref() {
            Reflect::set(&object, &JsValue::from_str("sh2"), &JsValue::from(sh2)).unwrap();
        }
        if let Some(sh3) = self.sh3.as_ref() {
            Reflect::set(&object, &JsValue::from_str("sh3"), &JsValue::from(sh3)).unwrap();
        }
        if let Some(lod_tree) = self.lod_tree.as_ref() {
            Reflect::set(&object, &JsValue::from_str("lodTree"), &JsValue::from(lod_tree)).unwrap();
        }
        Reflect::set(&object, &JsValue::from_str("splatEncoding"), &serde_wasm_bindgen::to_value(&self.encoding).unwrap()).unwrap();
        object
    }

    pub fn from_js_arrays(packed: Uint32Array, num_splats: usize, extra: Option<&Object>, encoding: SplatEncoding) -> anyhow::Result<Self> {
        let mut data = Self::new(encoding);
        data.max_splats = packed.length() as usize / 4;
        data.num_splats = num_splats;
        data.packed = packed;

        if let Some(extra) = extra {
            if let Ok(sh1) = Reflect::get(extra, &JsValue::from_str("sh1")) {
                if !sh1.is_falsy() {
                    data.sh1 = Some(Uint32Array::from(sh1));
                    data.max_sh_degree = 1;
                }
            }
            if let Ok(sh2) = Reflect::get(extra, &JsValue::from_str("sh2")) {
                if !sh2.is_falsy() {
                    data.sh2 = Some(Uint32Array::from(sh2));
                    data.max_sh_degree = 2;
                }
            }
            if let Ok(sh3) = Reflect::get(extra, &JsValue::from_str("sh3")) {
                if !sh3.is_falsy() {
                    data.sh3 = Some(Uint32Array::from(sh3));
                    data.max_sh_degree = 3;
                }
            }
            if let Ok(lod_tree) = Reflect::get(extra, &JsValue::from_str("lodTree")) {
                if !lod_tree.is_falsy() {
                    data.lod_tree = Some(Uint32Array::from(lod_tree));
                    data.encoding.lod_opacity = true;
                }
            }
        }

        Ok(data)
    }

    fn ensure_buffer(&mut self, count: usize) {
        self.buffer.resize(count * 4, 0);
    }

    fn flush_buffer(&mut self) {
        if self.buffer_dirty {
            let base = self.buffer_base;
            let count = self.buffer_count;
            let sub = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            sub.copy_from(&self.buffer[0..count * 4]);
            self.buffer_dirty = false;
        }
    }

    fn invalidate_buffer(&mut self) {
        self.flush_buffer();
        self.buffer_base = 0;
        self.buffer_count = 0;
        self.buffer_dirty = false;
    }

    fn prepare_buffer(&mut self, base: usize, count: usize) {
        if self.buffer_base != base || self.buffer_count != count {
            self.flush_buffer();
            self.ensure_buffer(count);
            let subarray = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            subarray.copy_to(&mut self.buffer[0..count * 4]);
            self.buffer_base = base;
            self.buffer_count = count;
            self.buffer_dirty = false;
        }
    }

    pub fn to_gsplat_array(&mut self) -> anyhow::Result<GsplatArray> {
        let mut out = GsplatArray::new();
        copy_getter_to_receiver(self, &mut out)?;
        Ok(out)
    }

    pub fn to_csplat_array(&mut self) -> anyhow::Result<CsplatArray> {
        let mut out = CsplatArray::new_encoding(Some(self.encoding.clone()));
        copy_getter_to_receiver(self, &mut out)?;
        Ok(out)
    }

    pub fn new_from_tsplat_array<TA: TsplatArray>(splats: &TA, encoding: Option<SplatEncoding>) -> anyhow::Result<Self> {
        Self::new_from_tsplat_array_with_lod(splats, false, encoding)
    }

    pub fn new_from_tsplat_array_lod<TA: TsplatArray>(splats: &TA, encoding: Option<SplatEncoding>) -> anyhow::Result<Self> {
        Self::new_from_tsplat_array_with_lod(splats, true, encoding)
    }

    fn new_from_tsplat_array_with_lod<TA: TsplatArray>(splats: &TA, lod_tree: bool, encoding: Option<SplatEncoding>) -> anyhow::Result<Self> {
        const MAX_SPLAT_CHUNK: usize = 65536;

        let mut receiver = Self::new(encoding.unwrap_or_default());
        let max_sh_degree = splats.max_sh_degree();
        receiver.init_splats(&SplatInit {
            num_splats: splats.len(),
            max_sh_degree,
            lod_tree,
        })?;

        if lod_tree {
            receiver.set_encoding(&SetSplatEncoding {
                lod_opacity: Some(true),
                ..Default::default()
            })?;
        }

        {
            let mut batch_center = vec![0.0; 3 * MAX_SPLAT_CHUNK];
            let mut batch_opacity = vec![0.0; MAX_SPLAT_CHUNK];
            let mut batch_rgb = vec![0.0; 3 * MAX_SPLAT_CHUNK];
            let mut batch_scale = vec![0.0; 3 * MAX_SPLAT_CHUNK];
            let mut batch_quat = vec![0.0; 4 * MAX_SPLAT_CHUNK];
            let mut batch_child_count = vec![0; MAX_SPLAT_CHUNK];
            let mut batch_child_start = vec![0; MAX_SPLAT_CHUNK];
            let mut base = 0;
            while base < splats.len() {
                let count = (splats.len() - base).min(MAX_SPLAT_CHUNK);
                for i in 0..count {
                    let [i3, i4] = [i * 3, i * 4];
                    let splat = &splats.get(base + i);
                    let center = splat.center();
                    let rgb = splat.rgb();
                    let scales = splat.scales();
                    let quat = splat.quaternion().to_array();

                    for d in 0..3 {
                        batch_center[i3 + d] = center[d];
                        batch_rgb[i3 + d] = rgb[d];
                        batch_scale[i3 + d] = scales[d];
                    }
                    for d in 0..4 {
                        batch_quat[i4 + d] = quat[d];
                    }

                    batch_opacity[i] = splat.opacity();

                    if lod_tree {
                        let (count, start) = splats.get_child_count_start(base + i);
                        if count == 0 {
                            batch_child_count[i] = 0;
                            batch_child_start[i] = 0;
                        } else {
                            batch_child_count[i] = count as u16;
                            batch_child_start[i] = start;
                        }
                    }
                }
                receiver.set_batch(base, count, &SplatProps {
                    center: &batch_center,
                    opacity: &batch_opacity,
                    rgb: &batch_rgb,
                    scale: &batch_scale,
                    quat: &batch_quat,
                    child_count: if lod_tree { &batch_child_count } else { &[] },
                    child_start: if lod_tree { &batch_child_start } else { &[] },
                    ..Default::default()
                });
                base += count;
            }
        }

        if max_sh_degree >= 1 {
            let mut batch = vec![0.0; 9 * MAX_SPLAT_CHUNK];
            let mut base = 0;
            while base < splats.len() {
                let count = (splats.len() - base).min(MAX_SPLAT_CHUNK);
                for i in 0..count {
                    let i9 = i * 9;
                    let values = splats.get_sh1(base + i);
                    for d in 0..9 {
                        batch[i9 + d] = values[d];
                    }
                }
                receiver.set_sh1(base, count, &batch);
                base += count;
            }
        }

        if max_sh_degree >= 2 {
            let mut batch = vec![0.0; 15 * MAX_SPLAT_CHUNK];
            let mut base = 0;
            while base < splats.len() {
                let count = (splats.len() - base).min(MAX_SPLAT_CHUNK);
                for i in 0..count {
                    let i15 = i * 15;
                    let values = splats.get_sh2(base + i);
                    for d in 0..15 {
                        batch[i15 + d] = values[d];
                    }
                }
                receiver.set_sh2(base, count, &batch);
                base += count;
            }
        }

        if max_sh_degree >= 3 {
            let mut batch = vec![0.0; 21 * MAX_SPLAT_CHUNK];
            let mut base = 0;
            while base < splats.len() {
                let count = (splats.len() - base).min(MAX_SPLAT_CHUNK);
                for i in 0..count {
                    let i21 = i * 21;
                    let values = splats.get_sh3(base + i);
                    for d in 0..21 {
                        batch[i21 + d] = values[d];
                    }
                }
                receiver.set_sh3(base, count, &batch);
                base += count;
            }
        }

        receiver.finish()?;
        Ok(receiver)
    }

    pub fn get_packed_array(&self, base: usize, count: usize, out: &mut [u32]) {
        let sub = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
        sub.copy_to(out);
    }

    pub fn get_lod_tree_array(&self, base: usize, count: usize, out: &mut [u32]) -> Option<()> {
        self.lod_tree.as_ref().map(|lod| {
            let sub = lod.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            sub.copy_to(out);
        })
    }
}

impl SplatReceiver for PackedSplatsData {
    fn init_splats(&mut self, init: &SplatInit) -> anyhow::Result<()> {
        let (_, _, _, max_splats) = get_splat_tex_size(init.num_splats);
        self.max_splats = max_splats;
        self.num_splats = init.num_splats;
        self.max_sh_degree = init.max_sh_degree;

        self.packed = Uint32Array::new_with_length((max_splats * 4) as u32);

        self.sh1 = if init.max_sh_degree < 1 { None } else {
            Some(Uint32Array::new_with_length((max_splats * 2) as u32))
        };
        self.sh2 = if init.max_sh_degree < 2 { None } else {
            Some(Uint32Array::new_with_length((max_splats * 4) as u32))
        };
        self.sh3 = if init.max_sh_degree < 3 { None } else {
            Some(Uint32Array::new_with_length((max_splats * 4) as u32))
        };

        self.lod_tree = if init.lod_tree {
            Some(Uint32Array::new_with_length((self.num_splats * 4) as u32))
        } else {
            None
        };
        self.encoding.lod_opacity = init.lod_tree;

        self.buffer_base = 0;
        self.buffer_count = 0;
        self.buffer_dirty = false;

        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        self.invalidate_buffer();
        
        if self.child_counts.is_some() || self.child_starts.is_some() {
            if self.child_counts.is_none() || self.child_starts.is_none() {
                return Err(anyhow::anyhow!("Missing child_counts or child_starts"));
            }

            const MAX_SPLAT_CHUNK: usize = 65536;
            self.ensure_buffer(MAX_SPLAT_CHUNK);
            self.lod_tree = Some(Uint32Array::new_with_length((self.num_splats * 4) as u32));
            let Self { buffer, packed, lod_tree, child_counts, child_starts, .. } = self;
            let lod_tree = lod_tree.as_mut().unwrap();
            let child_counts = child_counts.as_ref().unwrap();
            let child_starts = child_starts.as_ref().unwrap();

            let mut base = 0;
            while base < self.num_splats {
                let count = (self.num_splats - base).min(MAX_SPLAT_CHUNK);
                let buffer = &mut buffer[0..count * 4];
                packed.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_to(buffer);

                for i in 0..count {
                    let i4 = i * 4;
                    let center = decode_packed_splat_center(&buffer[i4..i4 + 4]);
                    let opacity = decode_packed_splat_opacity(&buffer[i4..i4 + 4], &self.encoding);
                    let scale = decode_packed_splat_scale(&buffer[i4..i4 + 4], &self.encoding);
                    let child_count = child_counts[base + i];
                    let child_start = child_starts[base + i];
                    encode_lod_tree(&mut buffer[i4..i4 + 4], &center, opacity, &scale, child_count, child_start);
                }
                lod_tree.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(buffer);
                base += count;
            }

            self.child_starts = None;
            self.child_counts = None;
        }

        let mut empty_buffer = Vec::new();
        std::mem::swap(&mut self.buffer, &mut empty_buffer);
        Ok(())
    }

    fn set_encoding(&mut self, encoding: &SetSplatEncoding) -> anyhow::Result<()> {
        if let Some(rgb_min) = encoding.rgb_min {
            self.encoding.rgb_min = rgb_min;
        }
        if let Some(rgb_max) = encoding.rgb_max {
            self.encoding.rgb_max = rgb_max;
        }
        if let Some(ln_scale_min) = encoding.ln_scale_min {
            self.encoding.ln_scale_min = ln_scale_min;
        }
        if let Some(ln_scale_max) = encoding.ln_scale_max {
            self.encoding.ln_scale_max = ln_scale_max;
        }
        if let Some(sh1_max) = encoding.sh1_max {
            self.encoding.sh1_max = sh1_max;
        }
        if let Some(sh2_max) = encoding.sh2_max {
            self.encoding.sh2_max = sh2_max;
        }
        if let Some(sh3_max) = encoding.sh3_max {
            self.encoding.sh3_max = sh3_max;
        }
        if let Some(lod_opacity) = encoding.lod_opacity {
            self.encoding.lod_opacity = lod_opacity;
        }
        Ok(())
    }

    fn debug(&self, value: usize) {
        web_sys::console::log_1(&JsValue::from_str(&format!("debug: {}", value)));
    }

    fn set_batch(&mut self, base: usize, count: usize, batch: &SplatProps) {
        self.prepare_buffer(base, count);
        if !batch.center.is_empty() && !batch.opacity.is_empty() && !batch.rgb.is_empty() && !batch.scale.is_empty() && !batch.quat.is_empty() {
            for i in 0..count {
                let [i3, i4] = [i * 3, i * 4];
                encode_packed_splat(
                    &mut self.buffer[i4..i4 + 4],
                    array::from_fn(|d| batch.center[i3 + d]),
                    batch.opacity[i],
                    array::from_fn(|d| batch.rgb[i3 + d]),
                    array::from_fn(|d| batch.scale[i3 + d]),
                    array::from_fn(|d| batch.quat[i4 + d]),
                    &self.encoding,
                );
            }
        } else {
            if !batch.center.is_empty() {
                self.set_center(base, count, batch.center);
            }
            if !batch.opacity.is_empty() {
                self.set_opacity(base, count, batch.opacity);
            }
            if !batch.rgb.is_empty() {
                self.set_rgb(base, count, batch.rgb);
            }
            if !batch.scale.is_empty() {
                self.set_scale(base, count, batch.scale);
            }
            if !batch.quat.is_empty() {
                self.set_quat(base, count, batch.quat);
            }
        }
        self.buffer_dirty = true;

        self.set_sh(base, count, batch.sh1, batch.sh2, batch.sh3);

        if !batch.child_count.is_empty() {
            self.set_child_count(base, count, batch.child_count);
        }
        if !batch.child_start.is_empty() {
            self.set_child_start(base, count, batch.child_start);
        }
    }

    fn set_center(&mut self, base: usize, count: usize, center: &[f32]) {
        self.prepare_buffer(base, count);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_packed_splat_center(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| center[i3 + d]));
        }
        self.buffer_dirty = true;
    }

    fn set_opacity(&mut self, base: usize, count: usize, opacity: &[f32]) {
        self.prepare_buffer(base, count);
        for i in 0..count {
            let i4 = i * 4;
            encode_packed_splat_opacity(&mut self.buffer[i4..i4 + 4], opacity[i], &self.encoding);
        }
        self.buffer_dirty = true;
    }

    fn set_rgb(&mut self, base: usize, count: usize, rgb: &[f32]) {
        self.prepare_buffer(base, count);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_packed_splat_rgb(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| rgb[i3 + d]), &self.encoding);
        }
        self.buffer_dirty = true;
    }

    fn set_rgba(&mut self, base: usize, count: usize, rgba: &[f32]) {
        self.prepare_buffer(base, count);
        for i in 0..count {
            let i4 = i * 4;
            encode_packed_splat_rgba(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| rgba[i4 + d]), &self.encoding);
        }
        self.buffer_dirty = true;
    }

    fn set_scale(&mut self, base: usize, count: usize, scale: &[f32]) {
        self.prepare_buffer(base, count);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_packed_splat_scale(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| scale[i3 + d]), &self.encoding);
        }
        self.buffer_dirty = true;
    }

    fn set_quat(&mut self, base: usize, count: usize, quat: &[f32]) {
        self.prepare_buffer(base, count);
        for i in 0..count {
            let i4 = i * 4;
            encode_packed_splat_quat(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| quat[i4 + d]));
        }
        self.buffer_dirty = true;
    }

    fn set_sh(&mut self, base: usize, count: usize, sh1: &[f32], sh2: &[f32], sh3: &[f32]) {
        if !sh1.is_empty() {
            self.set_sh1(base, count, sh1);
        }
        if !sh2.is_empty() {
            self.set_sh2(base, count, sh2);
        }
        if !sh3.is_empty() {
            self.set_sh3(base, count, sh3);
        }
    }

    fn set_sh1(&mut self, base: usize, count: usize, sh1: &[f32]) {
        self.invalidate_buffer();
        self.ensure_buffer(count);
        if let Some(packed_sh1) = self.sh1.as_ref() {
            let buffer = &mut self.buffer[0..count * 2];
            let SplatEncoding { sh1_max, .. } = self.encoding;
            encode_sh1_array(buffer, sh1, count, sh1_max);
            packed_sh1.subarray((base * 2) as u32, ((base + count) * 2) as u32).copy_from(buffer);
        }
    }

    fn set_sh2(&mut self, base: usize, count: usize, sh2: &[f32]) {
        self.invalidate_buffer();
        self.ensure_buffer(count);
        if let Some(packed_sh2) = self.sh2.as_ref() {
            let SplatEncoding { sh2_max, .. } = self.encoding;
            encode_sh2_array(&mut self.buffer, sh2, count, sh2_max);
            packed_sh2.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer);
        }
    }

    fn set_sh3(&mut self, base: usize, count: usize, sh3: &[f32]) {
        self.invalidate_buffer();
        self.ensure_buffer(count);
        if let Some(packed_sh3) = self.sh3.as_ref() {
            let SplatEncoding { sh3_max, .. } = self.encoding;
            encode_sh3_array(&mut self.buffer, sh3, count, sh3_max);
            packed_sh3.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer);
        }
    }

    fn set_child_count(&mut self, base: usize, count: usize, child_count: &[u16]) {
        if self.child_counts.is_none() {
            self.child_counts = Some(vec![0; self.num_splats]);
        }
        let counts = self.child_counts.as_mut().unwrap();
        for i in 0..count {
            counts[base + i] = child_count[i];
        }
    }

    fn set_child_start(&mut self, base: usize, count: usize, child_start: &[usize]) {
        if self.child_starts.is_none() {
            self.child_starts = Some(vec![0; self.num_splats]);
        }
        let starts = self.child_starts.as_mut().unwrap();
        for i in 0..count {
            starts[base + i] = child_start[i] as u32;
        }
    }
}

impl SplatGetter for PackedSplatsData {
    fn num_splats(&self) -> usize { self.num_splats }
    fn max_sh_degree(&self) -> usize { self.max_sh_degree }
    fn has_lod_tree(&self) -> bool { self.lod_tree.is_some() }
    fn get_encoding(&mut self) -> Option<SplatEncoding> { Some(self.encoding.clone()) }

    fn get_batch(&mut self, base: usize, count: usize, out: &mut SplatPropsMut) {
        if count == 0 { return; }

        self.prepare_buffer(base, count);

        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let elements = &self.buffer[i4..i4 + 4];
            if !out.center.is_empty() {
                let center = decode_packed_splat_center(elements);
                for d in 0..3 {
                    out.center[i3 + d] = center[d];
                }
            }
            if !out.opacity.is_empty() {
                let opacity = decode_packed_splat_opacity(elements, &self.encoding);
                out.opacity[i] = opacity;
            }
            if !out.rgb.is_empty() {
                let rgb = decode_packed_splat_rgb(elements, &self.encoding);
                for d in 0..3 {
                    out.rgb[i3 + d] = rgb[d];
                }
            }
            if !out.scale.is_empty() {
                let scale = decode_packed_splat_scale(elements, &self.encoding);
                for d in 0..3 {
                    out.scale[i3 + d] = scale[d];
                }
            }
            if !out.quat.is_empty() {
                let quat = decode_packed_splat_quat(elements);
                for d in 0..4 {
                    out.quat[i4 + d] = quat[d];
                }
            }
        }

        if !out.sh1.is_empty() {
            self.get_sh1(base, count, out.sh1);
        }
        if !out.sh2.is_empty() {
            self.get_sh2(base, count, out.sh2);
        }
        if !out.sh3.is_empty() {
            self.get_sh3(base, count, out.sh3);
        }

        if !out.child_count.is_empty() || !out.child_start.is_empty() {
            self.invalidate_buffer();
            if let Some(lod) = self.lod_tree.as_ref() {
                let sub = lod.subarray((base * 4) as u32, ((base + count) * 4) as u32);
                sub.copy_to(&mut self.buffer[0..count * 4]);
                for i in 0..count {
                    if !out.child_count.is_empty() {
                        out.child_count[i] = self.buffer[i * 4 + 2] as u16;
                    }
                    if !out.child_start.is_empty() {
                        out.child_start[i] = self.buffer[i * 4 + 3] as usize;
                    }
                }
            }
                
        }
    }

    fn get_center(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.prepare_buffer(base, count);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let center = decode_packed_splat_center(&self.buffer[i4..i4 + 4]);
            out[i3] = center[0];
            out[i3 + 1] = center[1];
            out[i3 + 2] = center[2];
        }
    }

    fn get_opacity(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.prepare_buffer(base, count);
        for i in 0..count {
            let i4 = i * 4;
            out[i] = decode_packed_splat_opacity(&self.buffer[i4..i4 + 4], &self.encoding);
        }
    }

    fn get_rgb(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.prepare_buffer(base, count);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let rgb = decode_packed_splat_rgb(&self.buffer[i4..i4 + 4], &self.encoding);
            out[i3] = rgb[0];
            out[i3 + 1] = rgb[1];
            out[i3 + 2] = rgb[2];
        }
    }

    fn get_scale(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.prepare_buffer(base, count);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let scale = decode_packed_splat_scale(&self.buffer[i4..i4 + 4], &self.encoding);
            out[i3] = scale[0];
            out[i3 + 1] = scale[1];
            out[i3 + 2] = scale[2];
        }
    }

    fn get_quat(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.prepare_buffer(base, count);
        for i in 0..count {
            let i4 = i * 4;
            let quat = decode_packed_splat_quat(&self.buffer[i4..i4 + 4]);
            out[i4] = quat[0];
            out[i4 + 1] = quat[1];
            out[i4 + 2] = quat[2];
            out[i4 + 3] = quat[3];
        }
    }

    fn get_sh1(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.invalidate_buffer();
        let sub = match self.sh1.as_ref() {
            Some(packed) => packed.subarray((base * 2) as u32, ((base + count) * 2) as u32),
            None => return,
        };
        self.ensure_buffer(count);
        sub.copy_to(&mut self.buffer[0..count * 2]);
        let sh1_scale = get_decode_sh1_scale(self.encoding.sh1_max);
        for i in 0..count {
            let [i2, i9] = [i * 2, i * 9];
            let words = [self.buffer[i2], self.buffer[i2 + 1]];
            let decoded = decode_sh1_internal_words(words, sh1_scale);
            for k in 0..9 { out[i9 + k] = decoded[k]; }
        }
    }

    fn get_sh2(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.invalidate_buffer();
        let sub = match self.sh2.as_ref() {
            Some(packed) => packed.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer(count);
        sub.copy_to(&mut self.buffer[0..count * 4]);
        let sh2_scale = get_decode_sh2_scale(self.encoding.sh2_max);
        for i in 0..count {
            let [i4, i15] = [i * 4, i * 15];
            let words = [self.buffer[i4], self.buffer[i4 + 1], self.buffer[i4 + 2], self.buffer[i4 + 3]];
            let decoded = decode_sh2_internal_words(words, sh2_scale);
            for k in 0..15 { out[i15 + k] = decoded[k]; }
        }
    }

    fn get_sh3(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        self.invalidate_buffer();
        let sub = match self.sh3.as_ref() {
            Some(packed) => packed.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer(count);
        sub.copy_to(&mut self.buffer[0..count * 4]);
        let sh3_scale = get_decode_sh3_scale(self.encoding.sh3_max);
        for i in 0..count {
            let [i4, i21] = [i * 4, i * 21];
            let words = [self.buffer[i4], self.buffer[i4 + 1], self.buffer[i4 + 2], self.buffer[i4 + 3]];
            let decoded = decode_sh3_internal_words(words, sh3_scale);
            for k in 0..21 { out[i21 + k] = decoded[k]; }
        }
    }

    fn get_child_count(&mut self, base: usize, count: usize, out: &mut [u16]) {
        if count == 0 { return; }
        self.invalidate_buffer();
        let sub = match self.lod_tree.as_ref() {
            Some(lod) => lod.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer(count);
        sub.copy_to(&mut self.buffer[0..count * 4]);
        for i in 0..count {
            out[i] = self.buffer[i * 4 + 2] as u16;
        }
    }

    fn get_child_start(&mut self, base: usize, count: usize, out: &mut [usize]) {
        if count == 0 { return; }
        self.invalidate_buffer();
        let sub = match self.lod_tree.as_ref() {
            Some(lod) => lod.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer(count);
        sub.copy_to(&mut self.buffer[0..count * 4]);
        for i in 0..count {
            out[i] = self.buffer[i * 4 + 3] as usize;
        }
    }
}
