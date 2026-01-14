use std::array;
use std::collections::HashMap;
use std::f32::consts::SQRT_2;

use anyhow::anyhow;

use crate::decoder::{ChunkReceiver, SplatGetter, SplatInit, SplatProps, SplatReceiver};

pub const PLY_MAGIC: u32 = 0x00796c70; // "ply"
const MAX_SPLAT_CHUNK: usize = 65536;
const SH_C0: f32 = 0.28209479177387814;
const SUPER_CHUNK_SIZE: usize = 256;

pub struct PlyDecoder<T: SplatReceiver> {
    splats: T,
    buffer: Vec<u8>,
    state: Option<PlyState>,
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
        }
        if self.state.is_some() {
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
        let parsed = parse_header(header)?;

        let state = if parsed.is_supersplat {
            let state = SuperSplatState::new(parsed)?;
            self.splats.init_splats(&SplatInit {
                num_splats: state.num_splats,
                max_sh_degree: state.max_sh_degree,
                lod_tree: false,
            })?;
            PlyState::SuperSplat(state)
        } else {
            let state = PlyDecoderState::new(parsed.num_splats, parsed.vertex.record_size, parsed.vertex.properties.clone())?;
            self.splats.init_splats(&SplatInit {
                num_splats: parsed.num_splats,
                max_sh_degree: state.max_sh_degree,
                lod_tree: false,
            })?;
            PlyState::Standard(state)
        };

        self.buffer.drain(..header_end + TERMINATOR.len());
        self.state = Some(state);
        Ok(())
    }

    fn poll_data(&mut self) -> anyhow::Result<()> {
        match self.state {
            Some(PlyState::Standard(_)) => self.poll_data_standard(),
            Some(PlyState::SuperSplat(_)) => self.poll_data_supersplat(),
            None => unreachable!(),
        }
    }

    fn poll_data_standard(&mut self) -> anyhow::Result<()> {
        let Some(PlyState::Standard(state)) = self.state.as_mut() else { unreachable!() };
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
                ..Default::default()
            });

            state.next_splat += count;
            offset += count * state.record_size;
        }

        self.buffer.drain(..offset);
        Ok(())
    }

    fn poll_data_supersplat(&mut self) -> anyhow::Result<()> {
        let Some(PlyState::SuperSplat(state)) = self.state.as_mut() else { unreachable!() };
        let mut offset = 0;
        while state.current_element < state.elements.len() {
            let elem_kind;
            let elem_count;
            let elem_record_size;
            let elem_read;
            {
                let elem = &state.elements[state.current_element];
                elem_kind = elem.kind;
                elem_count = elem.desc.count;
                elem_record_size = elem.desc.record_size;
                elem_read = elem.read;
            }

            let available = (self.buffer.len() - offset) / elem_record_size;
            if available == 0 {
                break;
            }
            let remaining = elem_count.saturating_sub(elem_read);
            let chunk = remaining.min(available).min(MAX_SPLAT_CHUNK);
            if chunk == 0 {
                break;
            }

            match elem_kind {
                PlyElementKind::Chunk => {
                    state.decode_chunks(chunk, offset, elem_record_size, &self.buffer)?;
                },
                PlyElementKind::Vertex => {
                    state.decode_vertices(chunk, elem_read, offset, elem_record_size, &self.buffer)?;
                    self.splats.set_batch(elem_read, chunk, &SplatProps {
                        center: &state.out_center[..chunk * 3],
                        opacity: &state.out_opacity[..chunk],
                        rgb: &state.out_rgb[..chunk * 3],
                        scale: &state.out_scale[..chunk * 3],
                        quat: &state.out_quat[..chunk * 4],
                        ..Default::default()
                    });
                },
                PlyElementKind::Sh => {
                    if state.sh_props.is_some() {
                        state.decode_sh(chunk, elem_read, offset, elem_record_size, &self.buffer);
                        self.splats.set_sh(
                            elem_read,
                            chunk,
                            &state.out_sh1[..chunk * 9],
                            if state.max_sh_degree >= 2 { &state.out_sh2[..chunk * 15] } else { &[][..] },
                            if state.max_sh_degree >= 3 { &state.out_sh3[..chunk * 21] } else { &[][..] },
                        );
                    }
                },
                PlyElementKind::Other => {
                    // Skip unknown element
                },
            }

            {
                let elem = &mut state.elements[state.current_element];
                elem.read += chunk;
                if elem.read == elem.desc.count {
                    state.current_element += 1;
                }
            }
            offset += chunk * elem_record_size;
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

        let Some(state) = self.state.as_ref() else {
            return Err(anyhow!("Invalid PLY file"));
        };
        if !self.buffer.is_empty() {
            return Err(anyhow!("Unexpected data after PLY file"));
        }

        match state {
            PlyState::Standard(state) => {
                if state.next_splat != state.num_splats {
                    return Err(anyhow!("Expected {} splats, got {}", state.num_splats, state.next_splat));
                }
            },
            PlyState::SuperSplat(state) => {
                if let Some(vertex_elem) = state.elements.iter().find(|e| matches!(e.kind, PlyElementKind::Vertex)) {
                    if vertex_elem.read != vertex_elem.desc.count || vertex_elem.desc.count != state.num_splats {
                        return Err(anyhow!("Expected {} splats, got {}", state.num_splats, vertex_elem.read));
                    }
                }
                if let Some(sh_elem) = state.elements.iter().find(|e| matches!(e.kind, PlyElementKind::Sh)) {
                    if sh_elem.read != sh_elem.desc.count {
                        return Err(anyhow!("Expected {} SH records, got {}", sh_elem.desc.count, sh_elem.read));
                    }
                }
            },
        }

        self.splats.finish()?;
        Ok(())
    }
}

