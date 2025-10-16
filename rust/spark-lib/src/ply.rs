use std::array;
use std::collections::HashMap;

use anyhow::anyhow;

use crate::decoder::{ChunkReceiver, SplatInit, SplatProps, SplatReceiver};

pub const PLY_MAGIC: u32 = 0x00796c70; // "ply"
const MAX_SPLAT_CHUNK: usize = 16384;
const SH_C0: f32 = 0.28209479177387814;

pub struct PlyDecoder<T: SplatReceiver> {
    splats: T,
    buffer: Vec<u8>,
    state: Option<PlyDecoderState>,
}

impl<T: SplatReceiver> PlyDecoder<T> {
    pub fn new(splats: T) -> Self {
        Self {
            splats,
            buffer: Vec::new(),
            state: None,
        }
    }

    pub fn into_splats(self) -> T {
        self.splats
    }

    fn poll(&mut self) -> anyhow::Result<()> {
        if self.state.is_none() {
            self.poll_header()?;
            if self.state.is_some() {
                self.poll_data()?;
            }
        } else {
            self.poll_data()?;
        }
        Ok(())
    }

    fn poll_header(&mut self) -> anyhow::Result<()> {
        if self.buffer.len() < 4 {
            return Ok(());
        }
        let magic = u32::from_le_bytes([self.buffer[0], self.buffer[1], self.buffer[2], self.buffer[3]]);
        if (magic & 0x00ffffff) != PLY_MAGIC {
            return Err(anyhow!("Invalid PLY file"));
        }

        const TERMINATOR: &[u8] = b"end_header\n";
        let header_end = self.buffer.windows(TERMINATOR.len()).position(|window| window == TERMINATOR);
        let Some(header_end) = header_end else {
            if self.buffer.len() >= 65536 {
                return Err(anyhow!("PLY header too large"));
            }
            return Ok(());
        };

        let header = std::str::from_utf8(&self.buffer[..header_end])?;

        let mut num_splats: Option<usize> = None;
        let mut properties: HashMap<String, PlyProperty> = HashMap::new();
        let mut record_size: usize = 0;

        for (line_index, line) in header.lines().enumerate() {
            let line = line.trim();
            if line_index == 0 {
                if line != "ply" {
                    return Err(anyhow!("Invalid PLY header"));
                }
                continue;
            }
            if line.is_empty() {
                continue;
            }

            let fields: Vec<_> = line.split_whitespace().collect();
            match (fields[0], fields.len()) {
                ("format", 3) => {
                    if fields[1] != "binary_little_endian" {
                        return Err(anyhow!("Unsupported PLY format: {}", fields[1]));
                    }
                    if fields[2] != "1.0" {
                        return Err(anyhow!("Unsupported PLY version: {}", fields[2]));
                    }
                },
                ("element", 3) => {
                    if fields[1] != "vertex" {
                        return Err(anyhow!("Unsupported PLY element: {}", fields[1]));
                    }
                    num_splats = Some(fields[2].parse()?);
                },
                ("property", 3) => {
                    let property_type = match fields[1] {
                        "float" => PlyPropertyType::Float,
                        "uchar" => PlyPropertyType::Uchar,
                        _ => return Err(anyhow!("Unsupported PLY property type: {}", fields[1])),
                    };
                    properties.insert(fields[2].to_string(), PlyProperty {
                        ty: property_type,
                        offset: record_size,
                    });
                    record_size += property_type.size();
                },
                ("comment", _) => {
                    // Ignore comments
                },
                _ => {
                    return Err(anyhow!("Unsupported PLY header line: {}", line));
                },
            }
        }
        let Some(num_splats) = num_splats else {
            return Err(anyhow!("Could not find number of splats in PLY file"));
        };

        let state = PlyDecoderState::new(num_splats, record_size, properties)?;
        self.splats.init_splats(&SplatInit {
            num_splats,
            max_sh_degree: state.max_sh_degree,
        })?;
        
        self.buffer.drain(..header_end + TERMINATOR.len());
        self.state = Some(state);
        Ok(())
    }

