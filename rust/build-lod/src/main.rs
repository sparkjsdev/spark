use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};

use spark_lib::decoder::{SplatEncoding, SplatGetter, SplatReceiver};
use spark_lib::rad::RadEncoder;
use spark_lib::{
    decoder::{ChunkReceiver, MultiDecoder},
    gsplat::GsplatArray,
    csplat::CsplatArray,
    tsplat::TsplatArray,
    tiny_lod,
    bhatt_lod,
    spz::SpzEncoder,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum BuildLodOutput {
    #[default]
    Rad,
    Spz,
    SpzChunked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum BuildLodTsplat {
    #[default]
    Gsplat,
    Csplat,
}

#[derive(Clone, Copy, Debug, Default)]
enum BuildLodMethod {
    TinyLod { lod_base: f32 },
    BhattLod { lod_base: f32 },
    #[default]
    Quick,
    Quality,
}

#[derive(Clone, Debug, Default)]
struct BuildLodOptions {
    unlod: bool,
    tsplat: BuildLodTsplat,
    method: BuildLodMethod,
    max_sh: Option<usize>,
    output: BuildLodOutput,
    splat_encoding: Option<SplatEncoding>,
}

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

fn process_file_lod(filename: &str, options: &BuildLodOptions) {
    match options.tsplat {
        BuildLodTsplat::Gsplat => {
            let splats = GsplatArray::new();
            process_file_lod_tsplat(filename, options, splats)
        },
        BuildLodTsplat::Csplat => {
            let splats = CsplatArray::new_encoding(options.splat_encoding.clone());
            process_file_lod_tsplat(filename, options, splats)
        }
    }
}

fn process_file_lod_tsplat<TS: SplatReceiver + TsplatArray + SplatGetter>(filename: &str, options: &BuildLodOptions, splats: TS) {
    let mut decoder = MultiDecoder::new(splats, None, Some(&filename));
    let mut splats = match read_file_chunks(&filename, &mut decoder) {
        Ok(_) => {
            println!("Detected file type: {:?}", decoder.file_type.unwrap());
            decoder.into_splats()
        }
        Err(error) => {
            eprintln!("Decoding failed: {:?}", error);
            return;
        }
    };

    println!("Read: num_splats: {} with sh_degree: {}", splats.len(), TsplatArray::max_sh_degree(&splats));

    if let Some(max_sh) = options.max_sh {
        splats.set_max_sh_degree(max_sh);
    }

    // {
    //     let mut center = f32::NEG_INFINITY;
    //     let mut scale = [f32::INFINITY, f32::NEG_INFINITY];
    //     let mut rgb = [f32::INFINITY, f32::NEG_INFINITY];
    //     let mut sh1 = [f32::INFINITY, f32::NEG_INFINITY];
    //     let mut sh2 = [f32::INFINITY, f32::NEG_INFINITY];
    //     let mut sh3 = [f32::INFINITY, f32::NEG_INFINITY];
    //     for i in 0..splats.len() {
    //         let splat = splats.get(i);
    //         center = center.max(splat.center().abs().max_element());
    //         for s in splat.scales().to_array() {
    //             if s > 0.0 {
    //                 scale = [scale[0].min(s), scale[1].max(s)];
    //             }
    //         }
    //         for c in splat.rgb().to_array() {
    //             rgb = [rgb[0].min(c), rgb[1].max(c)];
    //         }
    //         for c in splats.get_sh1(i) {
    //             sh1 = [sh1[0].min(c), sh1[1].max(c)];
    //         }
    //         // for c in splats.get_sh2(i) {
    //         //     sh2 = [sh2[0].min(c), sh2[1].max(c)];
    //         // }
    //         // for c in splats.get_sh3(i) {
    //         //     sh3 = [sh3[0].min(c), sh3[1].max(c)];
    //         // }
    //     }
    //     println!("Stats: center={}, scale={:?}, rgb={:?}, sh1={:?}, sh2={:?}, sh3={:?}", center, scale, rgb, sh1, sh2, sh3);

    //     rgb = [(rgb[0] / 0.1).floor() * 0.1, (rgb[1] / 0.1).ceil() * 0.1];
    //     sh1 = [(sh1[0] / 0.1).floor() * 0.1, (sh1[1] / 0.1).ceil() * 0.1];
    //     sh2 = [(sh2[0] / 0.1).floor() * 0.1, (sh2[1] / 0.1).ceil() * 0.1];
    //     sh3 = [(sh3[0] / 0.1).floor() * 0.1, (sh3[1] / 0.1).ceil() * 0.1];
    //     let mut rgb_buckets = Vec::new();
    //     rgb_buckets.resize(((rgb[1] - rgb[0]) / 0.1).round() as usize, 0);
    //     let mut sh1_buckets = Vec::new();
    //     sh1_buckets.resize(((sh1[1] - sh1[0]) / 0.1).round() as usize, 0);
    //     // let mut sh2_buckets = Vec::new();
    //     // sh2_buckets.resize(((sh2[1] - sh2[0]) / 0.1).round() as usize, 0);
    //     // let mut sh3_buckets = Vec::new();
    //     // sh3_buckets.resize(((sh3[1] - sh3[0]) / 0.1).round() as usize, 0);

    //     for i in 0..splats.len() {
    //         for c in splats.get(i).rgb().to_array() {
    //             let bucket = (((c - rgb[0]) / 0.1).floor() as usize).min(rgb_buckets.len() - 1);
    //             rgb_buckets[bucket] += 1;
    //         }
    //         for c in splats.get_sh1(i) {
    //             let bucket = ((c - sh1[0]) / 0.1).floor() as usize;
    //             sh1_buckets[bucket] += 1;
    //         }
    //         // for c in splats.get_sh2(i) {
    //         //     let bucket = ((c - sh2[0]) / 0.1).floor() as usize;
    //         //     sh2_buckets[bucket] += 1;
    //         // }
    //         // for c in splats.get_sh3(i) {
    //         //     let bucket = ((c - sh3[0]) / 0.1).floor() as usize;
    //         //     sh3_buckets[bucket] += 1;
    //         // }
    //     }

    //     println!("rgb_buckets: [{}..{}]", rgb[0], rgb[1]);
    //     for b in 0..rgb_buckets.len() {
    //         println!("{:.1}, {}", rgb[0] + b as f32 * 0.1, rgb_buckets[b]);
    //     }

    //     println!("sh1_buckets: [{}..{}]", sh1[0], sh1[1]);
    //     for b in 0..sh1_buckets.len() {
    //         println!("{:.1}, {}", sh1[0] + b as f32 * 0.1, sh1_buckets[b]);
    //     }
    //     // println!("sh2_buckets: [{}..{}]", sh2[0], sh2[1]);
    //     // for b in 0..sh2_buckets.len() {
    //     //     println!("{:.1}, {}", sh2[0] + b as f32 * 0.1, sh2_buckets[b]);
    //     // }
    //     // println!("sh3_buckets: [{}..{}]", sh3[0], sh3[1]);
    //     // for b in 0..sh3_buckets.len() {
    //     //     println!("{:.1}, {}", sh3[0] + b as f32 * 0.1, sh3_buckets[b]);
    //     // }
    // }

    let mut output_filename = filename.to_string();
    if let Some(dot) = filename.rfind('.') {
        output_filename.replace_range(dot.., "-lod");
    } else {
        output_filename.push_str("-lod");
    }

    if options.unlod {
        println!("Un-LODing {}", filename);
        let orig_splats_len = splats.len();
        splats.retain_children(|_, children| children.is_empty());
        if orig_splats_len != splats.len() {
            println!("Removed {} splats with children", orig_splats_len - splats.len());
        } else {
            println!("Skipping {} because it doesn't have children", filename);
            return;
        }
        splats.clear_children();
        output_filename.replace_range(output_filename.rfind("-lod").unwrap().., "");
    }

    let method = match options.method.clone() {
        BuildLodMethod::Quick => BuildLodMethod::TinyLod { lod_base: 1.5 },
        BuildLodMethod::Quality => BuildLodMethod::BhattLod { lod_base: 1.75 },
        other => other,
    };

    match method {
        BuildLodMethod::TinyLod { lod_base } => {
            let merge_filter = false;
            tiny_lod::compute_lod_tree(&mut splats, lod_base, merge_filter, |s| println!("{}", s));
        },
        BuildLodMethod::BhattLod { lod_base } => {
            bhatt_lod::compute_lod_tree(&mut splats, lod_base, |s| println!("{}", s));
        },
        _ => unreachable!()
    }

    match options.output {
        BuildLodOutput::Rad => {
            let mut encoder = RadEncoder::new(splats);
            // encoder.resolve_encoding();
            println!("Encoding RAD file with center={:?}, alpha={:?}, rgb={:?}, scales={:?}, orientation={:?}, sh={:?}", encoder.center_encoding, encoder.alpha_encoding, encoder.rgb_encoding, encoder.scales_encoding, encoder.orientation_encoding, encoder.sh_encoding);
            if let Some(encoding) = encoder.encoding.as_ref() {
                println!("Splat Encoding: {:?}", encoding);
            }
            let filename_ext = format!("{}.rad", output_filename);
            let mut writer = BufWriter::new(File::create(&filename_ext).unwrap());
            encoder.encode(&mut writer).unwrap();
            println!("Wrote {}", filename_ext);
        },
        BuildLodOutput::Spz => {
            let encoder = SpzEncoder::new(splats);
            let bytes = encoder.encode().unwrap();
            let filename_ext = format!("{}.spz", output_filename);
            let mut writer = BufWriter::new(File::create(&filename_ext).unwrap());
            writer.write_all(&bytes).unwrap();
            println!("Wrote {} ({} bytes)", filename_ext, bytes.len());
            return;
    
        },
        BuildLodOutput::SpzChunked => {
            let num_splats = splats.len();
            let num_chunks = num_splats.div_ceil(65536);
            for chunk in 0..num_chunks {
                let start = chunk * 65536;
                let count = (num_splats - start).min(65536);
                
                let subset = splats.clone_subset(start, count);
                let encoder = SpzEncoder::new(subset);
                let bytes = encoder.encode().unwrap();
                let filename_ext = format!("{}-{}.spz", output_filename, chunk);
                let mut writer = BufWriter::new(File::create(&filename_ext).unwrap());
                writer.write_all(&bytes).unwrap();
                println!("Chunk {}: Wrote {} ({} bytes)", chunk, filename_ext, bytes.len());
            }
        },
    }
}

fn show_usage_exit() {
    eprintln!("Usage: build-lod");
    eprintln!("  [--unlod]                                    // Remove LoD nodes with children from file");
    eprintln!("  [--csplat] [--gsplat]                        // Use compact (csplat) or higher-precision (default gsplat) splat encoding");
    eprintln!("  [--quick] [--quality]                        // Use quick (tiny-lod) or quality (bhatt-lod) LoD method (default quick)");
    eprintln!("  [--tiny-lod[=<base>]] [--bhatt-lod[=<base>]] // Use tiny-lod (default base 1.5) or bhatt-lod (default base 1.75) LoD method");
    eprintln!("  [--max-sh=<max-sh>]                          // Set maximum SH degree (default 3)");
    eprintln!("  [--rad] [--spz] [--spz-chunked]              // Output RAD, SPZ, or chunked SPZ files");
    eprintln!("  <file.ply|file.spz|file.compressed.ply|file.splat|file.ksplat|file.sog|file.rad> [...] // Multiple input files and wildcards allowed");
    std::process::exit(1);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut options = BuildLodOptions::default();
    let mut filenames = Vec::new();

    for arg in args {
        if arg == "--unlod" {
            options.unlod = true;
            println!("Using --unlod: Un-LoD file by removing nodes with children");
            continue;
        }
        if arg == "--csplat" {
            options.tsplat = BuildLodTsplat::Csplat;
            println!("Using --csplat: Compact splat encoding");
            continue;
        }
        if arg == "--gsplat" {
            options.tsplat = BuildLodTsplat::Gsplat;
            println!("Using --gsplat: Higher-precision splat encoding");
            continue;
        }
        if arg == "--quick" {
            options.method = BuildLodMethod::Quick;
            println!("Using --quick: Quick LoD method (tiny-lod base 1.5");
            continue;
        }
        if arg == "--quality" {
            options.method = BuildLodMethod::Quality;
            println!("Using --quality: Quality LoD method (bhatt-lod base 1.75)");
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--tiny-lod") {
            if let Some(rest) = rest.strip_prefix("=") {
                match rest.parse::<f32>() {
                    Ok(base) => {
                        let base = base.clamp(1.1, 2.0);
                        println!("Using --tiny-lod with base {}", base);
                        options.method = BuildLodMethod::TinyLod { lod_base: base };
                    }
                    Err(_) => {
                        eprintln!("Invalid --tiny-lod base: {}", rest);
                        show_usage_exit();
                    }
                }
            } else {
                options.method = BuildLodMethod::TinyLod { lod_base: 1.5 };
                println!("Using --tiny-lod with default base 1.5");
            }
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--bhatt-lod") {
            if let Some(rest) = rest.strip_prefix("=") {
                match rest.parse::<f32>() {
                    Ok(base) => {
                        let base = base.clamp(1.1, 2.0);
                        println!("Using --bhatt-lod with base {}", base);
                        options.method = BuildLodMethod::BhattLod { lod_base: base };
                    }
                    Err(_) => {
                        eprintln!("Invalid --bhatt-lod base: {}", rest);
                        show_usage_exit();
                    }
                }
            } else {
                options.method = BuildLodMethod::BhattLod { lod_base: 1.75 };
                println!("Using --bhatt-lod with default base 1.75");
            }
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--max-sh=") {
            match rest.parse::<usize>() {
                Ok(v) => {
                    println!("Using --max-sh={}", v.min(3));
                    options.max_sh = Some(v.min(3));
                }
                Err(_) => {
                    eprintln!("Invalid --max-sh value: {}", rest);
                    show_usage_exit();
                }
            }
            continue;
        }
        if arg == "--rad" {
            options.output = BuildLodOutput::Rad;
            println!("Using --rad: RAD file output (default)");
            continue;
        }
        if arg == "--spz" {
            options.output = BuildLodOutput::Spz;
            println!("Using --spz: SPZ file output");
            continue;
        }
        if arg == "--spz-chunked" {
            options.output = BuildLodOutput::SpzChunked;
            println!("Using --spz-chunked: Chunk SPZ file output");
            continue;
        }
        if arg.starts_with("--") {
            eprintln!("Unknown option: {}", arg);
            show_usage_exit();
        }
        filenames.push(arg);
    }

    if filenames.is_empty() {
        show_usage_exit();
    }

    for filename in filenames {
        println!("*** Processing: {}", filename);

        if filename.ends_with("-lod.spz") || filename.ends_with("-lod.rad") {
            if !options.unlod {
                println!("Skipping {} because it ends in -lod.*", filename);
                continue;
            }
        } else {
            if options.unlod {
                println!("Skipping {} because it doesn't end in -lod.*", filename);
                continue;
            }
        }

        process_file_lod(&filename, &options);
    }
}
