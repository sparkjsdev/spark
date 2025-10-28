use std::array;

use half::f16;
use js_sys::{Object, Reflect, Uint32Array};
use spark_lib::{decoder::{SetSplatEncoding, SplatEncoding, SplatInit, SplatProps, SplatReceiver}, gsplat::GsplatArray, splat_encode::{decode_packed_splat_center, decode_packed_splat_opacity, decode_packed_splat_scale, encode_packed_splat, encode_packed_splat_center, encode_packed_splat_opacity, encode_packed_splat_quat, encode_packed_splat_rgb, encode_packed_splat_rgba, encode_packed_splat_scale, encode_sh1_array, encode_sh2_array, encode_sh3_array, get_splat_tex_size}};
use wasm_bindgen::JsValue;

pub struct PackedSplatsReceiver {
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

impl PackedSplatsReceiver {
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
        Reflect::set(&object, &JsValue::from_str("encoding"), &serde_wasm_bindgen::to_value(&self.encoding).unwrap()).unwrap();
        object
    }

    fn ensure_buffer(&mut self, count: usize) {
        self.buffer.resize(count * 4, 0);
    }

    fn prepare_subarray(&mut self, base: usize, count: usize) -> Uint32Array {
        self.ensure_buffer(count);
        self.packed.subarray((base * 4) as u32, ((base + count) * 4) as u32)
    }

    pub fn new_from_gsplat_array_lod(splats: &GsplatArray) -> anyhow::Result<Self> {
        const MAX_SPLAT_CHUNK: usize = 16384;

        let mut receiver = Self::new();
        receiver.init_splats(&SplatInit {
            num_splats: splats.len(),
            max_sh_degree: splats.max_sh_degree,
            lod_tree: true,
        })?;

        receiver.set_encoding(&SetSplatEncoding {
            lod_opacity: Some(true),
            ..Default::default()
        })?;

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

                    let opacity = splat.opacity();
                    batch_opacity[i] = 0.5 * if opacity <= 1.0 { opacity } else {
                        (0.25 * (opacity - 1.0) + 1.0).clamp(1.0, 2.0)
                    };

                    if (base + i) < splats.extras.len() {
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
                    child_count: if (base + count) <= splats.extras.len() { &batch_child_count } else { &[] },
                    child_start: if (base + count) <= splats.extras.len() { &batch_child_start } else { &[] },
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

impl SplatReceiver for PackedSplatsReceiver {
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
