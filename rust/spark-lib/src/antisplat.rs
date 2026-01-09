use anyhow::anyhow;

use crate::decoder::{ChunkReceiver, SplatGetter, SplatInit, SplatProps, SplatReceiver};

pub const ANTISPLAT_BYTES_PER_SPLAT: usize = 32;
const MAX_SPLAT_CHUNK: usize = 65536;

pub struct AntiSplatDecoder<T: SplatReceiver> {
    splats: T,
    buffer: Vec<u8>,
}

impl<T: SplatReceiver> AntiSplatDecoder<T> {
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

impl<T: SplatReceiver> ChunkReceiver for AntiSplatDecoder<T> {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        self.buffer.extend_from_slice(bytes);
        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        let len = self.buffer.len();
        if len % ANTISPLAT_BYTES_PER_SPLAT != 0 {
            return Err(anyhow!("Invalid .splat file size"));
        }

        let num_splats = len / ANTISPLAT_BYTES_PER_SPLAT;
        self.splats.init_splats(&SplatInit {
            num_splats,
            max_sh_degree: 0,
            lod_tree: false,
        })?;

        let mut center: Vec<f32> = Vec::new();
        let mut opacity: Vec<f32> = Vec::new();
        let mut rgb: Vec<f32> = Vec::new();
        let mut scale: Vec<f32> = Vec::new();
        let mut quat: Vec<f32> = Vec::new();

        let mut base = 0usize;
        while base < num_splats {
            let count = (num_splats - base).min(MAX_SPLAT_CHUNK);

            if center.len() < count * 3 {
                center.resize(count * 3, 0.0);
            }
            if opacity.len() < count {
                opacity.resize(count, 0.0);
            }
            if rgb.len() < count * 3 {
                rgb.resize(count * 3, 0.0);
            }
            if scale.len() < count * 3 {
                scale.resize(count * 3, 0.0);
            }
            if quat.len() < count * 4 {
                quat.resize(count * 4, 0.0);
            }

            for i in 0..count {
                let splat_index = base + i;
                let byte_base = splat_index * ANTISPLAT_BYTES_PER_SPLAT;
                let float_base = splat_index * 8; // 8 floats fit in 32 bytes

                let x = read_f32(&self.buffer, float_base + 0);
                let y = read_f32(&self.buffer, float_base + 1);
                let z = read_f32(&self.buffer, float_base + 2);
                let sx = read_f32(&self.buffer, float_base + 3);
                let sy = read_f32(&self.buffer, float_base + 4);
                let sz = read_f32(&self.buffer, float_base + 5);

                let i3 = i * 3;
                center[i3 + 0] = x;
                center[i3 + 1] = y;
                center[i3 + 2] = z;

                scale[i3 + 0] = sx;
                scale[i3 + 1] = sy;
                scale[i3 + 2] = sz;

                rgb[i3 + 0] = self.buffer[byte_base + 24] as f32 / 255.0;
                rgb[i3 + 1] = self.buffer[byte_base + 25] as f32 / 255.0;
                rgb[i3 + 2] = self.buffer[byte_base + 26] as f32 / 255.0;

                opacity[i] = self.buffer[byte_base + 27] as f32 / 255.0;

                let qw = (self.buffer[byte_base + 28] as f32 - 128.0) / 128.0;
                let qx = (self.buffer[byte_base + 29] as f32 - 128.0) / 128.0;
                let qy = (self.buffer[byte_base + 30] as f32 - 128.0) / 128.0;
                let qz = (self.buffer[byte_base + 31] as f32 - 128.0) / 128.0;

                let i4 = i * 4;
                quat[i4 + 0] = qx;
                quat[i4 + 1] = qy;
                quat[i4 + 2] = qz;
                quat[i4 + 3] = qw;
            }

            self.splats.set_batch(
                base,
                count,
                &SplatProps {
                    center: &center[..count * 3],
                    opacity: &opacity[..count],
                    rgb: &rgb[..count * 3],
                    scale: &scale[..count * 3],
                    quat: &quat[..count * 4],
                    ..Default::default()
                },
            );

            base += count;
        }

        self.splats.finish()?;
        Ok(())
    }
}

pub struct AntiSplatEncoder<T: SplatGetter> {
    getter: T,
}

impl<T: SplatGetter> AntiSplatEncoder<T> {
    pub fn new(getter: T) -> Self { Self { getter } }

    pub fn encode(mut self) -> anyhow::Result<Vec<u8>> {
        let num_splats = self.getter.num_splats();
        if self.getter.max_sh_degree() > 0 {
            return Err(anyhow!("AntiSplat format does not store SH data"));
        }

        let mut out = Vec::with_capacity(num_splats * ANTISPLAT_BYTES_PER_SPLAT);

        let mut center: Vec<f32> = Vec::new();
        let mut opacity: Vec<f32> = Vec::new();
        let mut rgb: Vec<f32> = Vec::new();
        let mut scale: Vec<f32> = Vec::new();
        let mut quat: Vec<f32> = Vec::new();

        let mut base = 0usize;
        while base < num_splats {
            let count = (num_splats - base).min(MAX_SPLAT_CHUNK);

            ensure_len(&mut center, count * 3);
            ensure_len(&mut opacity, count);
            ensure_len(&mut rgb, count * 3);
            ensure_len(&mut scale, count * 3);
            ensure_len(&mut quat, count * 4);

            self.getter.get_center(base, count, &mut center[..count * 3]);
            self.getter.get_opacity(base, count, &mut opacity[..count]);
            self.getter.get_rgb(base, count, &mut rgb[..count * 3]);
            self.getter.get_scale(base, count, &mut scale[..count * 3]);
            self.getter.get_quat(base, count, &mut quat[..count * 4]);

            for i in 0..count {
                let i3 = i * 3;
                let i4 = i * 4;

                write_f32_le(&mut out, center[i3 + 0]);
                write_f32_le(&mut out, center[i3 + 1]);
                write_f32_le(&mut out, center[i3 + 2]);

                write_f32_le(&mut out, scale[i3 + 0]);
                write_f32_le(&mut out, scale[i3 + 1]);
                write_f32_le(&mut out, scale[i3 + 2]);

                out.push(scale_to_byte(rgb[i3 + 0]));
                out.push(scale_to_byte(rgb[i3 + 1]));
                out.push(scale_to_byte(rgb[i3 + 2]));

                out.push(scale_to_byte(opacity[i]));

                let qw = quat[i4 + 3];
                let qx = quat[i4 + 0];
                let qy = quat[i4 + 1];
                let qz = quat[i4 + 2];

                out.push(quantize_quat(qw));
                out.push(quantize_quat(qx));
                out.push(quantize_quat(qy));
                out.push(quantize_quat(qz));
            }

            base += count;
        }

        Ok(out)
    }
}

#[inline]
fn read_f32(bytes: &[u8], f32_index: usize) -> f32 {
    let offset = f32_index * 4;
    let arr: [u8; 4] = bytes[offset..offset + 4].try_into().unwrap();
    f32::from_le_bytes(arr)
}

#[inline]
fn write_f32_le(out: &mut Vec<u8>, v: f32) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn scale_to_byte(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round().clamp(0.0, 255.0) as u8
}

#[inline]
fn quantize_quat(v: f32) -> u8 {
    let clamped = v.clamp(-1.0, 1.0);
    ((clamped * 128.0).round() + 128.0).clamp(0.0, 255.0) as u8
}

#[inline]
fn ensure_len(buf: &mut Vec<f32>, len: usize) {
    if buf.len() < len {
        buf.resize(len, 0.0);
    }
}

