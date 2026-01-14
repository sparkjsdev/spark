use miniz_oxide::inflate::core::{decompress, DecompressorOxide};
use miniz_oxide::inflate::core::inflate_flags::{
    TINFL_FLAG_HAS_MORE_INPUT,
    TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
};
use miniz_oxide::inflate::TINFLStatus;

use crate::decoder::{ChunkReceiver, SetSplatEncoding, SplatGetter, SplatInit, SplatReceiver};
use miniz_oxide::deflate::compress_to_vec;

pub const SPZ_MAGIC: u32 = 0x5053474e; // "NGSP"
const SH_C0: f32 = 0.28209479177387814;
const MAX_SPLAT_CHUNK: usize = 65536;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpzDecoderStage { Centers, Alphas, Rgb, Scales, Quats, Sh, Extension, ChildCounts, ChildStarts, Done }

pub struct SpzDecoder<T: SplatReceiver> {
    splats: T,
    decompressor: DecompressorOxide,
    compressed: Vec<u8>,
    decompressed: Vec<u8>,
    buffer: Vec<u8>,
    state: Option<SpzDecoderState>,
    gzip_header_done: bool,
    out_pos: usize,
    done: bool,
}

impl<T: SplatReceiver> SpzDecoder<T> {
    pub fn new(splats: T) -> Self {
        Self {
            splats,
            decompressor: DecompressorOxide::new(),
            compressed: Vec::new(),
            decompressed: vec![0u8; 128 * 1024],
            buffer: Vec::new(),
            state: None,
            gzip_header_done: false,
            out_pos: 0,
            done: false,
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
            self.poll_sections()?;
        }
        Ok(())
    }

    fn poll_header(&mut self) -> anyhow::Result<()> {
        if self.buffer.len() < 16 {
            return Ok(());
        }

        let magic = read_u32_le(&self.buffer[0..4]);
        if magic != SPZ_MAGIC {
            return Err(anyhow::anyhow!("Invalid SPZ magic: 0x{:08x}", magic));
        }

        let version = read_u32_le(&self.buffer[4..8]);
        if version < 1 || version > 3 {
            return Err(anyhow::anyhow!("Unsupported SPZ version: {}", version));
        }

        let num_splats = read_u32_le(&self.buffer[8..12]) as usize;
        let sh_degree = self.buffer[12] as usize;
        let fractional_bits = self.buffer[13];
        let flags = self.buffer[14];
        let _reserved = self.buffer[15];

        self.buffer.drain(..16);
        let state = SpzDecoderState::new(version as u32, num_splats, sh_degree, fractional_bits, flags)?;
        self.state = Some(state);

        self.splats.init_splats(&SplatInit {
            num_splats,
            max_sh_degree: sh_degree,
            lod_tree: flags & 0x80 != 0,
        })?;

        if flags & 0x80 != 0 {
            self.splats.set_encoding(&SetSplatEncoding {
                lod_opacity: Some(true),
                ..Default::default()
            })?;
        }

        Ok(())
    }

