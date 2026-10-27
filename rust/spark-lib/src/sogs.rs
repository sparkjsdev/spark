use std::{collections::HashMap, io::Cursor};

use anyhow::{anyhow, Context};
use image::{DynamicImage, GenericImageView, ImageReader};
use serde_json;
use serde::Deserialize;
use zip::ZipArchive;

use crate::decoder::{ChunkReceiver, SplatInit, SplatProps, SplatReceiver};

pub const PK_MAGIC: u32 = 0x04034b50;
#[allow(clippy::excessive_precision)]
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
        // Move the zip buffer into decode_sogs, which frees it after preloading
        let buf = std::mem::take(&mut self.buffer);
        if buf.len() < 4 {
            return Err(anyhow!("SOGS file too small"));
        }
        let magic = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
        if magic != PK_MAGIC {
            return Err(anyhow!("Not a ZIP/SOGS file"));
        }
        decode_sogs(buf, &mut self.splats, None)?;
        Ok(())
    }
}

fn decode_sogs<T: SplatReceiver>(bytes: Vec<u8>, splats: &mut T, _pathname: Option<&str>) -> anyhow::Result<()> {
    let (meta, file_cache) = {
        let mut zip = ZipArchive::new(Cursor::new(bytes.as_slice()))?;

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
        for f in meta_image_files(&meta) {
            preload_file(&mut zip, &prefix, &mut file_cache, f)?;
        }
        (meta, file_cache)
    };
    // Zip no longer needed: all compressed files are in the cache
    drop(bytes);

    // Decode the images; each compressed buffer is dropped right after its decode
    let images = file_cache
        .into_iter()
        .map(|(name, raw)| {
            let img = decode_image(&raw).with_context(|| format!("decode {name}"))?;
            Ok((name, img))
        })
        .collect::<anyhow::Result<HashMap<String, ImageData>>>()?;

    match meta {
        PcSogsRoot::V2(v2) => decode_v2(v2, splats, &images),
        PcSogsRoot::V1(v1) => decode_v1(v1, splats, &images),
    }
}

fn meta_image_files(meta: &PcSogsRoot) -> Vec<&String> {
    let mut out = Vec::new();
    match meta {
        PcSogsRoot::V2(v2) => {
            out.extend(v2.means.files.iter());
            out.extend(v2.scales.files.iter());
            out.extend(v2.quats.files.iter());
            out.extend(v2.sh0.files.iter());
            if let Some(shn) = &v2.shn { out.extend(shn.files.iter()); }
        }
        PcSogsRoot::V1(v1) => {
            out.extend(v1.means.files.iter());
            out.extend(v1.scales.files.iter());
            out.extend(v1.quats.files.iter());
            out.extend(v1.sh0.files.iter());
            if let Some(shn) = &v1.shn { out.extend(shn.files.iter()); }
        }
    }
    out
}

fn get_image<'a>(images: &'a HashMap<String, ImageData>, name: &str) -> anyhow::Result<&'a ImageData> {
    images.get(name).ok_or_else(|| anyhow!("Missing file {name} in cache"))
}

/// Buffers for one chunk of splats, reused for the whole decode
struct Chunk {
    center: Vec<f32>,
    scale: Vec<f32>,
    quat: Vec<f32>,
    rgb: Vec<f32>,
    opacity: Vec<f32>,
    sh1: Vec<f32>,
    sh2: Vec<f32>,
    sh3: Vec<f32>,
}

