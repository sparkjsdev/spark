const DEPTH_INFINITY_F16: u32 = 0x7c00;
const DEPTH_SIZE_F16: usize = DEPTH_INFINITY_F16 as usize + 1;

#[derive(Default)]
pub struct SortBuffers {
    pub readback: Vec<u16>,
    pub ordering: Vec<u32>,
    pub buckets: Vec<u32>,
}

impl SortBuffers {
    pub fn ensure_size(&mut self, max_splats: usize) {
        if self.readback.len() < max_splats {
            self.readback.resize(max_splats, 0);
        }
        if self.ordering.len() < max_splats {
            self.ordering.resize(max_splats, 0);
        }
        if self.buckets.len() < DEPTH_SIZE_F16 {
            self.buckets.resize(DEPTH_SIZE_F16, 0);
        }
    }
}

pub fn sort_internal(buffers: &mut SortBuffers, num_splats: usize) -> Result<u32, String> {
    let SortBuffers { readback, ordering, buckets } = buffers;
    let readback = &readback[..num_splats];

    // Set the bucket counts to zero
    buckets.clear();
    buckets.resize(DEPTH_SIZE_F16, 0);

    // Count the number of splats in each bucket
    for &metric in readback.iter() {
        if (metric as u32) < DEPTH_INFINITY_F16 {
            buckets[metric as usize] += 1;
        }
    }

    // Compute bucket starting offset
    let mut active_splats = 0;
    for count in buckets.iter_mut().rev().skip(1) {
        let new_total = active_splats + *count;
        *count = active_splats;
        active_splats = new_total;
    }

    // Write out splat indices at the right location using bucket offsets
    for (index, &metric) in readback.iter().enumerate() {
        if (metric as u32) < DEPTH_INFINITY_F16 {
            ordering[buckets[metric as usize] as usize] = index as u32;
            buckets[metric as usize] += 1;
        }
    }

    // Sanity check
    if buckets[0] != active_splats {
        return Err(format!(
            "Expected {} active splats but got {}",
            active_splats,
            buckets[0]
        ));
    }
    Ok(active_splats)
}

const DEPTH_INFINITY_F32: u32 = 0x7f800000;
const RADIX_BASE: usize    = 1 << 16; // 65536

#[derive(Default)]
pub struct Sort32Buffers {
    /// raw f32 bit‑patterns (one per splat)
    pub readback: Vec<u32>,
    /// output indices
    pub ordering: Vec<u32>,
    /// bucket counts / offsets (length == RADIX_BASE)
    pub buckets16lo: Vec<u32>,
    /// bucket counts / offsets (length == RADIX_BASE)
    pub buckets16hi: Vec<u32>,
    /// scratch space for indices
    pub scratch: Vec<u32>,
}

impl Sort32Buffers {
    /// ensure all internal buffers are large enough for up to `max_splats`
    pub fn ensure_size(&mut self, max_splats: usize) {
        if self.readback.len() < max_splats {
            self.readback.resize(max_splats, 0);
        }
        if self.ordering.len() < max_splats {
            self.ordering.resize(max_splats, 0);
        }
        if self.scratch.len() < max_splats {
            self.scratch.resize(max_splats, 0);
        }
        if self.buckets16lo.len() < RADIX_BASE {
            self.buckets16lo.resize(RADIX_BASE, 0);
        }
        if self.buckets16hi.len() < RADIX_BASE {
            self.buckets16hi.resize(RADIX_BASE, 0);
        }
    }
}

/// Two‑pass radix sort (base 2¹⁶) of 32‑bit float bit‑patterns,
/// descending order (largest keys first). Mirrors the JS `sort32Splats`.
pub fn sort32_internal(
    buffers: &mut Sort32Buffers,
    max_splats: usize,
    num_splats: usize,
) -> Result<u32, String> {
    // make sure our buffers can hold `max_splats`
    buffers.ensure_size(max_splats);

    let Sort32Buffers { readback, ordering, buckets16lo, buckets16hi, scratch } = buffers;
    let keys = &readback[..num_splats];

    // tally low and high buckets
    buckets16lo.fill(0);
    buckets16hi.fill(0);
    for &key in keys.iter() {
        if key < DEPTH_INFINITY_F32 {
            let inv = !key;
            buckets16lo[(inv & 0xFFFF) as usize] += 1;
            buckets16hi[(inv >> 16) as usize] += 1;
        }
    }

    // ——— Pass #1: bucket by inv(low 16 bits) ———
    // exclusive prefix‑sum → starting offsets
    let mut total: u32 = 0;
    for slot in buckets16lo.iter_mut() {
        let cnt = *slot;
        *slot = total;
        total = total.wrapping_add(cnt);
    }
    let active_splats = total;

    // scatter into scratch by low bits of inv
    for (i, &key) in keys.iter().enumerate() {
        if key < DEPTH_INFINITY_F32 {
            let inv = !key;
            let lo = (inv & 0xFFFF) as usize;
            scratch[buckets16lo[lo] as usize] = i as u32;
            buckets16lo[lo] += 1;
        }
    }

    // ——— Pass #2: bucket by inv(high 16 bits) ———
    // exclusive prefix‑sum again
    let mut sum: u32 = 0;
    for slot in buckets16hi.iter_mut() {
        let cnt = *slot;
        *slot = sum;
        sum = sum.wrapping_add(cnt);
    }
    // scatter into final ordering by high bits of inv
    for &idx in scratch.iter().take(active_splats as usize) {
        let key = keys[idx as usize];
        let inv = !key;
        let hi = (inv >> 16) as usize;
        ordering[buckets16hi[hi] as usize] = idx;
        buckets16hi[hi] += 1;
    }

    // sanity‑check: last bucket should have consumed all entries
    if buckets16hi[RADIX_BASE - 1] != active_splats {
        return Err(format!(
            "Expected {} active splats but got {}",
            active_splats,
            buckets16hi[RADIX_BASE - 1]
        ));
    }

    Ok(active_splats)
}