pub fn morton_coord16_to_index([x, y, z]: [u16; 3]) -> u64 {
    fn expand3(x: u16) -> u64 {
        let mut x = x as u64;
        x = (x | x << 32) & 0x1f00000000ffff;
        x = (x | x << 16) & 0x1f0000ff0000ff;
        x = (x | x << 8) & 0x100f00f00f00f00f;
        x = (x | x << 4) & 0x10c30c30c30c30c3;
        x = (x | x << 2) & 0x1249249249249249;
        x
    }

    (expand3(x) << 0) | (expand3(y) << 1) | (expand3(z) << 2)
}

fn expand3_21(x: u32) -> u64 {
    // Expands the low 21 bits of `x` so that bit k becomes bit 3k.
    // (Classic "split by 3" bit-twiddling sequence.)
    let mut x = (x & 0x1f_ffff) as u64;
    x = (x | x << 32) & 0x1f00000000ffff;
    x = (x | x << 16) & 0x1f0000ff0000ff;
    x = (x | x << 8) & 0x100f00f00f00f00f;
    x = (x | x << 4) & 0x10c30c30c30c30c3;
    x = (x | x << 2) & 0x1249249249249249;
    x
}

pub fn morton_coord24_to_index([x, y, z]: [u32; 3]) -> u128 {
    fn expand3_24(x: u32) -> u128 {
        let mut x = x as u128;
        x = (x | x << 64) & 0x3ff0000000000000000ffffffffu128;
        x = (x | x << 32) & 0x3ff00000000ffff00000000ffffu128;
        x = (x | x << 16) & 0x30000ff0000ff0000ff0000ff0000ffu128;
        x = (x | x << 8) & 0x300f00f00f00f00f00f00f00f00f00fu128;
        x = (x | x << 4) & 0x30c30c30c30c30c30c30c30c30c30c3u128;
        x = (x | x << 2) & 0x9249249249249249249249249249249u128;
        x
    }

    (expand3_24(x) << 0) | (expand3_24(y) << 1) | (expand3_24(z) << 2)
}

pub fn morton_coord32_to_index([x, y, z]: [u32; 3]) -> u128 {
    fn expand3_32(x: u32) -> u128 {
        // 32 input bits expand to 96 output bits (fits in u128).
        // We do this as two chunks:
        // - bits 0..20  -> expanded bits 0..62
        // - bits 21..31 -> expanded bits 63..93
        let lo = expand3_21(x & 0x1f_ffff) as u128;
        let hi = expand3_21((x >> 21) & 0x7ff) as u128;
        lo | (hi << 63)
    }

    (expand3_32(x) << 0) | (expand3_32(y) << 1) | (expand3_32(z) << 2)
}

