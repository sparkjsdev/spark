use std::array;

use js_sys::{Array, Object, Reflect, Uint32Array};
use spark_lib::{
    decoder::{SetSplatEncoding, SplatEncoding, SplatGetter, SplatInit, SplatProps, SplatPropsMut, SplatReceiver, copy_getter_to_receiver},
    gsplat::GsplatArray,
    splat_encode::{
        decode_ext_rgb, decode_ext_splat_center, decode_ext_splat_opacity, decode_ext_splat_quat, decode_ext_splat_rgb, decode_ext_splat_scale, encode_ext_rgb, encode_ext_splat, encode_ext_splat_center, encode_ext_splat_opacity, encode_ext_splat_quat, encode_ext_splat_rgb, encode_ext_splat_rgba, encode_ext_splat_scale, encode_lod_tree, get_splat_tex_size
    },
};
use wasm_bindgen::JsValue;

pub struct ExtSplatsData {
    pub max_splats: usize,
    pub num_splats: usize,
    pub max_sh_degree: usize,
    pub ext_arrays: [Uint32Array; 2],
    pub sh1: Option<Uint32Array>,
    pub sh2: Option<Uint32Array>,
    pub sh3a: Option<Uint32Array>,
    pub sh3b: Option<Uint32Array>,
    pub lod_tree: Option<Uint32Array>,
    child_counts: Option<Vec<u16>>,
    child_starts: Option<Vec<u32>>,
    buffer_a: Vec<u32>,
    buffer_b: Vec<u32>,
}

impl ExtSplatsData {
    pub fn new() -> Self {
        Self {
            max_splats: 0,
            num_splats: 0,
            max_sh_degree: 0,
            ext_arrays: [Uint32Array::new_with_length(0), Uint32Array::new_with_length(0)],
            sh1: None,
            sh2: None,
            sh3a: None,
            sh3b: None,
            lod_tree: None,
            child_counts: None,
            child_starts: None,
            buffer_a: Vec::new(),
            buffer_b: Vec::new(),
        }
    }

    pub fn into_splat_object(self) -> Object {
        let object = Object::new();
        Reflect::set(&object, &JsValue::from_str("maxSplats"), &JsValue::from(self.max_splats as u32)).unwrap();
        Reflect::set(&object, &JsValue::from_str("numSplats"), &JsValue::from(self.num_splats as u32)).unwrap();
        Reflect::set(&object, &JsValue::from_str("maxShDegree"), &JsValue::from(self.max_sh_degree as u32)).unwrap();
        Reflect::set(&object, &JsValue::from_str("ext0"), &JsValue::from(self.ext_arrays[0].clone())).unwrap();
        Reflect::set(&object, &JsValue::from_str("ext1"), &JsValue::from(self.ext_arrays[1].clone())).unwrap();
        if let Some(sh1) = self.sh1.as_ref() {
            Reflect::set(&object, &JsValue::from_str("sh1"), &JsValue::from(sh1)).unwrap();
        }
        if let Some(sh2) = self.sh2.as_ref() {
            Reflect::set(&object, &JsValue::from_str("sh2"), &JsValue::from(sh2)).unwrap();
        }
        if let Some(sh3a) = self.sh3a.as_ref() {
            Reflect::set(&object, &JsValue::from_str("sh3a"), &JsValue::from(sh3a)).unwrap();
        }
        if let Some(sh3b) = self.sh3b.as_ref() {
            Reflect::set(&object, &JsValue::from_str("sh3b"), &JsValue::from(sh3b)).unwrap();
        }
        if let Some(lod_tree) = self.lod_tree.as_ref() {
            Reflect::set(&object, &JsValue::from_str("lodTree"), &JsValue::from(lod_tree)).unwrap();
        }
        object
    }

