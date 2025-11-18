use std::any::Any;

use miniz_oxide::inflate::{core::{decompress, inflate_flags::{TINFL_FLAG_HAS_MORE_INPUT, TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF}, DecompressorOxide}, TINFLStatus};
use serde::Serialize;

use crate::{
    ply::{PlyDecoder, PLY_MAGIC},
    spz::{SpzDecoder, SPZ_MAGIC},
};

pub trait ChunkReceiver: Any {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()>;
    fn finish(&mut self) -> anyhow::Result<()>;
}

impl dyn ChunkReceiver {
    pub fn into_any(self: Box<Self>) -> Box<dyn Any> { self }
}

#[derive(Debug, Clone)]
pub struct SplatInit {
    pub num_splats: usize,
    pub max_sh_degree: usize,
    pub lod_tree: bool,
}

impl Default for SplatInit {
    fn default() -> Self {
        Self {
            num_splats: 0,
            max_sh_degree: 0,
            lod_tree: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SplatEncoding {
    #[serde(rename = "rgbMin")]
    pub rgb_min: f32,
    #[serde(rename = "rgbMax")]
    pub rgb_max: f32,
    #[serde(rename = "lnScaleMin")]
    pub ln_scale_min: f32,
    #[serde(rename = "lnScaleMax")]
    pub ln_scale_max: f32,
    #[serde(rename = "sh1Min")]
    pub sh1_min: f32,
    #[serde(rename = "sh1Max")]
    pub sh1_max: f32,
    #[serde(rename = "sh2Min")]
    pub sh2_min: f32,
    #[serde(rename = "sh2Max")]
    pub sh2_max: f32,
    #[serde(rename = "sh3Min")]
    pub sh3_min: f32,
    #[serde(rename = "sh3Max")]
    pub sh3_max: f32,
    #[serde(rename = "lodOpacity")]
    pub lod_opacity: bool,
}

impl Default for SplatEncoding {
    fn default() -> Self {
        Self {
            rgb_min: 0.0,
            rgb_max: 1.0,
            ln_scale_min: -12.0,
            ln_scale_max: 9.0,
            sh1_min: -1.0,
            sh1_max: 1.0,
            sh2_min: -1.0,
            sh2_max: 1.0,
            sh3_min: -1.0,
            sh3_max: 1.0,
            lod_opacity: false,
        }
    }
}

#[derive(Default,Debug, Clone)]
pub struct SetSplatEncoding {
    pub rgb_min: Option<f32>,
    pub rgb_max: Option<f32>,
    pub ln_scale_min: Option<f32>,
    pub ln_scale_max: Option<f32>,
    pub sh1_min: Option<f32>,
    pub sh1_max: Option<f32>,
    pub sh2_min: Option<f32>,
    pub sh2_max: Option<f32>,
    pub sh3_min: Option<f32>,
    pub sh3_max: Option<f32>,
    pub lod_opacity: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct SplatProps<'a> {
    pub center: &'a [f32],
    pub opacity: &'a [f32],
    pub rgb: &'a [f32],
    pub scale: &'a [f32],
    pub quat: &'a [f32],
    pub sh1: &'a [f32],
    pub sh2: &'a [f32],
    pub sh3: &'a [f32],
    pub child_count: &'a [u16],
    pub child_start: &'a [usize],
}

impl<'a> Default for SplatProps<'a> {
    fn default() -> Self {
        Self {
            center: &[],
            opacity: &[],
            rgb: &[],
            scale: &[],
            quat: &[],
            sh1: &[],
            sh2: &[],
            sh3: &[],
            child_count: &[],
            child_start: &[],
        }
    }
}

#[allow(unused)]
pub trait SplatReceiver: 'static {
    fn init_splats(&mut self, init: &SplatInit) -> anyhow::Result<()> { Ok(()) }
    fn finish(&mut self) -> anyhow::Result<()> { Ok(()) }
    fn debug(&self, value: usize) { println!("debug: {}", value); }
    fn set_encoding(&mut self, encoding: &SetSplatEncoding) -> anyhow::Result<()> { Ok(()) }
    fn set_batch(&mut self, base: usize, count: usize, batch: &SplatProps);
    fn set_center(&mut self, base: usize, count: usize, center: &[f32]);
    fn set_opacity(&mut self, base: usize, count: usize, opacity: &[f32]);
    fn set_rgb(&mut self, base: usize, count: usize, rgb: &[f32]);
    fn set_rgba(&mut self, base: usize, count: usize, rgba: &[f32]);
    fn set_scale(&mut self, base: usize, count: usize, scale: &[f32]);
    fn set_quat(&mut self, base: usize, count: usize, quat: &[f32]);
    fn set_sh(&mut self, base: usize, count: usize, sh1: &[f32], sh2: &[f32], sh3: &[f32]) {}
    fn set_sh1(&mut self, base: usize, count: usize, sh1: &[f32]) {}
    fn set_sh2(&mut self, base: usize, count: usize, sh2: &[f32]) {}
    fn set_sh3(&mut self, base: usize, count: usize, sh3: &[f32]) {}
    fn set_child_count(&mut self, base: usize, count: usize, child_count: &[u16]) {}
    fn set_child_start(&mut self, base: usize, count: usize, child_start: &[usize]) {}
}

#[allow(unused)]
pub trait SplatGetter: 'static {
    // Source/format metadata (header-like)
    fn num_splats(&self) -> usize;
    fn max_sh_degree(&self) -> usize;
    fn flag_antialias(&self) -> bool { false }
    fn has_lod_tree(&self) -> bool { false }
    fn get_encoding(&mut self) -> SplatEncoding { SplatEncoding::default() }

    // Batched property fetchers
    fn get_center(&mut self, base: usize, count: usize, out: &mut [f32]);
    fn get_opacity(&mut self, base: usize, count: usize, out: &mut [f32]);
    fn get_rgb(&mut self, base: usize, count: usize, out: &mut [f32]);
    fn get_scale(&mut self, base: usize, count: usize, out: &mut [f32]);
    fn get_quat(&mut self, base: usize, count: usize, out: &mut [f32]);
    fn get_sh1(&mut self, _base: usize, _count: usize, _out: &mut [f32]) {}
    fn get_sh2(&mut self, _base: usize, _count: usize, _out: &mut [f32]) {}
    fn get_sh3(&mut self, _base: usize, _count: usize, _out: &mut [f32]) {}
    fn get_child_count(&mut self, _base: usize, _count: usize, _out: &mut [u16]) {}
    fn get_child_start(&mut self, _base: usize, _count: usize, _out: &mut [usize]) {}
}

#[derive(Debug, Clone, Copy)]
pub enum SplatFileType {
    PLY,
    SPZ,
}

impl SplatFileType {
    pub fn to_enum_str(self) -> &'static str {
        match self {
            Self::PLY => "ply",
            Self::SPZ => "spz",
        }
    }

