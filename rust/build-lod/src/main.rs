use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};

use spark_lib::{
    decoder::{ChunkReceiver, MultiDecoder},
    gsplat::GsplatArray,
    quick_lod::compute_lod_tree,
    // slow_lod::create_splat_tree,
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


fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("Usage: build-lod [--max-sh=<max-sh>] [--chunked] [--merge-filter] [--no-merge-filter] [--unlod] <file.spz|file.ply> [...] ");
        return;
    }

    let mut max_sh_out: Option<u8> = None;
    let mut chunked: bool = false;
    let mut merge_filter: bool = false;
    // let mut slow_lod: bool = false;
    let mut filenames = Vec::new();
    let mut unlod: bool = false;

    for arg in args {
        if let Some(rest) = arg.strip_prefix("--max-sh=") {
            match rest.parse::<u8>() {
                Ok(v) => { max_sh_out = Some(v.min(3)); }
                Err(_) => { eprintln!("Invalid --max-sh value: {}", rest); }
            }
            continue;
        }
        if arg == "--chunked" {
            chunked = true;
            continue;
        }
        if arg == "--merge-filter" {
            merge_filter = true;
            continue;
        }
        if arg == "--no-merge-filter" {
            merge_filter = false;
            continue;
        }
        if arg == "--unlod" {
            unlod = true;
            continue;
        }
        // if arg == "--slow" {
        //     slow_lod = true;
        //     continue;
        // }
        filenames.push(arg);
    }

    for filename in filenames {
        println!("*** Processing: {}", filename);

        if filename.ends_with("-lod.spz") {
            if !unlod {
                println!("Skipping {} because it ends in -lod.spz", filename);
                continue;
            }
        } else {
            if unlod {
                println!("Skipping {} because it doesn't end in -lod.spz", filename);
                continue;
            }
        }

        let mut decoder = MultiDecoder::new(GsplatArray::new(), None, Some(&filename));
        let mut splats = match read_file_chunks(&filename, &mut decoder) {
            Ok(_) => {
                println!("Detected file type: {:?}", decoder.file_type.unwrap());
                decoder.into_splats()
            }
            Err(error) => {
                eprintln!("Decoding failed: {:?}", error);
                continue;
            }
        };

        println!("num_splats: {} with sh_degree: {}", splats.len(), splats.max_sh_degree);

        if unlod {
            println!("Un-LODing {}", filename);
            let orig_splats_len = splats.len();
            splats.retain_extra(|_, extra| extra.children.is_empty());
            if orig_splats_len != splats.len() {
                println!("Removed {} splats with children", orig_splats_len - splats.len());
            } else {
                println!("Skipping {} because it doesn't have children", filename);
                continue;
            }

            splats.extras.clear();
            let output_filename = filename.replace("-lod.spz", ".spz");
            let encoder = SpzEncoder::new(splats);
            let encoder = if let Some(m) = max_sh_out { encoder.with_max_sh(m) } else { encoder };
            let bytes = encoder.encode().unwrap();

            let mut writer = BufWriter::new(File::create(&output_filename).unwrap());
            writer.write_all(&bytes).unwrap();
            println!("Wrote {} ({} bytes)", output_filename, bytes.len());
            continue;
        }

        // if !slow_lod {
            // compute_lod_tree(&mut splats, 1.5, merge_filter, Some(2), true);
            compute_lod_tree(&mut splats, 1.5, merge_filter, |s| println!("{}", s));
        // } else {
        //     create_splat_tree(&mut splats);
        // }

        // Replace extension with -lod.spz
        let mut output_prefix = filename.clone();
        if let Some(dot) = filename.rfind('.') {
            output_prefix.replace_range(dot.., "-lod");
        } else {
            output_prefix.push_str("-lod");
        }

        if !chunked {
            let encoder = SpzEncoder::new(splats);
            let encoder = if let Some(m) = max_sh_out { encoder.with_max_sh(m) } else { encoder };
            let bytes = encoder.encode().unwrap();

            let output_filename = format!("{}.spz", output_prefix);
            let mut writer = BufWriter::new(File::create(&output_filename).unwrap());
            writer.write_all(&bytes).unwrap();
            println!("Wrote {} ({} bytes)", output_filename, bytes.len());
            continue;
        }

        let initial_chunk = 1;

        let num_splats = splats.len();
        let num_chunks = num_splats.div_ceil(65536);
        for chunk in 0..num_chunks {
            let start = chunk * 65536;
            let mut count = (num_splats - start).min(65536);

            if chunk == 0 {
                count = initial_chunk * 65536;
            } else if chunk < initial_chunk {
                continue;
            }
            
            let subset = splats.clone_subset(start, count);
            let encoder = SpzEncoder::new(subset);
            let encoder = if let Some(m) = max_sh_out { encoder.with_max_sh(m) } else { encoder };
            let bytes = encoder.encode().unwrap();

            let output_filename = format!("{}-{}.spz", output_prefix, chunk);
            let mut writer = BufWriter::new(File::create(&output_filename).unwrap());
            writer.write_all(&bytes).unwrap();
            println!("Chunk {}: Wrote {} ({} bytes)", chunk, output_filename, bytes.len());
        }
    }
}
