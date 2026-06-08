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
// 16-bit radix (2 passes)
const RADIX_BITS: u32 = 16;
const RADIX_BASE: usize = 1 << RADIX_BITS; // 65536
const RADIX_MASK: u32 = RADIX_BASE as u32 - 1;

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
    /// scratch space for (key, index)
    pub scratch: Vec<u64>,
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

fn prefix_sum_exclusive(buckets: &mut [u32]) -> u32 {
    let mut sum = 0u32;
    for b in buckets.iter_mut() {
        let tmp = *b;
        *b = sum;
        sum = sum.wrapping_add(tmp);
    }
    sum
}

/// Two‑pass radix sort (base 2¹⁶) of 32‑bit float bit‑patterns,
/// descending order (largest keys first).
pub fn sort32_internal(
    buffers: &mut Sort32Buffers,
    max_splats: usize,
    num_splats: usize,
) -> Result<u32, String> {
    // make sure our buffers can hold `max_splats`
    buffers.ensure_size(max_splats);

    let Sort32Buffers { readback, ordering, buckets16lo, buckets16hi, scratch } = buffers;
    let keys = &readback[..num_splats];

    // tally low and high buckets (branchless)
    buckets16lo.fill(0);
    buckets16hi.fill(0);

    macro_rules! tick {
        ($key:expr) => {{
            let valid = ($key < DEPTH_INFINITY_F32) as u32;
            let inv = !$key;
            let lo = inv & RADIX_MASK;
            let hi = inv >> RADIX_BITS;

            // by mask above: lo < 65536 == buckets16lo.len() == RADIX_BASE
            unsafe { *buckets16lo.get_unchecked_mut(lo as usize) += valid; }
            // by shift above: hi < 65536 == buckets16hi.len() == RADIX_BASE
            unsafe { *buckets16hi.get_unchecked_mut(hi as usize) += valid; }
        }};
    }

    let mut chunks = keys.chunks_exact(8);

    for chunk in chunks.by_ref() {
        tick!(chunk[0]);
        tick!(chunk[1]);
        tick!(chunk[2]);
        tick!(chunk[3]);
        tick!(chunk[4]);
        tick!(chunk[5]);
        tick!(chunk[6]);
        tick!(chunk[7]);
    }

    for &k in chunks.remainder() {
        tick!(k);
    }

    // exclusive prefix‑sum → starting offsets
    let active_splats = prefix_sum_exclusive(buckets16lo);
    prefix_sum_exclusive(buckets16hi);

    // ——— Pass #1: bucket by inv(low 16 bits) ———

    // scatter into scratch by low bits of inv
    macro_rules! place {
        ($key:expr, $idx:expr) => {{
            if $key < DEPTH_INFINITY_F32 {
                let inv = !$key;
                let lo = (inv & RADIX_MASK) as usize;
                // by mask above: lo < 65536 == buckets16lo.len() == RADIX_BASE
                let pos = unsafe { *buckets16lo.get_unchecked(lo) } as usize;
                let inv_idx = ((inv as u64) << 32) | ($idx as u64);

                // by design we have pos < active_splats <= max_splats <= scratch.len()
                unsafe { *scratch.get_unchecked_mut(pos) = inv_idx; }
                // by mask above: lo < 65536 == buckets16lo.len() == RADIX_BASE
                unsafe { *buckets16lo.get_unchecked_mut(lo) += 1; }
            }
        }};
    }

    let mut chunks = keys.chunks_exact(8);
    let mut i = 0;

    for chunk in chunks.by_ref() {
        place!(chunk[0], i);
        place!(chunk[1], i + 1);
        place!(chunk[2], i + 2);
        place!(chunk[3], i + 3);
        place!(chunk[4], i + 4);
        place!(chunk[5], i + 5);
        place!(chunk[6], i + 6);
        place!(chunk[7], i + 7);

        i += 8;
    }

    for &k in chunks.remainder() {
        place!(k, i);
        i += 1;
    }

    // ——— Pass #2: bucket by inv(high 16 bits) ———

    // scatter into final ordering by high bits of inv
    macro_rules! place2 {
        ($inv_idx:expr) => {{
            let idx = $inv_idx as u32;
            let hi = (($inv_idx >> 48) & RADIX_MASK as u64) as usize;
            // by mask above: hi < 65536 == buckets16hi.len() == RADIX_BASE
            let pos = unsafe { *buckets16hi.get_unchecked(hi) } as usize;

            // by design we have pos < active_splats <= max_splats <= ordering.len()
            unsafe { *ordering.get_unchecked_mut(pos) = idx; }
            // by mask above: hi < 65536 == buckets16hi.len() == RADIX_BASE
            unsafe { *buckets16hi.get_unchecked_mut(hi) += 1; }
        }};
    }

    let mut chunks = scratch[..active_splats as usize].chunks_exact(8);

    for chunk in chunks.by_ref() {
        place2!(chunk[0]);
        place2!(chunk[1]);
        place2!(chunk[2]);
        place2!(chunk[3]);
        place2!(chunk[4]);
        place2!(chunk[5]);
        place2!(chunk[6]);
        place2!(chunk[7]);
    }

    for &inv_idx in chunks.remainder() {
        place2!(inv_idx);
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