    pub fn from_enum_str(enum_str: &str) -> anyhow::Result<Self> {
        match enum_str {
            "ply" => Ok(Self::PLY),
            "spz" => Ok(Self::SPZ),
            _ => Err(anyhow::anyhow!("Invalid file type: {}", enum_str)),
        }
    }

    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_lowercase().as_str() {
            "ply" => Some(Self::PLY),
            "spz" => Some(Self::SPZ),
            _ => None,
        }
    }

    pub fn from_pathname(pathname: &str) -> Option<Self> {
        pathname.split('.').last().and_then(Self::from_extension)
    }
}

pub struct MultiDecoder<T: SplatReceiver> {
    pub file_type: Option<SplatFileType>,
    pub pathname: Option<String>,
    splats: Option<T>,
    buffer: Vec<u8>,
    buffer_gz: Option<Vec<u8>>,
    inner: Option<Box<dyn ChunkReceiver>>,
}

impl<T: SplatReceiver> MultiDecoder<T> {
    pub fn new(
        splats: T,
        file_type: Option<SplatFileType>,
        pathname: Option<&str>,
    ) -> Self {
        let (splats, inner) = if let Some(file_type) = file_type {
            (None, Some(new_decoder(file_type, splats)))
        } else {
            (Some(splats), None)
        };
        Self {
            file_type,
            pathname: pathname.map(|s| s.to_string()),
            splats,
            buffer: Vec::new(),
            buffer_gz: None,
            inner,
        }
    }

    pub fn into_splats(self) -> T {
        let inner_any = self.inner.unwrap().into_any();
        let inner_any = match inner_any.downcast::<PlyDecoder<T>>() {
            Ok(ply) => { return ply.into_splats(); },
            Err(inner_any) => inner_any,
        };
        let _inner_any = match inner_any.downcast::<SpzDecoder<T>>() {
            Ok(spz) => { return spz.into_splats(); },
            Err(inner_any) => inner_any,
        };
        panic!("Invalid decoder type");
    }

