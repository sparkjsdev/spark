use std::collections::BinaryHeap;

use ahash::AHashMap;
use glam::IVec3;
use ordered_float::OrderedFloat;
use smallvec::{SmallVec, smallvec};

use crate::tsplat::{Tsplat, TsplatArray};

const MERGE_BASE: f32 = 2.0;

pub fn compute_lod_tree<TA: TsplatArray>(splats: &mut TA, lod_base: f32, logger: impl Fn(&str)) {
    let initial_len = splats.len();
    logger(&format!("bhatt_lod::compute_lod_tree: initial_len={}", initial_len));

    if initial_len == 0 {
        return;
    }

    splats.sort_by(|s| s.feature_size());
    splats.prepare_children();
    logger(&format!("Sorted and prepared splats"));

    let mut is_active = Vec::with_capacity(splats.len() * 2 - 1);
    is_active.resize(splats.len(), true);

    // Clamp minimum feature size to 10^-6
    let min_feature_size = splats.get(0).feature_size().max(0.000001);
    let level_min = min_feature_size.log(MERGE_BASE).ceil() as i16;
    logger(&format!("level_min: {}, feature_size[0]: {}", level_min, splats.get(0).feature_size()));

    let mut level = level_min;
    let mut frontier = 0;
    let mut active = BinaryHeap::new();
    let mut cells = AHashMap::<[i32; 3], SmallVec<[usize; 8]>>::new();

    loop {
        let step = MERGE_BASE.powf(level as f32);

        let frontier_start = frontier;
        while frontier < initial_len {
            if splats.get(frontier).feature_size() > step {
                break;
            }
            frontier += 1;
        }

        if frontier > frontier_start {
            let new_splats: Vec<_> = (frontier_start..frontier).map(|i| {
                let splat = splats.get(i);
                (OrderedFloat(-splat.feature_size()), i)
            }).collect();
            active.extend(new_splats);
        }
        logger(&format!("Level: {}, step: {}, frontier: {} / {}, # active: {}, # splats: {}", level, step, frontier, initial_len, active.len(), splats.len()));

        cells.clear();
        let mut grid_min_max = [IVec3::splat(i32::MAX), IVec3::splat(i32::MIN)];

        for &(OrderedFloat(_neg_size), index) in active.iter() {
            let splat = splats.get(index);
            let grid = splat.grid_i32(step);
            cells.entry(grid).or_default().push(index);
        }

        let mut next_active = Vec::new();

        while let Some((OrderedFloat(neg_size), index)) = active.pop() {
            if !is_active[index] {
                continue;
            }

            let grid = splats.get(index).grid_i32(step);
            grid_min_max = [grid_min_max[0].min(IVec3::from_array(grid)), grid_min_max[1].max(IVec3::from_array(grid))];

            let mut best = (usize::MAX, -f32::INFINITY, [i32::MAX, i32::MAX, i32::MAX]);

            for z in (grid[2] - 1)..=(grid[2] + 1) {
                for y in (grid[1] - 1)..=(grid[1] + 1) {
                    for x in (grid[0] - 1)..=(grid[0] + 1) {
                        if let Some(neighbors) = cells.get(&[x, y, z]) {
                            for &neighbor in neighbors.iter() {
                                if is_active[neighbor] && neighbor != index {
                                    let metric = splats.similarity(index, neighbor);
                                    if metric > best.1 {
                                        best = (neighbor, metric, [x, y, z]);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if best.0 != usize::MAX {
                let best_neighbor = best.0;
                let merged = splats.new_merged(&[index, best_neighbor], 0.0);
                // if (merged % 10000) == 0 {
                //     logger(&format!("merged: {}", merged));
                // }

                is_active[index] = false;
                let cell_index = cells.get_mut(&grid).unwrap();
                cell_index.retain(|x| *x != index);

                is_active[best_neighbor] = false;
                let cell_best_neighbor = cells.get_mut(&best.2).unwrap();
                cell_best_neighbor.retain(|x| *x != best_neighbor);

                is_active.push(true);

                let feature_size = splats.get(merged).feature_size();
                if feature_size > step {
                    next_active.push((OrderedFloat(-feature_size), merged));
                } else {
                    let merged_grid = splats.get(merged).grid_i32(step);
                    cells.entry(merged_grid).or_default().push(merged);

                    active.push((OrderedFloat(-feature_size), merged));
                }
            } else {
                // Can't find a neighbor to merge, so kick to next level
                next_active.push((OrderedFloat(neg_size), index));
            }
        }

        level += 1;
        active.extend(next_active);

        if frontier < initial_len {
            // Still have more input splats to process
            continue;
        }

        if active.len() <= 1 {
            break;
        }
    }

    let root_index = splats.len() - 1;
    logger(&format!("Root index: {}", root_index));
    logger(&format!("Root splat: {:?}", splats.get(root_index)));

    let mut to_output = Vec::with_capacity(splats.len() * 2 - 1);
    // to_output.resize(splats.len(), true);
    to_output.resize(initial_len, true);
    to_output.resize(splats.len(), false);
    to_output[root_index] = true;

    fn recurse_to_output<TA: TsplatArray>(
        splats: &mut TA, index: usize, to_output: &mut Vec<bool>, lod_base: f32,
    ) -> (f32, SmallVec<[usize; 8]>) {
        // let feature_size = splats.get(index).feature_size();
        // let feature_size = splats.get(index).area();
        let feature_size = {
            let splat = splats.get(index);
            splat.area() * splat.opacity()
        };

        let children = splats.get_children(index);
        if children.is_empty() {
            (feature_size, smallvec![index])
        } else {
            let mut new_children: SmallVec<[usize; 8]> = SmallVec::new();
            let mut max_child_feature_size = -f32::INFINITY;

            for &child in children.iter() {
                let (child_feature_size, child_children) = recurse_to_output(splats, child, to_output, lod_base);
                max_child_feature_size = max_child_feature_size.max(child_feature_size);
                new_children.extend(child_children);
            }

            if feature_size >= (max_child_feature_size * lod_base) {
                to_output[index] = true;
            }

            if to_output[index] {
                assert!(new_children.len() <= 65535);
                splats.set_children(index, &new_children);
                (feature_size, smallvec![index])
            } else {
                splats.set_children(index, &[]);
                (max_child_feature_size, new_children)
            }
        }
    }

    let (_root_feature_size, _root_children) = recurse_to_output(splats, root_index, &mut to_output, lod_base);

    let output_count = to_output.iter().filter(|&&b| b).count();
    logger(&format!("Output set: {} / {}", output_count, splats.len()));
    logger(&format!("LoD growth factor: {}", output_count as f32 / initial_len as f32));

    let mut indices = Vec::new();

    fn recurse_indices<TA: TsplatArray>(
        splats: &mut TA, index: usize, to_output: &Vec<bool>, indices: &mut Vec<usize>,
        limit_size: f32, frontier: &mut Vec<usize>,
    ) {
        if splats.get(index).feature_size() < limit_size {
            frontier.push(index);
            return;
        }

        let mut children = splats.get_children(index);
        if children.is_empty() {
            return;
        }

        let new_children: SmallVec<[usize; 8]> = (indices.len()..(indices.len() + children.len())).collect();
        splats.set_children(index, &new_children);

        children.sort();
        for &child in children.iter() {
            indices.push(child);
        }

        for child in children {
            recurse_indices(splats, child, to_output, indices, limit_size, frontier);
        }
    }

    indices.push(root_index);
    let mut limit_size = splats.get(root_index).feature_size();
    let mut frontier = vec![root_index];

    loop {
        logger(&format!("Chunking from limit_size={}, # frontier={}", limit_size, frontier.len()));
        let mut next_frontier = Vec::new();
        for index in frontier.drain(..) {
            recurse_indices(splats, index, &to_output, &mut indices, limit_size, &mut next_frontier);
        }

        if next_frontier.is_empty() {
            break;
        }
        limit_size = limit_size / 4.0;
        frontier = next_frontier;
    }

    assert_eq!(indices.len(), output_count);

    for (index, &to_output) in to_output.iter().enumerate() {
        if !to_output {
            indices.push(index);
        }
    }

    splats.permute(&indices);
    splats.truncate(output_count);
    logger(&format!("Truncated to output_count={}", output_count));

    let mut total_children = 0u64;
    let mut num_interior = 0;
    for i in 0..splats.len() {
        let num_children = splats.get_children(i).len();
        if num_children > 0 {
            num_interior += 1;
            total_children += num_children as u64;
        }
    }
    let avg_children = total_children as f64 / num_interior as f64;
    logger(&format!("Average children per interior splat: {}", avg_children));

    logger(&format!("Root #children: {}", splats.get_children(0).len()));
}
