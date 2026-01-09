use anyhow::anyhow;
use half::f16;

use crate::decoder::{ChunkReceiver, SplatGetter, SplatInit, SplatProps, SplatReceiver};

const HEADER_BYTES: usize = 4096;
const SECTION_BYTES: usize = 1024;
const MAX_SPLAT_CHUNK: usize = 65536;

struct KsplatCompression {
    bytes_per_center: usize,
    bytes_per_scale: usize,
    bytes_per_rotation: usize,
    bytes_per_color: usize,
    bytes_per_sh_component: usize,
    scale_offset_bytes: usize,
    rotation_offset_bytes: usize,
    color_offset_bytes: usize,
    sh_offset_bytes: usize,
    scale_range: u32,
}

const KSPLAT_COMPRESSION: [KsplatCompression; 3] = [
    KsplatCompression {
        bytes_per_center: 12,
        bytes_per_scale: 12,
        bytes_per_rotation: 16,
        bytes_per_color: 4,
        bytes_per_sh_component: 4,
        scale_offset_bytes: 12,
        rotation_offset_bytes: 24,
        color_offset_bytes: 40,
        sh_offset_bytes: 44,
        scale_range: 1,
    },
    KsplatCompression {
        bytes_per_center: 6,
        bytes_per_scale: 6,
        bytes_per_rotation: 8,
        bytes_per_color: 4,
        bytes_per_sh_component: 2,
        scale_offset_bytes: 6,
        rotation_offset_bytes: 12,
        color_offset_bytes: 20,
        sh_offset_bytes: 24,
        scale_range: 32767,
    },
    KsplatCompression {
        bytes_per_center: 6,
        bytes_per_scale: 6,
        bytes_per_rotation: 8,
        bytes_per_color: 4,
        bytes_per_sh_component: 1,
        scale_offset_bytes: 6,
        rotation_offset_bytes: 12,
        color_offset_bytes: 20,
        sh_offset_bytes: 24,
        scale_range: 32767,
    },
];

const SH_COMPONENTS: [usize; 4] = [0, 9, 24, 45];
const SH1_INDEX: [usize; 9] = [0, 3, 6, 1, 4, 7, 2, 5, 8];
const SH2_INDEX: [usize; 15] = [9, 14, 19, 10, 15, 20, 11, 16, 21, 12, 17, 22, 13, 18, 23];
const SH3_INDEX: [usize; 21] = [24, 31, 38, 25, 32, 39, 26, 33, 40, 27, 34, 41, 28, 35, 42, 29, 36, 43, 30, 37, 44];

pub struct KsplatDecoder<T: SplatReceiver> {
    splats: T,
    buffer: Vec<u8>,
}

impl<T: SplatReceiver> KsplatDecoder<T> {
    pub fn new(splats: T) -> Self {
        Self {
            splats,
            buffer: Vec::new(),
        }
    }

    pub fn into_splats(self) -> T {
        self.splats
    }
}

impl<T: SplatReceiver> ChunkReceiver for KsplatDecoder<T> {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        self.buffer.extend_from_slice(bytes);
        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        if self.buffer.len() < HEADER_BYTES {
            return Err(anyhow!("File too small for ksplat header"));
        }

        let version_major = self.buffer[0];
        let version_minor = self.buffer[1];
        if version_major != 0 || version_minor < 1 {
            return Err(anyhow!("Unsupported .ksplat version: {version_major}.{version_minor}"));
        }

        let max_section_count = read_u32(&self.buffer, 4)? as usize;
        let num_splats = read_u32(&self.buffer, 16)? as usize;
        let compression_level = read_u16(&self.buffer, 20)? as usize;
        if compression_level > 2 {
            return Err(anyhow!("Invalid compression level {compression_level}"));
        }
        let comp = &KSPLAT_COMPRESSION[compression_level];

        let min_sh = {
            let v = read_f32(&self.buffer, 36)?;
            if v == 0.0 { -1.5 } else { v }
        };
        let max_sh = {
            let v = read_f32(&self.buffer, 40)?;
            if v == 0.0 { 1.5 } else { v }
        };

