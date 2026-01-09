use ahash::AHashMap;
use glam::I64Vec3;
use smallvec::{smallvec, SmallVec};

use crate::{ordering, tsplat::{Tsplat, TsplatArray}};

const CHUNK_SIZE: usize = 65536;
// const CHUNK_LEVELS: i16 = 2;

pub fn compute_lod_tree<SA: TsplatArray>(splats: &mut SA, lod_base: f32, merge_filter: bool, logger: impl Fn(&str)) {
    logger(&format!("tiny_lod::compute_lod_tree: splats.len={}, lod_base={}, merge_filter={}", splats.len(), lod_base, merge_filter));

    splats.retain(|splat| {
        (splat.opacity() > 0.0) && (splat.max_scale() > 0.0)
    });
    logger(&format!("Removed empty splats, splats.len={}", splats.len()));

    if splats.len() == 0 {
        return;
    }

    // for i in 0..9 {
    //     logger(&format!("splats[{}].opacity: {}, .scales: {:?}, .feature_size: {}", i, splats.splats[i].opacity(), splats.splats[i].scales(), splats.splats[i].feature_size()));
    // }
    splats.sort_by(|splat| splat.feature_size());
    // for i in 0..9 {
    //     let splat = splats.get(i);
    //     logger(&format!("after sort splats[{}].opacity: {}, .scales: {:?}, .feature_size: {}", i, splat.opacity(), splat.scales(), splat.feature_size()));
    // }
    // for i in splats.len()-5..splats.len() {
    //     let splat = splats.get(i);
    //     logger(&format!("after sort splats[{}].opacity: {}, .scales: {:?}, .feature_size: {}", i, splat.opacity(), splat.scales(), splat.feature_size()));
    // }

    splats.prepare_extra();

    let level_min = splats.get(0).feature_size().log(lod_base).ceil() as i16;
    logger(&format!("level_min: {}, feature_size[0]: {}", level_min, splats.get(0).feature_size()));
    let mut level = level_min;
    let initial_splats = splats.len();
    let mut frontier = 0;
    let mut active: Vec<(usize, [u64; 3])> = Vec::new();
    let mut levels_output: Vec<_> = Vec::new();
    let mut make_root = false;

    let mut child_counts: AHashMap<usize, usize> = AHashMap::new();

    loop {
        let step = lod_base.powf(level as f32);

        while frontier < initial_splats {
            if splats.get(frontier).feature_size() > step {
                break;
            }
            active.push((frontier, [0, 0, 0]));
            frontier += 1;
        }
        logger(&format!("Level: {}, step: {}, frontier: {} / {}", level, step, frontier, initial_splats));

        for (index, morton3) in active.iter_mut() {
            let grid = splats.get(*index).grid(step);
            *morton3 = ordering::morton_coord64_to_index(grid.to_array().map(|x| x as u64));
        }
        active.sort_unstable_by_key(|&(_, coord)| coord);
        logger(&format!("Sorted active: {}", active.len()));

        // let mut min_max_size = [f32::INFINITY, -f32::INFINITY];
        // for &index in &active {
        //     let size = splats.get(index).feature_size();
        //     min_max_size[0] = min_max_size[0].min(size);
        //     min_max_size[1] = min_max_size[1].max(size);
        // }
        // logger(&format!("min_max_size: {:?}", min_max_size));

        let mut start = 0;
        let mut next_active = Vec::new();
        let mut output = Vec::new();
        let mut merged_count = 0;
        let mut cell_count = 0;
        let mut grid_min_max = [I64Vec3::splat(i64::MAX), I64Vec3::splat(i64::MIN)];

        while start < active.len() {
            let grid = splats.get(active[start].0).grid(step);
            grid_min_max = [grid_min_max[0].min(grid), grid_min_max[1].max(grid)];

            let mut end = start + 1;
            while end < active.len() {
                if !make_root && splats.get(active[end].0).grid(step) != grid {
                    break;
                }
                end += 1;
            }

            cell_count += 1;
            let count = end - start;
            *child_counts.entry(count).or_default() += 1;

            if count > 1 {
                let merge_step = if merge_filter { step } else { 0.0 };
                let indices: SmallVec<[usize; 4]> = (start..end).map(|i| active[i].0).collect();
                let merged = splats.new_merged(&indices, merge_step);
                next_active.push(merged);
                output.push((merged, indices));
                merged_count += 1;
            } else {
                next_active.push(active[start].0);
            }

            start = end;
        }

        logger(&format!("Merged: {} / {}", merged_count, cell_count));
        let mut child_counts = child_counts.drain().collect::<Vec<_>>();
        child_counts.sort_unstable_by_key(|(len, _)| *len);
        // logger(&format!("Child counts: {:?}", child_counts));

        levels_output.push(output);
        active.clear();
        active.extend(next_active.into_iter().map(|index| (index, [0, 0, 0])));
        level += 1;

        if frontier < initial_splats {
            // Still have more splats to process
            continue;
        }

        if cell_count == 1 {
            break;
        }

        let grid_range = (grid_min_max[1] - grid_min_max[0]).max_element();
        if grid_range <= 1 {
            logger(&format!("Grid range is 1, making root"));
            make_root = true;
        }
    }

    assert_eq!(active.len(), 1);
    let root_index = active[0].0;
    levels_output.push(vec![(usize::MAX, smallvec![root_index])]);

    logger(&format!("Root index: {}", root_index));
    logger(&format!("Root: {:?}", splats.get(root_index)));

    let mut indices = Vec::new();

    let mut remap_children = |indices: &mut Vec<usize>, parent: usize, children: &[usize]| {
        if parent != usize::MAX {
            let remapped_children: Vec<_> = (indices.len()..(indices.len() + children.len())).collect();
            splats.set_children(parent, &remapped_children);
        }
        for &child in children.iter() {
            indices.push(child);
        }
    };

    while let Some(level) = levels_output.pop() {
        let level_children: usize = level.iter().map(|(_p, c)| c.len()).sum();
        if indices.len() + level_children > CHUNK_SIZE {
            levels_output.push(level);
            break;
        }

        for (parent, children) in level {
            remap_children(&mut indices, parent, &children);
        }
    }

    while let Some(level) = levels_output.pop() {
        for (parent, children) in level {
            remap_children(&mut indices, parent, &children);
        }
    }

    splats.permute(&indices);

    for i in 0..splats.len() {
        let splat = splats.get_mut(i);
        if splat.opacity() > 1.0 {
            let d = splat.lod_opacity();
            // // Map 1..5 LOD-encoded opacity to 1..2 opacity
            splat.set_opacity((0.25 * (d - 1.0) + 1.0).clamp(1.0, 2.0));
        }
    }

    // let mut indices = Vec::new();
    // let mut frontier: VecDeque<(u32, SmallVec<[u32; 8]>)> = VecDeque::from([(u32::MAX, smallvec![root_index])]);

    // while !frontier.is_empty() {
    //     logger(&format!("Chunking from level={}, # frontier={}", level, frontier.len()));
    //     let mut remaining = VecDeque::new();
    //     std::mem::swap(&mut frontier, &mut remaining);

    //     while let Some((orig_parent, children)) = remaining.pop_front() {
    //         if orig_parent != u32::MAX {
    //             splats.children[orig_parent as usize] = (indices.len()..(indices.len() + children.len())).collect();
    //         }

    //         for &node in children.iter() {
    //             let node_children: SmallVec<[u32; 8]> = splats.children[node as usize].drain(..).collect();
    //             if !node_children.is_empty() {
    //                 // if node_children[0] >= splats.extras.len() {
    //                 //     println!("indices.len(): {}", indices.len());
    //                 //     println!("splats.extras.len(): {}", splats.extras.len());
    //                 //     println!("Child index out of bounds: node={}, children={:?}", node, node_children);
    //                 // }
    //                 // let child_level = splats.extras[node_children[0]].level;
    //                 let child_level = node_children.iter().map(|&c| splats.extras[c].level).max().unwrap();
    //                 if child_level <= (level - CHUNK_LEVELS) {
    //                     // Defer to future chunk
    //                     frontier.push_back((node, node_children));
    //                 } else {
    //                     // Depth-first traversal within chunk
    //                     remaining.push_front((node, node_children));
    //                 }
    //             }
    //             indices.push(node);
    //         }
    //     }

    //     level -= CHUNK_LEVELS;
    // }
    // logger(&format!("# chunks={}", indices.len() / 65536));

    // logger(&format!("Orig root: {:?}", splats.splats[root_index]));
    // logger(&format!("indices.len(): {}", indices.len()));
    // splats.permute(&indices);

    // for splat in splats.splats.iter_mut() {
    //     if splat.opacity() > 1.0 {
    //         let d = splat.lod_opacity();
    //         // // Map 1..5 LOD-encoded opacity to 1..2 opacity
    //         splat.set_opacity((0.25 * (d - 1.0) + 1.0).clamp(1.0, 2.0));
    //     }
    // }

    // logger(&format!("New root: {:?}", splats.splats[0]));
}