    pub fn from_js_arrays(ext_arrays: [Uint32Array; 2], num_splats: usize, extra: Option<&Object>) -> anyhow::Result<Self> {
        let mut data = Self::new();
        data.max_splats = (ext_arrays[0].length().min(ext_arrays[1].length()) / 4) as usize;
        data.num_splats = num_splats;
        data.ext_arrays = ext_arrays;

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
            if let Ok(sh3a) = Reflect::get(extra, &JsValue::from_str("sh3a")) {
                if !sh3a.is_falsy() {
                    data.sh3a = Some(Uint32Array::from(sh3a));
                    data.max_sh_degree = 3;
                }
            }
            if let Ok(sh3b) = Reflect::get(extra, &JsValue::from_str("sh3b")) {
                if !sh3b.is_falsy() {
                    data.sh3b = Some(Uint32Array::from(sh3b));
                    data.max_sh_degree = 3;
                }
            }
            if let Ok(lod_tree) = Reflect::get(extra, &JsValue::from_str("lodTree")) {
                if !lod_tree.is_falsy() {
                    data.lod_tree = Some(Uint32Array::from(lod_tree));
                }
            }
        }

        Ok(data)
    }

    fn ensure_buffer(&mut self, count: usize) {
        self.buffer_a.resize(count * 4, 0);
        self.buffer_b.resize(count * 4, 0);
    }

    fn ensure_buffer_a(&mut self, count: usize) {
        self.buffer_a.resize(count * 4, 0);
    }

    fn ensure_buffer_b(&mut self, count: usize) {
        self.buffer_b.resize(count * 4, 0);
    }

    fn prepare_subarray(&mut self, base: usize, count: usize) -> [Uint32Array; 2] {
        self.ensure_buffer(count);
        [
            self.ext_arrays[0].subarray((base * 4) as u32, ((base + count) * 4) as u32),
            self.ext_arrays[1].subarray((base * 4) as u32, ((base + count) * 4) as u32),
        ]
    }

    fn prepare_subarray_a(&mut self, base: usize, count: usize) -> Uint32Array {
        self.ensure_buffer_a(count);
        self.ext_arrays[0].subarray((base * 4) as u32, ((base + count) * 4) as u32)
    }

    fn prepare_subarray_b(&mut self, base: usize, count: usize) -> Uint32Array {
        self.ensure_buffer_b(count);
        self.ext_arrays[1].subarray((base * 4) as u32, ((base + count) * 4) as u32)
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

    pub fn get_ext_arrays(&self, base: usize, count: usize, out: [&mut [u32]; 2]) {
        let sub = self.ext_arrays[0].subarray((base * 4) as u32, ((base + count) * 4) as u32);
        sub.copy_to(out[0]);
        let sub = self.ext_arrays[1].subarray((base * 4) as u32, ((base + count) * 4) as u32);
        sub.copy_to(out[1]);
    }

    pub fn get_lod_tree_array(&self, base: usize, count: usize, out: &mut [u32]) -> Option<()> {
        self.lod_tree.as_ref().map(|lod| {
            let sub = lod.subarray((base * 4) as u32, ((base + count) * 4) as u32);
            sub.copy_to(out);
        })
    }
}

