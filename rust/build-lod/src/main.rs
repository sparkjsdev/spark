use std::{fs::File, io::{BufReader, Read}};

use spark_lib::{
    decoder::{ChunkReceiver, MultiDecoder, SplatEncoding, SplatGetter},
    gsplat::GsplatArray,
    quick_lod::compute_lod_tree,
    spz::SpzEncoder,
};

fn read_file_chunks(filename: &str, decoder: &mut impl ChunkReceiver) -> anyhow::Result<()> {
    const CHUNK_SIZE: usize = 1 * 1024 * 1024; // 1 MiB
    let mut reader = BufReader::new(File::open(filename).unwrap());
    let mut buffer = vec![0u8; CHUNK_SIZE];
    loop {
        let bytes_read = reader.read(&mut buffer).unwrap();
        if bytes_read == 0 {
            break;
        }
        decoder.push(&buffer[..bytes_read])?;
    }
    decoder.finish()
}

struct GsplatLodGetter {
    splats: GsplatArray,
}

impl GsplatLodGetter {
    fn new(mut splats: GsplatArray) -> Self {
        compute_lod_tree(&mut splats, 1.5);
        Self { splats }
    }
}

impl SplatGetter for GsplatLodGetter {
    fn num_splats(&self) -> usize { self.splats.len() }
    fn max_sh_degree(&self) -> usize { self.splats.max_sh_degree }
    fn fractional_bits(&self) -> u8 { 12 }
    fn flag_antialias(&self) -> bool { true }
    fn has_lod_tree(&self) -> bool { true }
    fn get_encoding(&mut self) -> SplatEncoding { SplatEncoding::default() }

    fn get_center(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let c = self.splats.splats[base + i].center.to_array();
            out[i * 3 + 0] = c[0];
            out[i * 3 + 1] = c[1];
            out[i * 3 + 2] = c[2];
        }
    }
    fn get_opacity(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count { out[i] = self.splats.splats[base + i].opacity(); }
    }
    fn get_rgb(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let r = self.splats.splats[base + i].rgb().to_array();
            out[i * 3 + 0] = r[0];
            out[i * 3 + 1] = r[1];
            out[i * 3 + 2] = r[2];
        }
    }
    fn get_scale(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let s = self.splats.splats[base + i].scales().to_array();
            out[i * 3 + 0] = s[0];
            out[i * 3 + 1] = s[1];
            out[i * 3 + 2] = s[2];
        }
    }
    fn get_quat(&mut self, base: usize, count: usize, out: &mut [f32]) {
        for i in 0..count {
            let q = self.splats.splats[base + i].quaternion().to_array();
            out[i * 4 + 0] = q[0];
            out[i * 4 + 1] = q[1];
            out[i * 4 + 2] = q[2];
            out[i * 4 + 3] = q[3];
        }
    }
    fn get_sh1(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if self.splats.max_sh_degree >= 1 {
            for i in 0..count { out[i * 9..i * 9 + 9].copy_from_slice(&self.splats.sh1[base + i].to_array()); }
        }
    }
    fn get_sh2(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if self.splats.max_sh_degree >= 2 {
            for i in 0..count { out[i * 15..i * 15 + 15].copy_from_slice(&self.splats.sh2[base + i].to_array()); }
        }
    }
    fn get_sh3(&mut self, base: usize, count: usize, out: &mut [f32]) {
        if self.splats.max_sh_degree >= 3 {
            for i in 0..count { out[i * 21..i * 21 + 21].copy_from_slice(&self.splats.sh3[base + i].to_array()); }
        }
    }
    fn get_child_count(&mut self, base: usize, count: usize, out: &mut [u16]) {
        for i in 0..count { out[i] = self.splats.extras[base + i].children.len() as u16; }
    }
    fn get_child_start(&mut self, base: usize, count: usize, out: &mut [u32]) {
        for i in 0..count {
            let children = &self.splats.extras[base + i].children;
            out[i] = children.first().copied().unwrap_or(0) as u32;
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("Usage: build-lod <file.spz|file.ply> [...] ");
        return;
    }
    let mut max_sh_out: Option<u8> = None;
    let mut filenames = Vec::new();
    for arg in args {
        if let Some(rest) = arg.strip_prefix("--max-sh=") {
            match rest.parse::<u8>() {
                Ok(v) => { max_sh_out = Some(v.min(3)); }
                Err(_) => { eprintln!("Invalid --max-sh value: {}", rest); }
            }
            continue;
        }
        filenames.push(arg);
    }
    for filename in filenames {
        println!("*** Processing: {}", filename);
        let mut decoder = MultiDecoder::new(GsplatArray::new(), None, Some(&filename));
        let splats = match read_file_chunks(&filename, &mut decoder) {
            Ok(_) => {
                println!("Detected file type: {:?}", decoder.file_type.unwrap());
                decoder.into_splats()
            }
            Err(error) => {
                eprintln!("Decoding failed: {:?}", error);
                continue;
            }
        };

        println!("num_splats: {}, max_sh: {}", splats.len(), splats.max_sh_degree);

        let getter = GsplatLodGetter::new(splats);
        let encoder = SpzEncoder::new(getter);
        let encoder = if let Some(m) = max_sh_out { encoder.with_max_sh(m) } else { encoder };
        let bytes = match encoder.encode() {
            Ok(b) => b,
            Err(e) => { eprintln!("Encoding failed: {:?}", e); continue; }
        };

        // Replace extension with -lod.spz
        let mut output_filename = filename.clone();
        if let Some(dot) = filename.rfind('.') {
            output_filename.replace_range(dot.., "-lod.spz");
        } else {
            output_filename.push_str("-lod.spz");
        }

        match std::fs::write(&output_filename, &bytes) {
            Ok(_) => println!("Wrote {} ({} bytes)", output_filename, bytes.len()),
            Err(e) => eprintln!("Failed to write {}: {:?}", output_filename, e),
        }
    }
}
