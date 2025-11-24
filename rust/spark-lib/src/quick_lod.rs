use std::{collections::VecDeque, iter::zip};

use ahash::AHashMap;
use glam::I64Vec3;
use smallvec::{smallvec, SmallVec};

use crate::gsplat::*;

const CHUNK_LEVELS: i16 = 2;

pub fn compute_lod_tree(splats: &mut GsplatArray, lod_base: f32, merge_filter: bool) {
    splats.retain(|splat| {
        (splat.opacity() > 0.0) && (splat.max_scale() > 0.0)
    });

    splats.sort_by(|splat| splat.feature_size());
    splats.compute_extras();

    let mut level_min_max = [i16::MAX, i16::MIN];
    let mut level_counts = AHashMap::<i16, usize>::new();
    for (splat, extra) in zip(&splats.splats, &mut splats.extras) {
        extra.level = splat.feature_size().log(lod_base).ceil() as i16;
        *level_counts.entry(extra.level).or_default() += 1;
        let [min, max] = level_min_max;
        level_min_max = [min.min(extra.level), max.max(extra.level)];
    }
    let [level_min, level_max] = level_min_max;
    println!("level_min: {}, level_max: {}", level_min, level_max);
    println!("level_counts: {:?}", level_counts);

    let mut level = level_min;
    let initial_splats = splats.splats.len();
    let mut frontier = 0;
    let mut previous_level: Option<AHashMap<[i64; 3], SmallVec<[usize; 8]>>> = None;

    loop {
        let step = lod_base.powf(level as f32);
        let mut cells = AHashMap::<[i64; 3], SmallVec<[usize; 8]>>::new();
        // let seeded = ahash::RandomState::with_seeds(1, 2, 3, 4);
        // let mut cells = AHashMap::<[i64; 3], SmallVec<[usize; 8]>>::with_hasher(seeded);
        let mut grid_min_max = [I64Vec3::splat(i64::MAX), I64Vec3::splat(i64::MIN)];

        while frontier < initial_splats {
            if splats.extras[frontier].level > level {
                break;
            }
            let grid = splats.splats[frontier].grid(step);
            grid_min_max = [grid_min_max[0].min(grid), grid_min_max[1].max(grid)];
            cells.entry(grid.to_array()).or_default().push(frontier);
            frontier += 1;
        }
        println!("Level: {}, step: {}, frontier: {} / {}", level, step, frontier, initial_splats);

        // for index in 0..frontier {
        //     let splat = &splats.splats[index];
        //     let grid = splat.grid(step);
        //     grid_min_max = [grid_min_max[0].min(grid), grid_min_max[1].max(grid)];

        //     let indices = cells.entry(grid.to_array()).or_default();
        //     indices.push(index);
        // }

        if let Some(mut previous) = previous_level {
            for indices in previous.values_mut() {
                for &index in indices.iter() {
                    let grid = splats.splats[index].grid(step);
                    grid_min_max = [grid_min_max[0].min(grid), grid_min_max[1].max(grid)];
                    cells.entry(grid.to_array()).or_default().push(index);
                }
            }
        }
        
        let [grid_min, grid_max] = grid_min_max;
        let grid_range = (grid_max - grid_min).max_element();

        let mut merged_count = 0;
        // let mut cell_counts: AHashMap<usize, usize> = AHashMap::new();
        for indices in cells.values_mut() {
            // *cell_counts.entry(indices.len()).or_default() += 1;
            if indices.len() > 1 {
                const DEBUG_INDEX: usize = 4000000000;
                // if splats.len() == DEBUG_INDEX {
                //     println!("Merging {} from {:?}", splats.len(), indices);
                //     let next_step = lod_base.powf(-14.0);
                //     for &index in indices.iter() {
                //         println!("{} | {:?}: {:?}", index, splats.splats[index].grid(next_step), splats.splats[index]);
                //     }
                //     println!("--------------------------------");
                // }
                let merge_step = if merge_filter { step } else { 0.0 };
                let merged = splats.new_merged(indices, merge_step, splats.len() == DEBUG_INDEX);
                splats.extras[merged].level = level + 1;
                // if merged == DEBUG_INDEX {
                //     println!("Merged splat: {:?}", splats.splats[merged]);
                // }
                indices.clear();
                indices.push(merged);
                merged_count += 1;
            }
        }
        println!("Merged: {} / {}", merged_count, cells.len());
        // let mut cell_counts: Vec<_> = cell_counts.into_iter().collect();
        // cell_counts.sort_by_key(|(len, _)| *len);
        // println!("Cell counts: {:?}", cell_counts);

        // if let Some(mut previous) = previous_level {
        //     for prev_indices in previous.values_mut() {
        //         assert_eq!(prev_indices.len(), 1);
        //         let prev_index = prev_indices[0];
        //         let prev_splat = &splats.splats[prev_index];
        //         let new_grid = prev_splat.grid(step);
        //         let mut closest: Option<(f32, [i64; 3])> = None;

        //         for z in new_grid.z-1..=new_grid.z+1 {
        //             for y in new_grid.y-1..=new_grid.y+1 {
        //                 for x in new_grid.x-1..=new_grid.x+1 {
        //                     if let Some(cell) = cells.get(&[x, y, z]) {
        //                         let splat_center = splats.splats[cell[0]].center;
        //                         let dist2 = splat_center.distance_squared(prev_splat.center);
        //                         if let Some((cur_dist2, _cur_closest)) = closest {
        //                             if dist2 < cur_dist2 {
        //                                 closest = Some((dist2, [x, y, z]));
        //                             }
        //                         } else {
        //                             closest = Some((dist2, [x, y, z]));
        //                         }
        //                     }
        //                 }
        //             }
        //         }

        //         if let Some((_dist2, closest)) = closest {
        //             prev_indices.clear();
        //             let new_indices = cells.get_mut(&closest).unwrap();
        //             let new_index = new_indices[0];
        //             let new_extra = &mut splats.extras[new_index];
        //             if !new_extra.children.contains(&prev_index) {
        //                 new_extra.children.push(prev_index);
        //             }
        //         } else {
        //             // println!("prev_index: {}, prev_splat: {:?}", prev_index, prev_splat);
        //             // println!("new_grid: {:?}", new_grid);
        //             assert!(false, "No closest cell found");
        //         }
        //     }
        // }

        previous_level = Some(cells);

        if (frontier == initial_splats) && (grid_range <= 1) {
            break;
        }

        level += 1;
    }

    let root_index = if let Some(previous) = previous_level {
        if previous.len() > 1 {
            level += 1;
            let step = lod_base.powf(level as f32);
            
            let indices: SmallVec<[usize; 8]> = previous.values()
                .flat_map(|i| i.iter().copied())
                .collect();
            let merge_step = if merge_filter { step } else { 0.0 };
            let merged = splats.new_merged(&indices, merge_step, false);
            merged
        } else {
            let only = previous.values().next().unwrap();
            only[0]
        }
    } else {
        unreachable!()
    };
    println!("Root index: {}", root_index);

    let mut indices = Vec::new();
    let mut frontier: VecDeque<(usize, SmallVec<[usize; 8]>)> = VecDeque::from([(usize::MAX, smallvec![root_index])]);

    while !frontier.is_empty() {
        println!("Chunking from level={}, # frontier={}", level, frontier.len());
        let mut remaining = VecDeque::new();
        std::mem::swap(&mut frontier, &mut remaining);

        while let Some((orig_parent, children)) = remaining.pop_front() {
            if orig_parent != usize::MAX {
                // splats.extras[orig_parent].children = smallvec![indices.len(), children.len()];
                splats.extras[orig_parent].children = (indices.len()..(indices.len() + children.len())).collect();
            }

            for &node in children.iter() {
                let node_children: SmallVec<[usize; 8]> = splats.extras[node].children.drain(..).collect();
                if !node_children.is_empty() {
                    // if node_children[0] >= splats.extras.len() {
                    //     println!("indices.len(): {}", indices.len());
                    //     println!("splats.extras.len(): {}", splats.extras.len());
                    //     println!("Child index out of bounds: node={}, children={:?}", node, node_children);
                    // }
                    // let child_level = splats.extras[node_children[0]].level;
                    let child_level = node_children.iter().map(|&c| splats.extras[c].level).max().unwrap();
                    if child_level <= (level - CHUNK_LEVELS) {
                        // Defer to future chunk
                        frontier.push_back((node, node_children));
                    } else {
                        // Depth-first traversal within chunk
                        remaining.push_front((node, node_children));
                    }
                }
                indices.push(node);
            }
        }

        level -= CHUNK_LEVELS;
    }
    println!("# chunks={}", indices.len() / 65536);

    println!("Orig root: {:?}", splats.splats[root_index]);
    println!("indices.len(): {}", indices.len());
    splats.permute(&indices);

    for splat in splats.splats.iter_mut() {
        if splat.opacity() > 1.0 {
            let d = splat.lod_opacity();
            // // Map 1..5 LOD-encoded opacity to 1..2 opacity
            splat.set_opacity((0.25 * (d - 1.0) + 1.0).clamp(1.0, 2.0));
        }
    }

    println!("New root: {:?}", splats.splats[0]);
    
    // fn print_splat_children(splats: &GsplatArray, index: usize, depth: usize) {
    //     if depth > 3 {
    //         return;
    //     }
    //     for _ in 0..depth {
    //         print!("- ");
    //     }
    //     println!("Splat {} children: {:?}", index, splats.extras[index].children);
    //     if splats.extras[index].children.is_empty() {
    //         return;
    //     }
    //     let first = splats.extras[index].children[0];
    //     let count = splats.extras[index].children[1];
    //     for child in first..first+count {
    //         print_splat_children(splats, child, depth + 1);
    //     }
    // }

    // print_splat_children(&splats, 0, 0);
}