        // Pre-scan sections to determine global max SH degree
        let mut header_offset = HEADER_BYTES;
        let mut section_base = HEADER_BYTES + max_section_count * SECTION_BYTES;
        let mut max_sh_degree = 0usize;
        for _ in 0..max_section_count {
            if header_offset + SECTION_BYTES > self.buffer.len() {
                return Err(anyhow!("Unexpected end of file while reading section headers"));
            }
            let sh_degree = read_u16(&self.buffer, header_offset + 40)? as usize;
            if sh_degree > max_sh_degree {
                max_sh_degree = sh_degree;
            }
            // Advance base using stored sizes to stay aligned even if section_splat_count is zero
            let section_max_splat_count = read_u32(&self.buffer, header_offset + 4)? as usize;
            let sh_components = SH_COMPONENTS.get(sh_degree).copied().unwrap_or(0);
            let bytes_per_splat = comp.bytes_per_center
                + comp.bytes_per_scale
                + comp.bytes_per_rotation
                + comp.bytes_per_color
                + sh_components * comp.bytes_per_sh_component;
            let bucket_storage_size_bytes = read_u16(&self.buffer, header_offset + 20)? as usize;
            let bucket_count = read_u32(&self.buffer, header_offset + 12)? as usize;
            let buckets_meta = read_u32(&self.buffer, header_offset + 36)? as usize * 4;
            let buckets_storage_size_bytes = bucket_storage_size_bytes * bucket_count + buckets_meta;
            let storage_size_bytes = bytes_per_splat * section_max_splat_count + buckets_storage_size_bytes;
            section_base = section_base.checked_add(storage_size_bytes).ok_or_else(|| anyhow!("Section size overflow"))?;
            header_offset += SECTION_BYTES;
        }

        self.splats.init_splats(&SplatInit {
            num_splats,
            max_sh_degree,
            lod_tree: false,
        })?;