    fn poll_sections(&mut self) -> anyhow::Result<()> {
        let Some(state) = self.state.as_mut() else {
            unreachable!();
        };
        loop {
            match state.stage {
                SpzDecoderStage::Centers => {
                    let bytes_per_item = if state.version == 1 { 6 } else { 9 };
                    let avail_items = self.buffer.len() / bytes_per_item;
                    let remaining = state.num_splats - state.next_splat;
                    if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                        return Ok(());
                    }
                    let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                    if state.output.len() < chunk * 3 {
                        state.output.resize(chunk * 3, 0.0);
                    }
                    if state.version == 1 {
                        for i in 0..chunk {
                            let base = i * 6;
                            state.output[i * 3 + 0] = read_f16_le(&self.buffer[base..base + 2]);
                            state.output[i * 3 + 1] = read_f16_le(&self.buffer[base + 2..base + 4]);
                            state.output[i * 3 + 2] = read_f16_le(&self.buffer[base + 4..base + 6]);
                        }
                    } else {
                        let frac = (1_u32 << state.fractional_bits) as f32;
                        for i in 0..chunk {
                            let base = i * 9;
                            state.output[i * 3 + 0] = read_i24_le(&self.buffer[base..base + 3]) as f32 / frac;
                            state.output[i * 3 + 1] = read_i24_le(&self.buffer[base + 3..base + 6]) as f32 / frac;
                            state.output[i * 3 + 2] = read_i24_le(&self.buffer[base + 6..base + 9]) as f32 / frac;
                        }
                    }

                    self.splats.set_center(state.next_splat, chunk, &state.output);

                    self.buffer.drain(..chunk * bytes_per_item);
                    state.next_splat += chunk;
                    if state.next_splat == state.num_splats {
                        state.next_splat = 0;
                        state.stage = SpzDecoderStage::Alphas;
                    }
                }
                SpzDecoderStage::Alphas => {
                    let bytes_per_item = 1;
                    let avail_items = self.buffer.len() / bytes_per_item;
                    let remaining = state.num_splats - state.next_splat;
                    if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                        return Ok(());
                    }
                    let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                    if state.output.len() < chunk {
                        state.output.resize(chunk, 0.0);
                    }
                    let opacity_scale = if state.flags & 0x80 != 0 { 2.0 } else { 1.0 };
                    for i in 0..chunk {
                        state.output[i] = self.buffer[i] as f32 / 255.0 * opacity_scale;
                    }

                    self.splats.set_opacity(state.next_splat, chunk, &state.output);

                    self.buffer.drain(..chunk * bytes_per_item);
                    state.next_splat += chunk;
                    if state.next_splat == state.num_splats {
                        state.next_splat = 0;
                        state.stage = SpzDecoderStage::Rgb;
                    }
                }
                SpzDecoderStage::Rgb => {
                    let bytes_per_item = 3;
                    let avail_items = self.buffer.len() / bytes_per_item;
                    let remaining = state.num_splats - state.next_splat;
                    if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                        return Ok(());
                    }
                    let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                    let scale = SH_C0 / 0.15;
                    if state.output.len() < chunk * 3 {
                        state.output.resize(chunk * 3, 0.0);
                    }
                    for i in 0..chunk {
                        let b = i * 3;
                        state.output[b + 0] = (self.buffer[b] as f32 / 255.0 - 0.5) * scale + 0.5;
                        state.output[b + 1] = (self.buffer[b + 1] as f32 / 255.0 - 0.5) * scale + 0.5;
                        state.output[b + 2] = (self.buffer[b + 2] as f32 / 255.0 - 0.5) * scale + 0.5;
                    }

                    self.splats.set_rgb(state.next_splat, chunk, &state.output);

                    self.buffer.drain(..chunk * bytes_per_item);
                    state.next_splat += chunk;
                    if state.next_splat == state.num_splats {
                        state.next_splat = 0;
                        state.stage = SpzDecoderStage::Scales;
                    }
                }
                SpzDecoderStage::Scales => {
                    let bytes_per_item = 3;
                    let avail_items = self.buffer.len() / bytes_per_item;
                    let remaining = state.num_splats - state.next_splat;
                    if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                        return Ok(());
                    }
                    let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                    if state.output.len() < chunk * 3 {
                        state.output.resize(chunk * 3, 0.0);
                    }
                    for i in 0..chunk {
                        let b = i * 3;
                        state.output[b + 0] = ((self.buffer[b] as f32) / 16.0 - 10.0).exp();
                        state.output[b + 1] = ((self.buffer[b + 1] as f32) / 16.0 - 10.0).exp();
                        state.output[b + 2] = ((self.buffer[b + 2] as f32) / 16.0 - 10.0).exp();
                    }

                    self.splats.set_scale(state.next_splat, chunk, &state.output);