#[derive(Debug)]
enum PlyState {
    Standard(PlyDecoderState),
    SuperSplat(SuperSplatState),
}

#[derive(Clone, Debug)]
struct PlyElementDesc {
    name: String,
    count: usize,
    record_size: usize,
    properties: HashMap<String, PlyProperty>,
}

#[derive(Default)]
struct PlyElementBuilder {
    name: String,
    count: usize,
    properties: Vec<(String, PlyProperty)>,
    record_size: usize,
}

impl PlyElementBuilder {
    fn new(name: &str, count: usize) -> Self {
        Self {
            name: name.to_string(),
            count,
            ..Default::default()
        }
    }

    fn add_property(&mut self, name: &str, ty: PlyPropertyType) {
        let prop = PlyProperty { ty, offset: self.record_size };
        self.record_size += ty.size();
        self.properties.push((name.to_string(), prop));
    }

    fn build(self) -> PlyElementDesc {
        PlyElementDesc {
            name: self.name,
            count: self.count,
            record_size: self.record_size,
            properties: self.properties.into_iter().collect(),
        }
    }
}

struct ParsedHeader {
    elements: Vec<PlyElementDesc>,
    vertex: PlyElementDesc,
    chunk: Option<PlyElementDesc>,
    sh: Option<PlyElementDesc>,
    num_splats: usize,
    is_supersplat: bool,
}

fn parse_property_type(s: &str) -> anyhow::Result<PlyPropertyType> {
    let ty = match s {
        "char" => PlyPropertyType::Char,
        "uchar" => PlyPropertyType::Uchar,
        "short" => PlyPropertyType::Short,
        "ushort" => PlyPropertyType::Ushort,
        "int" => PlyPropertyType::Int,
        "uint" => PlyPropertyType::Uint,
        "float" => PlyPropertyType::Float,
        "double" => PlyPropertyType::Double,
        _ => return Err(anyhow!("Unsupported PLY property type: {}", s)),
    };
    Ok(ty)
}

fn parse_header(header: &str) -> anyhow::Result<ParsedHeader> {
    let mut builders: Vec<PlyElementBuilder> = Vec::new();
    let mut current: Option<PlyElementBuilder> = None;
    let mut format_seen = false;

    for (line_index, raw_line) in header.lines().enumerate() {
        let line = raw_line.trim();
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
        match fields[0] {
            "format" if fields.len() == 3 => {
                format_seen = true;
                if fields[1] != "binary_little_endian" {
                    return Err(anyhow!("Unsupported PLY format: {}", fields[1]));
                }
                if fields[2] != "1.0" {
                    return Err(anyhow!("Unsupported PLY version: {}", fields[2]));
                }
            },
            "comment" => {
                // ignore
            },
            "element" if fields.len() == 3 => {
                if let Some(cur) = current.take() {
                    builders.push(cur);
                }
                current = Some(PlyElementBuilder::new(fields[1], fields[2].parse()?));
            },
            "property" => {
                if fields.get(1).map(|s| *s) == Some("list") {
                    return Err(anyhow!("PLY list properties are not supported"));
                }
                if fields.len() != 3 {
                    return Err(anyhow!("Invalid property line: {}", line));
                }
                let Some(cur) = current.as_mut() else {
                    return Err(anyhow!("Property outside of element"));
                };
                let ty = parse_property_type(fields[1])?;
                cur.add_property(fields[2], ty);
            },
            "end_header" => {
                break;
            },
            _ => return Err(anyhow!("Unsupported PLY header line: {}", line)),
        }
    }

    if let Some(cur) = current.take() {
        builders.push(cur);
    }
    if !format_seen {
        return Err(anyhow!("Missing PLY format line"));
    }

    let elements: Vec<PlyElementDesc> = builders.into_iter().map(|b| b.build()).collect();
    let vertex = elements.iter().find(|e| e.name == "vertex").cloned().ok_or(anyhow!("Missing vertex element"))?;
    let chunk = elements.iter().find(|e| e.name == "chunk").cloned();
    let sh = elements.iter().find(|e| e.name == "sh").cloned();

    Ok(ParsedHeader {
        num_splats: vertex.count,
        vertex,
        chunk,
        sh,
        is_supersplat: elements.iter().any(|e| e.name == "chunk"),
        elements,
    })
}