        // Decode sections
        header_offset = HEADER_BYTES;
        section_base = HEADER_BYTES + max_section_count * SECTION_BYTES;
        let mut total_decoded = 0usize;
        for _ in 0..max_section_count {
            if header_offset + SECTION_BYTES > self.buffer.len() {
                return Err(anyhow!("Unexpected end of file while reading section headers"));
            }
            let section_splat_count = read_u32(&self.buffer, header_offset + 0)? as usize;
            let section_max_splat_count = read_u32(&self.buffer, header_offset + 4)? as usize;
            let bucket_size = read_u32(&self.buffer, header_offset + 8)? as usize;
            let bucket_count = read_u32(&self.buffer, header_offset + 12)? as usize;
            let bucket_block_size = read_f32(&self.buffer, header_offset + 16)?;
            let bucket_storage_size_bytes = read_u16(&self.buffer, header_offset + 20)? as usize;
            let compression_scale_range = {
                let raw = read_u32(&self.buffer, header_offset + 24)?;
                if raw == 0 { comp.scale_range } else { raw }
            } as f32;
            let full_bucket_count = read_u32(&self.buffer, header_offset + 32)? as usize;
            let partially_filled_bucket_count = read_u32(&self.buffer, header_offset + 36)? as usize;
            let sh_degree = read_u16(&self.buffer, header_offset + 40)? as usize;
            let sh_components = SH_COMPONENTS.get(sh_degree).copied().unwrap_or(0);

            let buckets_storage_size_bytes = bucket_storage_size_bytes * bucket_count + partially_filled_bucket_count * 4;
            let bytes_per_splat = comp.bytes_per_center
                + comp.bytes_per_scale
                + comp.bytes_per_rotation
                + comp.bytes_per_color
                + sh_components * comp.bytes_per_sh_component;
            let splat_data_storage_size_bytes = bytes_per_splat
                .checked_mul(section_max_splat_count)
                .ok_or_else(|| anyhow!("Section data size overflow"))?;
            let storage_size_bytes = splat_data_storage_size_bytes + buckets_storage_size_bytes;

            if section_base + storage_size_bytes > self.buffer.len() {
                return Err(anyhow!("Truncated ksplat file"));
            }

            // Buckets
            let buckets_base = section_base + partially_filled_bucket_count * 4;
            let bucket_array = if bucket_count > 0 {
                let len_bytes = bucket_count * 3 * std::mem::size_of::<f32>();
                if buckets_base + len_bytes > self.buffer.len() {
                    return Err(anyhow!("Bucket array out of bounds"));
                }
                Some(unsafe {
                    std::slice::from_raw_parts(
                        self.buffer.as_ptr().add(buckets_base) as *const f32,
                        bucket_count * 3,
                    )
                })
            } else {
                None
            };
            let partially_filled_lengths = if partially_filled_bucket_count > 0 {
                Some(unsafe {
                    std::slice::from_raw_parts(
                        self.buffer.as_ptr().add(section_base) as *const u32,
                        partially_filled_bucket_count,
                    )
                })
            } else {
                None
            };

            // Data view
            let data_base = section_base + buckets_storage_size_bytes;
            let data = &self.buffer[data_base..data_base + splat_data_storage_size_bytes];

            // Output buffers
            let mut center: Vec<f32> = vec![0.0; section_splat_count * 3];
            let mut scale: Vec<f32> = vec![0.0; section_splat_count * 3];
            let mut quat: Vec<f32> = vec![0.0; section_splat_count * 4];
            let mut rgb: Vec<f32> = vec![0.0; section_splat_count * 3];
            let mut opacity: Vec<f32> = vec![0.0; section_splat_count];
            let mut sh1: Vec<f32> = if sh_degree >= 1 { vec![0.0; section_splat_count * 9] } else { Vec::new() };
            let mut sh2: Vec<f32> = if sh_degree >= 2 { vec![0.0; section_splat_count * 15] } else { Vec::new() };
            let mut sh3: Vec<f32> = if sh_degree >= 3 { vec![0.0; section_splat_count * 21] } else { Vec::new() };

            let compression_scale_factor = if compression_level == 0 {
                0.0
            } else {
                bucket_block_size / 2.0 / compression_scale_range
            };

            let mut partial_bucket_index = full_bucket_count;
            let mut partial_bucket_base = full_bucket_count * bucket_size;

            for i in 0..section_splat_count {
                let splat_offset = i * bytes_per_splat;

                let bucket_index = if i < full_bucket_count * bucket_size {
                    i / bucket_size
                } else {
                    if let Some(lengths) = partially_filled_lengths {
                        let idx = partial_bucket_index.checked_sub(full_bucket_count).unwrap_or(0);
                        if idx < lengths.len() && i >= partial_bucket_base + lengths[idx] as usize {
                            partial_bucket_index += 1;
                            partial_bucket_base += lengths[idx] as usize;
                        }
                    }
                    partial_bucket_index
                };

                let i3 = i * 3;
                let i4 = i * 4;
                let bucket_center = |d: usize| -> f32 {
                    bucket_array
                        .and_then(|arr| arr.get(bucket_index * 3 + d).copied())
                        .unwrap_or(0.0)
                };

                // Centers
                center[i3 + 0] = if compression_level == 0 {
                    read_f32(data, splat_offset + 0)?
                } else {
                    let raw = read_u16(data, splat_offset + 0)? as f32;
                    (raw - comp.scale_range as f32) * compression_scale_factor + bucket_center(0)
                };
                center[i3 + 1] = if compression_level == 0 {
                    read_f32(data, splat_offset + 4)?
                } else {
                    let raw = read_u16(data, splat_offset + 2)? as f32;
                    (raw - comp.scale_range as f32) * compression_scale_factor + bucket_center(1)
                };
                center[i3 + 2] = if compression_level == 0 {
                    read_f32(data, splat_offset + 8)?
                } else {
                    let raw = read_u16(data, splat_offset + 4)? as f32;
                    (raw - comp.scale_range as f32) * compression_scale_factor + bucket_center(2)
                };

                // Scales
                let so = comp.scale_offset_bytes;
                scale[i3 + 0] = read_scale(data, splat_offset + so + 0, compression_level)?;
                scale[i3 + 1] = read_scale(data, splat_offset + so + if compression_level == 0 { 4 } else { 2 }, compression_level)?;
                scale[i3 + 2] = read_scale(data, splat_offset + so + if compression_level == 0 { 8 } else { 4 }, compression_level)?;

                // Quaternion (stored w,x,y,z)
                let ro = comp.rotation_offset_bytes;
                let qw = read_quat(data, splat_offset + ro + 0, compression_level)?;
                let qx = read_quat(data, splat_offset + ro + if compression_level == 0 { 4 } else { 2 }, compression_level)?;
                let qy = read_quat(data, splat_offset + ro + if compression_level == 0 { 8 } else { 4 }, compression_level)?;
                let qz = read_quat(data, splat_offset + ro + if compression_level == 0 { 12 } else { 6 }, compression_level)?;
                quat[i4 + 0] = qx;
                quat[i4 + 1] = qy;
                quat[i4 + 2] = qz;
                quat[i4 + 3] = qw;

                // Color/opacity
                let co = comp.color_offset_bytes;
                rgb[i3 + 0] = data[splat_offset + co + 0] as f32 / 255.0;
                rgb[i3 + 1] = data[splat_offset + co + 1] as f32 / 255.0;
                rgb[i3 + 2] = data[splat_offset + co + 2] as f32 / 255.0;
                opacity[i] = data[splat_offset + co + 3] as f32 / 255.0;

                // SH components
                if sh_degree >= 1 {
                    let sh_base = comp.sh_offset_bytes;
                    let read_sh = |component: usize| -> anyhow::Result<f32> {
                        let offset = splat_offset + sh_base
                            + component * comp.bytes_per_sh_component;
                        if compression_level == 0 {
                            read_f32(data, offset)
                        } else if compression_level == 1 {
                            Ok(f16::from_bits(read_u16(data, offset)?).to_f32())
                        } else {
                            let t = data.get(offset).copied().ok_or_else(|| anyhow!("SH byte out of bounds"))? as f32 / 255.0;
                            Ok(min_sh + t * (max_sh - min_sh))
                        }
                    };

                    let sh1_base = i * 9;
                    for (dst, key) in SH1_INDEX.iter().enumerate() {
                        sh1[sh1_base + dst] = read_sh(*key)?;
                    }
                    if sh_degree >= 2 {
                        let base = i * 15;
                        for (dst, key) in SH2_INDEX.iter().enumerate() {
                            sh2[base + dst] = read_sh(*key)?;
                        }
                    }
                    if sh_degree >= 3 {
                        let base = i * 21;
                        for (dst, key) in SH3_INDEX.iter().enumerate() {
                            sh3[base + dst] = read_sh(*key)?;
                        }
                    }
                }
            }

            // Emit to receiver, chunked
            let mut base_out = total_decoded;
            let mut remaining = section_splat_count;
            while remaining > 0 {
                let count = remaining.min(MAX_SPLAT_CHUNK);
                self.splats.set_batch(
                    base_out,
                    count,
                    &SplatProps {
                        center: &center[(base_out - total_decoded) * 3..][..count * 3],
                        opacity: &opacity[(base_out - total_decoded)..][..count],
                        rgb: &rgb[(base_out - total_decoded) * 3..][..count * 3],
                        scale: &scale[(base_out - total_decoded) * 3..][..count * 3],
                        quat: &quat[(base_out - total_decoded) * 4..][..count * 4],
                        sh1: if sh_degree >= 1 { &sh1[(base_out - total_decoded) * 9..][..count * 9] } else { &[] },
                        sh2: if sh_degree >= 2 { &sh2[(base_out - total_decoded) * 15..][..count * 15] } else { &[] },
                        sh3: if sh_degree >= 3 { &sh3[(base_out - total_decoded) * 21..][..count * 21] } else { &[] },
                        ..Default::default()
                    },
                );
                base_out += count;
                remaining -= count;
            }

            total_decoded += section_splat_count;
            section_base += storage_size_bytes;
            header_offset += SECTION_BYTES;
        }