                    self.buffer.drain(..chunk * bytes_per_item);
                    state.next_splat += chunk;
                    if state.next_splat == state.num_splats {
                        state.next_splat = 0;
                        state.stage = SpzDecoderStage::Quats;
                    }
                }
                SpzDecoderStage::Quats => {
                    let bytes_per_item = if state.version == 3 { 4 } else { 3 };
                    let avail_items = self.buffer.len() / bytes_per_item;
                    let remaining = state.num_splats - state.next_splat;
                    if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                        return Ok(());
                    }
                    let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                    if state.output.len() < chunk * 4 {
                        state.output.resize(chunk * 4, 0.0);
                    }
                    if state.version == 3 {
                        // Version 3 uses "smallest three" compression for quaternions (4 bytes per splat)
                        for i in 0..chunk {
                            let base = i * 4;
                            let comp = (self.buffer[base] as u32)
                                | ((self.buffer[base + 1] as u32) << 8)
                                | ((self.buffer[base + 2] as u32) << 16)
                                | ((self.buffer[base + 3] as u32) << 24);
                            let largest_index = (comp >> 30) as usize;
                            let mut remaining_values = comp;
                            let value_mask: u32 = (1u32 << 9) - 1; // 9 bits for magnitude
                            let max_value: f32 = std::f32::consts::FRAC_1_SQRT_2; // 1/sqrt(2)
                            let mut q = [0.0f32; 4];
                            let mut sum_squares = 0.0f32;

                            for j in (0..4).rev() {
                                if j != largest_index {
                                    let value = (remaining_values & value_mask) as f32;
                                    let sign = ((remaining_values >> 9) & 0x1) != 0;
                                    remaining_values >>= 10;
                                    let mut v = max_value * (value / value_mask as f32);
                                    if sign { v = -v; }
                                    q[j] = v;
                                    sum_squares += v * v;
                                }
                            }

                            let sq = 1.0 - sum_squares;
                            q[largest_index] = if sq > 0.0 { sq.sqrt() } else { 0.0 };

                            let o = i * 4;
                            state.output[o] = q[0];
                            state.output[o + 1] = q[1];
                            state.output[o + 2] = q[2];
                            state.output[o + 3] = q[3];
                        }
                    } else {
                        // Versions < 3 use 3 bytes (qx, qy, qz), reconstruct qw
                        for i in 0..chunk {
                            let base = i * 3;
                            let qx = self.buffer[base] as f32 / 127.5 - 1.0;
                            let qy = self.buffer[base + 1] as f32 / 127.5 - 1.0;
                            let qz = self.buffer[base + 2] as f32 / 127.5 - 1.0;
                            let qw = (1.0 - (qx * qx + qy * qy + qz * qz)).max(0.0).sqrt();
                            let o = i * 4;
                            state.output[o] = qx;
                            state.output[o + 1] = qy;
                            state.output[o + 2] = qz;
                            state.output[o + 3] = qw;
                        }
                    }

                    self.splats.set_quat(state.next_splat, chunk, &state.output);

                    self.buffer.drain(..chunk * bytes_per_item);
                    state.next_splat += chunk;
                    if state.next_splat == state.num_splats {
                        state.next_splat = 0;
                        state.stage = SpzDecoderStage::Sh;
                    }
                }
                SpzDecoderStage::Sh => {
                    if state.sh_degree == 0 {
                        state.stage = SpzDecoderStage::Extension;
                    } else {
                        let sh_components = 3 * match state.sh_degree { 1 => 3, 2 => 8, 3 => 15, _ => 0 };
                        let bytes_per_item = sh_components;
                        let avail_items = self.buffer.len() / bytes_per_item;
                        let remaining = state.num_splats - state.next_splat;
                        if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                            return Ok(());
                        }
                        let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                        let total_floats = chunk * sh_components;
                        if state.output.len() < total_floats {
                            state.output.resize(total_floats, 0.0);
                        }

                        for i in 0..chunk {
                            let base = i * sh_components;
                            for d in 0..3 {
                                for k in 0..3 {
                                    state.output[9 * i + k * 3 + d] = (self.buffer[base + k * 3 + d] as f32 - 128.0) / 128.0;
                                }
                            }
                            if state.sh_degree >= 2 {
                                for d in 0..3 {
                                    for k in 0..5 {
                                        state.output[9 * chunk + 15 * i + k * 3 + d] = (self.buffer[base + 9 + k * 3 + d] as f32 - 128.0) / 128.0;
                                    }
                                }
                            }
                            if state.sh_degree >= 3 {
                                for d in 0..3 {
                                    for k in 0..7 {
                                        state.output[24 * chunk + 21 * i + k * 3 + d] = (self.buffer[base + 24 + k * 3 + d] as f32 - 128.0) / 128.0;
                                    }
                                }
                            }
                        }

                        self.splats.set_sh(
                            state.next_splat,
                            chunk,
                            &state.output[0..chunk * 9],
                            if state.sh_degree >= 2 { &state.output[9 * chunk..24 * chunk] } else { &[][..] },
                            if state.sh_degree >= 3 { &state.output[24 * chunk..total_floats] } else { &[][..] },
                        );

                        self.buffer.drain(..chunk * bytes_per_item);
                        state.next_splat += chunk;
                        if state.next_splat == state.num_splats {
                            state.next_splat = 0;
                            state.stage = SpzDecoderStage::Extension;
                        }
                    }
                }
                SpzDecoderStage::Extension => {
                    if (state.flags & 0x80) == 0 {
                        // No LoD extension
                        state.stage = SpzDecoderStage::Done;
                    } else {
                        state.stage = SpzDecoderStage::ChildCounts;
                    }
                }
                SpzDecoderStage::ChildCounts => {
                    let bytes_per_item = 2;
                    let avail_items = self.buffer.len() / bytes_per_item;
                    let remaining = state.num_splats - state.next_splat;
                    if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                        return Ok(());
                    }
                    let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                    if state.output_u16.len() < chunk {
                        state.output_u16.resize(chunk, 0);
                    }
                    for i in 0..chunk {
                        let base = i * 2;
                        state.output_u16[i] = read_u16_le(&self.buffer[base..base + 2]);
                    }

                    self.splats.set_child_count(state.next_splat, chunk, &state.output_u16);

                    self.buffer.drain(..chunk * bytes_per_item);
                    state.next_splat += chunk;
                    if state.next_splat == state.num_splats {
                        state.next_splat = 0;
                        state.stage = SpzDecoderStage::ChildStarts;
                    }
                }
                SpzDecoderStage::ChildStarts => {
                    let bytes_per_item = 4;
                    let avail_items = self.buffer.len() / bytes_per_item;
                    let remaining = state.num_splats - state.next_splat;
                    if (avail_items < remaining) && (avail_items < MAX_SPLAT_CHUNK) {
                        return Ok(());
                    }
                    let chunk = remaining.min(avail_items).min(MAX_SPLAT_CHUNK);

                    if state.output_usize.len() < chunk {
                        state.output_usize.resize(chunk, 0);
                    }
                    for i in 0..chunk {
                        let base = i * 4;
                        state.output_usize[i] = read_u32_le(&self.buffer[base..base + 4]) as usize;
                    }

                    self.splats.set_child_start(state.next_splat, chunk, &state.output_usize);

                    self.buffer.drain(..chunk * bytes_per_item);
                    state.next_splat += chunk;
                    if state.next_splat == state.num_splats {
                        state.next_splat = 0;
                        state.stage = SpzDecoderStage::Done;
                    }
                }
                SpzDecoderStage::Done => return Ok(()),
            }
        }
    }

    fn poll_decompress(&mut self) -> anyhow::Result<()> {
        if !self.gzip_header_done {
            if !parse_gzip_header(&mut self.compressed)? {
                return Ok(());
            }
            self.gzip_header_done = true;
        }
        let mut in_offset = 0;
        let flags: u32 = TINFL_FLAG_HAS_MORE_INPUT | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF;
        loop {
            if in_offset >= self.compressed.len() { break; }
            // Ensure at least 64 KiB free space; keep last 32 KiB history at buffer start
            const WINDOW: usize = 32 * 1024;
            let free = self.decompressed.len().saturating_sub(self.out_pos);
            if free < 64 * 1024 {
                let keep_start = self.out_pos.saturating_sub(WINDOW);
                let keep_len = self.out_pos - keep_start;
                // Move last WINDOW bytes to beginning
                if keep_len > 0 {
                    // Use copy_within handles overlap
                    self.decompressed.copy_within(keep_start..self.out_pos, 0);
                }
                self.out_pos = keep_len;
            }

            let (status, in_consumed, out_written) = decompress(
                &mut self.decompressor,
                &self.compressed[in_offset..],
                &mut self.decompressed,
                self.out_pos,
                flags,
            );

            if out_written > 0 {
                self.buffer.extend_from_slice(&self.decompressed[self.out_pos..self.out_pos + out_written]);
                self.out_pos += out_written;
                self.poll()?;
            }

            in_offset += in_consumed;
            match status {
                TINFLStatus::Done => {
                    self.done = true;
                    let remaining = self.compressed.len().saturating_sub(in_offset);
                    if remaining >= 8 { in_offset += 8; }
                    break;
                }
                TINFLStatus::NeedsMoreInput => {
                    if in_consumed == 0 && out_written == 0 { break; }
                }
                TINFLStatus::HasMoreOutput => {
                    // Continue with same input, will loop again; ensure space on next iteration
                    continue;
                }
                _ => return Err(anyhow::anyhow!("Decompression failed: {:?}", status)),
            }
        }
        if in_offset > 0 { self.compressed.drain(..in_offset); }
        Ok(())
    }
}

