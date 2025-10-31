use std::array;

use half::f16;
use js_sys::{Object, Reflect, Uint32Array};
use spark_lib::{
    decoder::{SetSplatEncoding, SplatEncoding, SplatInit, SplatProps, SplatReceiver, SplatGetter, copy_getter_to_receiver},
    gsplat::GsplatArray,
    splat_encode::{
        decode_packed_splat_center,
        decode_packed_splat_opacity,
        decode_packed_splat_quat,
        decode_packed_splat_scale,
        encode_packed_splat,
        encode_packed_splat_center,
        encode_packed_splat_opacity,
        encode_packed_splat_quat,
        encode_packed_splat_rgb,
        encode_packed_splat_rgba,
        encode_packed_splat_scale,
        encode_sh1_array,
        encode_sh2_array,
        encode_sh3_array,
        get_splat_tex_size,
        u8_to_float,
    },
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
}

impl PackedSplatsData {
    pub fn new() -> Self {
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
            encoding: SplatEncoding::default(),
            buffer: Vec::new(),
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

    // Construct a getter from JS typed arrays.
    // - packed: required Uint32Array with 4 words per splat
    // - num_splats: limits count (<= packed.length()/4)
    // - extra: optional Object with optional fields:
    //   - maxShDegree: number
    //   - encoding: SplatEncoding-like object
    //   - sh1, sh2, sh3, lodTree: Uint32Array
    pub fn from_js_arrays(packed: Uint32Array, num_splats: usize, extra: Option<&Object>) -> anyhow::Result<Self> {
        let mut data = Self::new();
        let packed_len_words = packed.length() as usize;
        let max_splats_from_packed = packed_len_words / 4;
        data.packed = packed;
        data.max_splats = max_splats_from_packed;
        data.num_splats = num_splats.min(max_splats_from_packed);

        // Defaults
        data.max_sh_degree = 0;
        data.encoding = SplatEncoding::default();

        if let Some(extra) = extra {
            // maxShDegree
            if let Ok(val) = Reflect::get(extra, &JsValue::from_str("maxShDegree")) {
                if let Some(n) = val.as_f64() { data.max_sh_degree = n as usize; }
            }

            // encoding: optional; if provided but not decodable, we keep defaults to avoid dependency on Deserialize
            // (we only look for structural arrays below per request)

            // Optional typed arrays
            let read_u32array = |key: &str| -> Option<Uint32Array> {
                if let Ok(v) = Reflect::get(extra, &JsValue::from_str(key)) {
                    if v.is_object() { Some(Uint32Array::from(v)) } else { None }
                } else { None }
            };
            data.sh1 = read_u32array("sh1");
            data.sh2 = read_u32array("sh2");
            data.sh3 = read_u32array("sh3");
            data.lod_tree = read_u32array("lodTree");

            // If degree unspecified, infer from presence
            if data.max_sh_degree == 0 {
                if data.sh3.is_some() { data.max_sh_degree = 3; }
                else if data.sh2.is_some() { data.max_sh_degree = 2; }
                else if data.sh1.is_some() { data.max_sh_degree = 1; }
            }
        }

        Ok(data)
    }

    fn ensure_buffer(&mut self, count: usize) {
        self.buffer.resize(count * 4, 0);
    }

    fn prepare_subarray(&mut self, base: usize, count: usize) -> Uint32Array {
        self.ensure_buffer(count);
        self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32)
    }

    pub fn to_gsplat_array(&mut self) -> anyhow::Result<GsplatArray> {
        let mut out = GsplatArray::new();
        copy_getter_to_receiver(self, &mut out)?;
        Ok(out)
    }

    pub fn new_from_gsplat_array(splats: &GsplatArray) -> anyhow::Result<Self> {
        Self::new_from_gsplat_array_with_lod(splats, false)
    }

    pub fn new_from_gsplat_array_lod(splats: &GsplatArray) -> anyhow::Result<Self> {
        Self::new_from_gsplat_array_with_lod(splats, true)
    }