        self.splats.finish()?;
        Ok(())
    }
}

pub struct KsplatEncoder<T: SplatGetter> {
    getter: T,
    compression_level: u16,
    min_sh: f32,
    max_sh: f32,
}

impl<T: SplatGetter> KsplatEncoder<T> {
    pub fn new(getter: T) -> Self {
        Self {
            getter,
            compression_level: 0,
            min_sh: -1.5,
            max_sh: 1.5,
        }
    }

    #[allow(dead_code)]
    pub fn with_compression_level(mut self, level: u16) -> Self {
        self.compression_level = level.min(2);
        self
    }

    #[allow(dead_code)]
    pub fn with_sh_range(mut self, min_sh: f32, max_sh: f32) -> Self {
        self.min_sh = min_sh;
        self.max_sh = max_sh;
        self
    }

    pub fn encode(mut self) -> anyhow::Result<Vec<u8>> {
        if self.compression_level != 0 {
            return Err(anyhow!("Ksplat encoder currently supports compression level 0 only"));
        }

        let num_splats = self.getter.num_splats();
        let sh_degree = self.getter.max_sh_degree().min(3);
        let sh_components = SH_COMPONENTS[sh_degree];
        let comp = &KSPLAT_COMPRESSION[self.compression_level as usize];
        let bytes_per_splat = comp.bytes_per_center
            + comp.bytes_per_scale
            + comp.bytes_per_rotation
            + comp.bytes_per_color
            + sh_components * comp.bytes_per_sh_component;

        let max_section_count = 1u32;
        let section_splat_count = num_splats as u32;
        let section_max_splat_count = section_splat_count;
        let bucket_size = section_splat_count.max(1);
        let bucket_count = 1u32;
        let bucket_storage_size_bytes = 0u16;
        let buckets_storage_size_bytes = 0usize;
        let splat_data_storage_size_bytes = bytes_per_splat * section_max_splat_count as usize;
        let storage_size_bytes = splat_data_storage_size_bytes + buckets_storage_size_bytes;

        let data_base = HEADER_BYTES + (max_section_count as usize) * SECTION_BYTES;
        let total_size = data_base + storage_size_bytes;
        let mut out = vec![0u8; total_size];

        // Main header
        out[0] = 0; // major
        out[1] = 1; // minor
        write_u32(&mut out, 4, max_section_count)?;
        write_u32(&mut out, 16, section_splat_count)?;
        write_u16(&mut out, 20, self.compression_level)?;
        write_f32(&mut out, 36, self.min_sh)?;
        write_f32(&mut out, 40, self.max_sh)?;

        // Section header (only one)
        let section_header = HEADER_BYTES;
        write_u32(&mut out, section_header + 0, section_splat_count)?;
        write_u32(&mut out, section_header + 4, section_max_splat_count)?;
        write_u32(&mut out, section_header + 8, bucket_size)?;
        write_u32(&mut out, section_header + 12, bucket_count)?;
        write_f32(&mut out, section_header + 16, 0.0)?; // bucketBlockSize
        write_u16(&mut out, section_header + 20, bucket_storage_size_bytes)?;
        write_u32(&mut out, section_header + 24, comp.scale_range)?;
        write_u32(&mut out, section_header + 32, 1)?; // fullBucketCount
        write_u32(&mut out, section_header + 36, 0)?; // partiallyFilledBucketCount
        write_u16(&mut out, section_header + 40, sh_degree as u16)?;

        // Data region
        let mut offset = data_base + buckets_storage_size_bytes;

        // Buffers
        let mut center: Vec<f32> = Vec::new();
        let mut scale: Vec<f32> = Vec::new();
        let mut quat: Vec<f32> = Vec::new();
        let mut rgb: Vec<f32> = Vec::new();
        let mut opacity: Vec<f32> = Vec::new();
        let mut sh1: Vec<f32> = Vec::new();
        let mut sh2: Vec<f32> = Vec::new();
        let mut sh3: Vec<f32> = Vec::new();

        let mut base = 0usize;
        while base < num_splats {
            let count = (num_splats - base).min(MAX_SPLAT_CHUNK);

            ensure_len(&mut center, count * 3);
            ensure_len(&mut scale, count * 3);
            ensure_len(&mut quat, count * 4);
            ensure_len(&mut rgb, count * 3);
            ensure_len(&mut opacity, count);
            if sh_degree >= 1 { ensure_len(&mut sh1, count * 9); }
            if sh_degree >= 2 { ensure_len(&mut sh2, count * 15); }
            if sh_degree >= 3 { ensure_len(&mut sh3, count * 21); }

            self.getter.get_center(base, count, &mut center[..count * 3]);
            self.getter.get_scale(base, count, &mut scale[..count * 3]);
            self.getter.get_quat(base, count, &mut quat[..count * 4]);
            self.getter.get_rgb(base, count, &mut rgb[..count * 3]);
            self.getter.get_opacity(base, count, &mut opacity[..count]);
            if sh_degree >= 1 { self.getter.get_sh1(base, count, &mut sh1[..count * 9]); }
            if sh_degree >= 2 { self.getter.get_sh2(base, count, &mut sh2[..count * 15]); }
            if sh_degree >= 3 { self.getter.get_sh3(base, count, &mut sh3[..count * 21]); }

            for i in 0..count {
                let i3 = i * 3;
                let i4 = i * 4;

                write_f32(&mut out, offset + 0, center[i3 + 0])?;
                write_f32(&mut out, offset + 4, center[i3 + 1])?;
                write_f32(&mut out, offset + 8, center[i3 + 2])?;

                write_f32(&mut out, offset + comp.scale_offset_bytes + 0, scale[i3 + 0])?;
                write_f32(&mut out, offset + comp.scale_offset_bytes + 4, scale[i3 + 1])?;
                write_f32(&mut out, offset + comp.scale_offset_bytes + 8, scale[i3 + 2])?;

                write_f32(&mut out, offset + comp.rotation_offset_bytes + 0, quat[i4 + 3])?; // w
                write_f32(&mut out, offset + comp.rotation_offset_bytes + 4, quat[i4 + 0])?; // x
                write_f32(&mut out, offset + comp.rotation_offset_bytes + 8, quat[i4 + 1])?; // y
                write_f32(&mut out, offset + comp.rotation_offset_bytes + 12, quat[i4 + 2])?; // z

                out[offset + comp.color_offset_bytes + 0] = float_to_byte(rgb[i3 + 0]);
                out[offset + comp.color_offset_bytes + 1] = float_to_byte(rgb[i3 + 1]);
                out[offset + comp.color_offset_bytes + 2] = float_to_byte(rgb[i3 + 2]);
                out[offset + comp.color_offset_bytes + 3] = float_to_byte(opacity[i]);

                if sh_degree >= 1 {
                    let sh_base = comp.sh_offset_bytes;
                    for (src, key) in SH1_INDEX.iter().enumerate() {
                        write_f32(&mut out, offset + sh_base + key * comp.bytes_per_sh_component, sh1[i * 9 + src])?;
                    }
                    if sh_degree >= 2 {
                        for (src, key) in SH2_INDEX.iter().enumerate() {
                            write_f32(&mut out, offset + sh_base + key * comp.bytes_per_sh_component, sh2[i * 15 + src])?;
                        }
                    }
                    if sh_degree >= 3 {
                        for (src, key) in SH3_INDEX.iter().enumerate() {
                            write_f32(&mut out, offset + sh_base + key * comp.bytes_per_sh_component, sh3[i * 21 + src])?;
                        }
                    }
                }

                offset += bytes_per_splat;
            }

            base += count;
        }

        Ok(out)
    }
}