fn parse_gzip_header(buffer: &mut Vec<u8>) -> anyhow::Result<bool> {
    if buffer.len() < 10 {
        return Ok(false);
    }
    if buffer[0] != 0x1f || buffer[1] != 0x8b || buffer[2] != 8 {
        return Err(anyhow::anyhow!("Invalid gzip header"));
    }

    let flags = buffer[3];
    let mut end = 10;

    if (flags & 0x04) != 0 {
        if buffer.len() < end + 2 {
            return Ok(false);
        }
        let extra_len = (buffer[end] as usize) | ((buffer[end + 1] as usize) << 8);
        end += 2;
        if buffer.len() < end + extra_len {
            return Ok(false);
        }
        end += extra_len;
    }

    if (flags & 0x08) != 0 {
        let mut null = end;
        let mut found = false;
        while null < buffer.len() {
            if buffer[null] == 0 {
                null += 1;
                found = true;
                break;
            }
            null += 1;
        }
        if !found {
            return Ok(false);
        }
        end = null;
    }

    if (flags & 0x10) != 0 {
        let mut null = end;
        let mut found = false;
        while null < buffer.len() {
            if buffer[null] == 0 {
                null += 1;
                found = true;
                break;
            }
            null += 1;
        }
        if !found {
            return Ok(false);
        }
        end = null;
    }

    if (flags & 0x02) != 0 {
        if buffer.len() < end + 2 {
            return Ok(false);
        }
        end += 2;
    }
    
    buffer.drain(..end);
    Ok(true)
}