    fn init_file_type(&mut self, file_type: SplatFileType) -> anyhow::Result<()> {
        self.file_type = Some(file_type);
        let splats = self.splats.take().unwrap();
        let mut inner = new_decoder(file_type, splats);
        inner.push(&self.buffer)?;
        self.buffer.clear();
        self.buffer_gz = None;
        self.inner = Some(inner);
        Ok(())
    }
}

const GZIP_MAGIC: u32 = 0x00088b1f; // Gzip deflate

impl<T: SplatReceiver> ChunkReceiver for MultiDecoder<T> {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        if self.file_type.is_none() {
            self.buffer.extend_from_slice(bytes);
            if self.buffer.len() < 4 {
                return Ok(());
            }

            let mut detection_complete = false;

            let magic = u32::from_le_bytes([self.buffer[0], self.buffer[1], self.buffer[2], self.buffer[3]]);
            if (magic & 0x00ffffff) == PLY_MAGIC {
                return self.init_file_type(SplatFileType::PLY);
            }
            if (magic & 0x00ffffff) == GZIP_MAGIC {
                // Gzipped file, unpack beginning to check magic number
                if self.buffer_gz.is_none() {
                    self.buffer_gz = try_gunzip(&self.buffer, 4)?;
                }
                if let Some(buffer_gz) = self.buffer_gz.as_ref() {
                    detection_complete = true;
                    if buffer_gz.len() >= 4 {
                        let magic = u32::from_le_bytes([buffer_gz[0], buffer_gz[1], buffer_gz[2], buffer_gz[3]]);
                        if magic == SPZ_MAGIC {
                            return self.init_file_type(SplatFileType::SPZ);
                        }
                    }
                }
            } else {
                detection_complete = true;
            }

            if detection_complete {
                if let Some(pathname) = &self.pathname {
                    if let Some(file_type) = SplatFileType::from_pathname(pathname) {
                        return self.init_file_type(file_type);
                    }
                    return Err(anyhow::anyhow!("Unknown file type"));
                }

                Err(anyhow::anyhow!("Unknown file type"))
            } else {
                Ok(())
            }
        } else {
            self.inner.as_mut().unwrap().push(bytes)
        }
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        if self.file_type.is_none() {
            return Err(anyhow::anyhow!("Unknown file type"));
        }
        self.inner.as_mut().unwrap().finish()
    }
}

fn new_decoder<T: SplatReceiver>(file_type: SplatFileType, splats: T) -> Box<dyn ChunkReceiver> {
    match file_type {
        SplatFileType::PLY => Box::new(PlyDecoder::new(splats)),
        SplatFileType::SPZ => Box::new(SpzDecoder::new(splats)),
    }
}

fn try_gunzip(buffer: &[u8], max_bytes: usize) -> anyhow::Result<Option<Vec<u8>>> {
    if buffer.len() < 10 {
        return Ok(None);
    }
    if buffer[0] != 0x1f || buffer[1] != 0x8b || buffer[2] != 8 {
        return Err(anyhow::anyhow!("Invalid gzip header"));
    }

    let flags = buffer[3];
    let mut end = 10;

    if (flags & 0x04) != 0 {
        if buffer.len() < end + 2 {
            return Ok(None);
        }
        let extra_len = (buffer[end] as usize) | ((buffer[end + 1] as usize) << 8);
        end += 2;
        if buffer.len() < end + extra_len {
            return Ok(None);
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
            return Ok(None);
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
            return Ok(None);
        }
        end = null;
    }

    if (flags & 0x02) != 0 {
        if buffer.len() < end + 2 {
            return Ok(None);
        }
        end += 2;
    }
    
    if buffer.len() <= end {
        return Ok(None);
    }

    let mut buffer_gz = vec![0u8; max_bytes];
    let mut decompressor = DecompressorOxide::new();
    let (status, _in_consumed, out_written) = decompress(
        &mut decompressor,
        &buffer[end..],
        &mut buffer_gz,
        0,
        TINFL_FLAG_HAS_MORE_INPUT | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
    );
    match status {
        TINFLStatus::Failed => {
            Ok(Some(Vec::new()))
        }
        TINFLStatus::Done | TINFLStatus::HasMoreOutput => {
            buffer_gz.truncate(out_written);
            Ok(Some(buffer_gz))
        }
        TINFLStatus::NeedsMoreInput => {
            // Do nothing, try again next time
            Ok(None)
        }
        _ => Err(anyhow::anyhow!("Decompression failed: {:?}", status))
    }
}