pub fn morton_coord64_to_index([x, y, z]: [u64; 3]) -> [u64; 3] {
    // Output is a 192-bit Morton index stored as little-endian limbs:
    // out[0] holds bits 0..63, out[1] holds bits 64..127, out[2] holds bits 128..191.

    fn or_shift_u64_into_u192_le(out: &mut [u64; 3], v: u64, shift: u32) {
        let limb = (shift / 64) as usize;
        let off = (shift % 64) as u32;

        out[limb] |= v << off;
        if off != 0 && limb + 1 < 3 {
            out[limb + 1] |= v >> (64 - off);
        }
    }

    fn expand3_64_le(x: u64) -> [u64; 3] {
        // Expand as four chunks to keep the code in the same "magic constants" style:
        // - bits 0..20  -> expanded bits   0..62
        // - bits 21..41 -> expanded bits  63..125
        // - bits 42..62 -> expanded bits 126..188
        // - bit 63      -> expanded bit  189
        let mut out = [0u64; 3];

        let c0 = expand3_21((x & 0x1f_ffff) as u32);
        let c1 = expand3_21(((x >> 21) & 0x1f_ffff) as u32);
        let c2 = expand3_21(((x >> 42) & 0x1f_ffff) as u32);
        let c3 = expand3_21(((x >> 63) & 0x1) as u32);

        or_shift_u64_into_u192_le(&mut out, c0, 0);
        or_shift_u64_into_u192_le(&mut out, c1, 63);
        or_shift_u64_into_u192_le(&mut out, c2, 126);
        or_shift_u64_into_u192_le(&mut out, c3, 189);

        out
    }

    fn shl_u192_le(a: [u64; 3], shift: u32) -> [u64; 3] {
        match shift {
            0 => a,
            1 => [a[0] << 1, (a[1] << 1) | (a[0] >> 63), (a[2] << 1) | (a[1] >> 63)],
            2 => [a[0] << 2, (a[1] << 2) | (a[0] >> 62), (a[2] << 2) | (a[1] >> 62)],
            _ => unreachable!("only used for 0..=2 bit shifts"),
        }
    }

    let ex = expand3_64_le(x);
    let ey = expand3_64_le(y);
    let ez = expand3_64_le(z);

    let ex = shl_u192_le(ex, 0);
    let ey = shl_u192_le(ey, 1);
    let ez = shl_u192_le(ez, 2);

    [ex[0] | ey[0] | ez[0], ex[1] | ey[1] | ez[1], ex[2] | ey[2] | ez[2]]
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Alternative (table-based) implementations for side-by-side comparison ---

    const fn make_expand8_by_2() -> [u32; 256] {
        let mut table = [0u32; 256];
        let mut i = 0u32;
        while i < 256 {
            let mut v = 0u32;
            let mut bit = 0u32;
            while bit < 8 {
                let b = (i >> bit) & 1;
                v |= b << (bit * 3);
                bit += 1;
            }
            table[i as usize] = v;
            i += 1;
        }
        table
    }

    /// For a byte `b`, returns a 24-bit value with the bits of `b` expanded so that
    /// each original bit is separated by two zero bits (bit `k` -> bit `3k`).
    const EXPAND8_BY_2: [u32; 256] = make_expand8_by_2();

    fn morton_coord32_to_index_table([x, y, z]: [u32; 3]) -> u128 {
        fn expand3_32_table(x: u32) -> u128 {
            let b0 = EXPAND8_BY_2[(x & 0xff) as usize] as u128;
            let b1 = EXPAND8_BY_2[((x >> 8) & 0xff) as usize] as u128;
            let b2 = EXPAND8_BY_2[((x >> 16) & 0xff) as usize] as u128;
            let b3 = EXPAND8_BY_2[((x >> 24) & 0xff) as usize] as u128;
            b0 | (b1 << 24) | (b2 << 48) | (b3 << 72)
        }

        (expand3_32_table(x) << 0) | (expand3_32_table(y) << 1) | (expand3_32_table(z) << 2)
    }

    fn morton_coord64_to_index_table([x, y, z]: [u64; 3]) -> [u64; 3] {
        fn or_shift_u32_into_u192_le(out: &mut [u64; 3], v: u32, shift: u32) {
            let limb = (shift / 64) as usize;
            let off = (shift % 64) as u32;
            let v = v as u64;

            out[limb] |= v << off;
            if off != 0 && limb + 1 < 3 {
                out[limb + 1] |= v >> (64 - off);
            }
        }

        fn expand3_64_le_table(x: u64) -> [u64; 3] {
            let mut out = [0u64; 3];
            let mut byte = 0u32;
            while byte < 8 {
                let b = ((x >> (byte * 8)) & 0xff) as usize;
                let v = EXPAND8_BY_2[b];
                or_shift_u32_into_u192_le(&mut out, v, byte * 24);
                byte += 1;
            }
            out
        }

        fn shl_u192_le(a: [u64; 3], shift: u32) -> [u64; 3] {
            match shift {
                0 => a,
                1 => [a[0] << 1, (a[1] << 1) | (a[0] >> 63), (a[2] << 1) | (a[1] >> 63)],
                2 => [a[0] << 2, (a[1] << 2) | (a[0] >> 62), (a[2] << 2) | (a[1] >> 62)],
                _ => unreachable!("only used for 0..=2 bit shifts"),
            }
        }

        let ex = shl_u192_le(expand3_64_le_table(x), 0);
        let ey = shl_u192_le(expand3_64_le_table(y), 1);
        let ez = shl_u192_le(expand3_64_le_table(z), 2);

        [ex[0] | ey[0] | ez[0], ex[1] | ey[1] | ez[1], ex[2] | ey[2] | ez[2]]
    }

    // --- Hard-coded test vectors (manual expectations) ---

    #[test]
    fn morton_coord16_hardcoded_vectors() {
        assert_eq!(morton_coord16_to_index([0, 0, 0]), 0);
        assert_eq!(morton_coord16_to_index([1, 0, 0]), 1);
        assert_eq!(morton_coord16_to_index([0, 1, 0]), 2);
        assert_eq!(morton_coord16_to_index([0, 0, 1]), 4);
        assert_eq!(morton_coord16_to_index([1, 1, 1]), 7);
        assert_eq!(morton_coord16_to_index([2, 0, 0]), 8);
        assert_eq!(morton_coord16_to_index([0, 2, 0]), 16);
        assert_eq!(morton_coord16_to_index([0, 0, 2]), 32);
        assert_eq!(morton_coord16_to_index([3, 0, 0]), 9); // x bits 0 and 1 -> positions 0 and 3
    }

    #[test]
    fn morton_coord24_hardcoded_vectors() {
        assert_eq!(morton_coord24_to_index([0, 0, 0]), 0);
        assert_eq!(morton_coord24_to_index([1, 0, 0]), 1);
        assert_eq!(morton_coord24_to_index([0, 1, 0]), 2);
        assert_eq!(morton_coord24_to_index([0, 0, 1]), 4);
        assert_eq!(morton_coord24_to_index([1, 1, 1]), 7);

        // High-bit checks: bit 23 interleaves at positions 69/70/71.
        assert_eq!(morton_coord24_to_index([1 << 23, 0, 0]), 1u128 << 69);
        assert_eq!(morton_coord24_to_index([0, 1 << 23, 0]), 1u128 << 70);
        assert_eq!(morton_coord24_to_index([0, 0, 1 << 23]), 1u128 << 71);
    }

    #[test]
    fn morton_coord32_hardcoded_vectors() {
        assert_eq!(morton_coord32_to_index([0, 0, 0]), 0);
        assert_eq!(morton_coord32_to_index([1, 0, 0]), 1);
        assert_eq!(morton_coord32_to_index([0, 1, 0]), 2);
        assert_eq!(morton_coord32_to_index([0, 0, 1]), 4);
        assert_eq!(morton_coord32_to_index([1, 1, 1]), 7);

        // Cross the 63/64-bit boundary of the expanded representation:
        // bit 21 interleaves at positions 63/64/65.
        assert_eq!(morton_coord32_to_index([1 << 21, 0, 0]), 1u128 << 63);
        assert_eq!(morton_coord32_to_index([0, 1 << 21, 0]), 1u128 << 64);
        assert_eq!(morton_coord32_to_index([0, 0, 1 << 21]), 1u128 << 65);

        // Top-bit: bit 31 interleaves at positions 93/94/95.
        assert_eq!(morton_coord32_to_index([1 << 31, 0, 0]), 1u128 << 93);
        assert_eq!(morton_coord32_to_index([0, 1 << 31, 0]), 1u128 << 94);
        assert_eq!(morton_coord32_to_index([0, 0, 1 << 31]), 1u128 << 95);
    }

    #[test]
    fn morton_coord64_hardcoded_vectors() {
        assert_eq!(morton_coord64_to_index([0, 0, 0]), [0, 0, 0]);
        assert_eq!(morton_coord64_to_index([1, 0, 0]), [1, 0, 0]);
        assert_eq!(morton_coord64_to_index([0, 1, 0]), [2, 0, 0]);
        assert_eq!(morton_coord64_to_index([0, 0, 1]), [4, 0, 0]);
        assert_eq!(morton_coord64_to_index([1, 1, 1]), [7, 0, 0]);

        assert_eq!(morton_coord64_to_index([2, 0, 0]), [8, 0, 0]);
        assert_eq!(morton_coord64_to_index([0, 2, 0]), [16, 0, 0]);
        assert_eq!(morton_coord64_to_index([0, 0, 2]), [32, 0, 0]);

        // Cross limb boundary: bit 21 interleaves at 63/64/65.
        assert_eq!(morton_coord64_to_index([1u64 << 21, 0, 0]), [1u64 << 63, 0, 0]);
        assert_eq!(morton_coord64_to_index([0, 1u64 << 21, 0]), [0, 1, 0]);
        assert_eq!(morton_coord64_to_index([0, 0, 1u64 << 21]), [0, 2, 0]);

        // Top-bit: bit 63 interleaves at 189/190/191 (limb 2, offsets 61/62/63).
        assert_eq!(morton_coord64_to_index([1u64 << 63, 0, 0]), [0, 0, 1u64 << 61]);
        assert_eq!(morton_coord64_to_index([0, 1u64 << 63, 0]), [0, 0, 1u64 << 62]);
        assert_eq!(morton_coord64_to_index([0, 0, 1u64 << 63]), [0, 0, 1u64 << 63]);
        assert_eq!(
            morton_coord64_to_index([1u64 << 63, 1u64 << 63, 1u64 << 63]),
            [0, 0, (1u64 << 61) | (1u64 << 62) | (1u64 << 63)]
        );
    }

    #[test]
    fn morton_coord32_and_64_match_table_impls() {
        // A few non-trivial mixed-bit patterns.
        let cases32: &[[u32; 3]] = &[
            [0, 0, 0],
            [1, 2, 4],
            [0xdead_beef, 0x0123_4567, 0x89ab_cdef],
            [1 << 31, 1 << 17, 1 << 3],
            [0xffff_ffff, 0, 0],
        ];
        for &c in cases32 {
            assert_eq!(morton_coord32_to_index(c), morton_coord32_to_index_table(c), "case32={:?}", c);
        }

        let cases64: &[[u64; 3]] = &[
            [0, 0, 0],
            [1, 2, 4],
            [0x0123_4567_89ab_cdef, 0xfedc_ba98_7654_3210, 0x0f0f_0f0f_0f0f_0f0f],
            [1u64 << 63, 1u64 << 21, 1u64 << 7],
            [u64::MAX, 0, 0],
        ];
        for &c in cases64 {
            assert_eq!(morton_coord64_to_index(c), morton_coord64_to_index_table(c), "case64={:?}", c);
        }
    }
}