impl<T: SplatReceiver> ChunkReceiver for SpzDecoder<T> {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        self.compressed.extend_from_slice(bytes);
        self.poll_decompress()?;
        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        self.poll_decompress()?;
        if !self.done { return Err(anyhow::anyhow!("Truncated gzip stream")); }
        if let Some(state) = &self.state {
            if state.stage != SpzDecoderStage::Done && !(state.sh_degree == 0 && state.stage == SpzDecoderStage::Sh) {
                return Err(anyhow::anyhow!("Incomplete SPZ stream: stage = {:?}, sh_degree = {}", state.stage, state.sh_degree));
            }
        } else {
            return Err(anyhow::anyhow!("Invalid SPZ stream"));
        }
        self.splats.finish()?;
        Ok(())
    }
}

struct SpzDecoderState {
    version: u32,
    num_splats: usize,
    sh_degree: usize,
    fractional_bits: u8,
    #[allow(unused)]
    flags: u8,
    next_splat: usize,
    stage: SpzDecoderStage,
    output: Vec<f32>,
    output_u16: Vec<u16>,
    output_usize: Vec<usize>,
}

impl SpzDecoderState {
    fn new(version: u32, num_splats: usize, sh_degree: usize, fractional_bits: u8, flags: u8) -> anyhow::Result<Self> {
        if sh_degree > 3 { return Err(anyhow::anyhow!("Invalid SH degree: {}", sh_degree)); }
        Ok(Self {
            version,
            num_splats,
            sh_degree,
            fractional_bits,
            flags,
            next_splat: 0,
            stage: SpzDecoderStage::Centers,
            output: Vec::with_capacity(MAX_SPLAT_CHUNK * 4),
            output_u16: Vec::new(),
            output_usize: Vec::new(),
        })
    }
}