    fn poll_data(&mut self) -> anyhow::Result<()> {
        let Some(state) = self.state.as_mut() else {
            unreachable!();
        };

        let mut offset = 0;
        loop {
            let count = ((self.buffer.len() - offset) / state.record_size).min(MAX_SPLAT_CHUNK);
            if count == 0 {
                break;
            }

            state.ensure_out(count);

            for i in 0..count {
                let [i3, i4] = [i * 3, i * 4];
                let base = offset + i * state.record_size;

                for d in 0..3 {
                    state.out_center[i3 + d] = state.xyz[d].get_f32(&self.buffer, base);
                }
                let op_logistic = state.op_logi.get_f32(&self.buffer, base);
                state.out_opacity[i] = 1.0 / (1.0 + (-op_logistic).exp());
                for d in 0..3 {
                    state.out_rgb[i3 + d] = 0.5 + state.f_dc[d].get_f32(&self.buffer, base) * SH_C0;
                }
                for d in 0..3 {
                    state.out_scale[i3 + d] = state.scale[d].get_f32(&self.buffer, base).exp();
                }
                let quat: [f32; 4] = array::from_fn(|d| state.rot[d].get_f32(&self.buffer, base));
                let quat_magnitude = quat.map(|x| x.powi(2)).iter().sum::<f32>().sqrt();
                for d in 0..4 {
                    state.out_quat[i4 + d] = quat[d] / quat_magnitude;
                }

                if let Some(sh1) = state.sh1 {
                    let i9 = i * 9;
                    for d in 0..9 {
                        state.out_sh1[i9 + d] = sh1[d].get_f32(&self.buffer, base);
                    }
                }
                if let Some(sh2) = state.sh2 {
                    let i15 = i * 15;
                    for d in 0..15 {
                        state.out_sh2[i15 + d] = sh2[d].get_f32(&self.buffer, base);
                    }
                }
                if let Some(sh3) = state.sh3 {
                    let i21 = i * 21;
                    for d in 0..21 {
                        state.out_sh3[i21 + d] = sh3[d].get_f32(&self.buffer, base);
                    }
                }
            }

            self.splats.set_batch(state.next_splat, count, &SplatProps {
                center: &state.out_center[..count * 3],
                opacity: &state.out_opacity[..count],
                rgb: &state.out_rgb[..count * 3],
                scale: &state.out_scale[..count * 3],
                quat: &state.out_quat[..count * 4],
                sh1: &state.out_sh1[..(if state.max_sh_degree >= 1 { count * 9 } else { 0 })],
                sh2: &state.out_sh2[..(if state.max_sh_degree >= 2 { count * 15 } else { 0 })],
                sh3: &state.out_sh3[..(if state.max_sh_degree >= 3 { count * 21 } else { 0 })],
            });

            state.next_splat += count;
            offset += count * state.record_size;
        }

        self.buffer.drain(..offset);
        Ok(())
    }
}

impl<T: SplatReceiver> ChunkReceiver for PlyDecoder<T> {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        self.buffer.extend_from_slice(bytes);
        self.poll()?;
        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        self.poll()?;

        let Some(state) = self.state.as_mut() else {
            return Err(anyhow!("Invalid PLY file"));
        };
        if self.buffer.len() > 0 {
            return Err(anyhow!("Unexpected data after PLY file"));
        }
        if state.next_splat != state.num_splats {
            return Err(anyhow!("Expected {} splats, got {}", state.num_splats, state.next_splat));
        }
        self.splats.finish()?;
        
        Ok(())
    }
}

struct PlyDecoderState {
    num_splats: usize,
    record_size: usize,
    next_splat: usize,

    #[allow(unused)]
    properties: HashMap<String, PlyProperty>,
    xyz: [PlyProperty; 3],
    scale: [PlyProperty; 3],
    rot: [PlyProperty; 4],
    op_logi: PlyProperty,
    f_dc: [PlyProperty; 3],
    max_sh_degree: usize,
    sh1: Option<[PlyProperty; 9]>,
    sh2: Option<[PlyProperty; 15]>,
    sh3: Option<[PlyProperty; 21]>,

    out_center: Vec<f32>,
    out_opacity: Vec<f32>,
    out_rgb: Vec<f32>,
    out_scale: Vec<f32>,
    out_quat: Vec<f32>,
    out_sh1: Vec<f32>,
    out_sh2: Vec<f32>,
    out_sh3: Vec<f32>,
}

