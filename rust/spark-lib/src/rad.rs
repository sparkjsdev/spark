use std::array;
use std::io::Write;

use half::f16;

use serde_json::json;

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
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RadCenterEncoding {
    F32,
    F32LeBytes,
    F16,
    F16LeBytes,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RadAlphaEncoding {
    F32,
    F16,
    R8,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RadRgbEncoding {
    F32,
    F16,
    R8,
    R8Delta,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RadScalesEncoding {
    F32,
    Ln0R8,
    LnF16,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RadOrientationEncoding {
    F32,
    F16,
    Oct88R8,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RadShEncoding {
    F32,
    F16,
    R8,
}

impl<T: SplatGetter> RadEncoder<T> {
    pub fn new(getter: T) -> Self {
        Self {
            getter,
            encoding: None,
            max_sh: 3,
            center_encoding: RadCenterEncoding::F32LeBytes,
            alpha_encoding: RadAlphaEncoding::F16,
            rgb_encoding: RadRgbEncoding::R8Delta,
            scales_encoding: RadScalesEncoding::Ln0R8,
            orientation_encoding: RadOrientationEncoding::Oct88R8,
            sh_encoding: RadShEncoding::R8,
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

    pub fn encode<W: Write>(&mut self, writer: &mut W) -> anyhow::Result<()> {
        const PRETTY: bool = true;
        const CHUNK_SIZE: usize = 65536;

        let num_splats = self.getter.num_splats();
        let max_sh = self.getter.max_sh_degree().min(self.max_sh);
        let encoding = self.encoding.clone().or_else(|| self.getter.get_encoding()).unwrap_or(SplatEncoding::default());

        // // let check_center = self.center_encoding.is_none();
        // let check_rgb = encoding.is_none() && self.rgb_encoding.map(|e| e == RadRgbEncoding::R8 || e == RadRgbEncoding::R8Delta).unwrap_or(true);
        // let check_scales = encoding.is_none() && self.scales_encoding.map(|e| e == RadScalesEncoding::Ln0R8).unwrap_or(true);
        // let check_sh = (max_sh > 0) && encoding.is_none() && self.sh_encoding.map(|e| e == RadShEncoding::R8).unwrap_or(true);

        // if check_center || check_rgb || check_scales || check_sh {
        //     // We need to do a pass over the data to determine the minimal encoding
        //     let mut batch = SplatPropsMut {
        //         center: &mut if check_center { vec![0.0; CHUNK_SIZE * 3] } else { vec![] },
        //         opacity: &mut [],
        //         rgb: &mut if check_rgb { vec![0.0; CHUNK_SIZE * 3] } else { vec![] },
        //         scale: &mut if check_scales { vec![0.0; CHUNK_SIZE * 3] } else { vec![] },
        //         quat: &mut [],
        //         sh1: &mut if check_sh { vec![0.0; CHUNK_SIZE * 9] } else { vec![] },
        //         sh2: &mut if check_sh { vec![0.0; CHUNK_SIZE * 15] } else { vec![] },
        //         sh3: &mut if check_sh { vec![0.0; CHUNK_SIZE * 21] } else { vec![] },
        //         child_count: &mut [],
        //         child_start: &mut [],
        //     };

        //     let mut base = 0;
        //     // let mut max_coord = f32::NEG_INFINITY;
        //     let mut min_rgb = f32::INFINITY;
        //     let mut max_rgb = f32::NEG_INFINITY;
        //     let mut min_scale = f32::INFINITY;
        //     let mut max_scale = f32::NEG_INFINITY;
        //     let mut max_sh1 = f32::NEG_INFINITY;
        //     let mut max_sh2 = f32::NEG_INFINITY;
        //     let mut max_sh3 = f32::NEG_INFINITY;

        //     while base < num_splats {
        //         let count = CHUNK_SIZE.min(num_splats - base);
        //         self.getter.get_batch(base, count, &mut batch);

        //         for i in 0..count {
        //             for d in 0..3 {
        //                 // if check_center {
        //                 //     let coord = batch.center[i * 3 + d];
        //                 //     max_coord = max_coord.max(coord.abs());
        //                 // }
        //                 if check_rgb {
        //                     let value = batch.rgb[i * 3 + d];
        //                     min_rgb = min_rgb.min(value);
        //                     max_rgb = max_rgb.max(value);
        //                 }
        //                 if check_scales {
        //                     let scale = batch.scale[i * 3 + d].max()
        //                     min_scale = min_scale.min(scale);
        //                     max_scale = max_scale.max(scale);
        //                 }
        //             }
        //             if check_sh {
        //                 for d in 0..9 {
        //                     let value = batch.sh1[i * 9 + d];
        //                     max_sh1 = max_sh1.max(value.abs());
        //                 }
        //                 for d in 0..15 {
        //                     let value = batch.sh2[i * 15 + d];
        //                     max_sh2 = max_sh2.max(value.abs());
        //                 }
        //                 for d in 0..21 {
        //                     let value = batch.sh3[i * 21 + d];
        //                     max_sh3 = max_sh3.max(value.abs());
        //                 }
        //             }
        //         }

        //         base += count;
        //     }
        // }

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
        let chunks: anyhow::Result<Vec<_>> = (0..num_chunks).map(|chunk_index| {
            let base = chunk_index * CHUNK_SIZE;
            let count = (num_splats - base).min(CHUNK_SIZE);
            self.encode_chunk(base, count, &encoding, &mut buffer, &mut buffer_u16, &mut buffer_usize)
        }).collect();
        let chunks = chunks?;

        let mut offset = 0;
        let chunk_ranges: Vec<_> = chunks.iter().map(|chunk| {
            let chunk_range = json!({
                "offset": offset,
                "bytes": chunk.len(),
            });
            offset += chunk.len();
            chunk_range
        }).collect();
        let all_chunk_bytes = offset;

        let mut meta = serde_json::json!({
            "version": 1,
            "type": "gsplat",
            "count": num_splats,
            "maxSh": max_sh,
            "lodTree": self.getter.has_lod_tree(),
            "chunkSize": CHUNK_SIZE,
            "allChunkBytes": all_chunk_bytes,
            "chunks": chunk_ranges,
        });
        if let Some(mut encoding) = self.encoding.clone().or_else(|| self.getter.get_encoding()) {
            encoding.lod_opacity = self.getter.has_lod_tree();
            meta["splatEncoding"] = json!(encoding);
        }
        // println!("meta: {:?}", meta);
        let meta_bytes = if PRETTY {
            let mut meta_bytes = serde_json::to_vec_pretty(&meta)?;
            meta_bytes.push(b'\n');
            meta_bytes
        } else {
            serde_json::to_vec(&meta)?
        };
        let meta_bytes_size = meta_bytes.len();
        // println!("meta_bytes_len: {}", meta_bytes_size);

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

    fn encode_chunk_center(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count * 3 {
            buffer.resize(count * 3, 0.0);
        }
        self.getter.get_center(base, count, &mut buffer[..count * 3]);

        let (enc, bytes) = match self.center_encoding {
            RadCenterEncoding::F32 => ("f32", encode_f32(&buffer, 3, count)),
            RadCenterEncoding::F16 => ("f16", encode_f16(&buffer, 3, count)),
            RadCenterEncoding::F32LeBytes => ("f32_lebytes", encode_f32_lebytes(&buffer, 3, count)),
            RadCenterEncoding::F16LeBytes => ("f16_lebytes", encode_f16_lebytes(&buffer, 3, count)),
        };
        let meta = json!({ "property": "center", "encoding": enc, "compression": "gz" });
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_alpha(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count {
            buffer.resize(count, 0.0);
        }
        self.getter.get_opacity(base, count, &mut buffer[..count]);

        let max_alpha = if self.getter.has_lod_tree() { 2.0 } else { 1.0 };
        let (enc, bytes) = match self.alpha_encoding {
            RadAlphaEncoding::F32 => ("f32", encode_f32(&buffer, 1, count)),
            RadAlphaEncoding::F16 => ("f16", encode_f16(&buffer, 1, count)),
            RadAlphaEncoding::R8 => ("r8", encode_r8(&buffer, 1, count, 0.0, max_alpha)),
        };
        let meta = match self.alpha_encoding {
            RadAlphaEncoding::F32 | RadAlphaEncoding::F16 => json!({ "property": "alpha", "encoding": enc, "compression": "gz" }),
            RadAlphaEncoding::R8 => json!({ "property": "alpha", "encoding": enc, "compression": "gz", "min": 0.0, "max": max_alpha }),
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_rgb(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count * 3 {
            buffer.resize(count * 3, 0.0);
        }
        self.getter.get_rgb(base, count, &mut buffer[..count * 3]);

        let (enc, bytes) = match self.rgb_encoding {
            RadRgbEncoding::F32 => ("f32", encode_f32(&buffer, 3, count)),
            RadRgbEncoding::F16 => ("f16", encode_f16(&buffer, 3, count)),
            RadRgbEncoding::R8 => ("r8", encode_r8(&buffer, 3, count, encoding.rgb_min, encoding.rgb_max)),
            RadRgbEncoding::R8Delta => ("r8_delta", encode_r8_delta(&buffer, 3, count, encoding.rgb_min, encoding.rgb_max)),
        };
        let meta = match self.rgb_encoding {
            RadRgbEncoding::F32 | RadRgbEncoding::F16 => json!({ "property": "rgb", "encoding": enc, "compression": "gz" }),
            RadRgbEncoding::R8 | RadRgbEncoding::R8Delta => json!({ "property": "rgb", "encoding": enc, "compression": "gz", "min": encoding.rgb_min, "max": encoding.rgb_max }),
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_scales(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count * 3 {
            buffer.resize(count * 3, 0.0);
        }
        self.getter.get_scale(base, count, &mut buffer[..count * 3]);

        let (enc, bytes) = match self.scales_encoding {
            RadScalesEncoding::F32 => ("f32", encode_f32(&buffer, 3, count)),
            RadScalesEncoding::Ln0R8 => ("ln_0r8", encode_ln_0r8(&buffer, 3, count, -30.0, encoding.ln_scale_min, encoding.ln_scale_max)),
            RadScalesEncoding::LnF16 => ("ln_f16", encode_ln_f16(&buffer, 3, count)),
        };
        let meta = match self.scales_encoding {
            RadScalesEncoding::F32 | RadScalesEncoding::LnF16 => json!({ "property": "scales", "encoding": enc, "compression": "gz" }),
            RadScalesEncoding::Ln0R8 => json!({ "property": "scales", "encoding": enc, "compression": "gz", "min": encoding.ln_scale_min, "max": encoding.ln_scale_max }),
        };
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_orientation(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count * 4 {
            buffer.resize(count * 4, 0.0);
        }
        self.getter.get_quat(base, count, &mut buffer[..count * 4]);

        if self.orientation_encoding == RadOrientationEncoding::Oct88R8 {
            let bytes = encode_quat_oct88r8(&buffer, count);
            let meta = json!({ "property": "orientation", "encoding": "oct88r8", "compression": "gz" });
            (meta, compress_to_vec(&bytes, GZ_LEVEL))
        } else {
            for i in 0..count {
                for d in 0..3 {
                    buffer[i * 3 + d] = buffer[i * 4 + d];
                }
            }
            let (enc, bytes) = match self.orientation_encoding {
                RadOrientationEncoding::F32 => ("f32", encode_f32(&buffer, 3, count)),
                RadOrientationEncoding::F16 => ("f16", encode_f16(&buffer, 3, count)),
                _ => unreachable!(),
            };
            let meta = json!({ "property": "orientation", "encoding": enc, "compression": "gz" });
            (meta, compress_to_vec(&bytes, GZ_LEVEL))
        }
    }

    fn encode_chunk_sh1(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count * 9 {
            buffer.resize(count * 9, 0.0);
        }
        self.getter.get_sh1(base, count, &mut buffer[..count * 9]);

        let (enc, bytes) = match self.sh_encoding {
            RadShEncoding::F32 => ("f32", encode_f32(&buffer, 9, count)),
            RadShEncoding::F16 => ("f16", encode_f16(&buffer, 9, count)),
            RadShEncoding::R8 => ("r8", encode_r8(&buffer, 9, count, encoding.sh1_min, encoding.sh1_max)),
        };
        let meta = json!({ "property": "sh1", "encoding": enc, "compression": "gz", "min": encoding.sh1_min, "max": encoding.sh1_max });
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_sh2(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count * 15 {
            buffer.resize(count * 15, 0.0);
        }
        self.getter.get_sh2(base, count, &mut buffer[..count * 15]);
        
        let (enc, bytes) = match self.sh_encoding {
            RadShEncoding::F32 => ("f32", encode_f32(&buffer, 15, count)),
            RadShEncoding::F16 => ("f16", encode_f16(&buffer, 15, count)),
            RadShEncoding::R8 => ("r8", encode_r8(&buffer, 15, count, encoding.sh2_min, encoding.sh2_max)),
        };
        let meta = json!({ "property": "sh2", "encoding": enc, "compression": "gz", "min": encoding.sh2_min, "max": encoding.sh2_max });
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_sh3(&mut self, base: usize, count: usize, buffer: &mut Vec<f32>, encoding: &SplatEncoding) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count * 21 {
            buffer.resize(count * 21, 0.0);
        }
        self.getter.get_sh3(base, count, &mut buffer[..count * 21]);
        
        let (enc, bytes) = match self.sh_encoding {
            RadShEncoding::F32 => ("f32", encode_f32(&buffer, 21, count)),
            RadShEncoding::F16 => ("f16", encode_f16(&buffer, 21, count)),
            RadShEncoding::R8 => ("r8", encode_r8(&buffer, 21, count, encoding.sh3_min, encoding.sh3_max)),
        };
        let meta = json!({ "property": "sh3", "encoding": enc, "compression": "gz", "min": encoding.sh3_min, "max": encoding.sh3_max });
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_child_count(&mut self, base: usize, count: usize, buffer: &mut Vec<u16>) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count {
            buffer.resize(count, 0);
        }
        self.getter.get_child_count(base, count, &mut buffer[..count]);

        let bytes = encode_u16(&buffer, 1, count);
        let meta = json!({ "property": "child_count", "encoding": "u16", "compression": "gz" });
        (meta, compress_to_vec(&bytes, GZ_LEVEL))
    }

    fn encode_chunk_child_start(&mut self, base: usize, count: usize, buffer: &mut Vec<usize>) -> (serde_json::Value, Vec<u8>) {
        if buffer.len() < count {
            buffer.resize(count, 0);
        }
        self.getter.get_child_start(base, count, &mut buffer[..count]);

        let bytes = encode_usize_as_u32(&buffer, 1, count);
        let meta = json!({ "property": "child_start", "encoding": "u32", "compression": "gz" });
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
            props.push(self.encode_chunk_sh1(base, count, buffer, encoding));
        };

        if max_sh >= 2 {
            props.push(self.encode_chunk_sh2(base, count, buffer, encoding));
        }

        if max_sh >= 3 {
            props.push(self.encode_chunk_sh3(base, count, buffer, encoding));
        }

        if self.getter.has_lod_tree() {
            props.push(self.encode_chunk_child_count(base, count, buffer_u16));
            props.push(self.encode_chunk_child_start(base, count, buffer_usize));
        }

        let mut offset = 0;
        for (prop, data) in props.iter_mut() {
            let prop = prop.as_object_mut().unwrap();
            prop.insert("offset".to_string(), json!(offset));
            prop.insert("bytes".to_string(), json!(data.len()));
            offset += roundup8(data.len());
        }
        let payload_bytes = offset;

        let meta = serde_json::json!({
            "version": 1,
            "base": base,
            "count": count,
            "payloadBytes": payload_bytes,
            "properties": props.iter().map(|(prop, _)| prop).collect::<Vec<_>>(),
        });
        // println!("chunk meta: {:?}", meta);
        let meta_bytes = serde_json::to_vec(&meta)?;

        let mut encoded = Vec::with_capacity(8 + roundup8(meta_bytes.len()) + 8 + payload_bytes);
        encoded.extend(&RAD_CHUNK_MAGIC.to_le_bytes());

        encoded.extend((meta_bytes.len() as u32).to_le_bytes());
        encoded.extend(&meta_bytes);
        encoded.extend(&[0u8; 8][..pad8(meta_bytes.len())]);

        encoded.extend((payload_bytes as u64).to_le_bytes());

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

fn encode_r8_bits(data: &[f32], dims: usize, count: usize, min: f32, max: f32, bits: u8) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        for _ in 0..count {
            let value = quantize_sh_byte((data[index] - min) / (max - min) * 255.0, bits);
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

fn encode_r8_delta(data: &[f32], dims: usize, count: usize, min: f32, max: f32) -> Vec<u8> {
    let mut result = Vec::with_capacity(dims * count);
    for d in 0..dims {
        let mut index = d;
        let mut last = 0;
        for _ in 0..count {
            let value = ((data[index] - min) / (max - min) * 255.0).clamp(0.0, 255.0).round() as u8;
            result.push(value - last);
            last = value;
            index += dims;
        }
    }
    result
}

fn decode_r8_delta(data: &[u8], dims: usize, count: usize, min: f32, max: f32) -> Vec<f32> {
    let mut result = Vec::with_capacity(dims * count);
    let mut last = vec![0; dims];
    for i in 0..count {
        let mut index = i;
        for d in 0..dims {
            let value = last[d] + data[index];
            last[d] = value;
            result.push((value as f32 / 255.0) * (max - min) + min);
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

fn quantize_sh_byte(mut value: f32, bits: u8) -> u8 {
    let bucket = 1u32 << (8 - bits);
    value = ((value + (bucket as f32) / 2.0) / bucket as f32).floor() * bucket as f32;
    value.round().clamp(0.0, 255.0) as u8
}


pub struct RadDecoder<T: SplatReceiver> {
    splats: T,
    offset: u64,
    buffer: Vec<u8>,
    done: bool,
    meta: serde_json::Value,
    chunk_index: usize,
    chunk_count: usize,
    chunk_size: usize,
    chunk_meta: serde_json::Value,
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
            meta: serde_json::Value::Null,
            chunk_index: 0,
            chunk_count: 0,
            chunk_size: 0,
            chunk_meta: serde_json::Value::Null,
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

        if self.meta.is_null() && self.chunk_meta.is_null() {
            if !self.poll_header()? {
                return Ok(());
            }
        }

        if self.meta.is_object() {
            // Stream is a RAD file with multiple chunks
            while self.chunk_index < self.chunk_count {
                if self.chunk_meta.is_null() {
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
                self.chunk_meta = serde_json::Value::Null;
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

        let meta = serde_json::from_slice(&self.buffer[8..8 + length])?;

        self.buffer.drain(..meta_end);
        self.offset += meta_end as u64;

        self.parse_meta(meta)?;
        Ok(true)
    }

    fn parse_meta(&mut self, meta: serde_json::Value) -> anyhow::Result<()> {
        if !meta.is_object() {
            return Err(anyhow::anyhow!("Invalid RAD meta: {:?}", self.meta));
        }
        self.meta = meta;

        let version = self.meta.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
        if version != 1 {
            return Err(anyhow::anyhow!("Unsupported RAD version: {}", version));
        }

        let ty = self.meta.get("type").and_then(|v| v.as_str()).ok_or(anyhow::anyhow!("Missing RAD type"))?;
        if ty != "gsplat" {
            return Err(anyhow::anyhow!("Unsupported RAD type: {}", ty));
        }

        let num_splats = self.meta.get("count").and_then(|v| v.as_u64()).ok_or(anyhow::anyhow!("Missing count"))? as usize;
        let max_sh_degree = self.meta.get("maxSh").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let lod_tree = self.meta.get("lodTree").and_then(|v| v.as_bool()).unwrap_or(false);
        self.chunk_size = self.meta.get("chunkSize").and_then(|v| v.as_u64()).unwrap_or(num_splats as u64) as usize;

        self.chunk_count = self.meta.get("chunks").and_then(|v| v.as_array()).ok_or(anyhow::anyhow!("Missing chunks"))?.len();
        if self.chunk_count != num_splats.div_ceil(self.chunk_size) {
            return Err(anyhow::anyhow!("Invalid chunk count: expected {}, got {}", num_splats.div_ceil(self.chunk_size), self.chunk_count));
        }

        self.splats.init_splats(&SplatInit {
            num_splats,
            max_sh_degree,
            lod_tree,
        })?;

        if let Some(splat_encoding_value) = self.meta.get("splatEncoding") {
            let set_splat_encoding: SetSplatEncoding = serde_json::from_value(splat_encoding_value.clone())?;
            self.splats.set_encoding(&set_splat_encoding)?;
        }

        if lod_tree {
            self.splats.set_encoding(&SetSplatEncoding {
                lod_opacity: Some(true),
                ..Default::default()
            })?;
        }

        Ok(())
    }

    fn parse_chunk_meta(&mut self, chunk_meta: serde_json::Value, payload_start: u64, chunk_end: u64) -> anyhow::Result<()> {
        if !chunk_meta.is_object() {
            return Err(anyhow::anyhow!("Invalid RAD chunk meta: {:?}", self.chunk_meta));
        }
        self.chunk_meta = chunk_meta;
        self.payload_start = payload_start;
        self.chunk_end = chunk_end;

        let version = self.chunk_meta.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
        if version != 1 {
            return Err(anyhow::anyhow!("Unsupported RAD chunk version: {}", version));
        }

        self.base = self.chunk_meta.get("base").and_then(|v| v.as_u64()).ok_or(anyhow::anyhow!("Missing base"))? as usize;
        self.count = self.chunk_meta.get("count").and_then(|v| v.as_u64()).ok_or(anyhow::anyhow!("Missing count"))? as usize;

        if self.meta.is_null() {
            // Reading a chunk in isolation, rebase so first splat is at index 0
            self.base = 0;
        }

        let props = self.chunk_meta.get("properties").ok_or(anyhow::anyhow!("Missing properties"))?;
        if !props.is_array() {
            return Err(anyhow::anyhow!("Invalid properties: {:?}", props));
        }
        self.prop_index = 0;

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

        let meta = serde_json::from_slice(&self.buffer[8..8 + length])?;
        let payload_bytes = u64::from_le_bytes(self.buffer[meta_end..meta_end + 8].try_into().unwrap());

        self.buffer.drain(..meta_end + 8);
        self.offset += (meta_end + 8) as u64;
        let payload_start = self.offset;
        let chunk_end = self.offset + payload_bytes;

        self.parse_chunk_meta(meta, payload_start, chunk_end)?;
        Ok(true)
    }

    fn poll_chunk_props(&mut self) -> anyhow::Result<bool> {
        let props = self.chunk_meta["properties"].as_array().unwrap();
        loop {
            if self.prop_index >= props.len() {
                return Ok(true);
            }
            let prop = props[self.prop_index].as_object().ok_or(anyhow::anyhow!("Invalid property: {:?}", props[self.prop_index]))?;

            let offset = prop.get("offset").and_then(|v| v.as_u64()).ok_or(anyhow::anyhow!("Property missing offset"))?;
            if (self.payload_start + offset) != self.offset {
                return Err(anyhow::anyhow!("Property offset mismatch: expected {}, got {}", self.offset, offset));
            }

            let bytes = prop.get("bytes").and_then(|v| v.as_u64()).ok_or(anyhow::anyhow!("Property missing bytes"))? as usize;
            if self.buffer.len() < roundup8(bytes) {
                return Ok(false);
            }

            let data = &self.buffer[0..bytes];
            let data = if let Some(compression) = prop.get("compression").and_then(|v| v.as_str()) {
                match compression {
                    "gz" => &decompress_to_vec(data).map_err(|_e| anyhow::anyhow!("Failed to decompress gz data"))?,
                    _ => return Err(anyhow::anyhow!("Unsupported compression: {}", compression)),
                }
            } else {
                data
            };

            let prop_type = prop.get("property").and_then(|v| v.as_str()).ok_or(anyhow::anyhow!("Property missing type"))?;
            let prop_encoding = prop.get("encoding").and_then(|v| v.as_str()).ok_or(anyhow::anyhow!("Property missing encoding"))?;
            match prop_type {
                "center" => {
                    let centers = match prop_encoding {
                        "f32" => decode_f32(data, 3, self.count),
                        "f16" => decode_f16(data, 3, self.count),
                        "f32_lebytes" => decode_f32_lebytes(data, 3, self.count),
                        "f16_lebytes" => decode_f16_lebytes(data, 3, self.count),
                        _ => return Err(anyhow::anyhow!("Unsupported center encoding: {}", prop_encoding)),
                    };
                    self.splats.set_center(self.base, self.count, &centers);
                },
                "alpha" => {
                    let alphas = match prop_encoding {
                        "f32" => decode_f32(data, 1, self.count),
                        "f16" => decode_f16(data, 1, self.count),
                        "r8" => {
                            let min = prop.get("min").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing min"))? as f32;
                            let max = prop.get("max").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing max"))? as f32;
                            decode_r8(data, 1, self.count, min, max)
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported alpha encoding: {}", prop_encoding)),
                    };
                    self.splats.set_opacity(self.base, self.count, &alphas);
                },
                "rgb" => {
                    let rgbs = match prop_encoding {
                        "f32" => decode_f32(data, 3, self.count),
                        "f16" => decode_f16(data, 3, self.count),
                        "r8" | "r8_delta" => {
                            let min = prop.get("min").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing min"))? as f32;
                            let max = prop.get("max").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing max"))? as f32;
                            if prop_encoding == "r8" {
                                decode_r8(data, 3, self.count, min, max)
                            } else {
                                decode_r8_delta(data, 3, self.count, min, max)
                            }
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported rgb encoding: {}", prop_encoding)),
                    };
                    self.splats.set_rgb(self.base, self.count, &rgbs);
                },
                "scales" => {
                    let scales = match prop_encoding {
                        "f32" => decode_f32(data, 3, self.count),
                        "ln_f16" => decode_ln_f16(data, 3, self.count),
                        "ln_0r8" => {
                            let min = prop.get("min").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing min"))? as f32;
                            let max = prop.get("max").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing max"))? as f32;
                            decode_ln_0r8(data, 3, self.count, min, max)
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported scales encoding: {}", prop_encoding)),
                    };
                    self.splats.set_scale(self.base, self.count, &scales);
                },
                "orientation" => {
                    let quaternions = if prop_encoding == "oct88r8" {
                        decode_quat_oct88r8(data, self.count)
                    } else {
                        let xyzs = match prop_encoding {
                            "f32" => decode_f32(data, 3, self.count),
                            "f16" => decode_f16(data, 3, self.count),
                            _ => return Err(anyhow::anyhow!("Unsupported orientation encoding: {}", prop_encoding)),
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
                "sh1" | "sh2" | "sh3" => {
                    let elements = match prop_type {
                        "sh1" => 9,
                        "sh2" => 15,
                        "sh3" => 21,
                        _ => unreachable!()
                    };
                    let shs = match prop_encoding {
                        "f32" => decode_f32(data, elements, self.count),
                        "f16" => decode_f16(data, elements, self.count),
                        "r8" => {
                            let min = prop.get("min").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing min"))? as f32;
                            let max = prop.get("max").and_then(|v| v.as_f64()).ok_or(anyhow::anyhow!("Property missing max"))? as f32;
                            decode_r8(data, elements, self.count, min, max)
                        },
                        _ => return Err(anyhow::anyhow!("Unsupported sh encoding: {}", prop_encoding)),
                    };
                    match prop_type {
                        "sh1" => self.splats.set_sh1(self.base, self.count, &shs),
                        "sh2" => self.splats.set_sh2(self.base, self.count, &shs),
                        "sh3" => self.splats.set_sh3(self.base, self.count, &shs),
                        _ => unreachable!()
                    }
                },
                "child_count" => {
                    if prop_encoding != "u16" {
                        return Err(anyhow::anyhow!("Unsupported child count encoding: {}", prop_encoding));
                    }
                    let child_counts = decode_u16(data, 1, self.count);
                    self.splats.set_child_count(self.base, self.count, &child_counts);
                },
                "child_start" => {
                    if prop_encoding != "u32" {
                        return Err(anyhow::anyhow!("Unsupported child start encoding: {}", prop_encoding));
                    }
                    let child_starts = decode_u32_as_usize(data, 1, self.count);
                    self.splats.set_child_start(self.base, self.count, &child_starts);
                },
                _ => return Err(anyhow::anyhow!("Unknown property type: {}", prop_type)),
            }

            self.buffer.drain(..roundup8(bytes));
            self.offset += roundup8(bytes) as u64;
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
