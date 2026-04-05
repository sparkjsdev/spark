
use crate::tsplat::{Tsplat, TsplatArray};
use hnsw::{Hnsw, Searcher};
use rand_pcg::Pcg64;
use space::{Metric, Neighbor};

#[derive(Debug, Clone)]
pub struct ShClusters {
    pub num_sh: usize,
    pub num_clusters: usize,
    pub labels: Vec<usize>,
    pub weights: Vec<f32>,
    pub counts: Vec<usize>,
    pub sh1: Vec<[f32; 9]>,
    pub sh2: Vec<[f32; 15]>,
    pub sh3: Vec<[f32; 21]>,
}

const CHUNK_SIZE: usize = 65536;

pub fn compute_sh_clusters<FNC: FindNearestClusters, TA: TsplatArray>(
    splats: &TA,
    num_sh: usize,
    num_clusters: usize,
    num_iterations: usize,
    logger: impl Fn(&str),
) -> anyhow::Result<ShClusters> {
    let num_sh = splats.max_sh_degree().min(num_sh);
    assert!(num_sh >= 1, "num_sh must be at least 1");
    let dims = match num_sh {
        0 => 0,
        1 => 9,
        2 => 24,
        3 => 45,
        _ => unreachable!(),
    };

    let mut fnc = FNC::create_fnc(dims, num_clusters, CHUNK_SIZE)?;

    let mut clusters = Vec::with_capacity(dims * num_clusters);
    let mut next_clusters = vec![0.0; dims * num_clusters];
    let mut cluster_weight = vec![0.0; num_clusters];
    let mut cluster_count = vec![0; num_clusters];
    let mut labels = Vec::with_capacity(splats.len());
    let mut total_weight = 0.0;
    let mut total_distance;

    for c in 0..num_clusters {
        let sample = ((c as f32 / num_clusters as f32) * splats.len() as f32).floor() as usize;
        clusters.extend(splats.get_sh1(sample));
        if num_sh >= 2 {
            clusters.extend(splats.get_sh2(sample));
            if num_sh >= 3 {
                clusters.extend(splats.get_sh3(sample));
            }
        }
    }
    logger(&format!("sh_clustering: seeded {} centroids", num_clusters));

    let mut splats_sh = Vec::with_capacity(dims * CHUNK_SIZE);

    for iteration in 0..=num_iterations {
        let iteration_start_time = std::time::Instant::now();
        let last_iteration = iteration == num_iterations;

        fnc.set_clusters(dims, &clusters)?;
        logger(&format!("sh_clustering: Initialized centroids"));

        cluster_weight.fill(0.0);
        cluster_count.fill(0);
        labels.clear();
        total_weight = 0.0;
        total_distance = 0.0;
        if !last_iteration {
            next_clusters.fill(0.0);
        }

        let mut base = 0;
        while base < splats.len() {
            let count = (splats.len() - base).min(CHUNK_SIZE);

            splats_sh.clear();
            for i in 0..count {
                splats_sh.extend(splats.get_sh1(base + i));
                if num_sh >= 2 {
                    splats_sh.extend(splats.get_sh2(base + i));
                    if num_sh >= 3 {
                        splats_sh.extend(splats.get_sh3(base + i));
                    }
                }
            }

            let nearest = fnc.find_nearest_clusters(dims, &splats_sh)?;
            for (i, (c, distance)) in nearest.into_iter().enumerate() {
                let c = c as usize;
                labels.push(c);

                let splat = splats.get(base + i);
                let weight = splat.opacity() * splat.area();
                // let weight = 1.0;
                total_weight += weight;
                total_distance += weight * distance;
                cluster_weight[c] += weight;
                cluster_count[c] += 1;

                if !last_iteration && weight > 0.0 {
                    let b = i * dims;
                    for d in 0..dims {
                        next_clusters[c * dims + d] += weight * splats_sh[b + d];
                    }
                }
            }

            eprint!(".");
            base += count;
        }
        eprintln!();

        let avg_distance = total_distance / total_weight;
        logger(&format!("sh_clustering: iteration {} avg_distance={:.5}", iteration, avg_distance));

        if last_iteration {
            break;
        }

        for c in 0..num_clusters {
            if cluster_weight[c] > 0.0 {
                let inv_weight = 1.0 / cluster_weight[c];
                for d in 0..dims {
                    next_clusters[c * dims + d] *= inv_weight;
                }
            } else {
                for d in 0..dims {
                    next_clusters[c * dims + d] = clusters[c * dims + d];
                }
            }
        }

        std::mem::swap(&mut clusters, &mut next_clusters);

        let iteration_duration = iteration_start_time.elapsed();
        logger(&format!("sh_clustering: iteration {} duration={:.3}s", iteration, iteration_duration.as_secs_f64()));
    }

    let mut sh1 = Vec::with_capacity(num_clusters);
    let mut sh2 = Vec::with_capacity(if num_sh >= 2 { num_clusters } else { 0 });
    let mut sh3 = Vec::with_capacity(if num_sh >= 3 { num_clusters } else { 0 });

    for c in 0..num_clusters {
        cluster_weight[c] /= total_weight;

        let base = c * dims;
        sh1.push(std::array::from_fn(|i| clusters[base + i]));
        if num_sh >= 2 {
            sh2.push(std::array::from_fn(|i| clusters[base + 9 + i]));
            if num_sh >= 3 {
                sh3.push(std::array::from_fn(|i| clusters[base + 24 + i]));
            }
        }
    }

    Ok(ShClusters {
        num_sh,
        num_clusters,
        labels,
        weights: cluster_weight,
        counts: cluster_count,
        sh1,
        sh2,
        sh3,
    })
}