#[derive(Clone, Copy, Debug)]
struct SuperSplatChunk {
    min_x: f32,
    min_y: f32,
    min_z: f32,
    max_x: f32,
    max_y: f32,
    max_z: f32,
    min_scale_x: f32,
    min_scale_y: f32,
    min_scale_z: f32,
    max_scale_x: f32,
    max_scale_y: f32,
    max_scale_z: f32,
    min_r: f32,
    min_g: f32,
    min_b: f32,
    max_r: f32,
    max_g: f32,
    max_b: f32,
}

#[derive(Clone, Copy, Debug)]
struct SuperSplatChunkProps {
    min_x: PlyProperty,
    min_y: PlyProperty,
    min_z: PlyProperty,
    max_x: PlyProperty,
    max_y: PlyProperty,
    max_z: PlyProperty,
    min_scale_x: PlyProperty,
    min_scale_y: PlyProperty,
    min_scale_z: PlyProperty,
    max_scale_x: PlyProperty,
    max_scale_y: PlyProperty,
    max_scale_z: PlyProperty,
    min_r: Option<PlyProperty>,
    min_g: Option<PlyProperty>,
    min_b: Option<PlyProperty>,
    max_r: Option<PlyProperty>,
    max_g: Option<PlyProperty>,
    max_b: Option<PlyProperty>,
}

#[derive(Clone, Copy, Debug)]
struct SuperSplatVertexProps {
    packed_position: PlyProperty,
    packed_rotation: PlyProperty,
    packed_scale: PlyProperty,
    packed_color: PlyProperty,
}

#[derive(Clone, Debug)]
struct SuperSplatShProps {
    f_rest: Vec<PlyProperty>,
    sh1_props: Vec<usize>,
    sh2_props: Vec<usize>,
    sh3_props: Vec<usize>,
    num_f_rest: usize,
}

#[derive(Debug)]
struct SuperSplatState {
    elements: Vec<PlyElementState>,
    current_element: usize,
    num_splats: usize,
    max_sh_degree: usize,
    chunk_props: SuperSplatChunkProps,
    vertex_props: SuperSplatVertexProps,
    sh_props: Option<SuperSplatShProps>,
    chunks: Vec<SuperSplatChunk>,
    out_center: Vec<f32>,
    out_opacity: Vec<f32>,
    out_rgb: Vec<f32>,
    out_scale: Vec<f32>,
    out_quat: Vec<f32>,
    out_sh1: Vec<f32>,
    out_sh2: Vec<f32>,
    out_sh3: Vec<f32>,
    temp_rest: Vec<f32>,
}

