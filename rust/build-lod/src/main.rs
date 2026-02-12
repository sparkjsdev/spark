use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};

use spark_lib::chunk_tree;
use spark_lib::decoder::{SplatEncoding, SplatGetter, SplatReceiver};
use spark_lib::rad::RadEncoder;
use spark_lib::{
    decoder::{ChunkReceiver, MultiDecoder},
    gsplat::GsplatArray,
    csplat::CsplatArray,
    tsplat::{Tsplat, TsplatMut, TsplatArray},
    tiny_lod,
    bhatt_lod,
    spz::SpzEncoder,
};

const INFLATE_SCALE: bool = false;

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
    min_box: Option<[f32; 3]>,
    max_box: Option<[f32; 3]>,
    within_dist: Option<([f32; 3], f32)>,
    skip_validate: bool,
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

    let mut description = serde_json::Map::new();

    let input_splat_count = splats.len();
    let input_sh_degree = TsplatArray::max_sh_degree(&splats);

    println!("Read: num_splats: {} with sh_degree: {}", input_splat_count, input_sh_degree);
    description.insert("input_splat_count".to_string(), serde_json::Value::Number(input_splat_count.into()));
    description.insert("input_sh_degree".to_string(), serde_json::Value::Number(input_sh_degree.into()));

    if !options.skip_validate {
        let mut invalid_count = 0;

        for index in 0..splats.len() {
            let splat = splats.get(index);
            if !splat.center().is_finite() || !splat.scales().is_finite() || !splat.quaternion().is_finite() ||
                !splat.opacity().is_finite() || !splat.rgb().is_finite() || !splat.quaternion().is_finite()
            {
                if invalid_count < 100 {
                    eprintln!("Splat {} not finite: {:?}", index, splat);
                }
                invalid_count += 1;
            }
        }
        if invalid_count > 0 {
            eprintln!("Found {} invalid splats", invalid_count);
            eprintln!("Stopping processing due to invalid splats! To continue, use --skip-validate");
            return;
        }
    }

    splats.retain(|splat| {
        (splat.opacity() > 0.0) && (splat.max_scale() > 0.0) &&
        (splat.quaternion().is_finite() && splat.quaternion().length() > 0.0)
    });

    if input_splat_count != splats.len() {
        println!("Removed {} empty splats, remaining splats.len={}", input_splat_count - splats.len(), splats.len());
        description.insert("empty_splat_count".to_string(), serde_json::Value::Number((input_splat_count - splats.len()).into()));
        description.insert("initial_splat_count".to_string(), serde_json::Value::Number(splats.len().into()));
    }

    if let Some(max_sh) = options.max_sh {
        splats.set_max_sh_degree(max_sh);
        description.insert("max_sh_degree".to_string(), serde_json::Value::Number(max_sh.into()));
    }

    if let Some(min_box) = options.min_box {
        splats.retain(|splat| {
            splat.center().x >= min_box[0] && splat.center().y >= min_box[1] && splat.center().z >= min_box[2]
        });
        description.insert("min_box".to_string(), serde_json::Value::Array(min_box.iter().map(|&v| serde_json::Number::from_f64(v as f64).into()).collect()));
    }

    if let Some(max_box) = options.max_box {
        splats.retain(|splat| {
            splat.center().x <= max_box[0] && splat.center().y <= max_box[1] && splat.center().z <= max_box[2]
        });
        description.insert("max_box".to_string(), serde_json::Value::Array(max_box.iter().map(|&v| serde_json::Number::from_f64(v as f64).into()).collect()));
    }

    if let Some((origin, dist)) = options.within_dist {
        splats.retain(|splat| {
            let center = splat.center();
            let dist2 = (center.x - origin[0]).powi(2) + (center.y - origin[1]).powi(2) + (center.z - origin[2]).powi(2);
            dist2 <= dist * dist
        });
        description.insert("within_dist".to_string(), serde_json::Value::Array(origin.iter().map(|&v| serde_json::Number::from_f64(v as f64).into()).collect()));
        description.insert("within_dist_radius".to_string(), serde_json::Number::from_f64(dist as f64).into());
    }

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
        description.insert("unlod".to_string(), serde_json::Value::Bool(true));
    }

    let method = match options.method.clone() {
        BuildLodMethod::Quick => BuildLodMethod::TinyLod { lod_base: 1.5 },
        BuildLodMethod::Quality => BuildLodMethod::BhattLod { lod_base: 1.75 },
        other => other,
    };
    description.insert("method".to_string(), serde_json::Value::String(format!("{:?}", method)));

    let start_time = std::time::Instant::now();

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

    let lod_duration = start_time.elapsed();
    description.insert("lod_duration".to_string(), serde_json::Number::from_f64(lod_duration.as_secs_f64()).into());

    let start_time = std::time::Instant::now();

    chunk_tree::chunk_tree(&mut splats, 0, |s| println!("{}", s));

    let chunk_duration = start_time.elapsed();
    description.insert("chunk_duration".to_string(), serde_json::Number::from_f64(chunk_duration.as_secs_f64()).into());

    for i in 0..splats.len() {
        let mut splat = splats.get_mut(i);
        
        if splat.opacity() > 1.0 {
            if !INFLATE_SCALE {
                let d = splat.lod_opacity();
                // // Map 1..5 LOD-encoded opacity to 1..2 opacity
                splat.set_opacity((0.25 * (d - 1.0) + 1.0).clamp(1.0, 2.0));
            } else {
                let rescale = splat.opacity().powf(1.0 / 3.0);
                splat.set_scales(splat.scales() * rescale);
                splat.set_opacity(1.0);
            }
        }
    }
    if INFLATE_SCALE {
        description.insert("inflate_scale".to_string(), serde_json::Value::Bool(true));
    }

    match options.output {
        BuildLodOutput::Rad => {
            let mut encoder = RadEncoder::new(splats);
            let input_encoding = serde_json::json!({
                    "center": encoder.center_encoding,
                    "alpha": encoder.alpha_encoding,
                    "rgb": encoder.rgb_encoding,
                    "scales": encoder.scales_encoding,
                    "orientation": encoder.orientation_encoding,
                    "sh": encoder.sh_encoding,
                    "encoding": encoder.encoding,
            });
            description.insert("input_encoding".to_string(), input_encoding);

            encoder.resolve_encoding();
            let resolved_encoding = serde_json::json!({
                "center": encoder.center_encoding,
                "alpha": encoder.alpha_encoding,
                "rgb": encoder.rgb_encoding,
                "scales": encoder.scales_encoding,
                "orientation": encoder.orientation_encoding,
                "sh": encoder.sh_encoding,
                "encoding": encoder.encoding,
            });
            description.insert("resolved_encoding".to_string(), resolved_encoding);

            println!("Encoding RAD file with center={:?}, alpha={:?}, rgb={:?}, scales={:?}, orientation={:?}, sh={:?}", encoder.center_encoding, encoder.alpha_encoding, encoder.rgb_encoding, encoder.scales_encoding, encoder.orientation_encoding, encoder.sh_encoding);
            if let Some(encoding) = encoder.encoding.as_ref() {
                println!("Splat Encoding: {:?}", encoding);
            }

            let comment = serde_json::to_string_pretty(&description).unwrap();
            let mut encoder = encoder.with_comment(comment);
            
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
    eprintln!("  [--min-box=<x>,<y>,<z>]                      // Crop input file to minimum bounding coord");
    eprintln!("  [--max-box=<x>,<y>,<z>]                      // Crop input file to maximum bounding coord");
    eprintln!("  [--within-dist=<x>,<y>,<z>,<radius>]         // Crop input file to within radius of a point");
    eprintln!("  [--skip-validate]                            // Skip validation of input file");
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
        if let Some(rest) = arg.strip_prefix("--min-box=") {
            let values = rest.split(",").map(|v| v.parse::<f32>().unwrap()).collect::<Vec<f32>>();
            if values.len() != 3 {
                eprintln!("Invalid --min-box value: {}", rest);
                show_usage_exit();
            }
            options.min_box = Some([values[0], values[1], values[2]]);
            println!("Using --min-box={:?}", options.min_box);
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--max-box=") {
            let values = rest.split(",").map(|v| v.parse::<f32>().unwrap()).collect::<Vec<f32>>();
            if values.len() != 3 {
                eprintln!("Invalid --max-box value: {}", rest);
                show_usage_exit();
            }
            options.max_box = Some([values[0], values[1], values[2]]);
            println!("Using --max-box={:?}", options.max_box);
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--within-dist=") {
            let values = rest.split(",").map(|v| v.parse::<f32>().unwrap()).collect::<Vec<f32>>();
            if values.len() != 4 {
                eprintln!("Invalid --within-dist value: {}", rest);
                show_usage_exit();
            }
            options.within_dist = Some(([values[0], values[1], values[2]], values[3]));
            println!("Using --within-dist={:?}", options.within_dist);
            continue;
        }
        if arg == "--skip-validate" {
            options.skip_validate = true;
            println!("Using --skip-validate: Skip validation of input file");
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
