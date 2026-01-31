use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};

use spark_lib::decoder::SplatEncoding;
use spark_lib::rad;
use spark_lib::rad::RadEncoder;
use spark_lib::{
    decoder::{ChunkReceiver, MultiDecoder},
    gsplat::GsplatArray,
    csplat::CsplatArray,
    tsplat::{Tsplat, TsplatArray},
    // quick_lod,
    tiny_lod,
    bhatt_lod,
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


fn _write_collider_glb(vertices: Vec<[f32; 3]>, indices: Vec<[u32; 3]>, output_prefix: &str) {
    let min_vertices = vertices.iter().fold([f32::MAX, f32::MAX, f32::MAX], |acc, vertex| {
        [acc[0].min(vertex[0]), acc[1].min(vertex[1]), acc[2].min(vertex[2])]
    });
    let max_vertices = vertices.iter().fold([f32::MIN, f32::MIN, f32::MIN], |acc, vertex| {
        [acc[0].max(vertex[0]), acc[1].max(vertex[1]), acc[2].max(vertex[2])]
    });
    let num_vertices = vertices.len();
    let num_indices = indices.len() * 3;

    let mut buffer = Vec::new();

    let vertices_offset = buffer.len();
    for vertex in vertices {
        for coord in vertex {
            buffer.extend_from_slice(&coord.to_le_bytes());
        }
    }
    let vertices_length = buffer.len() - vertices_offset;

    let indices_offset = buffer.len();
    for index in indices {
        for i in index {
            buffer.extend_from_slice(&i.to_le_bytes());
        }
    }
    let indices_length = buffer.len() - indices_offset;

    assert!(buffer.len() % 4 == 0);

    println!("vo={}, vl={}, io={}, il={}", vertices_offset, vertices_length, indices_offset, indices_length);

    let gltf = serde_json::json!({
        "asset": { "version": "2.0" },
        "buffers": [
            { "byteLength": buffer.len() },
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": vertices_offset,
                "byteLength": vertices_length,
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteOffset": indices_offset,
                "byteLength": indices_length,
                "target": 34963,
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,
                "count": num_vertices,
                "type": "VEC3",
                "min": [min_vertices[0], min_vertices[1], min_vertices[2]],
                "max": [max_vertices[0], max_vertices[1], max_vertices[2]],
            },
            {
                "bufferView": 1,
                "byteOffset": 0,
                "componentType": 5125,
                "count": num_indices,
                "type": "SCALAR",
            },
        ],
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": { "POSITION": 0 },
                        "indices": 1,
                        "mode": 4,
                    },
                ],
            },
        ],
        "nodes": [
            { "mesh": 0 },
        ],
        "scenes": [
            { "nodes": [0] },
        ],
        "scene": 0,
    });
    let gltf = serde_json::to_string_pretty(&gltf).unwrap();

    let mut gltf_bytes = gltf.as_bytes().to_vec();
    let padding = 4 - (gltf_bytes.len() % 4);
    for _ in 0..padding {
        gltf_bytes.push(b' ');
    }

    let filename = format!("{}.glb", output_prefix);
    let mut file = BufWriter::new(File::create(&filename).unwrap());

    let glb_prefix = b"glTF";
    let glb_version = 2u32;
    let glb_length = (12 + 8 + buffer.len() + 8 + gltf_bytes.len()) as u32;
    file.write_all(&glb_prefix.as_slice()).unwrap();
    file.write_all(&glb_version.to_le_bytes()).unwrap();
    file.write_all(&glb_length.to_le_bytes()).unwrap();

    file.write_all(&(gltf_bytes.len() as u32).to_le_bytes()).unwrap();
    file.write_all(&b"JSON".to_vec()).unwrap();
    file.write_all(&gltf_bytes).unwrap();

    file.write_all(&(buffer.len() as u32).to_le_bytes()).unwrap();
    file.write_all(&b"BIN\0".to_vec()).unwrap();
    file.write_all(&buffer).unwrap();

    file.flush().unwrap();
    println!("Wrote {} ({} MB)", filename, glb_length / 1048576);
}