impl SuperSplatState {
    fn new(parsed: ParsedHeader) -> anyhow::Result<Self> {
        let chunk_desc = parsed.chunk.ok_or(anyhow!("Missing chunk element for SuperSplat PLY"))?;
        let vertex_desc = parsed.vertex;
        let expected_chunks = (vertex_desc.count + SUPER_CHUNK_SIZE - 1) / SUPER_CHUNK_SIZE;
        if chunk_desc.count < expected_chunks {
            return Err(anyhow!(
                "Not enough chunk records: have {}, need at least {}",
                chunk_desc.count,
                expected_chunks
            ));
        }

        let chunk_props = SuperSplatChunkProps {
            min_x: *chunk_desc.properties.get("min_x").ok_or(anyhow!("Missing min_x property"))?,
            min_y: *chunk_desc.properties.get("min_y").ok_or(anyhow!("Missing min_y property"))?,
            min_z: *chunk_desc.properties.get("min_z").ok_or(anyhow!("Missing min_z property"))?,
            max_x: *chunk_desc.properties.get("max_x").ok_or(anyhow!("Missing max_x property"))?,
            max_y: *chunk_desc.properties.get("max_y").ok_or(anyhow!("Missing max_y property"))?,
            max_z: *chunk_desc.properties.get("max_z").ok_or(anyhow!("Missing max_z property"))?,
            min_scale_x: *chunk_desc.properties.get("min_scale_x").ok_or(anyhow!("Missing min_scale_x property"))?,
            min_scale_y: *chunk_desc.properties.get("min_scale_y").ok_or(anyhow!("Missing min_scale_y property"))?,
            min_scale_z: *chunk_desc.properties.get("min_scale_z").ok_or(anyhow!("Missing min_scale_z property"))?,
            max_scale_x: *chunk_desc.properties.get("max_scale_x").ok_or(anyhow!("Missing max_scale_x property"))?,
            max_scale_y: *chunk_desc.properties.get("max_scale_y").ok_or(anyhow!("Missing max_scale_y property"))?,
            max_scale_z: *chunk_desc.properties.get("max_scale_z").ok_or(anyhow!("Missing max_scale_z property"))?,
            min_r: chunk_desc.properties.get("min_r").copied(),
            min_g: chunk_desc.properties.get("min_g").copied(),
            min_b: chunk_desc.properties.get("min_b").copied(),
            max_r: chunk_desc.properties.get("max_r").copied(),
            max_g: chunk_desc.properties.get("max_g").copied(),
            max_b: chunk_desc.properties.get("max_b").copied(),
        };

        let vertex_props = SuperSplatVertexProps {
            packed_position: *vertex_desc.properties.get("packed_position").ok_or(anyhow!("Missing packed_position property"))?,
            packed_rotation: *vertex_desc.properties.get("packed_rotation").ok_or(anyhow!("Missing packed_rotation property"))?,
            packed_scale: *vertex_desc.properties.get("packed_scale").ok_or(anyhow!("Missing packed_scale property"))?,
            packed_color: *vertex_desc.properties.get("packed_color").ok_or(anyhow!("Missing packed_color property"))?,
        };

        let sh_props = if let Some(sh_desc) = parsed.sh.as_ref() {
            if sh_desc.count != vertex_desc.count {
                return Err(anyhow!("SH element count ({}) must match vertex count ({})", sh_desc.count, vertex_desc.count));
            }
            let mut num_f_rest = 0;
            while sh_desc.properties.contains_key(&format!("f_rest_{}", num_f_rest)) {
                num_f_rest += 1;
            }
            let max_sh_degree = match num_f_rest {
                0 => 0,
                9 => 1,
                24 => 2,
                45 => 3,
                _ => return Err(anyhow!("Invalid number of f_rest properties: {}", num_f_rest)),
            };

            let mut f_rest: Vec<PlyProperty> = vec![PlyProperty { ty: PlyPropertyType::Uchar, offset: 0 }; num_f_rest];
            for (name, prop) in sh_desc.properties.iter() {
                if let Some(idx) = name.strip_prefix("f_rest_").and_then(|s| s.parse::<usize>().ok()) {
                    if idx < num_f_rest {
                        f_rest[idx] = *prop;
                    }
                }
            }

            let stride = num_f_rest / 3;
            let sh1_props: Vec<usize> = (0..3).flat_map(|k| (0..3).map(move |d| k + d * stride)).collect();
            let sh2_props: Vec<usize> = (0..5).flat_map(|k| (0..3).map(move |d| 3 + k + d * stride)).collect();
            let sh3_props: Vec<usize> = (0..7).flat_map(|k| (0..3).map(move |d| 8 + k + d * stride)).collect();

            Some(SuperSplatShProps {
                f_rest,
                sh1_props,
                sh2_props,
                sh3_props,
                num_f_rest,
            }).filter(|_| max_sh_degree > 0)
        } else {
            None
        };

        let max_sh_degree = sh_props
            .as_ref()
            .map(|p| match p.num_f_rest {
                0 => 0,
                9 => 1,
                24 => 2,
                45 => 3,
                _ => 0,
            })
            .unwrap_or(0);

        let elements = parsed
            .elements
            .into_iter()
            .map(|desc| {
                let kind = match desc.name.as_str() {
                    "chunk" => PlyElementKind::Chunk,
                    "vertex" => PlyElementKind::Vertex,
                    "sh" => PlyElementKind::Sh,
                    _ => PlyElementKind::Other,
                };
                PlyElementState { desc, kind, read: 0 }
            })
            .collect();

        Ok(Self {
            elements,
            current_element: 0,
            num_splats: vertex_desc.count,
            max_sh_degree,
            chunk_props,
            vertex_props,
            sh_props,
            chunks: Vec::new(),
            out_center: Vec::new(),
            out_opacity: Vec::new(),
            out_rgb: Vec::new(),
            out_scale: Vec::new(),
            out_quat: Vec::new(),
            out_sh1: Vec::new(),
            out_sh2: Vec::new(),
            out_sh3: Vec::new(),
            temp_rest: Vec::new(),
        })
    }

    fn ensure_out(&mut self, count: usize) {
        if self.out_center.len() < count * 3 {
            self.out_center.resize(count * 3, 0.0);
        }
        if self.out_opacity.len() < count {
            self.out_opacity.resize(count, 0.0);
        }
        if self.out_rgb.len() < count * 3 {
            self.out_rgb.resize(count * 3, 0.0);
        }
        if self.out_scale.len() < count * 3 {
            self.out_scale.resize(count * 3, 0.0);
        }
        if self.out_quat.len() < count * 4 {
            self.out_quat.resize(count * 4, 0.0);
        }
        if self.max_sh_degree >= 1 && self.out_sh1.len() < count * 9 {
            self.out_sh1.resize(count * 9, 0.0);
        }
        if self.max_sh_degree >= 2 && self.out_sh2.len() < count * 15 {
            self.out_sh2.resize(count * 15, 0.0);
        }
        if self.max_sh_degree >= 3 && self.out_sh3.len() < count * 21 {
            self.out_sh3.resize(count * 21, 0.0);
        }
    }

