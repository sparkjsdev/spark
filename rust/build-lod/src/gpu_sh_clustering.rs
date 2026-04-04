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
    pipeline: wgpu::ComputePipeline,
    bind_group: wgpu::BindGroup,
    points_buf: wgpu::Buffer,
    clusters_buf: wgpu::Buffer,
    out_buf: wgpu::Buffer,
    readback_buf: wgpu::Buffer,
    params_buf: wgpu::Buffer,
    num_clusters: usize,
}

impl GpuFindNearestClusters {
    async fn try_new(max_dims: usize, max_clusters: usize, max_splats: usize) -> anyhow::Result<Self> {
        // return Err(anyhow::anyhow!("GPU SH clustering disabled"));

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::default(),
            })
            .await?;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(SHADER)),
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

        let points_bytes = (max_splats * max_dims * std::mem::size_of::<f32>()) as u64;
        let clusters_bytes = (max_clusters * max_dims * std::mem::size_of::<f32>()) as u64;
        let out_bytes = (max_splats * std::mem::size_of::<Out>()) as u64;

        let points_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("points"),
            size: points_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let clusters_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("clusters"),
            size: clusters_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let out_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("out"),
            size: out_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let readback_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: out_bytes,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let params_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("params"),
            contents: bytemuck::bytes_of(&Params::default()),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bind group"),
            layout: &bgl,
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

        println!("GPU SH clustering initialized");

        Ok(Self {
            device,
            queue,
            pipeline,
            bind_group,
            points_buf,
            clusters_buf,
            out_buf,
            readback_buf,
            params_buf,
            num_clusters: 0,
        })
    }
}

impl FindNearestClusters for GpuFindNearestClusters {
    fn create_fnc(max_dims: usize, max_clusters: usize, max_splats: usize) -> anyhow::Result<Self> {
        pollster::block_on(Self::try_new(max_dims, max_clusters, max_splats))
    }

    fn set_clusters(&mut self, dims: usize, clusters: &[f32]) -> anyhow::Result<()> {
        let num_clusters = clusters.len() / dims;
        assert_eq!(num_clusters * dims, clusters.len());
        self.num_clusters = num_clusters;

        self.queue.write_buffer(&self.clusters_buf, 0, bytemuck::cast_slice(clusters));

        Ok(())
    }
    
    fn find_nearest_clusters(&mut self, dims: usize, splats: &[f32]) -> anyhow::Result<Vec<(u32, f32)>> {
        let num_splats = splats.len() / dims;
        assert_eq!(num_splats * dims, splats.len());

        self.queue.write_buffer(&self.points_buf, 0, bytemuck::cast_slice(splats));

        let params = Params {
            num_points: num_splats as u32,
            num_clusters: self.num_clusters as u32,
            dims: dims as u32,
            _pad: 0,
        };
        self.queue.write_buffer(&self.params_buf, 0, bytemuck::bytes_of(&params));

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("encoder") });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            let groups = num_splats.div_ceil(WORKGROUP_SIZE as usize);
            pass.dispatch_workgroups(groups as u32, 1, 1);
        }

        let out_bytes = (num_splats * std::mem::size_of::<Out>()) as u64;
        encoder.copy_buffer_to_buffer(&self.out_buf, 0, &self.readback_buf, 0, out_bytes);
        self.queue.submit(Some(encoder.finish()));

        let (tx, rx) = std::sync::mpsc::channel();
        let slice = self.readback_buf.slice(0..out_bytes);
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
        self.readback_buf.unmap();

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

const SHADER: &str = r#"
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

@group(0) @binding(0) var<storage, read> points: array<f32>;
@group(0) @binding(1) var<storage, read> clusters: array<f32>;
@group(0) @binding(2) var<storage, read_write> out_buf: array<Out>;
@group(0) @binding(3) var<uniform> params: Params;

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
            p[d] = points[point_base + d];
        }
    }

    var best_index: u32 = 0u;
    var best_dist2: f32 = 3.402823e38;

    let num_tiles = (params.num_clusters + TILE_CLUSTERS - 1u) / TILE_CLUSTERS;

    for (var tile: u32 = 0u; tile < num_tiles; tile = tile + 1u) {
        let base = tile * TILE_CLUSTERS;
        let cluster_idx = base + lane;

        if (cluster_idx < params.num_clusters) {
            let cluster_base = cluster_idx * params.dims;
            for (var d: u32 = 0u; d < params.dims; d = d + 1u) {
                cluster_tile[lane * MAX_DIMS + d] = clusters[cluster_base + d];
            }
        }
        workgroupBarrier();

        if (point_active) {
            let tile_count = min(TILE_CLUSTERS, params.num_clusters - base);
            for (var j: u32 = 0u; j < tile_count; j = j + 1u) {
                var dist2: f32 = 0.0;
                for (var d: u32 = 0u; d < params.dims; d = d + 1u) {
                    let t = p[d] - cluster_tile[j * MAX_DIMS + d];
                    dist2 = dist2 + t * t;
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
