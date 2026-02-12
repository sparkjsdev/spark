use std::array;
use std::io::Write;

use half::f16;

use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};
use miniz_oxide::deflate::compress_to_vec;
use miniz_oxide::inflate::decompress_to_vec;

// fn compress_to_vec(data: &[u8], _level: u8) -> Vec<u8> {
//     data.to_vec()
// }

// use zstd::encode_all;
// fn compress_to_vec(data: &[u8], _level: u8) -> Vec<u8> {
//     encode_all(data, 19).unwrap()
// }

use crate::decoder::{ChunkReceiver, SetSplatEncoding, SplatEncoding, SplatGetter, SplatInit, SplatReceiver};
use crate::splat_encode::{self, decode_scale8, encode_scale8_zero};

pub const RAD_MAGIC: u32 = 0x30444152; // 'RAD0'
pub const RAD_CHUNK_MAGIC: u32 = 0x43444152; // 'RADC'

const GZ_LEVEL: u8 = 6;


pub struct RadEncoder<T: SplatGetter> {
    pub getter: T,
    pub encoding: Option<SplatEncoding>,
    pub max_sh: usize,
    pub center_encoding: RadCenterEncoding,
    pub alpha_encoding: RadAlphaEncoding,
    pub rgb_encoding: RadRgbEncoding,
    pub scales_encoding: RadScalesEncoding,
    pub orientation_encoding: RadOrientationEncoding,
    pub sh_encoding: RadShEncoding,
    pub comment: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadCenterEncoding {
    #[default]
    Auto,
    F32,
    F32LeBytes,
    F16,
    F16LeBytes,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadAlphaEncoding {
    #[default]
    Auto,
    F32,
    F16,
    R8,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadRgbEncoding {
    #[default]
    Auto,
    F32,
    F16,
    R8,
    R8Delta,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadScalesEncoding {
    #[default]
    Auto,
    F32,
    Ln0R8,
    LnF16,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadOrientationEncoding {
    #[default]
    Auto,
    F32,
    F16,
    Oct88R8,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadShEncoding {
    #[default]
    Auto,
    F32,
    F16,
    S8,
    S8Delta,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RadChunkRange {
    offset: u64,
    bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    base: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RadMeta {
    version: u32,
    #[serde(rename = "type")]
    ty: RadType,
    count: u64,
    #[serde(rename = "maxSh", skip_serializing_if = "Option::is_none")]
    max_sh: Option<usize>,
    #[serde(rename = "lodTree", skip_serializing_if = "Option::is_none")]
    lod_tree: Option<bool>,
    #[serde(rename = "chunkSize", skip_serializing_if = "Option::is_none")]
    chunk_size: Option<usize>,
    #[serde(rename = "allChunkBytes")]
    all_chunk_bytes: u64,
    chunks: Vec<RadChunkRange>,
    #[serde(rename = "splatEncoding", skip_serializing_if = "Option::is_none")]
    splat_encoding: Option<SetSplatEncoding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadType {
    #[serde(rename = "gsplat")]
    Gsplat,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RadChunkMeta {
    version: u32,
    base: u64,
    count: u64,
    #[serde(rename = "payloadBytes")]
    payload_bytes: u64,
    #[serde(rename = "maxSh", skip_serializing_if = "Option::is_none")]
    max_sh: Option<usize>,
    #[serde(rename = "lodTree", skip_serializing_if = "Option::is_none")]
    lod_tree: Option<bool>,
    #[serde(rename = "splatEncoding", skip_serializing_if = "Option::is_none")]
    splat_encoding: Option<SetSplatEncoding>,
    properties: Vec<RadChunkProperty>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RadChunkProperty {
    offset: u64,
    bytes: u64,
    property: RadChunkPropertyName,
    encoding: RadChunkPropertyEncoding,
    #[serde(skip_serializing_if = "Option::is_none")]
    compression: Option<RadChunkPropertyCompression>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max: Option<f32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadChunkPropertyName {
    #[default]
    #[serde(rename = "center")]
    Center,
    #[serde(rename = "alpha")]
    Alpha,
    #[serde(rename = "rgb")]
    Rgb,
    #[serde(rename = "scales")]
    Scales,
    #[serde(rename = "orientation")]
    Orientation,
    #[serde(rename = "sh1")]
    Sh1,
    #[serde(rename = "sh2")]
    Sh2,
    #[serde(rename = "sh3")]
    Sh3,
    #[serde(rename = "child_count")]
    ChildCount,
    #[serde(rename = "child_start")]
    ChildStart,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadChunkPropertyEncoding {
    #[default]
    #[serde(rename = "f32")]
    F32,
    #[serde(rename = "f16")]
    F16,
    #[serde(rename = "f32_lebytes")]
    F32LeBytes,
    #[serde(rename = "f16_lebytes")]
    F16LeBytes,
    #[serde(rename = "r8")]
    R8,
    #[serde(rename = "r8_delta")]
    R8Delta,
    #[serde(rename = "s8")]
    S8,
    #[serde(rename = "s8_delta")]
    S8Delta,
    #[serde(rename = "ln_0r8")]
    Ln0R8,
    #[serde(rename = "ln_f16")]
    LnF16,
    #[serde(rename = "oct88r8")]
    Oct88R8,
    #[serde(rename = "u16")]
    U16,
    #[serde(rename = "u32")]
    U32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RadChunkPropertyCompression {
    Gz,
}

impl<T: SplatGetter> RadEncoder<T> {
    pub fn new(getter: T) -> Self {
        Self {
            getter,
            encoding: None,
            max_sh: 3,
            center_encoding: RadCenterEncoding::default(),
            alpha_encoding: RadAlphaEncoding::default(),
            rgb_encoding: RadRgbEncoding::default(),
            scales_encoding: RadScalesEncoding::default(),
            orientation_encoding: RadOrientationEncoding::default(),
            sh_encoding: RadShEncoding::default(),
            comment: None,
        }
    }

    pub fn with_max_sh(mut self, max_sh: usize) -> Self {
        self.max_sh = max_sh.min(3);
        self
    }

    pub fn with_encoding(mut self, encoding: SplatEncoding) -> Self {
        self.encoding = Some(encoding);
        self
    }

    pub fn with_center_encoding(mut self, encoding: RadCenterEncoding) -> Self {
        self.center_encoding = encoding;
        self
    }

    pub fn with_alpha_encoding(mut self, encoding: RadAlphaEncoding) -> Self {
        self.alpha_encoding = encoding;
        self
    }

    pub fn with_rgb_encoding(mut self, encoding: RadRgbEncoding) -> Self {
        self.rgb_encoding = encoding;
        self
    }

    pub fn with_scales_encoding(mut self, encoding: RadScalesEncoding) -> Self {
        self.scales_encoding = encoding;
        self
    }

    pub fn with_orientation_encoding(mut self, encoding: RadOrientationEncoding) -> Self {
        self.orientation_encoding = encoding;
        self
    }

    pub fn with_sh_encoding(mut self, encoding: RadShEncoding) -> Self {
        self.sh_encoding = encoding;
        self
    }

    pub fn with_comment(mut self, comment: String) -> Self {
        self.comment = Some(comment);
        self
    }

    fn with_chunks<F: FnMut(&mut T, usize, usize)>(&mut self, chunk_size: usize, mut f: F) {
        let num_splats = self.getter.num_splats();
        let mut base = 0;
        while base < num_splats {
            let count = (num_splats - base).min(chunk_size);
            f(&mut self.getter, base, count);
            base += count;
        }
    }

    pub fn resolve_center_encoding(&mut self) {
        if self.center_encoding != RadCenterEncoding::Auto {
            return;
        }
        // The best property center encoding depends on the ratio of the
        // center coordinates to the splat scales. Use F32 for now to be safe.
        self.center_encoding = RadCenterEncoding::F32LeBytes;

        // let mut buffer = vec![0.0; 65536 * 3];
        // let mut max_coord = f32::NEG_INFINITY;
        // self.with_chunks(65536, |getter, base, count| {
        //     getter.get_center(base, count, &mut buffer[..count * 3]);
        //     for i in 0..count * 3 {
        //         max_coord = max_coord.max(buffer[i].abs());
        //     }
        // });
        // if max_coord > 60000.0 {
        //     self.center_encoding = RadCenterEncoding::F32LeBytes;
        // } else {
        //     self.center_encoding = RadCenterEncoding::F16LeBytes;
        // }
    }

    pub fn resolve_alpha_encoding(&mut self) {
        if self.alpha_encoding != RadAlphaEncoding::Auto {
            return;
        }
        let mut buffer = vec![0.0; 65536];
        let mut max_alpha = f32::NEG_INFINITY;
        self.with_chunks(65536, |getter, base, count| {
            getter.get_opacity(base, count, &mut buffer[..count]);
            for i in 0..count {
                max_alpha = max_alpha.max(buffer[i]);
            }
        });
        if max_alpha > 1.0 {
            self.alpha_encoding = RadAlphaEncoding::F16;
        } else {
            self.alpha_encoding = RadAlphaEncoding::R8;
        }
    }

    pub fn resolve_rgb_encoding(&mut self) {
        if self.rgb_encoding != RadRgbEncoding::Auto {
            return;
        }

        let mut all_rgb = vec![0.0; self.getter.num_splats() * 3];
        self.getter.get_rgb(0, self.getter.num_splats(), &mut all_rgb);

        let n1 = ((all_rgb.len() as f32 * 0.01).round() as usize).min(all_rgb.len() - 1);
        let n99 = ((all_rgb.len() as f32 * 0.99).round() as usize).min(all_rgb.len() - 1);
        let rgb1 = *all_rgb.select_nth_unstable_by_key(n1, |&x| OrderedFloat(x)).1;
        let rgb99 = *all_rgb.select_nth_unstable_by_key(n99, |&x| OrderedFloat(x)).1;
        let rgb_min = rgb1.min(0.0);
        let rgb_max = rgb99.max(1.0);

        if rgb_min < -1.0 || rgb_max > 2.0 {
            self.rgb_encoding = RadRgbEncoding::F16;
        } else {
            self.rgb_encoding = RadRgbEncoding::R8Delta;
            if self.encoding.is_none() {
                self.encoding = Some(SplatEncoding::default());
            }
            self.encoding.as_mut().unwrap().rgb_min = rgb_min;
            self.encoding.as_mut().unwrap().rgb_max = rgb_max;
        }
    }

    pub fn resolve_scales_encoding(&mut self) {
        if self.scales_encoding != RadScalesEncoding::Auto {
            return;
        }

        let mut scales: Vec<f32> = Vec::with_capacity(self.getter.num_splats() * 2);
        let mut buffer = vec![0.0; 65536 * 3];
        self.with_chunks(65536, |getter, base, count| {
            getter.get_scale(base, count, &mut buffer[..count * 3]);
            for i in 0..count {
                let mut splat_scales = [buffer[i * 3], buffer[i * 3 + 1], buffer[i * 3 + 2]];
                splat_scales.sort_by_key(|&x| OrderedFloat(x));
                // Skip the smallest scale since it may be flat and its value isn't meaningful
                scales.extend([splat_scales[1], splat_scales[2]]);
            }
        });

        let n1 = ((scales.len() as f32 * 0.01).round() as usize).min(scales.len() - 1);
        let n99 = ((scales.len() as f32 * 0.99).round() as usize).min(scales.len() - 1);
        let scale1 = *scales.select_nth_unstable_by_key(n1, |&x| OrderedFloat(x)).1;
        let scale99 = *scales.select_nth_unstable_by_key(n99, |&x| OrderedFloat(x)).1;
        let ln_scale_min = scale1.max(1.0e-30).ln().min(-12.0);
        let ln_scale_max = scale99.max(1.0e-30).ln().max(9.0);

        if (ln_scale_max - ln_scale_min) > 25.0 {
            self.scales_encoding = RadScalesEncoding::LnF16
        } else {
            self.scales_encoding = RadScalesEncoding::Ln0R8;
            if self.encoding.is_none() {
                self.encoding = Some(SplatEncoding::default());
            }
            self.encoding.as_mut().unwrap().ln_scale_min = ln_scale_min;
            self.encoding.as_mut().unwrap().ln_scale_max = ln_scale_max;
        }
    }

    pub fn resolve_orientation_encoding(&mut self) {
        if self.orientation_encoding != RadOrientationEncoding::Auto {
            return;
        }
        self.orientation_encoding = RadOrientationEncoding::Oct88R8;
    }

    pub fn resolve_sh_encoding(&mut self) {
        if self.sh_encoding != RadShEncoding::Auto {
            return;
        }

        let num_sh = self.max_sh.min(self.getter.max_sh_degree());
        if num_sh == 0 {
            self.sh_encoding = RadShEncoding::S8;
            return;
        }

        if self.encoding.is_none() {
            self.encoding = Some(SplatEncoding::default());
        }

        let mut all_rgb = Vec::with_capacity(self.getter.num_splats() * 21);

        all_rgb.resize(self.getter.num_splats() * 9, 0.0);
        self.getter.get_sh1(0, self.getter.num_splats(), &mut all_rgb);
        let n5 = ((all_rgb.len() as f32 * 0.05).round() as usize).min(all_rgb.len() - 1);
        let n95 = ((all_rgb.len() as f32 * 0.95).round() as usize).min(all_rgb.len() - 1);
        let sh1_5 = *all_rgb.select_nth_unstable_by_key(n5, |&x| OrderedFloat(x)).1;
        let sh1_95 = *all_rgb.select_nth_unstable_by_key(n95, |&x| OrderedFloat(x)).1;
        self.encoding.as_mut().unwrap().sh1_max = sh1_5.abs().max(sh1_95.abs()).max(1.0);

        if num_sh >= 2 {
            all_rgb.resize(self.getter.num_splats() * 15, 0.0);
            self.getter.get_sh2(0, self.getter.num_splats(), &mut all_rgb);
            let n5 = ((all_rgb.len() as f32 * 0.05).round() as usize).min(all_rgb.len() - 1);
            let n95 = ((all_rgb.len() as f32 * 0.95).round() as usize).min(all_rgb.len() - 1);
            let sh2_5 = *all_rgb.select_nth_unstable_by_key(n5, |&x| OrderedFloat(x)).1;
            let sh2_95 = *all_rgb.select_nth_unstable_by_key(n95, |&x| OrderedFloat(x)).1;            
            self.encoding.as_mut().unwrap().sh2_max = sh2_5.abs().max(sh2_95.abs()).max(1.0);
        }

        if num_sh >= 3 {
            all_rgb.resize(self.getter.num_splats() * 21, 0.0);
            self.getter.get_sh3(0, self.getter.num_splats(), &mut all_rgb);
            let n5 = ((all_rgb.len() as f32 * 0.05).round() as usize).min(all_rgb.len() - 1);
            let n95 = ((all_rgb.len() as f32 * 0.95).round() as usize).min(all_rgb.len() - 1);
            let sh3_5 = *all_rgb.select_nth_unstable_by_key(n5, |&x| OrderedFloat(x)).1;
            let sh3_95 = *all_rgb.select_nth_unstable_by_key(n95, |&x| OrderedFloat(x)).1;
            self.encoding.as_mut().unwrap().sh3_max = sh3_5.abs().max(sh3_95.abs()).max(1.0);
        }

        self.sh_encoding = RadShEncoding::S8;
    }

    pub fn resolve_encoding(&mut self) {
        self.resolve_center_encoding();
        self.resolve_alpha_encoding();
        self.resolve_rgb_encoding();
        self.resolve_scales_encoding();
        self.resolve_orientation_encoding();
        self.resolve_sh_encoding();
    }

    pub fn encode<W: Write>(&mut self, writer: &mut W) -> anyhow::Result<()> {
        const PRETTY: bool = true;
        const CHUNK_SIZE: usize = 65536;

        let num_splats = self.getter.num_splats();
        let max_sh = self.getter.max_sh_degree().min(self.max_sh);
        let encoding = self.encoding.clone().or_else(|| self.getter.get_encoding()).unwrap_or(SplatEncoding::default());

        let mut buffer = Vec::new();
        let buffer_dim = if max_sh == 0 { 4 } else if max_sh == 1 { 9 } else if max_sh == 2 { 15 } else { 21 };
        buffer.resize(CHUNK_SIZE * buffer_dim, 0.0);

        let mut buffer_u16 = Vec::new();
        let mut buffer_usize = Vec::new();        
        if self.getter.has_lod_tree() {
            buffer_u16.resize(CHUNK_SIZE, 0);
            buffer_usize.resize(CHUNK_SIZE, 0);
        }

        let num_chunks = num_splats.div_ceil(CHUNK_SIZE);
        let mut chunks = Vec::with_capacity(num_chunks);
        let mut chunk_ranges = Vec::with_capacity(num_chunks);
        let mut offset: u64 = 0;

        for chunk_index in 0..num_chunks {
            let base = chunk_index * CHUNK_SIZE;
            let count = (num_splats - base).min(CHUNK_SIZE);
            let chunk = self.encode_chunk(base, count, &encoding, &mut buffer, &mut buffer_u16, &mut buffer_usize)?;

            chunk_ranges.push(RadChunkRange {
                offset,
                bytes: chunk.len() as u64,
                // base: Some(base),
                // count: Some(count),
                ..Default::default()
            });
            offset += chunk.len() as u64;
            chunks.push(chunk);
        }
        let all_chunk_bytes = offset;

        let mut meta = RadMeta {
            version: 1,
            ty: RadType::Gsplat,
            count: num_splats as u64,
            max_sh: Some(max_sh),
            lod_tree: if self.getter.has_lod_tree() { Some(true) } else { None },
            chunk_size: Some(CHUNK_SIZE),
            all_chunk_bytes: all_chunk_bytes,
            chunks: chunk_ranges,
            splat_encoding: None,
            comment: self.comment.clone(),
        };
        if let Some(mut encoding) = self.encoding.clone().or_else(|| self.getter.get_encoding()) {
            encoding.lod_opacity = self.getter.has_lod_tree();
            meta.splat_encoding = Some(SetSplatEncoding::from(encoding));
        }
        let meta_bytes = if PRETTY {
            let mut meta_bytes = serde_json::to_vec_pretty(&meta)?;
            meta_bytes.push(b'\n');
            meta_bytes
        } else {
            serde_json::to_vec(&meta)?
        };
        let meta_bytes_size = meta_bytes.len();

        writer.write_all(&RAD_MAGIC.to_le_bytes())?;
        writer.write_all(&(meta_bytes_size as u32).to_le_bytes())?;
        writer.write_all(&meta_bytes)?;
        write_pad(writer, meta_bytes_size)?;

        for chunk in chunks {
            assert!(chunk.len() & 7 == 0);
            writer.write_all(&chunk)?;
        }

        Ok(())
    }

    fn encode_chunk_center(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>) -> (RadChunkProperty, Vec<u8>) {
        if buffer.len() < count * 3 {
            buffer.resize(count * 3, 0.0);
        }
        self.getter.get_center(base, count, &mut buffer[..count * 3]);

        let (enc, bytes) = match self.center_encoding {
            RadCenterEncoding::F32 => (RadChunkPropertyEncoding::F32, encode_f32(&buffer, 3, count)),
            RadCenterEncoding::F16 => (RadChunkPropertyEncoding::F16, encode_f16(&buffer, 3, count)),
            RadCenterEncoding::Auto |
            RadCenterEncoding::F32LeBytes => (RadChunkPropertyEncoding::F32LeBytes, encode_f32_lebytes(&buffer, 3, count)),
            RadCenterEncoding::F16LeBytes => (RadChunkPropertyEncoding::F16LeBytes, encode_f16_lebytes(&buffer, 3, count)),
        };
        let meta = RadChunkProperty {
            property: RadChunkPropertyName::Center,
            encoding: enc,
            compression: Some(RadChunkPropertyCompression::Gz),
            ..Default::default()
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_alpha(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>) -> (RadChunkProperty, Vec<u8>) {
        if buffer.len() < count {
            buffer.resize(count, 0.0);
        }
        self.getter.get_opacity(base, count, &mut buffer[..count]);

        let max_alpha = if self.getter.has_lod_tree() { 2.0 } else { 1.0 };
        let (enc, bytes, min, max) = match self.alpha_encoding {
            RadAlphaEncoding::F32 => (RadChunkPropertyEncoding::F32, encode_f32(&buffer, 1, count), None, None),
            RadAlphaEncoding::Auto |
            RadAlphaEncoding::F16 => (RadChunkPropertyEncoding::F16, encode_f16(&buffer, 1, count), None, None),
            RadAlphaEncoding::R8 => (RadChunkPropertyEncoding::R8, encode_r8(&buffer, 1, count, 0.0, max_alpha), Some(0.0), Some(max_alpha)),
        };
        let meta = RadChunkProperty {
            property: RadChunkPropertyName::Alpha,
            encoding: enc,
            compression: Some(RadChunkPropertyCompression::Gz),
            min,
            max,
            ..Default::default()
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_rgb(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding) -> (RadChunkProperty, Vec<u8>) {
        if buffer.len() < count * 3 {
            buffer.resize(count * 3, 0.0);
        }
        self.getter.get_rgb(base, count, &mut buffer[..count * 3]);

        let (enc, bytes, min, max) = match self.rgb_encoding {
            RadRgbEncoding::F32 => (RadChunkPropertyEncoding::F32, encode_f32(&buffer, 3, count), None, None),
            RadRgbEncoding::F16 => (RadChunkPropertyEncoding::F16, encode_f16(&buffer, 3, count), None, None),
            RadRgbEncoding::R8 => (RadChunkPropertyEncoding::R8, encode_r8(&buffer, 3, count, encoding.rgb_min, encoding.rgb_max), Some(encoding.rgb_min), Some(encoding.rgb_max)),
            RadRgbEncoding::Auto |
            RadRgbEncoding::R8Delta => (RadChunkPropertyEncoding::R8Delta, encode_r8_delta(&buffer, 3, count, encoding.rgb_min, encoding.rgb_max), Some(encoding.rgb_min), Some(encoding.rgb_max)),
        };
        let meta = RadChunkProperty {
            property: RadChunkPropertyName::Rgb,
            encoding: enc,
            compression: Some(RadChunkPropertyCompression::Gz),
            min,
            max,
            ..Default::default()
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_scales(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding) -> (RadChunkProperty, Vec<u8>) {
        if buffer.len() < count * 3 {
            buffer.resize(count * 3, 0.0);
        }
        self.getter.get_scale(base, count, &mut buffer[..count * 3]);

        let (enc, bytes, min, max) = match self.scales_encoding {
            RadScalesEncoding::F32 => (RadChunkPropertyEncoding::F32, encode_f32(&buffer, 3, count), None, None),
            RadScalesEncoding::Auto |
            RadScalesEncoding::Ln0R8 => (RadChunkPropertyEncoding::Ln0R8, encode_ln_0r8(&buffer, 3, count, -30.0, encoding.ln_scale_min, encoding.ln_scale_max), Some(encoding.ln_scale_min), Some(encoding.ln_scale_max)),
            RadScalesEncoding::LnF16 => (RadChunkPropertyEncoding::LnF16, encode_ln_f16(&buffer, 3, count), None, None),
        };
        let meta = RadChunkProperty {
            property: RadChunkPropertyName::Scales,
            encoding: enc,
            compression: Some(RadChunkPropertyCompression::Gz),
            min,
            max,
            ..Default::default()
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_orientation(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>) -> (RadChunkProperty, Vec<u8>) {
        if buffer.len() < count * 4 {
            buffer.resize(count * 4, 0.0);
        }
        self.getter.get_quat(base, count, &mut buffer[..count * 4]);

        if self.orientation_encoding == RadOrientationEncoding::Oct88R8 || self.orientation_encoding == RadOrientationEncoding::Auto {
            let bytes = encode_quat_oct88r8(&buffer, count);
            let meta = RadChunkProperty {
                property: RadChunkPropertyName::Orientation,
                encoding: RadChunkPropertyEncoding::Oct88R8,
                compression: Some(RadChunkPropertyCompression::Gz),
                ..Default::default()
            };
            (meta, compress_to_vec(&bytes, GZ_LEVEL))
        } else {
            for i in 0..count {
                for d in 0..3 {
                    buffer[i * 3 + d] = buffer[i * 4 + d];
                }
            }
            let (enc, bytes) = match self.orientation_encoding {
                RadOrientationEncoding::F32 => (RadChunkPropertyEncoding::F32, encode_f32(&buffer, 3, count)),
                RadOrientationEncoding::F16 => (RadChunkPropertyEncoding::F16, encode_f16(&buffer, 3, count)),
                _ => unreachable!(),
            };
            let meta = RadChunkProperty {
                property: RadChunkPropertyName::Orientation,
                encoding: enc,
                compression: Some(RadChunkPropertyCompression::Gz),
                ..Default::default()
            };
            (meta, compress_to_vec(&bytes, GZ_LEVEL))
        }
    }

    fn encode_chunk_sh(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding, property: RadChunkPropertyName) -> (RadChunkProperty, Vec<u8>) {
        let (elements, sh_max) = match property {
            RadChunkPropertyName::Sh1 => (9, encoding.sh1_max),
            RadChunkPropertyName::Sh2 => (15, encoding.sh2_max),
            RadChunkPropertyName::Sh3 => (21, encoding.sh3_max),
            _ => unreachable!(),
        };
        if buffer.len() < count * elements {
            buffer.resize(count * elements, 0.0);
        }
        match property {
            RadChunkPropertyName::Sh1 => self.getter.get_sh1(base, count, &mut buffer[..count * elements]),
            RadChunkPropertyName::Sh2 => self.getter.get_sh2(base, count, &mut buffer[..count * elements]),
            RadChunkPropertyName::Sh3 => self.getter.get_sh3(base, count, &mut buffer[..count * elements]),
            _ => unreachable!(),
        };

        let (encoding, bytes, min, max) = match self.sh_encoding {
            RadShEncoding::F32 => (RadChunkPropertyEncoding::F32, encode_f32(&buffer, elements, count), None, None),
            RadShEncoding::F16 => (RadChunkPropertyEncoding::F16, encode_f16(&buffer, elements, count), None, None),
            RadShEncoding::Auto |
            RadShEncoding::S8 => (RadChunkPropertyEncoding::S8, encode_s8(&buffer, elements, count, sh_max), Some(-sh_max), Some(sh_max)),
            RadShEncoding::S8Delta => (RadChunkPropertyEncoding::S8Delta, encode_s8_delta(&buffer, elements, count, sh_max), Some(-sh_max), Some(sh_max)),
        };
        let meta = RadChunkProperty {
            property,
            encoding,
            compression: Some(RadChunkPropertyCompression::Gz),
            min,
            max,
            ..Default::default()
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_child_count(&mut self, base: usize, count: usize, buffer: &mut Vec<u16>) -> (RadChunkProperty, Vec<u8>) {
        if buffer.len() < count {
            buffer.resize(count, 0);
        }
        self.getter.get_child_count(base, count, &mut buffer[..count]);

        let bytes = encode_u16(&buffer, 1, count);
        let meta = RadChunkProperty {
            property: RadChunkPropertyName::ChildCount,
            encoding: RadChunkPropertyEncoding::U16,
            compression: Some(RadChunkPropertyCompression::Gz),
            ..Default::default()
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_child_start(&mut self, base: usize, count: usize, buffer: &mut Vec<usize>) -> (RadChunkProperty, Vec<u8>) {
        if buffer.len() < count {
            buffer.resize(count, 0);
        }
        self.getter.get_child_start(base, count, &mut buffer[..count]);

        let bytes = encode_usize_as_u32(&buffer, 1, count);
        let meta = RadChunkProperty {
            property: RadChunkPropertyName::ChildStart,
            encoding: RadChunkPropertyEncoding::U32,
            compression: Some(RadChunkPropertyCompression::Gz),
            ..Default::default()
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk(
        &mut self, base: usize, count: usize, encoding: &SplatEncoding,
        buffer: &mut Vec<f32>, buffer_u16: &mut Vec<u16>, buffer_usize: &mut Vec<usize>,
    ) -> anyhow::Result<Vec<u8>> {
        let max_sh = self.getter.max_sh_degree().min(self.max_sh);

        let mut props = vec![
            self.encode_chunk_center(base, count, buffer),
            self.encode_chunk_alpha(base, count, buffer),
            self.encode_chunk_rgb(base, count, buffer, encoding),
            self.encode_chunk_scales(base, count, buffer, encoding),
            self.encode_chunk_orientation(base, count, buffer),
        ];

        if max_sh >= 1 {
            props.push(self.encode_chunk_sh(base, count, buffer, encoding, RadChunkPropertyName::Sh1));
        };

        if max_sh >= 2 {
            props.push(self.encode_chunk_sh(base, count, buffer, encoding, RadChunkPropertyName::Sh2));
        }

        if max_sh >= 3 {
            props.push(self.encode_chunk_sh(base, count, buffer, encoding, RadChunkPropertyName::Sh3));
        }

        if self.getter.has_lod_tree() {
            props.push(self.encode_chunk_child_count(base, count, buffer_u16));
            props.push(self.encode_chunk_child_start(base, count, buffer_usize));
        }

        let mut offset = 0u64;
        for (prop, data) in props.iter_mut() {
            prop.offset = offset;
            prop.bytes = data.len() as u64;
            offset += roundup8(data.len()) as u64;
        }
        let payload_bytes = offset;

        let mut meta = RadChunkMeta {
            version: 1,
            base: base as u64,
            count: count as u64,
            payload_bytes,
            max_sh: Some(self.getter.max_sh_degree().min(self.max_sh)),
            lod_tree: if self.getter.has_lod_tree() { Some(true) } else { None },
            splat_encoding: None,
            properties: props.iter().map(|(prop, _)| prop.clone()).collect::<Vec<_>>(),
        };
        if let Some(mut encoding) = self.encoding.clone().or_else(|| self.getter.get_encoding()) {
            encoding.lod_opacity = self.getter.has_lod_tree();
            meta.splat_encoding = Some(SetSplatEncoding::from(encoding));
        }

        let meta_bytes = serde_json::to_vec(&meta)?;

        let mut encoded = Vec::with_capacity(8 + roundup8(meta_bytes.len()) + 8 + payload_bytes as usize);
        encoded.extend(&RAD_CHUNK_MAGIC.to_le_bytes());

        encoded.extend((meta_bytes.len() as u32).to_le_bytes());
        encoded.extend(&meta_bytes);
        encoded.extend(&[0u8; 8][..pad8(meta_bytes.len())]);

        encoded.extend(payload_bytes.to_le_bytes());

        for (_prop, data) in props.iter() {
            encoded.extend(data);
            encoded.extend(&[0u8; 8][..pad8(data.len())]);
        }

        Ok(encoded)
    }
}

fn roundup8(size: usize) -> usize {
    (size + 7) & !7
}

fn pad8(size: usize) -> usize {
    (8 - (size & 7)) & 7
}

fn write_pad<W: Write>(writer: &mut W, size: usize) -> anyhow::Result<()> {
    let pad = pad8(size);
    if pad != 0 {
        let zero_pad = [0u8; 8];
        writer.write_all(&zero_pad[..pad as usize])?;
    }
    Ok(())
}

fn encode_f32(data: &[f32], dims: usize, count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(4 * dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            result.extend(data[index].to_le_bytes());
            index += dims;
        }
    }
    result
}

fn decode_f32(data: &[u8], dims: usize, count: usize) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        let mut index = i * 4;
        for _ in 0..dims {
            result.push(f32::from_le_bytes(data[index..index + 4].try_into().unwrap()));
            index += count * 4;
        }
    }
    result
}

fn encode_f16(data: &[f32], dims: usize, count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(2 * dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            result.extend(f16::from_f32(data[index]).to_le_bytes());
            index += dims;
        }
    }
    result
}

fn decode_f16(data: &[u8], dims: usize, count: usize) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        let mut index = i * 2;
        for _ in 0..dims {
            result.push(f16::from_le_bytes(data[index..index + 2].try_into().unwrap()).to_f32());
            index += count * 2;
        }
    }
    result
}

fn encode_f32_lebytes(data: &[f32], dims: usize, count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(4 * dims * count);
    for b in 0..4 {
        for d in 0..dims {
            let mut index = d;
            for _ in 0..count {
                result.push(data[index].to_le_bytes()[b]);
                index += dims;
            }
        }
    }
    result
}

fn decode_f32_lebytes(data: &[u8], dims: usize, count: usize) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    let stride = count * dims;
    for i in 0..count {
        for d in 0..dims {
            let index = count * d + i;
            result.push(f32::from_le_bytes(array::from_fn(|b| data[index + stride * b])));
        }
    }
    result
}

fn encode_f16_lebytes(data: &[f32], dims: usize, count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(2 * dims * count);
    for b in 0..2 {
        for d in 0..dims {
            let mut index = d;
            for _ in 0..count {
                result.push(f16::from_f32(data[index]).to_le_bytes()[b]);
                index += dims;
            }
        }
    }
    result
}

fn decode_f16_lebytes(data: &[u8], dims: usize, count: usize) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    let stride = count * dims;
    for i in 0..count {
        for d in 0..dims {
            let index = count * d + i;
            result.push(f16::from_le_bytes(array::from_fn(|b| data[index + stride * b])).to_f32());
        }
    }
    result
}

fn encode_r8(data: &[f32], dims: usize, count: usize, min: f32, max: f32) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            let value = (data[index] - min) / (max - min) * 255.0;
            result.push(value.clamp(0.0, 255.0).round() as u8);
            index += dims;
        }
    }
    result
}

fn _encode_r8_bits(data: &[f32], dims: usize, count: usize, min: f32, max: f32, bits: u8) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            let value = _quantize_sh_byte((data[index] - min) / (max - min) * 255.0, bits);
            result.push(value);
            index += dims;
        }
    }
    result
}

fn decode_r8(data: &[u8], dims: usize, count: usize, min: f32, max: f32) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        let mut index = i;
        for _ in 0..dims {
            result.push((data[index] as f32 / 255.0) * (max - min) + min);
            index += count;
        }
    }
    result
}

fn encode_s8(data: &[f32], dims: usize, count: usize, max: f32) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            let value = data[index] / max * 127.0;
            result.push(value.clamp(-127.0, 127.0).round() as i8 as u8);
            index += dims;
        }
    }
    result
}

fn decode_s8(data: &[u8], dims: usize, count: usize, max: f32) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        let mut index = i;
        for _ in 0..dims {
            result.push(((data[index] as i8) as f32 / 127.0) * max);
            index += count;
        }
    }
    result
}

fn encode_r8_delta(data: &[f32], dims: usize, count: usize, min: f32, max: f32) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        let mut last = 0;
        for _ in 0..count {
            let value = ((data[index] - min) / (max - min) * 255.0).clamp(0.0, 255.0).round() as u8;
            result.push(value.wrapping_sub(last));
            last = value;
            index += dims;
        }
    }
    result
}

fn decode_r8_delta(data: &[u8], dims: usize, count: usize, min: f32, max: f32) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    let mut last = vec![0u8; dims];
    for i in 0..count {
        let mut index = i;
        for d in 0..dims {
            let value = last[d].wrapping_add(data[index]);
            last[d] = value;
            result.push((value as f32 / 255.0) * (max - min) + min);
            index += count;
        }
    }
    result
}

fn encode_s8_delta(data: &[f32], dims: usize, count: usize, max: f32) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        let mut last = 0;
        for _ in 0..count {
            let value = (data[index] / max * 127.0).clamp(-127.0, 127.0).round() as i8 as u8;
            result.push(value.wrapping_sub(last));
            last = value;
            index += dims;
        }
    }
    result
}

fn decode_s8_delta(data: &[u8], dims: usize, count: usize, max: f32) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    let mut last = vec![0u8; dims];
    for i in 0..count {
        let mut index = i;
        for d in 0..dims {
            let value = last[d].wrapping_add(data[index]);
            last[d] = value;
            result.push(((value as i8) as f32 / 127.0) * max);
            index += count;
        }
    }
    result
}

fn encode_ln_0r8(data: &[f32], dims: usize, count: usize, zero: f32, min: f32, max: f32) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            result.push(encode_scale8_zero(data[index], zero, min, max));
            index += dims;
        }
    }
    result
}