/// Call `fill(base, count, chunk)` for chunks of MAX_SPLAT_CHUNK splats and pass them to the receiver
fn emit_chunks<T: SplatReceiver>(
    splats: &mut T,
    num_splats: usize,
    max_sh_degree: usize,
    mut fill: impl FnMut(usize, usize, &mut Chunk) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    let n = num_splats.min(MAX_SPLAT_CHUNK);
    let mut c = Chunk {
        center: vec![0.0; n * 3],
        scale: vec![0.0; n * 3],
        quat: vec![0.0; n * 4],
        rgb: vec![0.0; n * 3],
        opacity: vec![0.0; n],
        sh1: if max_sh_degree >= 1 { vec![0.0; n * 9] } else { Vec::new() },
        sh2: if max_sh_degree >= 2 { vec![0.0; n * 15] } else { Vec::new() },
        sh3: if max_sh_degree >= 3 { vec![0.0; n * 21] } else { Vec::new() },
    };
    let mut base = 0usize;
    while base < num_splats {
        let count = (num_splats - base).min(MAX_SPLAT_CHUNK);
        fill(base, count, &mut c)?;
        splats.set_batch(
            base,
            count,
            &SplatProps {
                center: &c.center[..count * 3],
                opacity: &c.opacity[..count],
                rgb: &c.rgb[..count * 3],
                scale: &c.scale[..count * 3],
                quat: &c.quat[..count * 4],
                sh1: if max_sh_degree >= 1 { &c.sh1[..count * 9] } else { &[] },
                sh2: if max_sh_degree >= 2 { &c.sh2[..count * 15] } else { &[] },
                sh3: if max_sh_degree >= 3 { &c.sh3[..count * 21] } else { &[] },
                ..Default::default()
            },
        );
        base += count;
    }
    splats.finish()
}

fn decode_v2<T: SplatReceiver>(
    meta: PcSogsV2,
    splats: &mut T,
    images: &HashMap<String, ImageData>,
) -> anyhow::Result<()> {
    let _ = meta.version;
    let _ = meta.means.shape;
    let num_splats = meta.count;
    let max_sh_degree = meta.shn.as_ref().map(|shn| {
        if shn.bands >= 3 { 3 } else if shn.bands >= 2 { 2 } else if shn.bands >= 1 { 1 } else { 0 }
    }).unwrap_or(0);
    splats.init_splats(&SplatInit { num_splats, max_sh_degree, lod_tree: false })?;

    let means0 = get_image(images, &meta.means.files[0])?;
    let means1 = get_image(images, &meta.means.files[1])?;
    let scales_img = get_image(images, &meta.scales.files[0])?;
    let quats_img = get_image(images, &meta.quats.files[0])?;
    let sh0_img = get_image(images, &meta.sh0.files[0])?;
    let shn = match meta.shn {
        Some(shn) => Some(ShN::load(images, &shn.files, shn.codebook, max_sh_degree)?),
        None => None,
    };

    let scale_lookup: Vec<f32> = meta.scales.codebook.iter().map(|v| v.exp()).collect();
    let rgb_lookup: Vec<f32> = meta.sh0.codebook.iter().map(|v| SH_C0 * v + 0.5).collect();
    let a_lookup: Vec<f32> = (0..256).map(|i| i as f32 / 255.0).collect();

    emit_chunks(splats, num_splats, max_sh_degree, |base, count, c| {
        decode_means(&meta.means.mins, &meta.means.maxs, means0, means1, base, &mut c.center[..count * 3]);
        decode_scales(&scale_lookup, &scale_lookup, &scale_lookup, scales_img, base, &mut c.scale[..count * 3]);
        decode_quats(quats_img, base, &mut c.quat[..count * 4]);
        decode_sh0(&rgb_lookup, &rgb_lookup, &rgb_lookup, &a_lookup, sh0_img, base, &mut c.rgb[..count * 3], &mut c.opacity[..count]);
        if let Some(shn) = &shn {
            shn.decode(base, count, c);
        }
        Ok(())
    })
}

