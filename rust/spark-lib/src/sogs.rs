use std::{collections::HashMap, io::Cursor};

use anyhow::{anyhow, Context};
use image::{DynamicImage, GenericImageView, ImageReader};
use serde_json;
use serde::Deserialize;
use zip::ZipArchive;

use crate::decoder::{ChunkReceiver, SplatInit, SplatProps, SplatReceiver};

const PK_MAGIC: u32 = 0x04034b50;
const SH_C0: f32 = 0.28209479177387814;
const MAX_SPLAT_CHUNK: usize = 65536;

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PcSogsRoot {
    V2(PcSogsV2),
    V1(PcSogsV1),
}

#[derive(Debug, Deserialize)]
struct PcSogsV2 {
    version: u32,
    count: usize,
    means: Means,
    scales: ScalesV2,
    quats: Quats,
    sh0: Sh0V2,
    #[serde(rename = "shN")]
    shn: Option<ShNV2>,
}

#[derive(Debug, Deserialize)]
struct PcSogsV1 {
    means: MeansV1,
    scales: ScalesV1,
    quats: Quats,
    sh0: Sh0V1,
    #[serde(rename = "shN")]
    shn: Option<ShNV1>,
}

#[derive(Debug, Deserialize)]
struct Means {
    files: [String; 2],
    mins: [f32; 3],
    maxs: [f32; 3],
    shape: Option<[usize; 2]>,
}

#[derive(Debug, Deserialize)]
struct MeansV1 {
    files: [String; 2],
    mins: [f32; 3],
    maxs: [f32; 3],
    shape: [usize; 2],
}

#[derive(Debug, Deserialize)]
struct ScalesV1 {
    files: [String; 1],
    mins: [f32; 3],
    maxs: [f32; 3],
}