    fn new_from_gsplat_array_with_lod(splats: &GsplatArray, lod_tree: bool) -> anyhow::Result<Self> {
        const MAX_SPLAT_CHUNK: usize = 16384;

        let mut receiver = Self::new();
        receiver.init_splats(&SplatInit {
            num_splats: splats.len(),
            max_sh_degree: splats.max_sh_degree,
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
                    let splat = &splats.splats[base + i];
                    let rgb = splat.rgb();
                    let scales = splat.scales();
                    let quat = splat.quaternion().to_array();

                    for d in 0..3 {
                        batch_center[i3 + d] = splat.center[d];
                        batch_rgb[i3 + d] = rgb[d];
                        batch_scale[i3 + d] = scales[d];
                    }
                    for d in 0..4 {
                        batch_quat[i4 + d] = quat[d];
                    }

                    batch_opacity[i] = splat.opacity();

                    if lod_tree && (base + i) < splats.extras.len() {
                        let children = &splats.extras[base + i].children;
                        if children.is_empty() {
                            batch_child_count[i] = 0;
                            batch_child_start[i] = 0;
                        } else {
                            batch_child_count[i] = children.len() as u16;
                            batch_child_start[i] = children[0];
                        }
                    }
                }
                receiver.set_batch(base, count, &SplatProps {
                    center: &batch_center,
                    opacity: &batch_opacity,
                    rgb: &batch_rgb,
                    scale: &batch_scale,
                    quat: &batch_quat,
                    child_count: if lod_tree && (base + count) <= splats.extras.len() { &batch_child_count } else { &[] },
                    child_start: if lod_tree && (base + count) <= splats.extras.len() { &batch_child_start } else { &[] },
                    ..Default::default()
                });
                base += count;
            }
        }

        if splats.max_sh_degree >= 1 {
            let mut batch = vec![0.0; 9 * MAX_SPLAT_CHUNK];
            let mut base = 0;
            while base < splats.len() {
                let count = (splats.len() - base).min(MAX_SPLAT_CHUNK);
                for i in 0..count {
                    let i9 = i * 9;
                    let values = splats.sh1[base + i].to_array();
                    for d in 0..9 {
                        batch[i9 + d] = values[d];
                    }
                }
                receiver.set_sh1(base, count, &batch);
                base += count;
            }
        }

        if splats.max_sh_degree >= 2 {
            let mut batch = vec![0.0; 15 * MAX_SPLAT_CHUNK];
            let mut base = 0;
            while base < splats.len() {
                let count = (splats.len() - base).min(MAX_SPLAT_CHUNK);
                for i in 0..count {
                    let i15 = i * 15;
                    let values = splats.sh2[base + i].to_array();
                    for d in 0..15 {
                        batch[i15 + d] = values[d];
                    }
                }
                receiver.set_sh2(base, count, &batch);
                base += count;
            }
        }

        if splats.max_sh_degree >= 3 {
            let mut batch = vec![0.0; 21 * MAX_SPLAT_CHUNK];
            let mut base = 0;
            while base < splats.len() {
                let count = (splats.len() - base).min(MAX_SPLAT_CHUNK);
                for i in 0..count {
                    let i21 = i * 21;
                    let values = splats.sh3[base + i].to_array();
                    for d in 0..21 {
                        batch[i21 + d] = values[d];
                    }
                }
                receiver.set_sh3(base, count, &batch);
                base += count;
            }
        }

        Ok(receiver)
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

        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        if self.child_counts.is_some() || self.child_starts.is_some() {
            if self.child_counts.is_none() || self.child_starts.is_none() {
                return Err(anyhow::anyhow!("Missing child_counts or child_starts"));
            }

            const MAX_SPLAT_CHUNK: usize = 16384;
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
        if let Some(sh1_min) = encoding.sh1_min {
            self.encoding.sh1_min = sh1_min;
        }
        if let Some(sh1_max) = encoding.sh1_max {
            self.encoding.sh1_max = sh1_max;
        }
        if let Some(sh2_min) = encoding.sh2_min {
            self.encoding.sh2_min = sh2_min;
        }
        if let Some(sh2_max) = encoding.sh2_max {
            self.encoding.sh2_max = sh2_max;
        }
        if let Some(sh3_min) = encoding.sh3_min {
            self.encoding.sh3_min = sh3_min;
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
        web_sys::console::log_1(&JsValue::from_str(&format!("debug = {}", value)));
    }

    fn set_batch(&mut self, base: usize, count: usize, batch: &SplatProps) {
        let packed = self.prepare_subarray(base, count);
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
        packed.copy_from(&self.buffer);

        self.set_sh(base, count, batch.sh1, batch.sh2, batch.sh3);

        if !batch.child_count.is_empty() && !batch.child_start.is_empty() {
            if let Some(lod_tree) = self.lod_tree.as_ref() {
                for i in 0..count {
                    let [i3, i4] = [i * 3, i * 4];
                    encode_lod_tree(
                        &mut self.buffer[i4..i4 + 4],
                        &batch.center[i3..i3 + 3],
                        batch.opacity[i],
                        &batch.scale[i3..i3 + 3],
                        batch.child_count[i] as u16,
                        batch.child_start[i] as u32,
                    );
                }
                lod_tree.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer);
            }
        }
    }

