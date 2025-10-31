use std::{fs::File, io::{BufReader, Read}};

use spark_lib::{
    decoder::{ChunkReceiver, MultiDecoder},
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

        let mut splats = splats;
        compute_lod_tree(&mut splats, 1.5);

        let encoder = SpzEncoder::new(splats);
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