fn decode_v1<T: SplatReceiver>(
    meta: PcSogsV1,
    splats: &mut T,
    images: &HashMap<String, ImageData>,
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

    let means0 = get_image(images, &meta.means.files[0])?;
    let means1 = get_image(images, &meta.means.files[1])?;
    let scales_img = get_image(images, &meta.scales.files[0])?;
    let quats_img = get_image(images, &meta.quats.files[0])?;
    let sh0_img = get_image(images, &meta.sh0.files[0])?;
    let shn = match meta.shn {
        Some(shn) => {
            let lookup: Vec<f32> = (0..256)
                .map(|i| shn.mins + (shn.maxs - shn.mins) * (i as f32 / 255.0))
                .collect();
            Some(ShN::load(images, &shn.files, lookup, max_sh_degree)?)
        }
        None => None,
    };

    let build_lookup = |min: f32, max: f32, post: fn(f32) -> f32| -> Vec<f32> {
        (0..256)
            .map(|i| min + (max - min) * (i as f32 / 255.0))
            .map(post)
            .collect()
    };
    let (smin, smax) = (meta.scales.mins, meta.scales.maxs);
    let lx = build_lookup(smin[0], smax[0], f32::exp);
    let ly = build_lookup(smin[1], smax[1], f32::exp);
    let lz = build_lookup(smin[2], smax[2], f32::exp);
    let (cmin, cmax) = (meta.sh0.mins, meta.sh0.maxs);
    let lr = build_lookup(cmin[0], cmax[0], |v| SH_C0 * v + 0.5);
    let lg = build_lookup(cmin[1], cmax[1], |v| SH_C0 * v + 0.5);
    let lb = build_lookup(cmin[2], cmax[2], |v| SH_C0 * v + 0.5);
    let la = build_lookup(cmin[3], cmax[3], |v| 1.0 / (1.0 + (-v).exp()));

    emit_chunks(splats, num_splats, max_sh_degree, |base, count, c| {
        decode_means(&meta.means.mins, &meta.means.maxs, means0, means1, base, &mut c.center[..count * 3]);
        decode_scales(&lx, &ly, &lz, scales_img, base, &mut c.scale[..count * 3]);
        decode_quats(quats_img, base, &mut c.quat[..count * 4]);
        decode_sh0(&lr, &lg, &lb, &la, sh0_img, base, &mut c.rgb[..count * 3], &mut c.opacity[..count]);
        if let Some(shn) = &shn {
            shn.decode(base, count, c);
        }
        Ok(())
    })
}

// The decode_* helpers read the image from `base` and write `out` from 0 (len = count * components)