#[inline]
fn ensure_len(buf: &mut Vec<f32>, len: usize) {
    if buf.len() < len {
        buf.resize(len, 0.0);
    }
}

#[inline]
fn float_to_byte(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round().clamp(0.0, 255.0) as u8
}

#[inline]
fn read_u16(buf: &[u8], offset: usize) -> anyhow::Result<u16> {
    buf.get(offset..offset + 2)
        .ok_or_else(|| anyhow!("Unexpected EOF"))
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
}

#[inline]
fn read_u32(buf: &[u8], offset: usize) -> anyhow::Result<u32> {
    buf.get(offset..offset + 4)
        .ok_or_else(|| anyhow!("Unexpected EOF"))
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

#[inline]
fn read_f32(buf: &[u8], offset: usize) -> anyhow::Result<f32> {
    buf.get(offset..offset + 4)
        .ok_or_else(|| anyhow!("Unexpected EOF"))
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

#[inline]
fn write_u16(out: &mut [u8], offset: usize, value: u16) -> anyhow::Result<()> {
    let bytes = value.to_le_bytes();
    out.get_mut(offset..offset + 2).ok_or_else(|| anyhow!("Write OOB"))?.copy_from_slice(&bytes);
    Ok(())
}

#[inline]
fn write_u32(out: &mut [u8], offset: usize, value: u32) -> anyhow::Result<()> {
    let bytes = value.to_le_bytes();
    out.get_mut(offset..offset + 4).ok_or_else(|| anyhow!("Write OOB"))?.copy_from_slice(&bytes);
    Ok(())
}

#[inline]
fn write_f32(out: &mut [u8], offset: usize, value: f32) -> anyhow::Result<()> {
    let bytes = value.to_le_bytes();
    out.get_mut(offset..offset + 4).ok_or_else(|| anyhow!("Write OOB"))?.copy_from_slice(&bytes);
    Ok(())
}

#[inline]
fn read_scale(data: &[u8], offset: usize, compression_level: usize) -> anyhow::Result<f32> {
    if compression_level == 0 {
        read_f32(data, offset)
    } else {
        Ok(f16::from_bits(read_u16(data, offset)?).to_f32())
    }
}

#[inline]
fn read_quat(data: &[u8], offset: usize, compression_level: usize) -> anyhow::Result<f32> {
    if compression_level == 0 {
        read_f32(data, offset)
    } else {
        Ok(f16::from_bits(read_u16(data, offset)?).to_f32())
    }
}