    fn decode_chunks(&mut self, count: usize, offset: usize, record_size: usize, data: &[u8]) -> anyhow::Result<()> {
        for i in 0..count {
            let base = offset + i * record_size;
            let c = SuperSplatChunk {
                min_x: self.chunk_props.min_x.get_raw_f32(data, base),
                min_y: self.chunk_props.min_y.get_raw_f32(data, base),
                min_z: self.chunk_props.min_z.get_raw_f32(data, base),
                max_x: self.chunk_props.max_x.get_raw_f32(data, base),
                max_y: self.chunk_props.max_y.get_raw_f32(data, base),
                max_z: self.chunk_props.max_z.get_raw_f32(data, base),
                min_scale_x: self.chunk_props.min_scale_x.get_raw_f32(data, base),
                min_scale_y: self.chunk_props.min_scale_y.get_raw_f32(data, base),
                min_scale_z: self.chunk_props.min_scale_z.get_raw_f32(data, base),
                max_scale_x: self.chunk_props.max_scale_x.get_raw_f32(data, base),
                max_scale_y: self.chunk_props.max_scale_y.get_raw_f32(data, base),
                max_scale_z: self.chunk_props.max_scale_z.get_raw_f32(data, base),
                min_r: self.chunk_props.min_r.map(|p| p.get_raw_f32(data, base)).unwrap_or(0.0),
                min_g: self.chunk_props.min_g.map(|p| p.get_raw_f32(data, base)).unwrap_or(0.0),
                min_b: self.chunk_props.min_b.map(|p| p.get_raw_f32(data, base)).unwrap_or(0.0),
                max_r: self.chunk_props.max_r.map(|p| p.get_raw_f32(data, base)).unwrap_or(1.0),
                max_g: self.chunk_props.max_g.map(|p| p.get_raw_f32(data, base)).unwrap_or(1.0),
                max_b: self.chunk_props.max_b.map(|p| p.get_raw_f32(data, base)).unwrap_or(1.0),
            };
            self.chunks.push(c);
        }
        Ok(())
    }

    fn decode_vertices(&mut self, count: usize, base_index: usize, offset: usize, record_size: usize, data: &[u8]) -> anyhow::Result<()> {
        self.ensure_out(count);

        for i in 0..count {
            let splat_index = base_index + i;
            let Some(chunk) = self.chunks.get(splat_index / SUPER_CHUNK_SIZE) else {
                return Err(anyhow!("Missing PLY chunk for splat {}", splat_index));
            };
            let base = offset + i * record_size;

            let packed_position = self.vertex_props.packed_position.get_u32(data, base);
            let packed_rotation = self.vertex_props.packed_rotation.get_u32(data, base);
            let packed_scale = self.vertex_props.packed_scale.get_u32(data, base);
            let packed_color = self.vertex_props.packed_color.get_u32(data, base);

            let x = (((packed_position >> 21) & 2047) as f32 / 2047.0) * (chunk.max_x - chunk.min_x) + chunk.min_x;
            let y = (((packed_position >> 11) & 1023) as f32 / 1023.0) * (chunk.max_y - chunk.min_y) + chunk.min_y;
            let z = ((packed_position & 2047) as f32 / 2047.0) * (chunk.max_z - chunk.min_z) + chunk.min_z;

            let r0 = (((packed_rotation >> 20) & 1023) as f32 / 1023.0 - 0.5) * SQRT_2;
            let r1 = (((packed_rotation >> 10) & 1023) as f32 / 1023.0 - 0.5) * SQRT_2;
            let r2 = ((packed_rotation & 1023) as f32 / 1023.0 - 0.5) * SQRT_2;
            let rr = (1.0 - r0 * r0 - r1 * r1 - r2 * r2).max(0.0).sqrt();
            let r_order = (packed_rotation >> 30) & 3;
            let quat_x = if r_order == 0 { r0 } else if r_order == 1 { rr } else { r1 };
            let quat_y = if r_order <= 1 { r1 } else if r_order == 2 { rr } else { r2 };
            let quat_z = if r_order <= 2 { r2 } else { rr };
            let quat_w = if r_order == 0 { rr } else { r0 };

            let scale_x = (((packed_scale >> 21) & 2047) as f32 / 2047.0) * (chunk.max_scale_x - chunk.min_scale_x) + chunk.min_scale_x;
            let scale_y = (((packed_scale >> 11) & 1023) as f32 / 1023.0) * (chunk.max_scale_y - chunk.min_scale_y) + chunk.min_scale_y;
            let scale_z = ((packed_scale & 2047) as f32 / 2047.0) * (chunk.max_scale_z - chunk.min_scale_z) + chunk.min_scale_z;

            let r = (((packed_color >> 24) & 255) as f32 / 255.0) * (chunk.max_r - chunk.min_r) + chunk.min_r;
            let g = (((packed_color >> 16) & 255) as f32 / 255.0) * (chunk.max_g - chunk.min_g) + chunk.min_g;
            let b = (((packed_color >> 8) & 255) as f32 / 255.0) * (chunk.max_b - chunk.min_b) + chunk.min_b;
            let opacity = (packed_color & 255) as f32 / 255.0;

            let i3 = i * 3;
            let i4 = i * 4;
            self.out_center[i3] = x;
            self.out_center[i3 + 1] = y;
            self.out_center[i3 + 2] = z;
            self.out_scale[i3] = scale_x.exp();
            self.out_scale[i3 + 1] = scale_y.exp();
            self.out_scale[i3 + 2] = scale_z.exp();
            self.out_rgb[i3] = r;
            self.out_rgb[i3 + 1] = g;
            self.out_rgb[i3 + 2] = b;
            self.out_opacity[i] = opacity;
            self.out_quat[i4] = quat_x;
            self.out_quat[i4 + 1] = quat_y;
            self.out_quat[i4 + 2] = quat_z;
            self.out_quat[i4 + 3] = quat_w;
        }
        Ok(())
    }