fn decode_ln_0r8(data: &[u8], dims: usize, count: usize, min: f32, max: f32) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        let mut index = i;
        for _ in 0..dims {
            result.push(decode_scale8(data[index], min, max));
            index += count;
        }
    }
    result
}

fn encode_ln_f16(data: &[f32], dims: usize, count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(2 * dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            result.extend(f16::from_f32(data[index].ln()).to_le_bytes());
            index += dims;
        }
    }
    result
}

fn decode_ln_f16(data: &[u8], dims: usize, count: usize) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        let mut index = i * 2;
        for _ in 0..dims {
            result.push(f16::from_le_bytes([data[index], data[index + 1]]).to_f32().exp());
            index += count * 2;
        }
    }
    result
}

fn encode_quat_oct88r8(data: &[f32], count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(3 * count);
    for i in 0..count {
        let quat = array::from_fn(|d| data[i * 4 + d]);
        result.extend(splat_encode::encode_quat_oct888(quat));
    }
    result
}

fn decode_quat_oct88r8(data: &[u8], count: usize) -> Vec<f32> {
    let mut result = Vec::with_capacity(4 * count);
    for i in 0..count {
        let index = i * 3;
        result.extend(splat_encode::decode_quat_oct888([data[index], data[index + 1], data[index + 2]]));
    }
    result
}