#[inline]
fn read_u32_le(buf: &[u8]) -> u32 {
    u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]])
}

#[inline]
fn read_f16_le(two: &[u8]) -> f32 {
    let bits = u16::from_le_bytes([two[0], two[1]]);
    half::f16::from_bits(bits).to_f32()
}

#[inline]
fn read_i24_le(three: &[u8]) -> i32 {
    let v = (three[2] as u32) << 16 | (three[1] as u32) << 8 | (three[0] as u32);
    if (v & 0x0080_0000) != 0 { (v | 0xFF00_0000) as i32 } else { v as i32 }
}

#[inline]
fn read_u16_le(two: &[u8]) -> u16 {
    u16::from_le_bytes([two[0], two[1]])
}


pub struct SpzEncoder<T: SplatGetter> {
    getter: T,
    max_sh_out: Option<u8>,
    fractional_bits: u8,
}

impl<T: SplatGetter> SpzEncoder<T> {
    pub fn new(getter: T) -> Self { Self { getter, max_sh_out: None, fractional_bits: 12 } }

    pub fn with_max_sh(mut self, max_sh: u8) -> Self {
        self.max_sh_out = Some(max_sh.min(3));
        self
    }

    pub fn with_fractional_bits(mut self, bits: u8) -> Self {
        self.fractional_bits = bits.min(24);
        self
    }

    pub fn encode(mut self) -> anyhow::Result<Vec<u8>> {
        let num_splats = self.getter.num_splats();
        let sh_src = self.getter.max_sh_degree() as u8;
        let sh_degree = self.max_sh_out.map(|m| m.min(sh_src)).unwrap_or(sh_src);
        let fractional_bits = self.fractional_bits;
        let flag_antialias = self.getter.flag_antialias();
        let lod_tree = self.getter.has_lod_tree();
        let version = 2u32; // fixed for now; encoder writes v2 layout by default

        // Header (16 bytes)
        let mut raw = Vec::with_capacity(16 + num_splats * 64); // rough guess
        write_u32_le(&mut raw, SPZ_MAGIC);
        write_u32_le(&mut raw, version);
        write_u32_le(&mut raw, num_splats as u32);
        raw.push(sh_degree);
        raw.push(fractional_bits);
        let mut flags: u8 = 0;
        if flag_antialias { flags |= 0x01; }
        if lod_tree { flags |= 0x80; }
        raw.push(flags);
        raw.push(0); // reserved

        // Temporary buffers
        let mut f32_buf: Vec<f32> = Vec::new();
        let mut u16_buf: Vec<u16> = Vec::new();

        // Centers (i24 xyz)
        {
            let frac = (1_i32) << fractional_bits;
            let clamp_min = -0x7fffff; // keep consistent with prior writer
            let clamp_max = 0x7fffff;
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                ensure_len(&mut f32_buf, count * 3);
                self.getter.get_center(base, count, &mut f32_buf[..count * 3]);
                for i in 0..count {
                    let ix = (f32_buf[i * 3] * frac as f32).round() as i32;
                    let iy = (f32_buf[i * 3 + 1] * frac as f32).round() as i32;
                    let iz = (f32_buf[i * 3 + 2] * frac as f32).round() as i32;
                    write_i24_le(&mut raw, ix.clamp(clamp_min, clamp_max));
                    write_i24_le(&mut raw, iy.clamp(clamp_min, clamp_max));
                    write_i24_le(&mut raw, iz.clamp(clamp_min, clamp_max));
                }
                base += count;
            }
        }