    fn set_center(&mut self, base: usize, count: usize, center: &[f32]) {
        let packed = self.prepare_subarray(base, count);
        packed.copy_to(&mut self.buffer);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_packed_splat_center(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| center[i3 + d]));
        }
        packed.copy_from(&self.buffer);
    }

    fn set_opacity(&mut self, base: usize, count: usize, opacity: &[f32]) {
        let packed = self.prepare_subarray(base, count);
        packed.copy_to(&mut self.buffer);
        for i in 0..count {
            let i4 = i * 4;
            encode_packed_splat_opacity(&mut self.buffer[i4..i4 + 4], opacity[i], &self.encoding);
        }
        packed.copy_from(&self.buffer);
    }

    fn set_rgb(&mut self, base: usize, count: usize, rgb: &[f32]) {
        let packed = self.prepare_subarray(base, count);
        packed.copy_to(&mut self.buffer);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_packed_splat_rgb(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| rgb[i3 + d]), &self.encoding);
        }
        packed.copy_from(&self.buffer);
    }

    fn set_rgba(&mut self, base: usize, count: usize, rgba: &[f32]) {
        let packed = self.prepare_subarray(base, count);
        packed.copy_to(&mut self.buffer);
        for i in 0..count {
            let i4 = i * 4;
            encode_packed_splat_rgba(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| rgba[i4 + d]), &self.encoding);
        }
        packed.copy_from(&self.buffer);
    }

    fn set_scale(&mut self, base: usize, count: usize, scale: &[f32]) {
        let packed = self.prepare_subarray(base, count);
        packed.copy_to(&mut self.buffer);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_packed_splat_scale(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| scale[i3 + d]), &self.encoding);
        }
        packed.copy_from(&self.buffer);
    }

    fn set_quat(&mut self, base: usize, count: usize, quat: &[f32]) {
        let packed = self.prepare_subarray(base, count);
        packed.copy_to(&mut self.buffer);
        for i in 0..count {
            let i4 = i * 4;
            encode_packed_splat_quat(&mut self.buffer[i4..i4 + 4], array::from_fn(|d| quat[i4 + d]));
        }
        packed.copy_from(&self.buffer);
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
        self.ensure_buffer(count);
        if let Some(packed_sh1) = self.sh1.as_ref() {
            let buffer = &mut self.buffer[0..count * 2];
            let SplatEncoding { sh1_min, sh1_max, .. } = self.encoding;
            encode_sh1_array(buffer, sh1, count, sh1_min, sh1_max);
            packed_sh1.subarray((base * 2) as u32, ((base + count) * 2) as u32).copy_from(buffer);
        }
    }

    fn set_sh2(&mut self, base: usize, count: usize, sh2: &[f32]) {
        self.ensure_buffer(count);
        if let Some(packed_sh2) = self.sh2.as_ref() {
            let SplatEncoding { sh2_min, sh2_max, .. } = self.encoding;
            encode_sh2_array(&mut self.buffer, sh2, count, sh2_min, sh2_max);
            packed_sh2.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer);
        }
    }

    fn set_sh3(&mut self, base: usize, count: usize, sh3: &[f32]) {
        self.ensure_buffer(count);
        if let Some(packed_sh3) = self.sh3.as_ref() {
            let SplatEncoding { sh3_min, sh3_max, .. } = self.encoding;
            encode_sh3_array(&mut self.buffer, sh3, count, sh3_min, sh3_max);
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

fn encode_lod_tree(buffer: &mut [u32], center: &[f32], opacity: f32, scale: &[f32], child_count: u16, child_start: u32) {
    let center: [f16; 3] = array::from_fn(|d| f16::from_f32(center[d]));
    let max_scale = scale[0].max(scale[1]).max(scale[2]);
    let size = f16::from_f32(2.0 * opacity.max(1.0) * max_scale);
    buffer[0] = (center[0].to_bits() as u32) | ((center[1].to_bits() as u32) << 16);
    buffer[1] = (center[2].to_bits() as u32) | ((size.to_bits() as u32) << 16);
    buffer[2] = child_count as u32;
    buffer[3] = child_start as u32;
}

impl SplatGetter for PackedSplatsData {
    fn num_splats(&self) -> usize { self.num_splats }
    fn max_sh_degree(&self) -> usize { self.max_sh_degree }
    fn has_lod_tree(&self) -> bool { self.lod_tree.is_some() }
    fn get_encoding(&mut self) -> SplatEncoding { self.encoding.clone() }

    fn get_center(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
        let mut tmp = vec![0u32; count * 4];
        sub.copy_to(&mut tmp);
        for i in 0..count {
            let i4 = i * 4;
            let c = decode_packed_splat_center(&tmp[i4..i4 + 4]);
            let i3 = i * 3;
            out[i3] = c[0]; out[i3 + 1] = c[1]; out[i3 + 2] = c[2];
        }
    }

    fn get_opacity(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
        let mut tmp = vec![0u32; count * 4];
        sub.copy_to(&mut tmp);
        for i in 0..count {
            let i4 = i * 4;
            out[i] = decode_packed_splat_opacity(&tmp[i4..i4 + 4], &self.encoding);
        }
    }

    fn get_rgb(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
        let mut tmp = vec![0u32; count * 4];
        sub.copy_to(&mut tmp);
        for i in 0..count {
            let word0 = tmp[i * 4 + 0];
            let r = (word0 & 0xff) as u8;
            let g = ((word0 >> 8) & 0xff) as u8;
            let b = ((word0 >> 16) & 0xff) as u8;
            let i3 = i * 3;
            out[i3] = u8_to_float(r, self.encoding.rgb_min, self.encoding.rgb_max);
            out[i3 + 1] = u8_to_float(g, self.encoding.rgb_min, self.encoding.rgb_max);
            out[i3 + 2] = u8_to_float(b, self.encoding.rgb_min, self.encoding.rgb_max);
        }
    }

    fn get_scale(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
        let mut tmp = vec![0u32; count * 4];
        sub.copy_to(&mut tmp);
        for i in 0..count {
            let i4 = i * 4;
            let s = decode_packed_splat_scale(&tmp[i4..i4 + 4], &self.encoding);
            let i3 = i * 3;
            out[i3] = s[0]; out[i3 + 1] = s[1]; out[i3 + 2] = s[2];
        }
    }

    fn get_quat(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub = self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
        let mut tmp = vec![0u32; count * 4];
        sub.copy_to(&mut tmp);
        for i in 0..count {
            let i4 = i * 4;
            let q = decode_packed_splat_quat(&tmp[i4..i4 + 4]);
            let o = i * 4;
            out[o] = q[0]; out[o + 1] = q[1]; out[o + 2] = q[2]; out[o + 3] = q[3];
        }
    }

    fn get_sh1(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        if let Some(packed) = self.sh1.as_ref() {
            let sub = packed.subarray((base * 2) as u32, ((base + count) * 2) as u32);
            let mut tmp = vec![0u32; count * 2];
            sub.copy_to(&mut tmp);
            let sh1_mid = 0.5 * (self.encoding.sh1_min + self.encoding.sh1_max);
            let sh1_scale = 126.0 / (self.encoding.sh1_max - self.encoding.sh1_min);
            for i in 0..count {
                let w0 = tmp[i * 2];
                let w1 = tmp[i * 2 + 1];
                let decoded = decode_sh1_internal_words([w0, w1], sh1_mid, sh1_scale);
                let o = i * 9;
                for k in 0..9 { out[o + k] = decoded[k]; }
            }
        }
    }

    fn get_sh2(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        if let Some(packed) = self.sh2.as_ref() {
            let sub = packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            let mut tmp = vec![0u32; count * 4];
            sub.copy_to(&mut tmp);
            let sh2_mid = 0.5 * (self.encoding.sh2_min + self.encoding.sh2_max);
            let sh2_scale = 254.0 / (self.encoding.sh2_max - self.encoding.sh2_min);
            for i in 0..count {
                let words: [u32; 4] = [tmp[i * 4], tmp[i * 4 + 1], tmp[i * 4 + 2], tmp[i * 4 + 3]];
                let decoded = decode_sh2_internal_words(words, sh2_mid, sh2_scale);
                let o = i * 15;
                for k in 0..15 { out[o + k] = decoded[k]; }
            }
        }
    }

    fn get_sh3(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        if let Some(packed) = self.sh3.as_ref() {
            let sub = packed.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            let mut tmp = vec![0u32; count * 4];
            sub.copy_to(&mut tmp);
            let sh3_mid = 0.5 * (self.encoding.sh3_min + self.encoding.sh3_max);
            let sh3_scale = 62.0 / (self.encoding.sh3_max - self.encoding.sh3_min);
            for i in 0..count {
                let words: [u32; 4] = [tmp[i * 4], tmp[i * 4 + 1], tmp[i * 4 + 2], tmp[i * 4 + 3]];
                let decoded = decode_sh3_internal_words(words, sh3_mid, sh3_scale);
                let o = i * 21;
                for k in 0..21 { out[o + k] = decoded[k]; }
            }
        }
    }

    fn get_child_count(&mut self, base: usize, count: usize, out: &mut [u16]) {
        if count == 0 { return; }
        if let Some(lod) = self.lod_tree.as_ref() {
            let sub = lod.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            let mut tmp = vec![0u32; count * 4];
            sub.copy_to(&mut tmp);
            for i in 0..count { out[i] = tmp[i * 4 + 2] as u16; }
        }
    }

    fn get_child_start(&mut self, base: usize, count: usize, out: &mut [usize]) {
        if count == 0 { return; }
        if let Some(lod) = self.lod_tree.as_ref() {
            let sub = lod.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            let mut tmp = vec![0u32; count * 4];
            sub.copy_to(&mut tmp);
            for i in 0..count { out[i] = tmp[i * 4 + 3] as usize; }
        }
    }
}

// Local SH decoders matching encode_* in spark_lib::splat_encode
fn decode_sh1_internal_words(words: [u32; 2], sh1_mid: f32, sh1_scale: f32) -> [f32; 9] {
    let mut out = [0.0f32; 9];
    for i in 0..9 {
        let bit_start = i * 7;
        let word_start = bit_start / 32;
        let word_bit_start = word_start * 32;
        let bit_offset = bit_start - word_bit_start;
        let mut val: u32 = (words[word_start] >> bit_offset) & 0x7f;
        if bit_start + 7 > word_bit_start + 32 {
            val |= (words[word_start + 1] << (32 - bit_offset)) & 0x7f;
        }
        let signed = if val >= 64 { (val as i32) - 128 } else { val as i32 } as f32;
        out[i] = signed / sh1_scale + sh1_mid;
    }
    out
}

fn decode_sh2_internal_words(words: [u32; 4], sh2_mid: f32, sh2_scale: f32) -> [f32; 15] {
    let mut bytes = [0u8; 16];
    bytes[0..4].copy_from_slice(&words[0].to_le_bytes());
    bytes[4..8].copy_from_slice(&words[1].to_le_bytes());
    bytes[8..12].copy_from_slice(&words[2].to_le_bytes());
    bytes[12..16].copy_from_slice(&words[3].to_le_bytes());
    let mut out = [0.0f32; 15];
    for i in 0..15 {
        let v = bytes[i] as i8 as f32;
        out[i] = v / sh2_scale + sh2_mid;
    }
    out
}

fn decode_sh3_internal_words(words: [u32; 4], sh3_mid: f32, sh3_scale: f32) -> [f32; 21] {
    let mut out = [0.0f32; 21];
    for i in 0..21 {
        let bit_start = i * 6;
        let word_start = bit_start / 32;
        let word_bit_start = word_start * 32;
        let bit_offset = bit_start - word_bit_start;
        let mut val: u32 = (words[word_start] >> bit_offset) & 0x3f;
        if bit_start + 6 > word_bit_start + 32 {
            val |= (words[word_start + 1] << (32 - bit_offset)) & 0x3f;
        }
        let signed = if val >= 32 { (val as i32) - 64 } else { val as i32 } as f32;
        out[i] = signed / sh3_scale + sh3_mid;
    }
    out
}