impl PlyDecoderState {
    fn new(num_splats: usize, record_size: usize, properties: HashMap<String, PlyProperty>) -> anyhow::Result<Self> {
        let xyz = [
            *properties.get("x").ok_or(anyhow!("Missing x property"))?,
            *properties.get("y").ok_or(anyhow!("Missing y property"))?,
            *properties.get("z").ok_or(anyhow!("Missing z property"))?,
        ];
        let scale = [
            *properties.get("scale_0").ok_or(anyhow!("Missing scale_0 property"))?,
            *properties.get("scale_1").ok_or(anyhow!("Missing scale_1 property"))?,
            *properties.get("scale_2").ok_or(anyhow!("Missing scale_2 property"))?,
        ];
        let rot = [
            *properties.get("rot_1").ok_or(anyhow!("Missing rot_0 property"))?,
            *properties.get("rot_2").ok_or(anyhow!("Missing rot_1 property"))?,
            *properties.get("rot_3").ok_or(anyhow!("Missing rot_2 property"))?,
            *properties.get("rot_0").ok_or(anyhow!("Missing rot_3 property"))?,
        ];
        let op_logi = *properties.get("opacity").ok_or(anyhow!("Missing opacity property"))?;
        let f_dc = [
            *properties.get("f_dc_0").ok_or(anyhow!("Missing f_dc_0 property"))?,
            *properties.get("f_dc_1").ok_or(anyhow!("Missing f_dc_1 property"))?,
            *properties.get("f_dc_2").ok_or(anyhow!("Missing f_dc_2 property"))?,
        ];

        let mut num_f_rest = 0;
        while properties.contains_key(&format!("f_rest_{}", num_f_rest)) {
            num_f_rest += 1;
        }
        let max_sh_degree = match num_f_rest {
            0 => 0,
            9 => 1,
            24 => 2,
            45 => 3,
            _ => return Err(anyhow!("Invalid number of f_rest properties: {}", num_f_rest)),
        };

        let sh1 = if max_sh_degree >= 1 {
            let sh1 = array::from_fn(|i| {
                let name = f_rest_name(max_sh_degree, 1, i / 3, i % 3);
                *properties.get(&name).unwrap()
            });
            Some(sh1)
        } else {
            None
        };
        let sh2 = if max_sh_degree >= 2 {
            let sh2 = array::from_fn(|i| {
                let name = f_rest_name(max_sh_degree, 2, i / 3, i % 3);
                *properties.get(&name).unwrap()
            });
            Some(sh2)
        } else {
            None
        };
        let sh3 = if max_sh_degree >= 3 {
            let sh3 = array::from_fn(|i| {
                let name = f_rest_name(max_sh_degree, 3, i / 3, i % 3);
                *properties.get(&name).unwrap()
            });
            Some(sh3)
        } else {
            None
        };

        Ok(Self {
            num_splats,
            record_size,
            next_splat: 0,
            properties,
            xyz,
            scale,
            rot,
            op_logi,
            f_dc,
            max_sh_degree,
            sh1,
            sh2,
            sh3,
            out_center: Vec::new(),
            out_opacity: Vec::new(),
            out_rgb: Vec::new(),
            out_scale: Vec::new(),
            out_quat: Vec::new(),
            out_sh1: Vec::new(),
            out_sh2: Vec::new(),
            out_sh3: Vec::new(),
        })
    }

    fn ensure_out(&mut self, count: usize) {
        if self.out_center.len() < (count * 3) {
            self.out_center.resize(count * 3, 0.0);
        }
        if self.out_opacity.len() < count {
            self.out_opacity.resize(count, 0.0);
        }
        if self.out_rgb.len() < (count * 3) {
            self.out_rgb.resize(count * 3, 0.0);
        }
        if self.out_scale.len() < (count * 3) {
            self.out_scale.resize(count * 3, 0.0);
        }
        if self.out_quat.len() < (count * 4) {
            self.out_quat.resize(count * 4, 0.0);
        }
        if self.max_sh_degree >= 1 && self.out_sh1.len() < (count * 9) {
            self.out_sh1.resize(count * 9, 0.0);
        }
        if self.max_sh_degree >= 2 && self.out_sh2.len() < (count * 15) {
            self.out_sh2.resize(count * 15, 0.0);
        }
        if self.max_sh_degree >= 3 && self.out_sh3.len() < (count * 21) {
            self.out_sh3.resize(count * 21, 0.0);
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum PlyPropertyType {
    Float,
    Uchar,
}

impl PlyPropertyType {
    pub fn size(&self) -> usize {
        match self {
            PlyPropertyType::Float => 4,
            PlyPropertyType::Uchar => 1,
        }
    }

    pub fn get_f32(&self, data: &[u8], offset: usize) -> f32 {
        match self {
            PlyPropertyType::Float => {
                let u8_4: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                f32::from_le_bytes(u8_4)
            },
            PlyPropertyType::Uchar => {
                data[offset] as f32 / 255.0
            },
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PlyProperty {
    pub ty: PlyPropertyType,
    pub offset: usize,
}

impl PlyProperty {
    pub fn get_f32(&self, data: &[u8], record_offset: usize) -> f32 {
        self.ty.get_f32(data, record_offset + self.offset)
    }
}

fn f_rest_offset(degree: usize) -> usize {
    match degree {
        0 => 0,
        1 => 3,
        2 => 8,
        3 => 15,
        _ => unreachable!(),
    }
}

fn f_rest_name(max_sh_degree: usize, degree: usize, k: usize, d: usize) -> String {
    let stride = f_rest_offset(max_sh_degree);
    let offset = f_rest_offset(degree - 1);
    format!("f_rest_{}", stride * d + offset + k)
}