impl SplatReceiver for ExtSplatsData {
    fn init_splats(&mut self, init: &SplatInit) -> anyhow::Result<()> {
        let (_, _, _, max_splats) = get_splat_tex_size(init.num_splats);
        self.max_splats = max_splats;
        self.num_splats = init.num_splats;
        self.max_sh_degree = init.max_sh_degree;

        self.ext_arrays[0] = Uint32Array::new_with_length((max_splats * 4) as u32);
        self.ext_arrays[1] = Uint32Array::new_with_length((max_splats * 4) as u32);

        self.sh1 = if init.max_sh_degree < 1 { None } else {
            Some(Uint32Array::new_with_length((max_splats * 4) as u32))
        };
        self.sh2 = if init.max_sh_degree < 2 { None } else {
            Some(Uint32Array::new_with_length((max_splats * 4) as u32))
        };
        self.sh3a = if init.max_sh_degree < 3 { None } else {
            Some(Uint32Array::new_with_length((max_splats * 4) as u32))
        };
        self.sh3b = if init.max_sh_degree < 3 { None } else {
            Some(Uint32Array::new_with_length((max_splats * 4) as u32))
        };

        self.lod_tree = if init.lod_tree {
            Some(Uint32Array::new_with_length((self.num_splats * 4) as u32))
        } else {
            None
        };

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
            let Self { buffer_a, buffer_b, ext_arrays, lod_tree, child_counts, child_starts, .. } = self;
            let lod_tree = lod_tree.as_mut().unwrap();
            let child_counts = child_counts.as_ref().unwrap();
            let child_starts = child_starts.as_ref().unwrap();

            let mut base = 0;
            while base < self.num_splats {
                let count = (self.num_splats - base).min(MAX_SPLAT_CHUNK);
                let buffer_a = &mut buffer_a[0..count * 4];
                let buffer_b = &mut buffer_b[0..count * 4];
                ext_arrays[0].subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_to(buffer_a);
                ext_arrays[1].subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_to(buffer_b);

                for i in 0..count {
                    let i4 = i * 4;
                    let center = decode_ext_splat_center(&buffer_a[i4..i4 + 4]);
                    let opacity = decode_ext_splat_opacity(&buffer_a[i4..i4 + 4]);
                    let scale = decode_ext_splat_scale(&buffer_b[i4..i4 + 4]);
                    let child_count = child_counts[base + i];
                    let child_start = child_starts[base + i];
                    encode_lod_tree(&mut buffer_a[i4..i4 + 4], &center, opacity, &scale, child_count, child_start);
                }
                lod_tree.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(buffer_a);
                base += count;
            }

            self.child_starts = None;
            self.child_counts = None;
        }