pub fn copy_getter_to_receiver<G: SplatGetter, R: SplatReceiver>(getter: &mut G, receiver: &mut R) -> anyhow::Result<()> {
    const MAX_SPLAT_CHUNK: usize = 16384;

    let num_splats = getter.num_splats();
    let max_sh_degree = getter.max_sh_degree();
    let lod_tree = getter.has_lod_tree();
    receiver.init_splats(&SplatInit { num_splats, max_sh_degree, lod_tree })?;

    // Propagate encoding from getter if available
    let enc = getter.get_encoding();
    receiver.set_encoding(&SetSplatEncoding {
        rgb_min: Some(enc.rgb_min),
        rgb_max: Some(enc.rgb_max),
        ln_scale_min: Some(enc.ln_scale_min),
        ln_scale_max: Some(enc.ln_scale_max),
        sh1_min: Some(enc.sh1_min),
        sh1_max: Some(enc.sh1_max),
        sh2_min: Some(enc.sh2_min),
        sh2_max: Some(enc.sh2_max),
        sh3_min: Some(enc.sh3_min),
        sh3_max: Some(enc.sh3_max),
        lod_opacity: Some(enc.lod_opacity),
    })?;

    // Reusable buffers
    let mut center: Vec<f32> = Vec::new();
    let mut opacity: Vec<f32> = Vec::new();
    let mut rgb: Vec<f32> = Vec::new();
    let mut scale: Vec<f32> = Vec::new();
    let mut quat: Vec<f32> = Vec::new();
    let mut sh1: Vec<f32> = Vec::new();
    let mut sh2: Vec<f32> = Vec::new();
    let mut sh3: Vec<f32> = Vec::new();
    let mut child_count: Vec<u16> = Vec::new();
    let mut child_start: Vec<usize> = Vec::new();

    let mut base = 0usize;
    while base < num_splats {
        let count = (num_splats - base).min(MAX_SPLAT_CHUNK);

        if center.len() < count * 3 { center.resize(count * 3, 0.0); }
        if opacity.len() < count { opacity.resize(count, 0.0); }
        if rgb.len() < count * 3 { rgb.resize(count * 3, 0.0); }
        if scale.len() < count * 3 { scale.resize(count * 3, 0.0); }
        if quat.len() < count * 4 { quat.resize(count * 4, 0.0); }

        getter.get_center(base, count, &mut center[..count * 3]);
        getter.get_opacity(base, count, &mut opacity[..count]);
        getter.get_rgb(base, count, &mut rgb[..count * 3]);
        getter.get_scale(base, count, &mut scale[..count * 3]);
        getter.get_quat(base, count, &mut quat[..count * 4]);

        let (sh1_slice, sh2_slice, sh3_slice) = if max_sh_degree >= 1 {
            if sh1.len() < count * 9 { sh1.resize(count * 9, 0.0); }
            getter.get_sh1(base, count, &mut sh1[..count * 9]);

            if max_sh_degree >= 2 {
                if sh2.len() < count * 15 { sh2.resize(count * 15, 0.0); }
                getter.get_sh2(base, count, &mut sh2[..count * 15]);
            }

            if max_sh_degree >= 3 {
                if sh3.len() < count * 21 { sh3.resize(count * 21, 0.0); }
                getter.get_sh3(base, count, &mut sh3[..count * 21]);
            }

            (
                &sh1[..count * 9],
                if max_sh_degree >= 2 { &sh2[..count * 15] } else { &[][..] },
                if max_sh_degree >= 3 { &sh3[..count * 21] } else { &[][..] },
            )
        } else { (&[][..], &[][..], &[][..]) };

        let (child_count_slice, child_start_slice): (&[u16], &[usize]) = if lod_tree {
            if child_count.len() < count { child_count.resize(count, 0); }
            getter.get_child_count(base, count, &mut child_count[..count]);
            if child_start.len() < count { child_start.resize(count, 0); }
            getter.get_child_start(base, count, &mut child_start[..count]);
            (&child_count[..count], &child_start[..count])
        } else { (&[][..], &[][..]) };

        receiver.set_batch(base, count, &SplatProps {
            center: &center[..count * 3],
            opacity: &opacity[..count],
            rgb: &rgb[..count * 3],
            scale: &scale[..count * 3],
            quat: &quat[..count * 4],
            sh1: sh1_slice,
            sh2: sh2_slice,
            sh3: sh3_slice,
            child_count: child_count_slice,
            child_start: child_start_slice,
        });

        base += count;
    }

    receiver.finish()?;
    Ok(())
}