fn encode_u16(data: &[u16], dims: usize, count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(2 * dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            result.extend(data[index].to_le_bytes());
            index += dims;
        }
    }
    result
}

fn decode_u16(data: &[u8], dims: usize, count: usize) -> Vec<u16> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        result.push(u16::from_le_bytes([data[i * 2], data[i * 2 + 1]]));
    }
    result
}

fn encode_usize_as_u32(data: &[usize], dims: usize, count: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(4 * dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            result.extend((data[index] as u32).to_le_bytes());
            index += dims;
        }
    }
    result
}

fn decode_u32_as_usize(data: &[u8], dims: usize, count: usize) -> Vec<usize> {
    let mut result = Vec::with_capacity(dims * count);
    for i in 0..count {
        result.push(u32::from_le_bytes(data[i * 4..i * 4 + 4].try_into().unwrap()) as usize);
    }
    result
}

fn _quantize_sh_byte(mut value: f32, bits: u8) -> u8 {
    let bucket = 1u32 << (8 - bits);
    value = ((value + (bucket as f32) / 2.0) / bucket as f32).floor() * bucket as f32;
    value.round().clamp(0.0, 255.0) as u8
}

pub fn decode_rad_header(bytes: &[u8]) -> anyhow::Result<Option<(RadMeta, u64)>> {
    if bytes.len() < 8 {
        return Ok(None);
    }

    let magic = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    if magic != RAD_MAGIC {
        return Err(anyhow::anyhow!("Invalid RAD magic: 0x{:08x}", magic));
    }

    let length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if bytes.len() < 8 + length {
        return Ok(None);
    }

    let meta: RadMeta = serde_json::from_slice(&bytes[8..8 + length])?;
    let chunks_start = (8 + roundup8(length)) as u64;
    Ok(Some((meta, chunks_start)))
}