    fn decode_sh(&mut self, count: usize, _base_index: usize, offset: usize, record_size: usize, data: &[u8]) {
        let num_f_rest = match self.sh_props.as_ref() {
            Some(sh_props) => sh_props.num_f_rest,
            None => return,
        };
        if self.temp_rest.len() < num_f_rest {
            self.temp_rest.resize(num_f_rest, 0.0);
        }
        self.ensure_out(count);
        let Some(sh_props) = self.sh_props.as_ref() else { return; };

        for i in 0..count {
            let base = offset + i * record_size;
            for (idx, prop) in sh_props.f_rest.iter().enumerate() {
                self.temp_rest[idx] = prop.get_raw_f32(data, base);
            }

            if self.max_sh_degree >= 1 {
                let start = i * 9;
                for (j, idx) in sh_props.sh1_props.iter().enumerate() {
                    self.out_sh1[start + j] = self.temp_rest[*idx] * 8.0 / 255.0 - 4.0;
                }
            }
            if self.max_sh_degree >= 2 {
                let start = i * 15;
                for (j, idx) in sh_props.sh2_props.iter().enumerate() {
                    self.out_sh2[start + j] = self.temp_rest[*idx] * 8.0 / 255.0 - 4.0;
                }
            }
            if self.max_sh_degree >= 3 {
                let start = i * 21;
                for (j, idx) in sh_props.sh3_props.iter().enumerate() {
                    self.out_sh3[start + j] = self.temp_rest[*idx] * 8.0 / 255.0 - 4.0;
                }
            }
        }
    }
}

#[derive(Debug)]
struct PlyElementState {
    desc: PlyElementDesc,
    kind: PlyElementKind,
    read: usize,
}

#[derive(Clone, Copy, Debug)]
enum PlyElementKind {
    Chunk,
    Vertex,
    Sh,
    Other,
}

#[derive(Debug)]
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
    Char,
    Uchar,
    Short,
    Ushort,
    Int,
    Uint,
    Float,
    Double,
}

impl PlyPropertyType {
    pub fn size(&self) -> usize {
        match self {
            PlyPropertyType::Char | PlyPropertyType::Uchar => 1,
            PlyPropertyType::Short | PlyPropertyType::Ushort => 2,
            PlyPropertyType::Int | PlyPropertyType::Uint | PlyPropertyType::Float => 4,
            PlyPropertyType::Double => 8,
        }
    }

    pub fn get_f32(&self, data: &[u8], offset: usize) -> f32 {
        match self {
            PlyPropertyType::Float => {
                let u8_4: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                f32::from_le_bytes(u8_4)
            },
            PlyPropertyType::Double => {
                let u8_8: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
                f64::from_le_bytes(u8_8) as f32
            },
            PlyPropertyType::Char => data[offset] as i8 as f32 / 255.0,
            PlyPropertyType::Uchar => data[offset] as f32 / 255.0,
            PlyPropertyType::Short => {
                let bytes: [u8; 2] = data[offset..offset + 2].try_into().unwrap();
                i16::from_le_bytes(bytes) as f32
            },
            PlyPropertyType::Ushort => {
                let bytes: [u8; 2] = data[offset..offset + 2].try_into().unwrap();
                u16::from_le_bytes(bytes) as f32
            },
            PlyPropertyType::Int => {
                let bytes: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                i32::from_le_bytes(bytes) as f32
            },
            PlyPropertyType::Uint => {
                let bytes: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                u32::from_le_bytes(bytes) as f32
            },
        }
    }