pub trait FindNearestClusters: Sized {
    fn create_fnc(max_dims: usize, max_clusters: usize, max_splats: usize) -> anyhow::Result<Self>;
    fn set_clusters(&mut self, dims: usize, clusters: &[f32]) -> anyhow::Result<()>;
    fn find_nearest_clusters(&mut self, dims: usize, splats: &[f32]) -> anyhow::Result<Vec<(u32, f32)>>;
}

pub struct CpuFindNearestClusters {
    ann: Hnsw<SquaredEuclidean, Vec<f32>, Pcg64, 12, 24>,    
    ann_searcher: Searcher<u32>,
}

impl FindNearestClusters for CpuFindNearestClusters {
    fn create_fnc(_max_dims: usize, _max_clusters: usize, _max_splats: usize) -> anyhow::Result<Self> {
        println!("CPU SH clustering initialized");
        Ok(Self {
            ann: Hnsw::new(SquaredEuclidean),
            ann_searcher: Searcher::default(),
        })
    }

    fn set_clusters(&mut self, dims: usize, clusters: &[f32]) -> anyhow::Result<()> {
        self.ann = Hnsw::new(SquaredEuclidean);
        self.ann_searcher = Searcher::default();

        let num_clusters = clusters.len() / dims;
        assert_eq!(num_clusters * dims, clusters.len());

        for c in 0..num_clusters {
            let c_index = self.ann.insert(clusters[c * dims..(c + 1) * dims].to_vec(), &mut self.ann_searcher);
            assert_eq!(c_index, c);
        }

        Ok(())
    }

    fn find_nearest_clusters(&mut self, dims: usize, splats: &[f32]) -> anyhow::Result<Vec<(u32, f32)>> {
        let num_splats = splats.len() / dims;
        assert_eq!(num_splats * dims, splats.len());

        let mut splat_sh = Vec::new();
        let mut output = Vec::with_capacity(num_splats);

        for i in 0..num_splats {
            let base = i * dims;
            splat_sh.clear();
            splat_sh.extend(&splats[base..base + dims]);

            let mut closest = [Neighbor {
                index: !0,
                distance: !0,
            }];
            self.ann.nearest(&splat_sh, 64, &mut self.ann_searcher, &mut closest);
            output.push((closest[0].index as u32, f32::from_bits(closest[0].distance)));
        }

        Ok(output)
    }
}

struct SquaredEuclidean;

impl Metric<Vec<f32>> for SquaredEuclidean {
    type Unit = u32;

    fn distance(&self, a: &Vec<f32>, b: &Vec<f32>) -> u32 {
        a.iter()
            .zip(b.iter())
            .map(|(&a, &b)| (a - b).powi(2))
            .sum::<f32>()
            .to_bits()
    }
}
