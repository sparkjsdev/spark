use std::borrow::Cow;
 
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use spark_lib::sh_clustering::FindNearestClusters;

const WORKGROUP_SIZE: u32 = 64;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
struct Params {
    num_points: u32,
    num_clusters: u32,
    dims: u32,
    _pad: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug, Default)]
struct Out {
    best_index: u32,
    best_dist2: f32,
}

pub struct GpuFindNearestClusters {
    device: wgpu::Device,
    queue: wgpu::Queue,
    bgl: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
    f16: bool,
    buffers: Option<GpuFindNearestBuffers>,
}

pub struct GpuFindNearestBuffers {
    bind_group: wgpu::BindGroup,
    points_buf: wgpu::Buffer,
    clusters_buf: wgpu::Buffer,
    out_buf: wgpu::Buffer,
    readback_buf: wgpu::Buffer,
    params_buf: wgpu::Buffer,
    num_clusters: usize,
}

impl GpuFindNearestClusters {
    pub fn new_with_f16(f16: Option<bool>) -> anyhow::Result<Self> {
        pollster::block_on(Self::async_new_with_f16(f16))
    }

    async fn async_new_with_f16(f16: Option<bool>) -> anyhow::Result<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await?;

        let f16 = match f16 {
            Some(true) => true,
            Some(false) => false,
            None => adapter.features().contains(wgpu::Features::SHADER_F16),
        };

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("device"),
                required_features: if f16 {
                    wgpu::Features::SHADER_F16
                } else {
                    wgpu::Features::empty()
                },
                required_limits: wgpu::Limits::default(),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::default(),
            })
            .await?;
    
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Owned(create_shader(f16))),
        });

        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bgl"),
            entries: &[
                storage_layout(0, true),  // points
                storage_layout(1, true),  // clusters
                storage_layout(2, false), // out
                uniform_layout(3),        // params
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pipeline layout"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        println!("GPU SH clustering using {}", if f16 { "f16" } else { "f32" });

        Ok(Self {
            device,
            queue,
            bgl,
            pipeline,
            f16,
            buffers: None,
        })
    }

    async fn async_try_init(&mut self, max_dims: usize, max_clusters: usize, max_splats: usize) -> anyhow::Result<()> {
        let float_size = if self.f16 { std::mem::size_of::<half::f16>() } else { std::mem::size_of::<f32>() };
        let points_bytes = (max_splats * max_dims * float_size) as u64;
        let clusters_bytes = (max_clusters * max_dims * float_size) as u64;
        let out_bytes = (max_splats * std::mem::size_of::<Out>()) as u64;

        let points_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("points"),
            size: points_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let clusters_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("clusters"),
            size: clusters_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let out_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("out"),
            size: out_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let readback_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: out_bytes,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let params_buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("params"),
            contents: bytemuck::bytes_of(&Params::default()),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bind group"),
            layout: &self.bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: points_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: clusters_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: out_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: params_buf.as_entire_binding(),
                },
            ],
        });

        self.buffers = Some(GpuFindNearestBuffers {
            bind_group,
            points_buf,
            clusters_buf,
            out_buf,
            readback_buf,
            params_buf,
            num_clusters: 0,
        });
        println!("GPU SH clustering initialized");

        Ok(())
    }
}

impl FindNearestClusters for GpuFindNearestClusters {
    fn init_fnc(&mut self, max_dims: usize, max_clusters: usize, max_splats: usize) -> anyhow::Result<()> {
        pollster::block_on(self.async_try_init(max_dims, max_clusters, max_splats))?;
        Ok(())
    }

    fn set_clusters(&mut self, dims: usize, clusters: &[f32]) -> anyhow::Result<()> {
        let buffers = self.buffers.as_mut().unwrap();

        let num_clusters = clusters.len() / dims;
        assert_eq!(num_clusters * dims, clusters.len());
        buffers.num_clusters = num_clusters;

        if self.f16 {
            // Round up count to align with nearest 4-byte boundary
            let mut clusters_f16: Vec<u16> = Vec::with_capacity(clusters.len().div_ceil(2) * 2);
            clusters_f16.extend(clusters.iter().copied().map(|x| half::f16::from_f32(x).to_bits()));
            if clusters.len() % 2 != 0 {
                clusters_f16.push(0);
            }
            self.queue.write_buffer(&buffers.clusters_buf, 0, bytemuck::cast_slice(&clusters_f16));
        } else {
            self.queue.write_buffer(&buffers.clusters_buf, 0, bytemuck::cast_slice(clusters));
        }

        Ok(())
    }
    
