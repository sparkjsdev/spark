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
    let SortBuffers {
        readback,
        ordering,
        buckets,
    } = buffers;
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
            active_splats, buckets[0]
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
    pub scratch: Vec<u64>, // (key, index)
    pub buckets: Vec<u32>, // 2 * 65536
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
        if self.buckets.len() < RADIX_BASE * 2 {
            self.buckets.resize(RADIX_BASE * 2, 0);
        }
    }
}

#[inline(always)]
unsafe fn prefix_sum_exclusive(buckets: &mut [u32]) -> u32 {
    let mut sum = 0u32;
    for b in buckets.iter_mut() {
        let tmp = *b;
        *b = sum;
        sum = sum.wrapping_add(tmp);
    }
    sum
}

pub fn sort32_internal(
    buffers: &mut Sort32Buffers,
    max_splats: usize,
    num_splats: usize,
) -> Result<u32, String> {
    buffers.ensure_size(max_splats);

    let Sort32Buffers {
        readback,
        ordering,
        scratch,
        buckets,
    } = buffers;
    let keys = &readback[..num_splats];

    // Split buckets
    let (b0, b1) = buckets.split_at_mut(RADIX_BASE);

    b0.fill(0);
    b1.fill(0);

    // pass 1: Histogram (branchless)
    let mut chunks = keys.chunks_exact(8);

    for chunk in chunks.by_ref() {
        macro_rules! tick {
            ($k:expr) => {{
                let valid = ($k < DEPTH_INFINITY_F32) as u32;
                let inv = !$k;

                let r0 = inv & RADIX_MASK;
                let r1 = inv >> RADIX_BITS;

                b0[r0 as usize] += valid;
                b1[r1 as usize] += valid;
            }};
        }

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
        let valid = (k < DEPTH_INFINITY_F32) as u32;
        let inv = !k;
        b0[(inv & RADIX_MASK) as usize] += valid;
        b1[(inv >> RADIX_BITS) as usize] += valid;
    }

    // exclusive prefix‑sum → starting offsets
    let active = unsafe { prefix_sum_exclusive(b0) } as usize;
    unsafe {
        prefix_sum_exclusive(b1);
    }

    // pass 1: scatter into scratch 
    let mut chunks = keys.chunks_exact(8);
    let mut i = 0;

    for chunk in chunks.by_ref() {
        macro_rules! place {
            ($k:expr, $idx:expr) => {{
                let valid = ($k < DEPTH_INFINITY_F32) as u32;
                let inv = !$k;

                let r0 = (inv & RADIX_MASK) as usize;
                let pos = b0[r0] as usize;

                // Always write (branchless), but only advance if valid
                scratch[pos] = ((inv as u64) << 32) | ($idx as u64);
                b0[r0] += valid;
            }};
        }

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
        let valid = (k < DEPTH_INFINITY_F32) as u32;
        let inv = !k;

        let r0 = (inv & RADIX_MASK) as usize;
        let pos = b0[r0] as usize;

        scratch[pos] = ((inv as u64) << 32) | (i as u64);
        b0[r0] += valid;

        i += 1;
    }

    // pass 2: scatter into final ordering
    let mut chunks = scratch[..active].chunks_exact(8);

    for chunk in chunks.by_ref() {
        macro_rules! place2 {
            ($kv:expr) => {{
                let r1 = (($kv >> 48) & RADIX_MASK as u64) as usize;
                let pos = b1[r1] as usize;

                ordering[pos] = $kv as u32;
                b1[r1] += 1;
            }};
        }

        place2!(chunk[0]);
        place2!(chunk[1]);
        place2!(chunk[2]);
        place2!(chunk[3]);
        place2!(chunk[4]);
        place2!(chunk[5]);
        place2!(chunk[6]);
        place2!(chunk[7]);
    }

    for &kv in chunks.remainder() {
        let r1 = ((kv >> 48) & RADIX_MASK as u64) as usize;
        let pos = b1[r1] as usize;

        ordering[pos] = kv as u32;
        b1[r1] += 1;
    }

    // sanity‑check: last bucket should have consumed all entries
    if b1[RADIX_BASE - 1] != active as u32 {
        return Err(format!(
            "Expected {} active splats but got {}",
            active, b1[RADIX_BASE - 1]
        ));
    }

    Ok(active as u32)
}