#[derive(Debug, Deserialize)]
struct ScalesV2 {
    files: [String; 1],
    codebook: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct Quats {
    files: [String; 1],
    encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Sh0V1 {
    files: [String; 1],
    mins: [f32; 4],
    maxs: [f32; 4],
}

#[derive(Debug, Deserialize)]
struct Sh0V2 {
    files: [String; 1],
    codebook: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct ShNV1 {
    files: [String; 2],
    mins: f32,
    maxs: f32,
    shape: [usize; 2],
}

#[derive(Debug, Deserialize)]
struct ShNV2 {
    files: [String; 2],
    codebook: Vec<f32>,
    bands: u8,
}

pub struct SogsDecoder<T: SplatReceiver> {
    splats: T,
    buffer: Vec<u8>,
}

impl<T: SplatReceiver> SogsDecoder<T> {
    pub fn new(splats: T, _pathname: Option<String>) -> Self {
        Self {
            splats,
            buffer: Vec::new(),
        }
    }

    pub fn into_splats(self) -> T {
        self.splats
    }
}

impl<T: SplatReceiver> ChunkReceiver for SogsDecoder<T> {
    fn push(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        self.buffer.extend_from_slice(bytes);
        Ok(())
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        if self.buffer.len() < 4 {
            return Err(anyhow!("SOGS file too small"));
        }
        let magic = u32::from_le_bytes([self.buffer[0], self.buffer[1], self.buffer[2], self.buffer[3]]);
        if magic != PK_MAGIC {
            return Err(anyhow!("Not a ZIP/SOGS file"));
        }
        decode_sogs(&self.buffer, &mut self.splats, None)?;
        Ok(())
    }
}

fn decode_sogs<T: SplatReceiver>(bytes: &[u8], splats: &mut T, _pathname: Option<&str>) -> anyhow::Result<()> {
    let cursor = Cursor::new(bytes);
    let mut zip = ZipArchive::new(cursor)?;

    // Find meta.json entry and its prefix
    let mut meta_name: Option<String> = None;
    for i in 0..zip.len() {
        let name = zip.by_index(i)?.name().to_string();
        if name.ends_with("meta.json") {
            meta_name = Some(name);
            break;
        }
    }
    let meta_name = meta_name.ok_or_else(|| anyhow!("meta.json not found in SOGS zip"))?;
    let prefix = meta_name.rsplit_once('/').map(|(p, _)| format!("{}/", p)).unwrap_or_default();

    let meta_bytes = {
        let mut meta_file = zip.by_name(&meta_name)?;
        let mut meta_bytes = Vec::new();
        std::io::copy(&mut meta_file, &mut meta_bytes)?;
        meta_bytes
    };
    let meta: PcSogsRoot = serde_json::from_slice(&meta_bytes)
        .context("Failed to parse meta.json for SOGS")?;

    let mut file_cache: HashMap<String, Vec<u8>> = HashMap::new();
    preload_all(&meta, &prefix, &mut zip, &mut file_cache)?;

    let mut get_file = |name: &str| -> anyhow::Result<Vec<u8>> {
        file_cache.get(name).cloned().ok_or_else(|| anyhow!("Missing file {name} in cache"))
    };

    match meta {
        PcSogsRoot::V2(v2) => decode_v2(v2, splats, &mut get_file),
        PcSogsRoot::V1(v1) => decode_v1(v1, splats, &mut get_file),
    }
}

fn decode_v2<T: SplatReceiver>(
    meta: PcSogsV2,
    splats: &mut T,
    get_file: &mut dyn FnMut(&str) -> anyhow::Result<Vec<u8>>,
) -> anyhow::Result<()> {
    let _ = meta.version;
    let num_splats = meta.count;
    let max_sh_degree = meta.shn.as_ref().map(|shn| {
        if shn.bands >= 3 { 3 } else if shn.bands >= 2 { 2 } else if shn.bands >= 1 { 1 } else { 0 }
    }).unwrap_or(0);
    splats.init_splats(&SplatInit { num_splats, max_sh_degree, lod_tree: false })?;

    let means0 = decode_rgba(&get_file(&meta.means.files[0])?)
        .context("decode means[0]")?;
    let means1 = decode_rgba(&get_file(&meta.means.files[1])?)
        .context("decode means[1]")?;
    let scales_img = decode_rgba(&get_file(&meta.scales.files[0])?)
        .context("decode scales")?;
    let quats_img = decode_rgba(&get_file(&meta.quats.files[0])?)
        .context("decode quats")?;
    let sh0_img = decode_rgba(&get_file(&meta.sh0.files[0])?)
        .context("decode sh0")?;

    let mut center = vec![0.0f32; num_splats * 3];
    let mut scale = vec![0.0f32; num_splats * 3];
    let mut quat = vec![0.0f32; num_splats * 4];
    let mut rgb = vec![0.0f32; num_splats * 3];
    let mut opacity = vec![0.0f32; num_splats];
    let mut sh1: Vec<f32> = if max_sh_degree >= 1 { vec![0.0; num_splats * 9] } else { Vec::new() };
    let mut sh2: Vec<f32> = if max_sh_degree >= 2 { vec![0.0; num_splats * 15] } else { Vec::new() };
    let mut sh3: Vec<f32> = if max_sh_degree >= 3 { vec![0.0; num_splats * 21] } else { Vec::new() };

    if let Some(shape) = meta.means.shape {
        let _ = shape;
    }
    decode_means(&meta.means.mins, &meta.means.maxs, &means0, &means1, &mut center)?;
    decode_scales_v2(&meta.scales.codebook, &scales_img, &mut scale)?;
    decode_quats(&quats_img, &mut quat)?;
    decode_sh0_v2(&meta.sh0.codebook, &sh0_img, &mut rgb, &mut opacity)?;

    if let Some(shn) = meta.shn {
        decode_shn_v2(
            shn,
            get_file,
            num_splats,
            &mut sh1,
            &mut sh2,
            &mut sh3,
        )?;
    }

    emit_to_receiver(
        splats,
        num_splats,
        max_sh_degree,
        &center,
        &scale,
        &quat,
        &rgb,
        &opacity,
        &sh1,
        &sh2,
        &sh3,
    )
}

fn decode_v1<T: SplatReceiver>(
    meta: PcSogsV1,
    splats: &mut T,
    get_file: &mut dyn FnMut(&str) -> anyhow::Result<Vec<u8>>,
) -> anyhow::Result<()> {
    let num_splats = meta.means.shape[0];
    if meta.quats.encoding.as_deref() != Some("quaternion_packed") {
        return Err(anyhow!("Unsupported quaternion encoding in SOGS v1"));
    }

    let mut max_sh_degree = 0usize;
    if let Some(shn) = &meta.shn {
        max_sh_degree = if shn.shape[1] >= 48 - 3 {
            3
        } else if shn.shape[1] >= 27 - 3 {
            2
        } else if shn.shape[1] >= 12 - 3 {
            1
        } else {
            0
        };
    }

    splats.init_splats(&SplatInit { num_splats, max_sh_degree, lod_tree: false })?;

    let means0 = decode_rgba(&get_file(&meta.means.files[0])?)
        .context("decode means[0]")?;
    let means1 = decode_rgba(&get_file(&meta.means.files[1])?)
        .context("decode means[1]")?;
    let scales_img = decode_rgba(&get_file(&meta.scales.files[0])?)
        .context("decode scales")?;
    let quats_img = decode_rgba(&get_file(&meta.quats.files[0])?)
        .context("decode quats")?;
    let sh0_img = decode_rgba(&get_file(&meta.sh0.files[0])?)
        .context("decode sh0")?;

    let mut center = vec![0.0f32; num_splats * 3];
    let mut scale = vec![0.0f32; num_splats * 3];
    let mut quat = vec![0.0f32; num_splats * 4];
    let mut rgb = vec![0.0f32; num_splats * 3];
    let mut opacity = vec![0.0f32; num_splats];
    let mut sh1: Vec<f32> = if max_sh_degree >= 1 { vec![0.0; num_splats * 9] } else { Vec::new() };
    let mut sh2: Vec<f32> = if max_sh_degree >= 2 { vec![0.0; num_splats * 15] } else { Vec::new() };
    let mut sh3: Vec<f32> = if max_sh_degree >= 3 { vec![0.0; num_splats * 21] } else { Vec::new() };

    decode_means(&meta.means.mins, &meta.means.maxs, &means0, &means1, &mut center)?;
    decode_scales_v1(&meta.scales.mins, &meta.scales.maxs, &scales_img, &mut scale)?;
    decode_quats(&quats_img, &mut quat)?;
    decode_sh0_v1(&meta.sh0.mins, &meta.sh0.maxs, &sh0_img, &mut rgb, &mut opacity)?;

    if let Some(shn) = meta.shn {
        decode_shn_v1(
            shn,
            get_file,
            num_splats,
            max_sh_degree,
            &mut sh1,
            &mut sh2,
            &mut sh3,
        )?;
    }

    emit_to_receiver(
        splats,
        num_splats,
        max_sh_degree,
        &center,
        &scale,
        &quat,
        &rgb,
        &opacity,
        &sh1,
        &sh2,
        &sh3,
    )
}

fn decode_means(
    mins: &[f32; 3],
    maxs: &[f32; 3],
    img0: &ImageData,
    img1: &ImageData,
    out_center: &mut [f32],
) -> anyhow::Result<()> {
    let num_splats = out_center.len() / 3;
    for i in 0..num_splats {
        let i4 = i * 4;
        let fx = (img0.rgba[i4] as u32 + ((img1.rgba[i4] as u32) << 8)) as f32 / 65535.0;
        let fy = (img0.rgba[i4 + 1] as u32 + ((img1.rgba[i4 + 1] as u32) << 8)) as f32 / 65535.0;
        let fz = (img0.rgba[i4 + 2] as u32 + ((img1.rgba[i4 + 2] as u32) << 8)) as f32 / 65535.0;
        let mut x = mins[0] + (maxs[0] - mins[0]) * fx;
        let mut y = mins[1] + (maxs[1] - mins[1]) * fy;
        let mut z = mins[2] + (maxs[2] - mins[2]) * fz;
        x = x.signum() * (x.abs().exp() - 1.0);
        y = y.signum() * (y.abs().exp() - 1.0);
        z = z.signum() * (z.abs().exp() - 1.0);
        let i3 = i * 3;
        out_center[i3] = x;
        out_center[i3 + 1] = y;
        out_center[i3 + 2] = z;
    }
    Ok(())
}

fn decode_scales_v2(codebook: &[f32], img: &ImageData, out_scale: &mut [f32]) -> anyhow::Result<()> {
    let num_splats = out_scale.len() / 3;
    let lookup: Vec<f32> = codebook.iter().map(|v| v.exp()).collect();
    for i in 0..num_splats {
        let i4 = i * 4;
        let i3 = i * 3;
        out_scale[i3] = lookup[img.rgba[i4] as usize];
        out_scale[i3 + 1] = lookup[img.rgba[i4 + 1] as usize];
        out_scale[i3 + 2] = lookup[img.rgba[i4 + 2] as usize];
    }
    Ok(())
}

fn decode_scales_v1(mins: &[f32; 3], maxs: &[f32; 3], img: &ImageData, out_scale: &mut [f32]) -> anyhow::Result<()> {
    let num_splats = out_scale.len() / 3;
    let build_lookup = |min: f32, max: f32| -> Vec<f32> {
        (0..256)
            .map(|i| min + (max - min) * (i as f32 / 255.0))
            .map(|ln| ln.exp())
            .collect()
    };
    let lx = build_lookup(mins[0], maxs[0]);
    let ly = build_lookup(mins[1], maxs[1]);
    let lz = build_lookup(mins[2], maxs[2]);
    for i in 0..num_splats {
        let i4 = i * 4;
        let i3 = i * 3;
        out_scale[i3] = lx[img.rgba[i4] as usize];
        out_scale[i3 + 1] = ly[img.rgba[i4 + 1] as usize];
        out_scale[i3 + 2] = lz[img.rgba[i4 + 2] as usize];
    }
    Ok(())
}

fn decode_quats(img: &ImageData, out_quat: &mut [f32]) -> anyhow::Result<()> {
    let num_splats = out_quat.len() / 4;
    const SQRT2: f32 = std::f32::consts::SQRT_2;
    let lookup: Vec<f32> = (0..256).map(|i| (i as f32 / 255.0 - 0.5) * SQRT2).collect();
    for i in 0..num_splats {
        let i4 = i * 4;
        let r0 = lookup[img.rgba[i4] as usize];
        let r1 = lookup[img.rgba[i4 + 1] as usize];
        let r2 = lookup[img.rgba[i4 + 2] as usize];
        let rr = (1.0 - (r0 * r0 + r1 * r1 + r2 * r2)).max(0.0).sqrt();
        let r_order = img.rgba[i4 + 3] as i32 - 252;
        let quat_x = if r_order == 0 { r0 } else if r_order == 1 { rr } else { r1 };
        let quat_y = if r_order <= 1 { r1 } else if r_order == 2 { rr } else { r2 };
        let quat_z = if r_order <= 2 { r2 } else { rr };
        let quat_w = if r_order == 0 { rr } else { r0 };
        let o = i * 4;
        out_quat[o] = quat_x;
        out_quat[o + 1] = quat_y;
        out_quat[o + 2] = quat_z;
        out_quat[o + 3] = quat_w;
    }
    Ok(())
}

fn decode_sh0_v2(codebook: &[f32], img: &ImageData, out_rgb: &mut [f32], out_opacity: &mut [f32]) -> anyhow::Result<()> {
    let num_splats = out_opacity.len();
    let lookup_rgb: Vec<f32> = codebook.iter().map(|v| SH_C0 * v + 0.5).collect();
    let lookup_a: Vec<f32> = (0..256).map(|i| i as f32 / 255.0).collect();
    for i in 0..num_splats {
        let i4 = i * 4;
        let i3 = i * 3;
        out_rgb[i3] = lookup_rgb[img.rgba[i4] as usize];
        out_rgb[i3 + 1] = lookup_rgb[img.rgba[i4 + 1] as usize];
        out_rgb[i3 + 2] = lookup_rgb[img.rgba[i4 + 2] as usize];
        out_opacity[i] = lookup_a[img.rgba[i4 + 3] as usize];
    }
    Ok(())
}

fn decode_sh0_v1(mins: &[f32; 4], maxs: &[f32; 4], img: &ImageData, out_rgb: &mut [f32], out_opacity: &mut [f32]) -> anyhow::Result<()> {
    let num_splats = out_opacity.len();
    let build_lookup = |min: f32, max: f32, post: fn(f32) -> f32| -> Vec<f32> {
        (0..256)
            .map(|i| min + (max - min) * (i as f32 / 255.0))
            .map(post)
            .collect()
    };
    let lr = build_lookup(mins[0], maxs[0], |v| SH_C0 * v + 0.5);
    let lg = build_lookup(mins[1], maxs[1], |v| SH_C0 * v + 0.5);
    let lb = build_lookup(mins[2], maxs[2], |v| SH_C0 * v + 0.5);
    let la = build_lookup(mins[3], maxs[3], |v| 1.0 / (1.0 + (-v).exp()));
    for i in 0..num_splats {
        let i4 = i * 4;
        let i3 = i * 3;
        out_rgb[i3] = lr[img.rgba[i4] as usize];
        out_rgb[i3 + 1] = lg[img.rgba[i4 + 1] as usize];
        out_rgb[i3 + 2] = lb[img.rgba[i4 + 2] as usize];
        out_opacity[i] = la[img.rgba[i4 + 3] as usize];
    }
    Ok(())
}

fn decode_shn_v2(
    shn: ShNV2,
    get_file: &mut dyn FnMut(&str) -> anyhow::Result<Vec<u8>>,
    num_splats: usize,
    sh1: &mut [f32],
    sh2: &mut [f32],
    sh3: &mut [f32],
) -> anyhow::Result<()> {
    let centroids = decode_image(&get_file(&shn.files[0])?)?;
    let labels = decode_image(&get_file(&shn.files[1])?)?;
    let lookup = shn.codebook;
    let use_sh1 = shn.bands >= 1;
    let use_sh2 = shn.bands >= 2;
    let use_sh3 = shn.bands >= 3;

    for i in 0..num_splats {
        let i4 = i * 4;
        let label = labels.rgba[i4] as u16 | ((labels.rgba[i4 + 1] as u16) << 8);
        let stride = if use_sh3 { 15 } else if use_sh2 { 8 } else { 3 };
        let col = (label & 63) as usize * stride;
        let row = (label >> 6) as usize;
        let offset = row * centroids.width + col;
        for d in 0..3 {
            if use_sh1 {
                for k in 0..3 {
                    sh1[i * 9 + k * 3 + d] = lookup[centroids.rgba[(offset + k) * 4 + d] as usize];
                }
            }
            if use_sh2 {
                for k in 0..5 {
                    sh2[i * 15 + k * 3 + d] = lookup[centroids.rgba[(offset + 3 + k) * 4 + d] as usize];
                }
            }
            if use_sh3 {
                for k in 0..7 {
                    sh3[i * 21 + k * 3 + d] = lookup[centroids.rgba[(offset + 8 + k) * 4 + d] as usize];
                }
            }
        }
    }
    Ok(())
}

fn decode_shn_v1(
    shn: ShNV1,
    get_file: &mut dyn FnMut(&str) -> anyhow::Result<Vec<u8>>,
    num_splats: usize,
    max_sh_degree: usize,
    sh1: &mut [f32],
    sh2: &mut [f32],
    sh3: &mut [f32],
) -> anyhow::Result<()> {
    let centroids = decode_image(&get_file(&shn.files[0])?)?;
    let labels = decode_image(&get_file(&shn.files[1])?)?;
    let lookup: Vec<f32> = (0..256)
        .map(|i| shn.mins + (shn.maxs - shn.mins) * (i as f32 / 255.0))
        .collect();

    for i in 0..num_splats {
        let i4 = i * 4;
        let label = labels.rgba[i4] as u16 | ((labels.rgba[i4 + 1] as u16) << 8);
        let stride = if max_sh_degree >= 3 { 15 } else if max_sh_degree >= 2 { 8 } else { 3 };
        let col = (label & 63) as usize * stride;
        let row = (label >> 6) as usize;
        let offset = row * centroids.width + col;
        for d in 0..3 {
            if max_sh_degree >= 1 {
                for k in 0..3 {
                    sh1[i * 9 + k * 3 + d] = lookup[centroids.rgba[(offset + k) * 4 + d] as usize];
                }
            }
            if max_sh_degree >= 2 {
                for k in 0..5 {
                    sh2[i * 15 + k * 3 + d] = lookup[centroids.rgba[(offset + 3 + k) * 4 + d] as usize];
                }
            }
            if max_sh_degree >= 3 {
                for k in 0..7 {
                    sh3[i * 21 + k * 3 + d] = lookup[centroids.rgba[(offset + 8 + k) * 4 + d] as usize];
                }
            }
        }
    }
    Ok(())
}

fn emit_to_receiver<T: SplatReceiver>(
    splats: &mut T,
    num_splats: usize,
    max_sh_degree: usize,
    center: &[f32],
    scale: &[f32],
    quat: &[f32],
    rgb: &[f32],
    opacity: &[f32],
    sh1: &[f32],
    sh2: &[f32],
    sh3: &[f32],
) -> anyhow::Result<()> {
    let mut base = 0usize;
    while base < num_splats {
        let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
        let i3 = base * 3;
        let i4 = base * 4;
        splats.set_batch(
            base,
            count,
            &SplatProps {
                center: &center[i3..i3 + count * 3],
                opacity: &opacity[base..base + count],
                rgb: &rgb[i3..i3 + count * 3],
                scale: &scale[i3..i3 + count * 3],
                quat: &quat[i4..i4 + count * 4],
                sh1: if max_sh_degree >= 1 { &sh1[base * 9..base * 9 + count * 9] } else { &[] },
                sh2: if max_sh_degree >= 2 { &sh2[base * 15..base * 15 + count * 15] } else { &[] },
                sh3: if max_sh_degree >= 3 { &sh3[base * 21..base * 21 + count * 21] } else { &[] },
                ..Default::default()
            },
        );
        base += count;
    }
    splats.finish()
}

fn preload_all(
    meta: &PcSogsRoot,
    prefix: &str,
    zip: &mut ZipArchive<Cursor<&[u8]>>,
    cache: &mut HashMap<String, Vec<u8>>,
) -> anyhow::Result<()> {
    match meta {
        PcSogsRoot::V2(v2) => {
            for f in v2.means.files.iter() { preload_file(zip, prefix, cache, f)?; }
            for f in v2.scales.files.iter() { preload_file(zip, prefix, cache, f)?; }
            for f in v2.quats.files.iter() { preload_file(zip, prefix, cache, f)?; }
            for f in v2.sh0.files.iter() { preload_file(zip, prefix, cache, f)?; }
            if let Some(shn) = &v2.shn {
                for f in shn.files.iter() { preload_file(zip, prefix, cache, f)?; }
            }
        }
        PcSogsRoot::V1(v1) => {
            for f in v1.means.files.iter() { preload_file(zip, prefix, cache, f)?; }
            for f in v1.scales.files.iter() { preload_file(zip, prefix, cache, f)?; }
            for f in v1.quats.files.iter() { preload_file(zip, prefix, cache, f)?; }
            for f in v1.sh0.files.iter() { preload_file(zip, prefix, cache, f)?; }
            if let Some(shn) = &v1.shn {
                for f in shn.files.iter() { preload_file(zip, prefix, cache, f)?; }
            }
        }
    }
    Ok(())
}

fn preload_file(
    zip: &mut ZipArchive<Cursor<&[u8]>>,
    prefix: &str,
    cache: &mut HashMap<String, Vec<u8>>,
    name: &str,
) -> anyhow::Result<()> {
    if cache.contains_key(name) {
        return Ok(());
    }
    let full = format!("{}{}", prefix, name);
    let mut out = Vec::new();
    {
        if let Ok(mut entry) = zip.by_name(&full) {
            std::io::copy(&mut entry, &mut out)?;
            cache.insert(name.to_string(), out);
            return Ok(());
        }
    }
    let mut entry = zip.by_name(name).context(format!("Missing file {name} in SOGS zip"))?;
    std::io::copy(&mut entry, &mut out)?;
    cache.insert(name.to_string(), out);
    Ok(())
}

struct ImageData {
    rgba: Vec<u8>,
    width: usize,
    #[allow(dead_code)]
    height: usize,
}

fn decode_rgba(bytes: &[u8]) -> anyhow::Result<ImageData> {
    let img = decode_image(bytes)?;
    Ok(img)
}

fn decode_image(bytes: &[u8]) -> anyhow::Result<ImageData> {
    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .decode()?;
    let (width, height) = img.dimensions();
    let rgba: Vec<u8> = match img {
        DynamicImage::ImageRgba8(i) => i.into_raw(),
        other => other.to_rgba8().into_raw(),
    };
    Ok(ImageData { rgba, width: width as usize, height: height as usize })
}