    fn find_nearest_clusters(&mut self, dims: usize, splats: &[f32]) -> anyhow::Result<Vec<(u32, f32)>> {
        let buffers = self.buffers.as_mut().unwrap();

        let num_splats = splats.len() / dims;
        assert_eq!(num_splats * dims, splats.len());

        if self.f16 {
            // Round up count to align with nearest 4-byte boundary
            let mut splats_f16: Vec<u16> = Vec::with_capacity(splats.len().div_ceil(2) * 2);
            splats_f16.extend(splats.iter().copied().map(|x| half::f16::from_f32(x).to_bits()));
            if splats.len() % 2 != 0 {
                splats_f16.push(0);
            }
            self.queue.write_buffer(&buffers.points_buf, 0, bytemuck::cast_slice(&splats_f16));
        } else {
            self.queue.write_buffer(&buffers.points_buf, 0, bytemuck::cast_slice(splats));
        }

        let params = Params {
            num_points: num_splats as u32,
            num_clusters: buffers.num_clusters as u32,
            dims: dims as u32,
            _pad: 0,
        };
        self.queue.write_buffer(&buffers.params_buf, 0, bytemuck::bytes_of(&params));

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("encoder") });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &buffers.bind_group, &[]);
            let groups = num_splats.div_ceil(WORKGROUP_SIZE as usize);
            pass.dispatch_workgroups(groups as u32, 1, 1);
        }

        let out_bytes = (num_splats * std::mem::size_of::<Out>()) as u64;
        encoder.copy_buffer_to_buffer(&buffers.out_buf, 0, &buffers.readback_buf, 0, out_bytes);
        self.queue.submit(Some(encoder.finish()));

        let (tx, rx) = std::sync::mpsc::channel();
        let slice = buffers.readback_buf.slice(0..out_bytes);
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });

        let _ = self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
        rx.recv().unwrap().unwrap();

        let data = slice.get_mapped_range();
        let data_cast: &[Out] = bytemuck::cast_slice(&data);

        let mut out = Vec::with_capacity(num_splats);
        for i in 0..num_splats {
            out.push((data_cast[i].best_index, data_cast[i].best_dist2));
        }

        drop(data);
        buffers.readback_buf.unmap();

        Ok(out)
    }
}

fn storage_layout(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn uniform_layout(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn create_shader(use_f16: bool) -> String {
    let enable_f16 = if use_f16 { "enable f16;\n" } else { "" };
    let float_type = if use_f16 { "f16" } else { "f32" };

    let structs = r#"
struct Params {
    num_points: u32,
    num_clusters: u32,
    dims: u32,
    _pad: u32,
};

struct Out {
    best_index: u32,
    best_dist2: f32,
};
"#;

    let bindings = format!(r#"
@group(0) @binding(0) var<storage, read> points: array<{float_type}>;
@group(0) @binding(1) var<storage, read> clusters: array<{float_type}>;
@group(0) @binding(2) var<storage, read_write> out_buf: array<Out>;
@group(0) @binding(3) var<uniform> params: Params;
"#);

    let rest = r#"
const MAX_DIMS: u32 = 45u;
const TILE_CLUSTERS: u32 = 64u;

var<workgroup> cluster_tile: array<f32, TILE_CLUSTERS * MAX_DIMS>;

@compute @workgroup_size(64)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
) {
    let point_idx = gid.x;
    let lane = lid.x;
    let point_active = point_idx < params.num_points;

    var p: array<f32, MAX_DIMS>;
    if (point_active) {
        let point_base = point_idx * params.dims;
        for (var d: u32 = 0u; d < params.dims; d = d + 1u) {
            p[d] = f32(points[point_base + d]);
        }
    }

    var best_index: u32 = 0u;
    var best_dist2: f32 = 3.402823e38;

    let num_tiles = (params.num_clusters + TILE_CLUSTERS - 1u) / TILE_CLUSTERS;

    for (var tile: u32 = 0u; tile < num_tiles; tile = tile + 1u) {
        let base = tile * TILE_CLUSTERS;
        let tile_count = min(TILE_CLUSTERS, params.num_clusters - base);
        let tile_offset = base * params.dims;
        let tile_elems = tile_count * params.dims;

        for (var idx: u32 = lane; idx < tile_elems; idx = idx + TILE_CLUSTERS) {
            let cluster_offset = idx / params.dims;
            let d = idx - cluster_offset * params.dims;
            cluster_tile[cluster_offset * MAX_DIMS + d] = f32(clusters[tile_offset + idx]);
        }
        workgroupBarrier();

        if (point_active) {
            for (var j: u32 = 0u; j < tile_count; j = j + 1u) {
                var dist2: f32 = 0.0;
                for (var d: u32 = 0u; d < params.dims; d = d + 1u) {
                    let t = p[d] - cluster_tile[j * MAX_DIMS + d];
                    dist2 = fma(t, t, dist2);
                }
                let k = base + j;
                if (dist2 < best_dist2) {
                    best_dist2 = dist2;
                    best_index = k;
                }
            }
        }
        workgroupBarrier();
    }

    if (point_active) {
        out_buf[point_idx].best_index = best_index;
        out_buf[point_idx].best_dist2 = best_dist2;
    }
}
"#;

    let source = [
        enable_f16,
        structs,
        &bindings,
        rest,
    ].concat();
    // println!("WGSL source:\n{}", source);

    source
}