    pub fn get_raw_f32(&self, data: &[u8], offset: usize) -> f32 {
        match self {
            PlyPropertyType::Float => {
                let bytes: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                f32::from_le_bytes(bytes)
            },
            PlyPropertyType::Double => {
                let bytes: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
                f64::from_le_bytes(bytes) as f32
            },
            PlyPropertyType::Char => data[offset] as i8 as f32,
            PlyPropertyType::Uchar => data[offset] as f32,
            PlyPropertyType::Short => {
                let bytes: [u8; 2] = data[offset..offset + 2].try_into().unwrap();
                i16::from_le_bytes(bytes) as f32
            },
            PlyPropertyType::Ushort => {
                let bytes: [u8; 2] = data[offset..offset + 2].try_into().unwrap();
                u16::from_le_bytes(bytes) as f32
            },
            PlyPropertyType::Int => {
                let bytes: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                i32::from_le_bytes(bytes) as f32
            },
            PlyPropertyType::Uint => {
                let bytes: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                u32::from_le_bytes(bytes) as f32
            },
        }
    }

    pub fn get_u32(&self, data: &[u8], offset: usize) -> u32 {
        match self {
            PlyPropertyType::Uint | PlyPropertyType::Int | PlyPropertyType::Float => {
                let bytes: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
                match self {
                    PlyPropertyType::Uint => u32::from_le_bytes(bytes),
                    PlyPropertyType::Int => i32::from_le_bytes(bytes) as u32,
                    PlyPropertyType::Float => f32::from_le_bytes(bytes).to_bits(),
                    _ => unreachable!(),
                }
            },
            PlyPropertyType::Ushort => {
                let bytes: [u8; 2] = data[offset..offset + 2].try_into().unwrap();
                u16::from_le_bytes(bytes) as u32
            },
            PlyPropertyType::Short => {
                let bytes: [u8; 2] = data[offset..offset + 2].try_into().unwrap();
                i16::from_le_bytes(bytes) as u32
            },
            PlyPropertyType::Uchar => data[offset] as u32,
            PlyPropertyType::Char => data[offset] as i8 as u32,
            PlyPropertyType::Double => {
                let bytes: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
                f64::from_le_bytes(bytes) as u32
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

    pub fn get_raw_f32(&self, data: &[u8], record_offset: usize) -> f32 {
        self.ty.get_raw_f32(data, record_offset + self.offset)
    }

    pub fn get_u32(&self, data: &[u8], record_offset: usize) -> u32 {
        self.ty.get_u32(data, record_offset + self.offset)
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

pub struct PlyEncoder<T: SplatGetter> {
    getter: T,
    max_sh_out: Option<u8>,
}

impl<T: SplatGetter> PlyEncoder<T> {
    pub fn new(getter: T) -> Self { Self { getter, max_sh_out: None } }

    pub fn with_max_sh(mut self, max_sh: u8) -> Self {
        self.max_sh_out = Some(max_sh.min(3));
        self
    }

    pub fn encode_to_writer<W: std::io::Write>(mut self, writer: &mut W) -> anyhow::Result<()> {
        let num_splats = self.getter.num_splats();
        let sh_src = self.getter.max_sh_degree() as u8;
        let sh_degree = self.max_sh_out.map(|m| m.min(sh_src)).unwrap_or(sh_src) as usize;

        // Header (UTF-8 text)
        let mut header = String::new();
        header.push_str("ply\n");
        header.push_str("format binary_little_endian 1.0\n");
        header.push_str(&format!("element vertex {}\n", num_splats));
        header.push_str("property float x\n");
        header.push_str("property float y\n");
        header.push_str("property float z\n");
        header.push_str("property float scale_0\n");
        header.push_str("property float scale_1\n");
        header.push_str("property float scale_2\n");
        header.push_str("property float rot_0\n");
        header.push_str("property float rot_1\n");
        header.push_str("property float rot_2\n");
        header.push_str("property float rot_3\n");
        header.push_str("property float opacity\n");
        header.push_str("property float f_dc_0\n");
        header.push_str("property float f_dc_1\n");
        header.push_str("property float f_dc_2\n");
        let num_f_rest = match sh_degree { 0 => 0, 1 => 9, 2 => 24, 3 => 45, _ => 0 };
        for i in 0..num_f_rest {
            header.push_str(&format!("property float f_rest_{}\n", i));
        }
        header.push_str("end_header\n");
        writer.write_all(header.as_bytes())?;

        // Temporary buffers
        let mut centers: Vec<f32> = Vec::new();
        let mut opacities: Vec<f32> = Vec::new();
        let mut rgbs: Vec<f32> = Vec::new();
        let mut scales: Vec<f32> = Vec::new();
        let mut quats: Vec<f32> = Vec::new();
        let mut sh1: Vec<f32> = Vec::new();
        let mut sh2: Vec<f32> = Vec::new();
        let mut sh3: Vec<f32> = Vec::new();

        let stride = f_rest_offset(sh_degree);

        let mut write_f32_le = |v: f32| -> anyhow::Result<()> {
            writer.write_all(&v.to_le_bytes())?;
            Ok(())
        };

        let mut base = 0usize;
        loop {
            if base >= num_splats { break; }
            let count = (num_splats - base).min(MAX_SPLAT_CHUNK);

            ensure_len(&mut centers, count * 3);
            ensure_len(&mut opacities, count);
            ensure_len(&mut rgbs, count * 3);
            ensure_len(&mut scales, count * 3);
            ensure_len(&mut quats, count * 4);
            if sh_degree >= 1 { ensure_len(&mut sh1, count * 9); }
            if sh_degree >= 2 { ensure_len(&mut sh2, count * 15); }
            if sh_degree >= 3 { ensure_len(&mut sh3, count * 21); }

            self.getter.get_center(base, count, &mut centers[..count * 3]);
            self.getter.get_opacity(base, count, &mut opacities[..count]);
            self.getter.get_rgb(base, count, &mut rgbs[..count * 3]);
            self.getter.get_scale(base, count, &mut scales[..count * 3]);
            self.getter.get_quat(base, count, &mut quats[..count * 4]);
            if sh_degree >= 1 { self.getter.get_sh1(base, count, &mut sh1[..count * 9]); }
            if sh_degree >= 2 { self.getter.get_sh2(base, count, &mut sh2[..count * 15]); }
            if sh_degree >= 3 { self.getter.get_sh3(base, count, &mut sh3[..count * 21]); }

            for i in 0..count {
                let i3 = i * 3;
                let i4 = i * 4;

                // center
                write_f32_le(centers[i3 + 0])?;
                write_f32_le(centers[i3 + 1])?;
                write_f32_le(centers[i3 + 2])?;

                // ln scales
                write_f32_le(scales[i3 + 0].ln())?;
                write_f32_le(scales[i3 + 1].ln())?;
                write_f32_le(scales[i3 + 2].ln())?;

                // quat (rot_0..rot_3), write normalized to be safe
                let mut qx = quats[i4 + 0];
                let mut qy = quats[i4 + 1];
                let mut qz = quats[i4 + 2];
                let mut qw = quats[i4 + 3];
                let norm = (qx*qx + qy*qy + qz*qz + qw*qw).sqrt();
                if norm > 0.0 {
                    qx /= norm; qy /= norm; qz /= norm; qw /= norm;
                }
                write_f32_le(qw)?; // rot_0
                write_f32_le(qx)?; // rot_1
                write_f32_le(qy)?; // rot_2
                write_f32_le(qz)?; // rot_3

                // opacity -> logit(opacity)
                let op = opacities[i].clamp(1.0e-12, 1.0 - 1.0e-12);
                let logit = (op / (1.0 - op)).ln();
                let logit = logit.clamp(-100.0, 100.0);
                write_f32_le(logit)?;

                // f_dc from rgb
                let r = rgbs[i3 + 0];
                let g = rgbs[i3 + 1];
                let b = rgbs[i3 + 2];
                write_f32_le((r - 0.5) / SH_C0)?;
                write_f32_le((g - 0.5) / SH_C0)?;
                write_f32_le((b - 0.5) / SH_C0)?;

                // f_rest (SH) interleaved by channel as decoder expects
                if sh_degree > 0 {
                    let write_sh_value = |deg: usize, k: usize, d: usize| -> f32 {
                        match deg {
                            1 => sh1[i * 9 + k * 3 + d],
                            2 => sh2[i * 15 + k * 3 + d],
                            3 => sh3[i * 21 + k * 3 + d],
                            _ => 0.0,
                        }
                    };
                    for idx in 0..num_f_rest {
                        let d = if stride > 0 { idx / stride } else { 0 };
                        let in_channel = if stride > 0 { idx % stride } else { 0 };
                        if in_channel < 3 {
                            let k = in_channel; // degree 1 (3 coeffs)
                            write_f32_le(write_sh_value(1, k, d))?;
                        } else if in_channel < 8 {
                            let k = in_channel - 3; // degree 2 (5 coeffs)
                            write_f32_le(write_sh_value(2, k, d))?;
                        } else {
                            let k = in_channel - 8; // degree 3 (7 coeffs)
                            write_f32_le(write_sh_value(3, k, d))?;
                        }
                    }
                }
            }

            base += count;
        }

        Ok(())
    }

    pub fn encode(self) -> anyhow::Result<Vec<u8>> {
        let mut out: Vec<u8> = Vec::new();
        self.encode_to_writer(&mut out)?;
        Ok(out)
    }
}

#[inline]
fn ensure_len(buf: &mut Vec<f32>, len: usize) {
    if buf.len() < len { buf.resize(len, 0.0); }
}