        // Alphas (u8)
        {
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                ensure_len(&mut f32_buf, count);
                self.getter.get_opacity(base, count, &mut f32_buf[..count]);
                for i in 0..count {
                    let opacity = f32_buf[i];
                    let opacity = if lod_tree {
                        0.5 * opacity
                    } else {
                        opacity
                    };
                    let a = (opacity * 255.0).clamp(0.0, 255.0).round();
                    raw.push(a as u8);
                }
                base += count;
            }
        }

        // RGB (3*u8)
        {
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                ensure_len(&mut f32_buf, count * 3);
                self.getter.get_rgb(base, count, &mut f32_buf[..count * 3]);
                for i in 0..count {
                    let r = scale_rgb_byte(f32_buf[i * 3]);
                    let g = scale_rgb_byte(f32_buf[i * 3 + 1]);
                    let b = scale_rgb_byte(f32_buf[i * 3 + 2]);
                    raw.extend_from_slice(&[r, g, b]);
                }
                base += count;
            }
        }

        // Scales (3*u8 of ln scale)
        {
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                ensure_len(&mut f32_buf, count * 3);
                self.getter.get_scale(base, count, &mut f32_buf[..count * 3]);
                for i in 0..count {
                    let sx = ((f32_buf[i * 3].ln() + 10.0) * 16.0).round().clamp(0.0, 255.0) as u8;
                    let sy = ((f32_buf[i * 3 + 1].ln() + 10.0) * 16.0).round().clamp(0.0, 255.0) as u8;
                    let sz = ((f32_buf[i * 3 + 2].ln() + 10.0) * 16.0).round().clamp(0.0, 255.0) as u8;
                    raw.extend_from_slice(&[sx, sy, sz]);
                }
                base += count;
            }
        }

        // Quats
        if version == 3 {
            // Smallest-three (4 bytes)
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                ensure_len(&mut f32_buf, count * 4);
                self.getter.get_quat(base, count, &mut f32_buf[..count * 4]);
                for i in 0..count {
                    let q = &mut f32_buf[i * 4..i * 4 + 4];
                    // ensure unit and handle sign: choose largest index
                    let (idx, _) = (0..4)
                        .map(|k| (k, q[k].abs()))
                        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                        .unwrap();
                    let mut comp: u32 = (idx as u32) << 30;
                    let max_value: f32 = std::f32::consts::FRAC_1_SQRT_2;
                    let value_mask: u32 = (1u32 << 9) - 1;
                    for k in (0..4).rev() {
                        if k == idx { continue; }
                        let mut v = q[k].clamp(-max_value, max_value);
                        let sign = v.is_sign_negative();
                        if sign { v = -v; }
                        let mag = (v / max_value * value_mask as f32).round().clamp(0.0, value_mask as f32) as u32;
                        comp = (comp << 10) | ((sign as u32) << 9) | mag;
                    }
                    raw.extend_from_slice(&comp.to_le_bytes());
                }
                base += count;
            }
        } else {
            // 3 bytes (xyz), fold sign of w
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                ensure_len(&mut f32_buf, count * 4);
                self.getter.get_quat(base, count, &mut f32_buf[..count * 4]);
                for i in 0..count {
                    let qx = f32_buf[i * 4];
                    let qy = f32_buf[i * 4 + 1];
                    let qz = f32_buf[i * 4 + 2];
                    let qw = f32_buf[i * 4 + 3];
                    let neg = qw < 0.0;
                    let x = (((if neg { -qx } else { qx }) + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
                    let y = (((if neg { -qy } else { qy }) + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
                    let z = (((if neg { -qz } else { qz }) + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
                    raw.extend_from_slice(&[x, y, z]);
                }
                base += count;
            }
        }

        // SH blocks
        if sh_degree > 0 {
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                let bands = match sh_degree { 1 => 3, 2 => 8, 3 => 15, _ => 0 } as usize;
                let total_components = bands * 3;

                ensure_len(&mut f32_buf, count * total_components);
                
                if sh_degree >= 1 {
                    self.getter.get_sh1(base, count, &mut f32_buf[..count * 9]);
                }
                if sh_degree >= 2{
                    self.getter.get_sh2(base, count, &mut f32_buf[count * 9..count * 24]);
                }
                if sh_degree >= 3 {
                    self.getter.get_sh3(base, count, &mut f32_buf[count * 24..count * 45]);
                }

                for i in 0..count {
                    if sh_degree >= 1 {
                        for k in 0..9 {
                            raw.push(quantize_sh_byte(f32_buf[i * 9 + k], 5));
                        }
                    }

                    if sh_degree >= 2 {
                        for k in 0..15 {
                            raw.push(quantize_sh_byte(f32_buf[(count * 9) + i * 15 + k], 4));
                        }
                    }

                    if sh_degree >= 3 {
                        for k in 0..21 {
                            raw.push(quantize_sh_byte(f32_buf[(count * 24) + i * 21 + k], 4));
                        }
                    }
                }

                // let _ = bands; // silence warning in case of degree 0
                base += count;
            }
        }

        // LoD extension
        if lod_tree {
            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                ensure_len_u16(&mut u16_buf, count);
                self.getter.get_child_count(base, count, &mut u16_buf[..count]);
                for i in 0..count { raw.extend_from_slice(&u16_buf[i].to_le_bytes()); }
                base += count;
            }

            let mut base = 0usize;
            loop {
                if base >= num_splats { break; }
                let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
                let mut child_starts: Vec<usize> = vec![0; count];
                self.getter.get_child_start(base, count, &mut child_starts[..count]);
                for i in 0..count { raw.extend_from_slice(&(child_starts[i] as u32).to_le_bytes()); }
                base += count;
            }
        }

        // gzip: header + deflate(raw) + trailer(CRC32, ISIZE)
        let mut out = Vec::with_capacity(raw.len() / 2);
        // Header (no extra fields)
        out.extend_from_slice(&[0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff]);
        // Deflate payload (level 6 as a balanced default)
        let deflated = compress_to_vec(&raw, 6);
        out.extend_from_slice(&deflated);
        // Trailer
        let crc = crc32(&raw);
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        Ok(out)
    }
}

#[inline]
fn ensure_len(buf: &mut Vec<f32>, len: usize) {
    if buf.len() < len { buf.resize(len, 0.0); }
}

#[inline]
fn ensure_len_u16(buf: &mut Vec<u16>, len: usize) {
    if buf.len() < len { buf.resize(len, 0); }
}

#[inline]
fn write_u32_le(out: &mut Vec<u8>, v: u32) { out.extend_from_slice(&v.to_le_bytes()); }

#[inline]
fn write_i24_le(out: &mut Vec<u8>, v: i32) {
    out.push((v & 0xFF) as u8);
    out.push(((v >> 8) & 0xFF) as u8);
    out.push(((v >> 16) & 0xFF) as u8);
}

#[inline]
fn scale_rgb_byte(r: f32) -> u8 {
    let v = ((r - 0.5) / (SH_C0 / 0.15) + 0.5) * 255.0;
    v.round().clamp(0.0, 255.0) as u8
}

#[inline]
fn quantize_sh_byte(sh: f32, bits: u8) -> u8 {
    let mut value = (sh * 128.0).round() + 128.0;
    let bucket = 1u32 << (8 - bits);
    value = ((value + (bucket as f32) / 2.0) / bucket as f32).floor() * bucket as f32;
    value.round().clamp(0.0, 255.0) as u8
}

// Simple CRC32 (IEEE, polynomial 0xEDB88320)
#[inline]
fn crc32(bytes: &[u8]) -> u32 {
    const POLY: u32 = 0xEDB88320;
    static mut TABLE: [u32; 256] = [0; 256];
    static INIT: std::sync::Once = std::sync::Once::new();
    unsafe {
        INIT.call_once(|| {
            for i in 0..256u32 {
                let mut c = i;
                for _ in 0..8 {
                    c = if c & 1 != 0 { (c >> 1) ^ POLY } else { c >> 1 };
                }
                TABLE[i as usize] = c;
            }
        });
        let mut crc: u32 = 0xFFFF_FFFF;
        for &b in bytes {
            let idx = ((crc ^ b as u32) & 0xFF) as usize;
            crc = (crc >> 8) ^ TABLE[idx];
        }
        !crc
    }
}