pub struct RadDecoder<T: SplatReceiver> {
    splats: T,
    offset: u64,
    buffer: Vec<u8>,
    done: bool,
    meta: Option<RadMeta>,
    chunks_start: u64,
    chunk_index: usize,
    chunk_count: usize,
    chunk_size: usize,
    chunk_meta: Option<RadChunkMeta>,
    payload_start: u64,
    chunk_end: u64,
    prop_index: usize,
    base: usize,
    count: usize,
}

impl<T: SplatReceiver> RadDecoder<T> {
    pub fn new(splats: T) -> Self {
        Self {
            splats,
            offset: 0,
            buffer: Vec::new(),
            done: false,
            meta: None,
            chunks_start: 0,
            chunk_index: 0,
            chunk_count: 0,
            chunk_size: 0,
            chunk_meta: None,
            payload_start: 0,
            chunk_end: 0,
            prop_index: 0,
            base: 0,
            count: 0,
        }
    }

    pub fn into_splats(self) -> T {
        self.splats
    }

    fn poll(&mut self) -> anyhow::Result<()> {
        if self.done {
            return self.skip_remaining();
        }

        if self.meta.is_none() && self.chunk_meta.is_none() {
            if !self.poll_header()? {
                return Ok(());
            }
        }

        if self.meta.is_some() {
            // Stream is a RAD file with multiple chunks
            while self.chunk_index < self.chunk_count {
                if self.chunk_meta.is_none() {
                    if !self.poll_chunk_header()? {
                        return Ok(());
                    }
                }

                if !self.poll_chunk_props()? {
                    return Ok(());
                }

                if !self.skip_to_chunk_end()? {
                    return Ok(());
                }
                self.chunk_meta = None;
                self.chunk_index += 1;
            }

            self.done = true;
            return self.skip_remaining();
        } else {
            // Stream consists of a single RAD chunk
            if !self.poll_chunk_props()? {
                return Ok(());
            }

            if !self.skip_to_chunk_end()? {
                return Ok(());
            }
            self.done = true;
            return self.skip_remaining();
        }
    }