        std::mem::swap(&mut self.buffer_a, &mut Vec::new());
        std::mem::swap(&mut self.buffer_b, &mut Vec::new());
        Ok(())
    }

    fn set_encoding(&mut self, _encoding: &SetSplatEncoding) -> anyhow::Result<()> {
        Ok(())
    }

    fn debug(&self, value: usize) {
        web_sys::console::log_1(&JsValue::from_str(&format!("debug: {}", value)));
    }

    fn set_batch(&mut self, base: usize, count: usize, batch: &SplatProps) {
        let [ext_a, ext_b] = self.prepare_subarray(base, count);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_ext_splat(
                &mut self.buffer_a[i4..i4 + 4],
                &mut self.buffer_b[i4..i4 + 4],
                array::from_fn(|d| batch.center[i3 + d]),
                batch.opacity[i],
                array::from_fn(|d| batch.rgb[i3 + d]),
                array::from_fn(|d| batch.scale[i3 + d]),
                array::from_fn(|d| batch.quat[i4 + d]),
            );
        }
        ext_a.copy_from(&self.buffer_a);
        ext_b.copy_from(&self.buffer_b);

        self.set_sh(base, count, batch.sh1, batch.sh2, batch.sh3);

        if !batch.child_count.is_empty() && !batch.child_start.is_empty() {
            if let Some(lod_tree) = self.lod_tree.as_ref() {
                for i in 0..count {
                    let [i3, i4] = [i * 3, i * 4];
                    encode_lod_tree(
                        &mut self.buffer_a[i4..i4 + 4],
                        &batch.center[i3..i3 + 3],
                        batch.opacity[i],
                        &batch.scale[i3..i3 + 3],
                        batch.child_count[i] as u16,
                        batch.child_start[i] as u32,
                    );
                }
                lod_tree.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer_a);
            }
        }
    }

    fn set_center(&mut self, base: usize, count: usize, center: &[f32]) {
        let ext_a = self.prepare_subarray_a(base, count);
        ext_a.copy_to(&mut self.buffer_a);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_ext_splat_center(&mut self.buffer_a[i4..i4 + 4], array::from_fn(|d| center[i3 + d]));
        }
        ext_a.copy_from(&self.buffer_a);
    }

    fn set_opacity(&mut self, base: usize, count: usize, opacity: &[f32]) {
        let ext_a = self.prepare_subarray_a(base, count);
        ext_a.copy_to(&mut self.buffer_a);
        for i in 0..count {
            let i4 = i * 4;
            encode_ext_splat_opacity(&mut self.buffer_a[i4..i4 + 4], opacity[i]);
        }
        ext_a.copy_from(&self.buffer_a);
    }

    fn set_rgb(&mut self, base: usize, count: usize, rgb: &[f32]) {
        let ext_b = self.prepare_subarray_b(base, count);
        ext_b.copy_to(&mut self.buffer_b);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_ext_splat_rgb(&mut self.buffer_b[i4..i4 + 4], array::from_fn(|d| rgb[i3 + d]));
        }
        ext_b.copy_from(&self.buffer_b);
    }

    fn set_rgba(&mut self, base: usize, count: usize, rgba: &[f32]) {
        let [ext_a, ext_b] = self.prepare_subarray(base, count);
        ext_a.copy_to(&mut self.buffer_a);
        ext_b.copy_to(&mut self.buffer_b);
        for i in 0..count {
            let i4 = i * 4;
            encode_ext_splat_rgba(&mut self.buffer_a[i4..i4 + 4], &mut self.buffer_b[i4..i4 + 4], array::from_fn(|d| rgba[i4 + d]));
        }
        ext_a.copy_from(&self.buffer_a);
        ext_b.copy_from(&self.buffer_b);
    }

    fn set_scale(&mut self, base: usize, count: usize, scale: &[f32]) {
        let ext_b = self.prepare_subarray_b(base, count);
        ext_b.copy_to(&mut self.buffer_b);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            encode_ext_splat_scale(&mut self.buffer_b[i4..i4 + 4], array::from_fn(|d| scale[i3 + d]));
        }
        ext_b.copy_from(&self.buffer_b);
    }

    fn set_quat(&mut self, base: usize, count: usize, quat: &[f32]) {
        let ext_b = self.prepare_subarray_b(base, count);
        ext_b.copy_to(&mut self.buffer_b);
        for i in 0..count {
            let i4 = i * 4;
            encode_ext_splat_quat(&mut self.buffer_b[i4..i4 + 4], array::from_fn(|d| quat[i4 + d]));
        }
        ext_b.copy_from(&self.buffer_b);
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
        self.ensure_buffer_a(count);
        if let Some(packed_sh1) = self.sh1.as_ref() {
            let buffer = &mut self.buffer_a[0..count * 4];
            for i in 0..count {
                let [i3, i4] = [i * 3, i * 4];
                for k in 0..3 {
                    let k3 = (i3 + k) * 3;
                    buffer[i4 + k] = encode_ext_rgb([sh1[k3], sh1[k3 + 1], sh1[k3 + 2]]);
                }
            }
            packed_sh1.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(buffer);
        }
    }

    fn set_sh2(&mut self, base: usize, count: usize, sh2: &[f32]) {
        self.ensure_buffer(count);
        if let Some(packed_sh1) = self.sh1.as_ref() {
            if let Some(packed_sh2) = self.sh2.as_ref() {
                let buffer_a = &mut self.buffer_a[0..count * 4];
                let buffer_b = &mut self.buffer_b[0..count * 4];
                packed_sh1.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_to(buffer_a);
                for i in 0..count {
                    let [i4, i5] = [i * 4, i * 5];
                    let k3 = i5 * 3;
                    buffer_a[i4 + 3] = encode_ext_rgb([sh2[k3], sh2[k3 + 1], sh2[k3 + 2]]);
                    for k in 1..5 {
                        let k3 = (i5 + k) * 3;
                        buffer_b[i4 + (k - 1)] = encode_ext_rgb([sh2[k3], sh2[k3 + 1], sh2[k3 + 2]]);
                    }
                }
                packed_sh2.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer_a);
                packed_sh2.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer_b);
            }
        }
    }

    fn set_sh3(&mut self, base: usize, count: usize, sh3: &[f32]) {
        self.ensure_buffer(count);
        if let Some(packed_sh3a) = self.sh3a.as_ref() {
            if let Some(packed_sh3b) = self.sh3b.as_ref() {
                let buffer_a = &mut self.buffer_a[0..count * 4];
                let buffer_b = &mut self.buffer_b[0..count * 4];
                for i in 0..count {
                    let [i4, i7] = [i * 4, i * 7];
                    for k in 0..4 {
                        let k3 = (i7 + k) * 3;
                        buffer_a[i4 + k] = encode_ext_rgb([sh3[k3], sh3[k3 + 1], sh3[k3 + 2]]);
                    }
                    for k in 4..7 {
                        let k3 = (i7 + k) * 3;
                        buffer_b[i4 + (k - 4)] = encode_ext_rgb([sh3[k3], sh3[k3 + 1], sh3[k3 + 2]]);
                    }
                }
                packed_sh3a.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer_a);
                packed_sh3b.subarray((base * 4) as u32, ((base + count) * 4) as u32).copy_from(&self.buffer_b);
            }
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

impl SplatGetter for ExtSplatsData {
    fn num_splats(&self) -> usize { self.num_splats }
    fn max_sh_degree(&self) -> usize { self.max_sh_degree }
    fn has_lod_tree(&self) -> bool { self.lod_tree.is_some() }
    fn get_encoding(&mut self) -> SplatEncoding { SplatEncoding::default() }

    fn get_batch(&mut self, base: usize, count: usize, out: &mut SplatPropsMut) {
        if count == 0 { return; }

        let [ext_a, ext_b] = self.prepare_subarray(base, count);
        ext_a.copy_to(&mut self.buffer_a);
        ext_b.copy_to(&mut self.buffer_b);

        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let buffer_a = &self.buffer_a[i4..i4 + 4];
            let buffer_b = &self.buffer_b[i4..i4 + 4];
            if !out.center.is_empty() {
                let center = decode_ext_splat_center(buffer_a);
                for d in 0..3 {
                    out.center[i3 + d] = center[d];
                }
            }
            if !out.opacity.is_empty() {
                let opacity = decode_ext_splat_opacity(buffer_a);
                out.opacity[i] = opacity;
            }
            if !out.rgb.is_empty() {
                let rgb = decode_ext_splat_rgb(buffer_b);
                for d in 0..3 {
                    out.rgb[i3 + d] = rgb[d];
                }
            }
            if !out.scale.is_empty() {
                let scale = decode_ext_splat_scale(buffer_b);
                for d in 0..3 {
                    out.scale[i3 + d] = scale[d];
                }
            }
            if !out.quat.is_empty() {
                let quat = decode_ext_splat_quat(buffer_b);
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
            if let Some(lod) = self.lod_tree.as_ref() {
                let sub = lod.subarray((base * 4) as u32, ((base + count) * 4) as u32);
                sub.copy_to(&mut self.buffer_a[0..count * 4]);
                for i in 0..count {
                    if !out.child_count.is_empty() {
                        out.child_count[i] = self.buffer_a[i * 4 + 2] as u16;
                    }
                    if !out.child_start.is_empty() {
                        out.child_start[i] = self.buffer_a[i * 4 + 3] as usize;
                    }
                }
            }
                
        }
    }

    fn get_center(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let ext_a = self.prepare_subarray_a(base, count);
        ext_a.copy_to(&mut self.buffer_a);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let center = decode_ext_splat_center(&self.buffer_a[i4..i4 + 4]);
            out[i3] = center[0];
            out[i3 + 1] = center[1];
            out[i3 + 2] = center[2];
        }
    }

    fn get_opacity(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let ext_a = self.prepare_subarray_a(base, count);
        ext_a.copy_to(&mut self.buffer_a);
        for i in 0..count {
            let i4 = i * 4;
            out[i] = decode_ext_splat_opacity(&self.buffer_a[i4..i4 + 4]);
        }
    }

    fn get_rgb(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let ext_b = self.prepare_subarray_b(base, count);
        ext_b.copy_to(&mut self.buffer_b);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let rgb = decode_ext_splat_rgb(&self.buffer_b[i4..i4 + 4]);
            out[i3] = rgb[0];
            out[i3 + 1] = rgb[1];
            out[i3 + 2] = rgb[2];
        }
    }

    fn get_scale(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let ext_b = self.prepare_subarray_b(base, count);
        ext_b.copy_to(&mut self.buffer_b);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            let scale = decode_ext_splat_scale(&self.buffer_b[i4..i4 + 4]);
            out[i3] = scale[0];
            out[i3 + 1] = scale[1];
            out[i3 + 2] = scale[2];
        }
    }

    fn get_quat(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let ext_b = self.prepare_subarray_b(base, count);
        ext_b.copy_to(&mut self.buffer_b);
        for i in 0..count {
            let i4 = i * 4;
            let quat = decode_ext_splat_quat(&self.buffer_b[i4..i4 + 4]);
            out[i4] = quat[0];
            out[i4 + 1] = quat[1];
            out[i4 + 2] = quat[2];
            out[i4 + 3] = quat[3];
        }
    }

    fn get_sh1(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub = match self.sh1.as_ref() {
            Some(packed) => packed.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer_a(count);
        sub.copy_to(&mut self.buffer_a[0..count * 4]);
        for i in 0..count {
            let [i3, i4] = [i * 3, i * 4];
            for k in 0..3 {
                let k3 = (i3 + k) * 3;
                let rgb = decode_ext_rgb(self.buffer_a[i4 + k]);
                out[k3 + 0] = rgb[0];
                out[k3 + 1] = rgb[1];
                out[k3 + 2] = rgb[2];
            }
        }
    }

    fn get_sh2(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub1 = match self.sh1.as_ref() {
            Some(packed) => packed.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        let sub2 = match self.sh2.as_ref() {
            Some(packed) => packed.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer(count);
        sub1.copy_to(&mut self.buffer_a[0..count * 4]);
        sub2.copy_to(&mut self.buffer_b[0..count * 4]);
        for i in 0..count {
            let [i4, i5] = [i * 4, i * 5];
            let k3 = i5 * 3;
            let rgb = decode_ext_rgb(self.buffer_a[i4 + 3]);
            out[k3 + 0] = rgb[0];
            out[k3 + 1] = rgb[1];
            out[k3 + 2] = rgb[2];
            for k in 1..5 {
                let k3 = (i5 + k) * 3;
                let rgb = decode_ext_rgb(self.buffer_b[i4 + (k - 1)]);
                out[k3 + 0] = rgb[0];
                out[k3 + 1] = rgb[1];
                out[k3 + 2] = rgb[2];
            }
        }
    }

    fn get_sh3(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if count == 0 { return; }
        let sub1 = match self.sh3a.as_ref() {
            Some(packed) => packed.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        let sub2 = match self.sh3b.as_ref() {
            Some(packed) => packed.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer(count);
        sub1.copy_to(&mut self.buffer_a[0..count * 4]);
        sub2.copy_to(&mut self.buffer_b[0..count * 4]);
        for i in 0..count {
            let [i4, i7] = [i * 4, i * 7];
            for k in 0..4 {
                let k3 = (i7 + k) * 3;
                let rgb = decode_ext_rgb(self.buffer_a[i4 + k]);
                out[k3 + 0] = rgb[0];
                out[k3 + 1] = rgb[1];
                out[k3 + 2] = rgb[2];
            }
            for k in 4..7 {
                let k3 = (i7 + k) * 3;
                let rgb = decode_ext_rgb(self.buffer_b[i4 + (k - 4)]);
                out[k3 + 0] = rgb[0];
                out[k3 + 1] = rgb[1];
                out[k3 + 2] = rgb[2];
            }
        }
    }

    fn get_child_count(&mut self, base: usize, count: usize, out: &mut [u16]) {
        if count == 0 { return; }
        let sub = match self.lod_tree.as_ref() {
            Some(lod) => lod.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer_a(count);
        sub.copy_to(&mut self.buffer_a[0..count * 4]);
        for i in 0..count {
            out[i] = self.buffer_a[i * 4 + 2] as u16;
        }
    }

    fn get_child_start(&mut self, base: usize, count: usize, out: &mut [usize]) {
        if count == 0 { return; }
        let sub = match self.lod_tree.as_ref() {
            Some(lod) => lod.subarray((base * 4) as u32, ((base + count) * 4) as u32),
            None => return,
        };
        self.ensure_buffer_a(count);
        sub.copy_to(&mut self.buffer_a[0..count * 4]);
        for i in 0..count {
            out[i] = self.buffer_a[i * 4 + 3] as usize;
        }
    }
}