fn process_file(filename: String, max_sh: Option<usize>, chunked: bool, merge_filter: bool, unlod: bool, within_dist: Option<f32>) {
    let splats = GsplatArray::new();
    // let encoding = SplatEncoding {
    //     sh1_min: -2.0,
    //     sh1_max: 2.0,
    //     sh2_min: -2.0,
    //     sh2_max: 2.0,
    //     sh3_min: -2.0,
    //     sh3_max: 2.0,
    //     ..Default::default()
    // };
    // let splats = CsplatArray::new_encoding(Some(encoding));
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

    println!("Read: num_splats: {} with sh_degree: {}", splats.len(), splats.max_sh_degree);

    if let Some(max_sh) = max_sh {
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
    //         for c in splats.get_sh2(i) {
    //             sh2 = [sh2[0].min(c), sh2[1].max(c)];
    //         }
    //         for c in splats.get_sh3(i) {
    //             sh3 = [sh3[0].min(c), sh3[1].max(c)];
    //         }
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
    //     let mut sh2_buckets = Vec::new();
    //     sh2_buckets.resize(((sh2[1] - sh2[0]) / 0.1).round() as usize, 0);
    //     let mut sh3_buckets = Vec::new();
    //     sh3_buckets.resize(((sh3[1] - sh3[0]) / 0.1).round() as usize, 0);

    //     for i in 0..splats.len() {
    //         for c in splats.get(i).rgb().to_array() {
    //             let bucket = (((c - rgb[0]) / 0.1).floor() as usize).min(rgb_buckets.len() - 1);
    //             rgb_buckets[bucket] += 1;
    //         }
    //         for c in splats.get_sh1(i) {
    //             let bucket = ((c - sh1[0]) / 0.1).floor() as usize;
    //             sh1_buckets[bucket] += 1;
    //         }
    //         for c in splats.get_sh2(i) {
    //             let bucket = ((c - sh2[0]) / 0.1).floor() as usize;
    //             sh2_buckets[bucket] += 1;
    //         }
    //         for c in splats.get_sh3(i) {
    //             let bucket = ((c - sh3[0]) / 0.1).floor() as usize;
    //             sh3_buckets[bucket] += 1;
    //         }
    //     }

    //     println!("rgb_buckets: [{}..{}]", rgb[0], rgb[1]);
    //     for b in 0..rgb_buckets.len() {
    //         println!("{:.1}, {}", rgb[0] + b as f32 * 0.1, rgb_buckets[b]);
    //     }

    //     println!("sh1_buckets: [{}..{}]", sh1[0], sh1[1]);
    //     for b in 0..sh1_buckets.len() {
    //         println!("{:.1}, {}", sh1[0] + b as f32 * 0.1, sh1_buckets[b]);
    //     }
    //     println!("sh2_buckets: [{}..{}]", sh2[0], sh2[1]);
    //     for b in 0..sh2_buckets.len() {
    //         println!("{:.1}, {}", sh2[0] + b as f32 * 0.1, sh2_buckets[b]);
    //     }
    //     println!("sh3_buckets: [{}..{}]", sh3[0], sh3[1]);
    //     for b in 0..sh3_buckets.len() {
    //         println!("{:.1}, {}", sh3[0] + b as f32 * 0.1, sh3_buckets[b]);
    //     }
    // }

    if let Some(within_dist) = within_dist {
        splats.retain(|splat| splat.center().length() <= within_dist);
        print!("After filtering <= {}: num_splats: {}", within_dist, splats.len());
    }

    if unlod {
        println!("Un-LODing {}", filename);
        let orig_splats_len = splats.len();
        // splats.retain_extra(|_, extra| extra.children.is_empty());
        splats.retain_children(|_, children| children.is_empty());
        if orig_splats_len != splats.len() {
            println!("Removed {} splats with children", orig_splats_len - splats.len());
        } else {
            // println!("Skipping {} because it doesn't have children", filename);
            // return;
        }
        splats.clear_children();

        let output_filename = filename.replace("-lod.spz", ".spz");
        let output_filename = output_filename.replace(".ply", ".spz");
        let encoder = SpzEncoder::new(splats);
        let encoder = if let Some(m) = max_sh { encoder.with_max_sh(m) } else { encoder };
        let bytes = encoder.encode().unwrap();

        let mut writer = BufWriter::new(File::create(&output_filename).unwrap());
        writer.write_all(&bytes).unwrap();
        println!("Wrote {} ({} bytes)", output_filename, bytes.len());
        return;
    }

    // quick_lod::compute_lod_tree(&mut splats, 1.5, merge_filter, |s| println!("{}", s));
    // tiny_lod::compute_lod_tree(&mut splats, 1.5, merge_filter, |s| println!("{}", s));
    bhatt_lod::compute_lod_tree(&mut splats, 1.75, |s| println!("{}", s));

    // return;

    // // Replace extension with .rad
    // let mut output_filename = filename.clone();
    // if let Some(dot) = filename.rfind('.') {
    //     output_filename.replace_range(dot.., "-lod.rad");
    // } else {
    //     output_filename.push_str("-lod.rad");
    // }

    // let mut encoder = RadEncoder::new(splats);
    // // let mut encoder = encoder.with_center_encoding(rad::RadCenterEncoding::F16);
    // // encoder.sh_encoding = rad::RadShEncoding::F16;
    // // encoder.rgb_encoding = rad::RadRgbEncoding::F16;
    // // let mut encoder = encoder.with_encoding(SplatEncoding {
    // //     rgb_min: -0.1,
    // //     rgb_max: 1.1,
    // //     sh1_min: -1.1,
    // //     sh1_max: 1.1,
    // //     sh2_min: -1.2,
    // //     sh2_max: 1.2,
    // //     sh3_min: -1.3,
    // //     sh3_max: 1.3,
    // //     ..Default::default()
    // // });
    // let mut writer = BufWriter::new(File::create(&output_filename).unwrap());
    // encoder.encode(&mut writer).unwrap();
    // println!("Wrote {}", output_filename);
    // return;

    // Replace extension with -lod.spz
    let mut output_prefix = filename.clone();
    if let Some(dot) = filename.rfind('.') {
        output_prefix.replace_range(dot.., "-lod");
    } else {
        output_prefix.push_str("-lod");
    }

    if !chunked {
        let encoder = SpzEncoder::new(splats);
        let bytes = encoder.encode().unwrap();

        let output_filename = format!("{}.spz", output_prefix);
        let mut writer = BufWriter::new(File::create(&output_filename).unwrap());
        writer.write_all(&bytes).unwrap();
        println!("Wrote {} ({} bytes)", output_filename, bytes.len());
        return;
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
        let bytes = encoder.encode().unwrap();

        let output_filename = format!("{}-{}.spz", output_prefix, chunk);
        let mut writer = BufWriter::new(File::create(&output_filename).unwrap());
        writer.write_all(&bytes).unwrap();
        println!("Chunk {}: Wrote {} ({} bytes)", chunk, output_filename, bytes.len());
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("Usage: build-lod [--max-sh=<max-sh>] [--chunked] [--merge-filter] [--no-merge-filter] [--unlod] <file.spz|file.ply> [...] ");
        return;
    }

    let mut max_sh_out: Option<usize> = None;
    let mut chunked: bool = false;
    let mut merge_filter: bool = false;
    let mut filenames = Vec::new();
    let mut unlod: bool = false;
    let mut within_dist: Option<f32> = None;

    for arg in args {
        if let Some(rest) = arg.strip_prefix("--max-sh=") {
            match rest.parse::<usize>() {
                Ok(v) => {
                    max_sh_out = Some(v.min(3));
                    println!("Using --max-sh={}", max_sh_out.unwrap());
                }
                Err(_) => { eprintln!("Invalid --max-sh value: {}", rest); }
            }
            continue;
        }
        if arg == "--chunked" {
            chunked = true;
            println!("Using --chunked");
            continue;
        }
        if arg == "--merge-filter" {
            merge_filter = true;
            println!("Using --merge-filter");
            continue;
        }
        if arg == "--no-merge-filter" {
            merge_filter = false;
            println!("Using --no-merge-filter");
            continue;
        }
        if arg == "--unlod" {
            unlod = true;
            println!("Using --unlod");
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--within-dist=") {
            match rest.parse::<f32>() {
                Ok(v) => { within_dist = Some(v); }
                Err(_) => { eprintln!("Invalid --within-dist value: {}", rest); }
            }
            println!("Using --within-dist={}", within_dist.unwrap());
            continue;
        }
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

        process_file(filename, max_sh_out, chunked, merge_filter, unlod, within_dist);
    }
}