    fn poll_header(&mut self) -> anyhow::Result<bool> {
        if self.buffer.len() < 4 { 
            return Ok(false);
        }

        let magic = u32::from_le_bytes(self.buffer[0..4].try_into().unwrap());
        if magic == RAD_CHUNK_MAGIC {
            return self.poll_chunk_header();
        }

        if magic != RAD_MAGIC {
            return Err(anyhow::anyhow!("Invalid RAD magic: 0x{:08x}", magic));
        }

        if self.buffer.len() < 8 {
            return Ok(false);
        }

        let length = u32::from_le_bytes(self.buffer[4..8].try_into().unwrap()) as usize;
        let meta_end = 8 + roundup8(length);
        if self.buffer.len() < meta_end {
            return Ok(false);
        }

        let meta: RadMeta = serde_json::from_slice(&self.buffer[8..8 + length])?;

        self.buffer.drain(..meta_end);
        self.offset += meta_end as u64;
        self.chunks_start = self.offset;

        self.parse_meta(meta)?;
        Ok(true)
    }

    fn parse_meta(&mut self, meta: RadMeta) -> anyhow::Result<()> {
        if meta.version != 1 {
            return Err(anyhow::anyhow!("Unsupported RAD version: {}", meta.version));
        }

        if meta.ty != RadType::Gsplat {
            return Err(anyhow::anyhow!("Unsupported RAD type: {:?}", meta.ty));
        }

        let num_splats = meta.count as usize;
        let max_sh_degree = meta.max_sh.unwrap_or(0);
        let lod_tree = meta.lod_tree.unwrap_or(false);
        self.chunk_size = meta.chunk_size.unwrap_or(num_splats);
        self.chunk_count = meta.chunks.len();
        if self.chunk_count != num_splats.div_ceil(self.chunk_size) {
            return Err(anyhow::anyhow!("Invalid chunk count: expected {}, got {}", num_splats.div_ceil(self.chunk_size), self.chunk_count));
        }

        self.splats.init_splats(&SplatInit {
            num_splats,
            max_sh_degree,
            lod_tree,
        })?;

        if let Some(set_splat_encoding) = meta.splat_encoding.as_ref() {
            self.splats.set_encoding(set_splat_encoding)?;
        }

        if lod_tree {
            self.splats.set_encoding(&SetSplatEncoding {
                lod_opacity: Some(true),
                ..Default::default()
            })?;
        }

        self.meta = Some(meta);
        Ok(())
    }