fn decode_means(
    mins: &[f32; 3],
    maxs: &[f32; 3],
    img0: &ImageData,
    img1: &ImageData,
    base: usize,
    out_center: &mut [f32],
) {
    let (rgba0, rgba1) = (&img0.rgba[base * 4..], &img1.rgba[base * 4..]);
    for i in 0..out_center.len() / 3 {
        let i4 = i * 4;
        let fx = (rgba0[i4] as u32 + ((rgba1[i4] as u32) << 8)) as f32 / 65535.0;
        let fy = (rgba0[i4 + 1] as u32 + ((rgba1[i4 + 1] as u32) << 8)) as f32 / 65535.0;
        let fz = (rgba0[i4 + 2] as u32 + ((rgba1[i4 + 2] as u32) << 8)) as f32 / 65535.0;
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
}

fn decode_scales(lx: &[f32], ly: &[f32], lz: &[f32], img: &ImageData, base: usize, out_scale: &mut [f32]) {
    let rgba = &img.rgba[base * 4..];
    for i in 0..out_scale.len() / 3 {
        let i4 = i * 4;
        let i3 = i * 3;
        out_scale[i3] = lx[rgba[i4] as usize];
        out_scale[i3 + 1] = ly[rgba[i4 + 1] as usize];
        out_scale[i3 + 2] = lz[rgba[i4 + 2] as usize];
    }
}

fn decode_quats(img: &ImageData, base: usize, out_quat: &mut [f32]) {
    const SQRT2: f32 = std::f32::consts::SQRT_2;
    let lookup: [f32; 256] = std::array::from_fn(|i| (i as f32 / 255.0 - 0.5) * SQRT2);
    let rgba = &img.rgba[base * 4..];
    for i in 0..out_quat.len() / 4 {
        let i4 = i * 4;
        let r0 = lookup[rgba[i4] as usize];
        let r1 = lookup[rgba[i4 + 1] as usize];
        let r2 = lookup[rgba[i4 + 2] as usize];
        let rr = (1.0 - (r0 * r0 + r1 * r1 + r2 * r2)).max(0.0).sqrt();
        let r_order = rgba[i4 + 3] as i32 - 252;
        let quat_x = if r_order == 0 { r0 } else if r_order == 1 { rr } else { r1 };
        let quat_y = if r_order <= 1 { r1 } else if r_order == 2 { rr } else { r2 };
        let quat_z = if r_order <= 2 { r2 } else { rr };
        let quat_w = if r_order == 0 { rr } else { r0 };
        out_quat[i4] = quat_x;
        out_quat[i4 + 1] = quat_y;
        out_quat[i4 + 2] = quat_z;
        out_quat[i4 + 3] = quat_w;
    }
}

fn decode_sh0(
    lr: &[f32],
    lg: &[f32],
    lb: &[f32],
    la: &[f32],
    img: &ImageData,
    base: usize,
    out_rgb: &mut [f32],
    out_opacity: &mut [f32],
) {
    let rgba = &img.rgba[base * 4..];
    for i in 0..out_opacity.len() {
        let i4 = i * 4;
        let i3 = i * 3;
        out_rgb[i3] = lr[rgba[i4] as usize];
        out_rgb[i3 + 1] = lg[rgba[i4 + 1] as usize];
        out_rgb[i3 + 2] = lb[rgba[i4 + 2] as usize];
        out_opacity[i] = la[rgba[i4 + 3] as usize];
    }
}

/// shN images (centroids + labels), decoded per chunk
struct ShN<'a> {
    centroids: &'a ImageData,
    labels: &'a ImageData,
    lookup: Vec<f32>,
    degree: usize,
}

impl<'a> ShN<'a> {
    fn load(
        images: &'a HashMap<String, ImageData>,
        files: &[String; 2],
        lookup: Vec<f32>,
        degree: usize,
    ) -> anyhow::Result<Self> {
        let centroids = get_image(images, &files[0])?;
        let labels = get_image(images, &files[1])?;
        Ok(Self { centroids, labels, lookup, degree })
    }

    fn decode(&self, base: usize, count: usize, c: &mut Chunk) {
        let (centroids, lookup) = (self.centroids, &self.lookup);
        let labels = &self.labels.rgba[base * 4..];
        let stride = if self.degree >= 3 { 15 } else if self.degree >= 2 { 8 } else { 3 };
        for i in 0..count {
            let i4 = i * 4;
            let label = labels[i4] as u16 | ((labels[i4 + 1] as u16) << 8);
            let col = (label & 63) as usize * stride;
            let row = (label >> 6) as usize;
            let offset = row * centroids.width + col;
            for d in 0..3 {
                if self.degree >= 1 {
                    for k in 0..3 {
                        c.sh1[i * 9 + k * 3 + d] = lookup[centroids.rgba[(offset + k) * 4 + d] as usize];
                    }
                }
                if self.degree >= 2 {
                    for k in 0..5 {
                        c.sh2[i * 15 + k * 3 + d] = lookup[centroids.rgba[(offset + 3 + k) * 4 + d] as usize];
                    }
                }
                if self.degree >= 3 {
                    for k in 0..7 {
                        c.sh3[i * 21 + k * 3 + d] = lookup[centroids.rgba[(offset + 8 + k) * 4 + d] as usize];
                    }
                }
            }
        }
    }
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



#[cfg(test)]
mod tests {
    use super::*;