    fn parse_chunk_meta(&mut self, chunk_meta: RadChunkMeta, payload_start: u64, chunk_end: u64) -> anyhow::Result<()> {
        self.payload_start = payload_start;
        self.chunk_end = chunk_end;

        if chunk_meta.version != 1 {
            return Err(anyhow::anyhow!("Unsupported RAD chunk version: {}", chunk_meta.version));
        }

        self.base = chunk_meta.base as usize;
        self.count = chunk_meta.count as usize;

        if self.meta.is_none() {
            // Reading a chunk in isolation, rebase so first splat is at index 0
            self.base = 0;

            self.splats.init_splats(&SplatInit {
                num_splats: self.count,
                max_sh_degree: chunk_meta.max_sh.unwrap_or(0),
                lod_tree: chunk_meta.lod_tree.unwrap_or(false),
            })?;
        }

        self.prop_index = 0;
        self.chunk_meta = Some(chunk_meta);
        Ok(())
    }

    fn poll_chunk_header(&mut self) -> anyhow::Result<bool> {
        if self.buffer.len() < 4 { 
            return Ok(false);
        }

        let magic = u32::from_le_bytes(self.buffer[0..4].try_into().unwrap());
        if magic != RAD_CHUNK_MAGIC {
            return Err(anyhow::anyhow!("Invalid RAD chunk magic: 0x{:08x}", magic));
        }

        if self.buffer.len() < 8 {
            return Ok(false);
        }

        let length = u32::from_le_bytes(self.buffer[4..8].try_into().unwrap()) as usize;
        let meta_end = 8 + roundup8(length);
        if self.buffer.len() < (meta_end + 8) {
            return Ok(false);
        }

        let meta: RadChunkMeta = serde_json::from_slice(&self.buffer[8..8 + length])?;
        let payload_bytes = u64::from_le_bytes(self.buffer[meta_end..meta_end + 8].try_into().unwrap());

        self.buffer.drain(..meta_end + 8);
        self.offset += (meta_end + 8) as u64;
        let payload_start = self.offset;
        let chunk_end = self.offset + payload_bytes;

        self.parse_chunk_meta(meta, payload_start, chunk_end)?;
        Ok(true)
    }