    fn png(rgba: Vec<u8>, w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_raw(w, h, rgba).unwrap();
        let mut out = Vec::new();
        DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    /// Receiver that records every f32 value (GsplatArray stores f16)
    #[derive(Default)]
    struct Rec {
        center: Vec<f32>,
        scale: Vec<f32>,
        quat: Vec<f32>,
        rgb: Vec<f32>,
        opacity: Vec<f32>,
        sh: [Vec<f32>; 3],
        finished: bool,
    }

    impl SplatReceiver for Rec {
        fn init_splats(&mut self, init: &SplatInit) -> anyhow::Result<()> {
            let n = init.num_splats;
            (self.center, self.scale, self.quat, self.rgb, self.opacity) =
                (vec![0.0; n * 3], vec![0.0; n * 3], vec![0.0; n * 4], vec![0.0; n * 3], vec![0.0; n]);
            for (d, k) in [9, 15, 21].into_iter().enumerate() {
                self.sh[d] = if init.max_sh_degree > d { vec![0.0; n * k] } else { Vec::new() };
            }
            Ok(())
        }
        fn finish(&mut self) -> anyhow::Result<()> { self.finished = true; Ok(()) }
        fn set_batch(&mut self, base: usize, count: usize, b: &SplatProps) {
            let put = |dst: &mut Vec<f32>, src: &[f32], k: usize| {
                assert_eq!(src.len(), count * k);
                dst[base * k..(base + count) * k].copy_from_slice(src);
            };
            put(&mut self.center, b.center, 3);
            put(&mut self.scale, b.scale, 3);
            put(&mut self.quat, b.quat, 4);
            put(&mut self.rgb, b.rgb, 3);
            put(&mut self.opacity, b.opacity, 1);
            for (d, (src, k)) in [(b.sh1, 9), (b.sh2, 15), (b.sh3, 21)].into_iter().enumerate() {
                if !self.sh[d].is_empty() { put(&mut self.sh[d], src, k); }
            }
        }
        fn set_center(&mut self, _: usize, _: usize, _: &[f32]) { unimplemented!() }
        fn set_opacity(&mut self, _: usize, _: usize, _: &[f32]) { unimplemented!() }
        fn set_rgb(&mut self, _: usize, _: usize, _: &[f32]) { unimplemented!() }
        fn set_rgba(&mut self, _: usize, _: usize, _: &[f32]) { unimplemented!() }
        fn set_scale(&mut self, _: usize, _: usize, _: &[f32]) { unimplemented!() }
        fn set_quat(&mut self, _: usize, _: usize, _: &[f32]) { unimplemented!() }
    }

    const N: usize = 70_000; // > MAX_SPLAT_CHUNK: at least 2 chunks, the last one partial
    const W: usize = 512;
    const H: usize = N.div_ceil(W);
    const CW: usize = 64 * 15;
    const CH: usize = 16;
    const MINS: [f32; 3] = [-2.0, -1.0, -3.0];
    const MAXS: [f32; 3] = [2.0, 3.0, 1.5];

    struct Synth {
        ml: Vec<u8>, mu: Vec<u8>, s: Vec<u8>, q: Vec<u8>, c: Vec<u8>, cent: Vec<u8>, lab: Vec<u8>,
        cb: [Vec<f32>; 3], // codebook scales, sh0, shN (v2)
    }

    fn xorshift(seed: u32) -> impl FnMut() -> u32 {
        let mut x = seed;
        move || { x ^= x << 13; x ^= x >> 17; x ^= x << 5; x }
    }

    fn synth() -> Synth {
        let mut rnd = xorshift(0x1234_5678);
        let mut img = |n: usize, f: fn(usize, u32) -> u8| -> Vec<u8> {
            (0..n * 4).map(|i| f(i % 4, rnd())).collect()
        };
        let ml = img(W * H, |_, r| r as u8);
        let mu = img(W * H, |_, r| r as u8);
        let s = img(W * H, |_, r| r as u8);
        let q = img(W * H, |ch, r| if ch == 3 { 252 + (r % 4) as u8 } else { r as u8 });
        let c = img(W * H, |_, r| r as u8);
        let cent = img(CW * CH, |_, r| r as u8);
        let lab = img(W * H, |ch, r| if ch == 1 { (r % 4) as u8 } else { r as u8 });
        let mut rf = xorshift(0x9e37_79b9);
        let mut cb = || -> Vec<f32> { (0..256).map(|_| (rf() % 2000) as f32 / 1000.0 - 1.0).collect() };
        let cb = [cb(), cb(), cb()];
        Synth { ml, mu, s, q, c, cent, lab, cb }
    }

    /// Reference: formulas evaluated per splat, without chunking
    fn reference(sy: &Synth, v1: bool) -> Rec {
        let mut r = Rec::default();
        r.init_splats(&SplatInit { num_splats: N, max_sh_degree: 3, lod_tree: false }).unwrap();
        let lin = |min: f32, max: f32, b: u8| min + (max - min) * (b as f32 / 255.0);
        for j in 0..N {
            let p = j * 4;
            for d in 0..3 {
                let f = (sy.ml[p + d] as u32 + ((sy.mu[p + d] as u32) << 8)) as f32 / 65535.0;
                let v = MINS[d] + (MAXS[d] - MINS[d]) * f;
                r.center[j * 3 + d] = v.signum() * (v.abs().exp() - 1.0);
                r.scale[j * 3 + d] = if v1 { lin(-3.0, 1.0, sy.s[p + d]).exp() } else { sy.cb[0][sy.s[p + d] as usize].exp() };
                let col = if v1 { lin(-2.0, 2.0, sy.c[p + d]) } else { sy.cb[1][sy.c[p + d] as usize] };
                r.rgb[j * 3 + d] = SH_C0 * col + 0.5;
            }
            let a = sy.c[p + 3];
            r.opacity[j] = if v1 { 1.0 / (1.0 + (-lin(-4.0, 4.0, a)).exp()) } else { a as f32 / 255.0 };
            let qv = |b: u8| (b as f32 / 255.0 - 0.5) * std::f32::consts::SQRT_2;
            let (r0, r1, r2) = (qv(sy.q[p]), qv(sy.q[p + 1]), qv(sy.q[p + 2]));
            let rr = (1.0 - (r0 * r0 + r1 * r1 + r2 * r2)).max(0.0).sqrt();
            let quat = match sy.q[p + 3] - 252 {
                0 => [r0, r1, r2, rr],
                1 => [rr, r1, r2, r0],
                2 => [r1, rr, r2, r0],
                _ => [r1, r2, rr, r0],
            };
            r.quat[j * 4..j * 4 + 4].copy_from_slice(&quat);
            let label = sy.lab[p] as usize | ((sy.lab[p + 1] as usize) << 8);
            let off = (label >> 6) * CW + (label & 63) * 15;
            for (deg, (first, k)) in [(0, 3), (3, 5), (8, 7)].into_iter().enumerate() {
                for kk in 0..k {
                    for d in 0..3 {
                        let b = sy.cent[(off + first + kk) * 4 + d];
                        r.sh[deg][j * k * 3 + kk * 3 + d] = if v1 { lin(-0.5, 0.5, b) } else { sy.cb[2][b as usize] };
                    }
                }
            }
        }
        r.finished = true;
        r
    }

    fn assert_same(got: &Rec, exp: &Rec) {
        assert!(got.finished);
        let pairs = [
            ("center", &got.center, &exp.center), ("scale", &got.scale, &exp.scale),
            ("quat", &got.quat, &exp.quat), ("rgb", &got.rgb, &exp.rgb), ("opacity", &got.opacity, &exp.opacity),
            ("sh1", &got.sh[0], &exp.sh[0]), ("sh2", &got.sh[1], &exp.sh[1]), ("sh3", &got.sh[2], &exp.sh[2]),
        ];
        for (name, g, e) in pairs {
            assert_eq!(g.len(), e.len(), "{name} len");
            for (i, (a, b)) in g.iter().zip(e.iter()).enumerate() {
                assert!((a - b).abs() <= 1e-6 * (1.0 + b.abs()), "{name}[{i}]: {a} vs {b}");
            }
        }
    }

    fn synth_files(sy: &Synth) -> HashMap<String, Vec<u8>> {
        let (w, h) = (W as u32, H as u32);
        [
            ("ml.png", png(sy.ml.clone(), w, h)), ("mu.png", png(sy.mu.clone(), w, h)),
            ("s.png", png(sy.s.clone(), w, h)), ("q.png", png(sy.q.clone(), w, h)),
            ("c.png", png(sy.c.clone(), w, h)), ("lab.png", png(sy.lab.clone(), w, h)),
            ("cent.png", png(sy.cent.clone(), CW as u32, CH as u32)),
        ].into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    fn meta_v2(sy: &Synth) -> Vec<u8> {
        serde_json::json!({
            "version": 2, "count": N,
            "means": {"files": ["ml.png", "mu.png"], "mins": MINS, "maxs": MAXS},
            "scales": {"files": ["s.png"], "codebook": sy.cb[0]},
            "quats": {"files": ["q.png"]},
            "sh0": {"files": ["c.png"], "codebook": sy.cb[1]},
            "shN": {"files": ["cent.png", "lab.png"], "codebook": sy.cb[2], "bands": 3},
        }).to_string().into_bytes()
    }

    /// Build an in-memory SOG zip (stored entries, nested under a folder prefix)
    fn sog_zip(meta: &[u8], files: HashMap<String, Vec<u8>>) -> Vec<u8> {
        use std::io::Write;
        let mut zbuf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(Cursor::new(&mut zbuf));
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zw.start_file("scene/meta.json", opts).unwrap();
            zw.write_all(meta).unwrap();
            for (name, bytes) in files {
                zw.start_file(format!("scene/{name}"), opts).unwrap();
                zw.write_all(&bytes).unwrap();
            }
            zw.finish().unwrap();
        }
        zbuf
    }

    /// Feed the zip to SogsDecoder in several pushes, as the streaming loader does
    fn decode_zip(zbuf: &[u8]) -> Rec {
        let mut dec = SogsDecoder::new(Rec::default(), None);
        for part in zbuf.chunks(100_000) { dec.push(part).unwrap(); }
        dec.finish().unwrap();
        assert!(dec.buffer.is_empty());
        dec.into_splats()
    }

    #[test]
    fn decode_v2_chunked_matches_reference() {
        let sy = synth();
        let got = decode_zip(&sog_zip(&meta_v2(&sy), synth_files(&sy)));
        assert_same(&got, &reference(&sy, false));
    }

    #[test]
    fn decode_v1_chunked_matches_reference() {
        let sy = synth();
        let meta = serde_json::json!({
            "means": {"files": ["ml.png", "mu.png"], "mins": MINS, "maxs": MAXS, "shape": [N, 3]},
            "scales": {"files": ["s.png"], "mins": [-3.0, -3.0, -3.0], "maxs": [1.0, 1.0, 1.0]},
            "quats": {"files": ["q.png"], "encoding": "quaternion_packed"},
            "sh0": {"files": ["c.png"], "mins": [-2.0, -2.0, -2.0, -4.0], "maxs": [2.0, 2.0, 2.0, 4.0]},
            "shN": {"files": ["cent.png", "lab.png"], "mins": -0.5, "maxs": 0.5, "shape": [N, 45]},
        }).to_string().into_bytes();
        let got = decode_zip(&sog_zip(&meta, synth_files(&sy)));
        assert_same(&got, &reference(&sy, true));
    }
}