    fn poll_chunk_props(&mut self) -> anyhow::Result<bool> {
        let props = &self.chunk_meta.as_ref().unwrap().properties;
        loop {
            if self.prop_index >= props.len() {
                return Ok(true);
            }
            let prop = &props[self.prop_index];

            if (self.payload_start + prop.offset) != self.offset {
                return Err(anyhow::anyhow!("Property offset mismatch: expected {}, got {}", self.offset, self.payload_start + prop.offset));
            }

            if self.buffer.len() < roundup8(prop.bytes as usize) {
                return Ok(false);
            }

            let data = &self.buffer[0..prop.bytes as usize];
            let data = if let Some(compression) = prop.compression.as_ref() {
                match compression {
                    RadChunkPropertyCompression::Gz => &decompress_to_vec(data).map_err(|_e| anyhow::anyhow!("Failed to decompress gz data"))?,
                    // _ => return Err(anyhow::anyhow!("Unsupported compression: {:?}", compression)),
                }
            } else {
                data
            };

            match prop.property {
                RadChunkPropertyName::Center => {
                    let centers = match prop.encoding {
                        RadChunkPropertyEncoding::F32 => decode_f32(data, 3, self.count),
                        RadChunkPropertyEncoding::F16 => decode_f16(data, 3, self.count),
                        RadChunkPropertyEncoding::F32LeBytes => decode_f32_lebytes(data, 3, self.count),
                        RadChunkPropertyEncoding::F16LeBytes => decode_f16_lebytes(data, 3, self.count),
                        _ => return Err(anyhow::anyhow!("Unsupported center encoding: {:?}", prop.encoding)),
                    };
                    self.splats.set_center(self.base, self.count, &centers);
                },
                RadChunkPropertyName::Alpha => {
                    let alphas = match prop.encoding {
                        RadChunkPropertyEncoding::F32 => decode_f32(data, 1, self.count),
                        RadChunkPropertyEncoding::F16 => decode_f16(data, 1, self.count),
                        RadChunkPropertyEncoding::R8 => {
                            let Some(min) = prop.min else {
                                return Err(anyhow::anyhow!("Property missing min"));
                            };
                            let Some(max) = prop.max else {
                                return Err(anyhow::anyhow!("Property missing max"));
                            };
                            decode_r8(data, 1, self.count, min, max)
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported alpha encoding: {:?}", prop.encoding)),
                    };
                    self.splats.set_opacity(self.base, self.count, &alphas);
                },
                RadChunkPropertyName::Rgb => {
                    let rgbs = match prop.encoding {
                        RadChunkPropertyEncoding::F32 => decode_f32(data, 3, self.count),
                        RadChunkPropertyEncoding::F16 => decode_f16(data, 3, self.count),
                        RadChunkPropertyEncoding::R8 | RadChunkPropertyEncoding::R8Delta => {
                            let Some(min) = prop.min else {
                                return Err(anyhow::anyhow!("Property missing min"));
                            };
                            let Some(max) = prop.max else {
                                return Err(anyhow::anyhow!("Property missing max"));
                            };
                            if prop.encoding == RadChunkPropertyEncoding::R8 {
                                decode_r8(data, 3, self.count, min, max)
                            } else {
                                decode_r8_delta(data, 3, self.count, min, max)
                            }
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported rgb encoding: {:?}", prop.encoding)),
                    };
                    self.splats.set_rgb(self.base, self.count, &rgbs);
                },
                RadChunkPropertyName::Scales => {
                    let scales = match prop.encoding {
                        RadChunkPropertyEncoding::F32 => decode_f32(data, 3, self.count),
                        RadChunkPropertyEncoding::LnF16 => decode_ln_f16(data, 3, self.count),
                        RadChunkPropertyEncoding::Ln0R8 => {
                            let Some(min) = prop.min else {
                                return Err(anyhow::anyhow!("Property missing min"));
                            };
                            let Some(max) = prop.max else {
                                return Err(anyhow::anyhow!("Property missing max"));
                            };
                            decode_ln_0r8(data, 3, self.count, min, max)
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported scales encoding: {:?}", prop.encoding)),
                    };
                    self.splats.set_scale(self.base, self.count, &scales);
                },
                RadChunkPropertyName::Orientation => {
                    let quaternions = if prop.encoding == RadChunkPropertyEncoding::Oct88R8 {
                        decode_quat_oct88r8(data, self.count)
                    } else {
                        let xyzs = match prop.encoding {
                            RadChunkPropertyEncoding::F32 => decode_f32(data, 3, self.count),
                            RadChunkPropertyEncoding::F16 => decode_f16(data, 3, self.count),
                            _ => return Err(anyhow::anyhow!("Unsupported orientation encoding: {:?}", prop.encoding)),
                        };
                        let mut quaternions = Vec::with_capacity(4 * self.count);
                        for i in 0..self.count {
                            let xyz: [f32; 3] = array::from_fn(|d| xyzs[i * 3 + d]);
                            let w = (1.0 - xyz[0].powi(2) - xyz[1].powi(2) - xyz[2].powi(2)).max(0.0).sqrt();
                            quaternions.extend([xyz[0], xyz[1], xyz[2], w]);
                        }
                        quaternions
                    };
                    self.splats.set_quat(self.base, self.count, &quaternions);
                },
                RadChunkPropertyName::Sh1 | RadChunkPropertyName::Sh2 | RadChunkPropertyName::Sh3 => {
                    let elements = match prop.property {
                        RadChunkPropertyName::Sh1 => 9,
                        RadChunkPropertyName::Sh2 => 15,
                        RadChunkPropertyName::Sh3 => 21,
                        _ => unreachable!()
                    };
                    let shs = match prop.encoding {
                        RadChunkPropertyEncoding::F32 => decode_f32(data, elements, self.count),
                        RadChunkPropertyEncoding::F16 => decode_f16(data, elements, self.count),
                        RadChunkPropertyEncoding::R8 | RadChunkPropertyEncoding::R8Delta => {
                            let Some(min) = prop.min else {
                                return Err(anyhow::anyhow!("Property missing min"));
                            };
                            let Some(max) = prop.max else {
                                return Err(anyhow::anyhow!("Property missing max"));
                            };
                            if prop.encoding == RadChunkPropertyEncoding::R8 {
                                decode_r8(data, elements, self.count, min, max)
                            } else {
                                decode_r8_delta(data, elements, self.count, min, max)
                            }
                        },
                        RadChunkPropertyEncoding::S8 | RadChunkPropertyEncoding::S8Delta => {
                            let Some(max) = prop.max else {
                                return Err(anyhow::anyhow!("Property missing max"));
                            };
                            if prop.encoding == RadChunkPropertyEncoding::S8 {
                                decode_s8(data, elements, self.count, max)
                            } else {
                                decode_s8_delta(data, elements, self.count, max)
                            }
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported sh encoding: {:?}", prop.encoding)),
                    };
                    match prop.property {
                        RadChunkPropertyName::Sh1 => self.splats.set_sh1(self.base, self.count, &shs),
                        RadChunkPropertyName::Sh2 => self.splats.set_sh2(self.base, self.count, &shs),
                        RadChunkPropertyName::Sh3 => self.splats.set_sh3(self.base, self.count, &shs),
                        _ => unreachable!()
                    }
                },
                RadChunkPropertyName::ChildCount => {
                    if prop.encoding != RadChunkPropertyEncoding::U16 {
                        return Err(anyhow::anyhow!("Unsupported child count encoding: {:?}", prop.encoding));
                    }
                    let child_counts = decode_u16(data, 1, self.count);
                    self.splats.set_child_count(self.base, self.count, &child_counts);
                },
                RadChunkPropertyName::ChildStart => {
                    if prop.encoding != RadChunkPropertyEncoding::U32 {
                        return Err(anyhow::anyhow!("Unsupported child start encoding: {:?}", prop.encoding));
                    }
                    let child_starts = decode_u32_as_usize(data, 1, self.count);
                    self.splats.set_child_start(self.base, self.count, &child_starts);
                },
                // _ => return Err(anyhow::anyhow!("Unknown property type: {:?}", prop.property)),
            }

            self.buffer.drain(..roundup8(prop.bytes as usize));
            self.offset += roundup8(prop.bytes as usize) as u64;
            self.prop_index += 1;
        }
    }

    fn skip_to_chunk_end(&mut self) -> anyhow::Result<bool> {
        if self.offset >= self.chunk_end {
            return Ok(true);
        }

        let remaining = self.chunk_end - self.offset;
        let available = remaining.min(self.buffer.len() as u64);
        self.buffer.drain(..available as usize);
        self.offset += available;

        return Ok(self.offset >= self.chunk_end);
    }

    fn skip_remaining(&mut self) -> anyhow::Result<()> {
        self.offset += self.buffer.len() as u64;
        self.buffer.clear();
        Ok(())
    }
}

impl<T: SplatReceiver> ChunkReceiver for RadDecoder<T> {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        self.buffer.extend_from_slice(bytes);
        self.poll()?;
        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        self.poll()?;
        if !self.done {
            return Err(anyhow::anyhow!("Incomplete RAD chunk"));
        }
        self.splats.finish()?;
        Ok(())
    }
}
