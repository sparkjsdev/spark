use glam::{Mat3A, Quat, Vec2, Vec3A, Vec4};
use half::f16;

#[derive(Debug, Clone, Copy, Default)]
pub struct SymMat3(Vec4, Vec2);

#[derive(Debug, Clone, Copy, Default)]
pub struct SymMat3f16([f16; 6]);


impl From<SymMat3> for SymMat3f16 {
    fn from(mat: SymMat3) -> Self {
        Self([
            f16::from_f32(mat.0[0]),
            f16::from_f32(mat.0[1]),
            f16::from_f32(mat.0[2]),
            f16::from_f32(mat.0[3]),
            f16::from_f32(mat.1[0]),
            f16::from_f32(mat.1[1]),
        ])
    }
}

impl From<SymMat3f16> for SymMat3 {
    fn from(mat: SymMat3f16) -> Self {
        Self(
            Vec4::from_array([f32::from(mat.0[0]), f32::from(mat.0[1]), f32::from(mat.0[2]), f32::from(mat.0[3])]),
            Vec2::from_array([f32::from(mat.0[4]), f32::from(mat.0[5])]),
        )
    }
}

impl SymMat3 {
    pub fn new(elements: [f32; 6]) -> Self {
        Self(
            Vec4::from_array([elements[0], elements[1], elements[2], elements[3]]),
            Vec2::from_array([elements[4], elements[5]]),
        )
    }

    pub fn new_zeros() -> Self {
        Self(Vec4::ZERO, Vec2::ZERO)
    }

    /// Constructs a SymMat3 (covariance format) from scale (Vec3A) and quaternion (Quat) using glam types.
    pub fn new_scale_quaternion(scale: Vec3A, quat: Quat) -> Self {
        // Convert quaternion quaternion into a 3x3 rotation matrix
        let rot = Mat3A::from_quat(quat);
        // Compute the full matrix: R * S * R^T, where S = diagonal(scale^2)
        // Since S is diagonal, this is equivalent to (rot * scale).mul_element_wise(rot)
        // But we're interested only in the symmetric matrix: combine scale and rotation

        // The transformed axis vectors:
        let sx = rot.x_axis * scale.x;
        let sy = rot.y_axis * scale.y;
        let sz = rot.z_axis * scale.z;

        // Covariance is then the sum of the outer products of the scaled axes
        // That is: sigma = sx*sx^T + sy*sy^T + sz*sz^T
        // Since we want symmetric storage: [xx, yy, zz, xy, xz, yz]
        let xx = sx.x * sx.x + sy.x * sy.x + sz.x * sz.x;
        let yy = sx.y * sx.y + sy.y * sy.y + sz.y * sz.y;
        let zz = sx.z * sx.z + sy.z * sy.z + sz.z * sz.z;
        let xy = sx.x * sx.y + sy.x * sy.y + sz.x * sz.y;
        let xz = sx.x * sx.z + sy.x * sy.z + sz.x * sz.z;
        let yz = sx.y * sx.z + sy.y * sy.z + sz.y * sz.z;

        Self(Vec4::from_array([xx, yy, zz, xy]), Vec2::from_array([xz, yz]))
    }

    pub fn xx(&self) -> f32 {
        self.0.x
    }
    pub fn yy(&self) -> f32 {
        self.0.y
    }
    pub fn zz(&self) -> f32 {
        self.0.z
    }
    pub fn xy(&self) -> f32 {
        self.0.w
    }
    pub fn xz(&self) -> f32 {
        self.1.x
    }
    pub fn yz(&self) -> f32 {
        self.1.y
    }

    pub fn xx_mut(&mut self) -> &mut f32 {
        &mut self.0.x
    }
    pub fn yy_mut(&mut self) -> &mut f32 {
        &mut self.0.y
    }
    pub fn zz_mut(&mut self) -> &mut f32 {
        &mut self.0.z
    }

    pub fn add_weighted(&mut self, other: &Self, weight: f32) {
        self.0 = other.0.mul_add(Vec4::splat(weight), self.0);
        self.1 = other.1.mul_add(Vec2::splat(weight), self.1);
    }

    // fn new_average(a: &Self, b: &Self) -> Self {
    //     Self(
    //         a.0.mul_add(Vec4::splat(0.5), b.0 * 0.5),
    //         a.1.mul_add(Vec2::splat(0.5), b.1 * 0.5),
    //     )
    // }

    // fn determinant(&self) -> f32 {
    //     let m00 = self.0.x;
    //     let m11 = self.0.y;
    //     let m22 = self.0.z;
    //     let m01 = self.0.w;
    //     let m02 = self.1.x;
    //     let m12 = self.1.y;

    //     m00 * (m11 * m22 - m12 * m12) -
    //     m01 * (m01 * m22 - m12 * m02) +
    //     m02 * (m01 * m12 - m11 * m02)
    // }

    // fn inverse(&self) -> Option<Self> {
    //     let m00 = self.0.x;
    //     let m11 = self.0.y;
    //     let m22 = self.0.z;
    //     let m01 = self.0.w;
    //     let m02 = self.1.x;
    //     let m12 = self.1.y;

    //     let det = self.determinant();
    //     // Use a relative tolerance based on matrix scale (diagonal magnitudes)
    //     let diag_max = self.0[0].abs().max(self.0[1].abs()).max(self.0[2].abs());
    //     let rel_tol = 1e-9_f32 * (diag_max * diag_max * diag_max).max(1e-30_f32);
    //     if det.abs() < rel_tol {
    //         // println!("Matrix: {:?}", self);
    //         // panic!("Matrix is singular or too close to singular");
    //         return None;
    //     }
    //     let inv_det = 1.0 / det;
        
    //     let inv_xx = (m11 * m22 - m12 * m12) * inv_det;
    //     let inv_yy = (m00 * m22 - m02 * m02) * inv_det;
    //     let inv_zz = (m00 * m11 - m01 * m01) * inv_det;
    //     let inv_xy = (m02 * m12 - m01 * m22) * inv_det;
    //     let inv_xz = (m01 * m12 - m02 * m11) * inv_det;
    //     let inv_yz = (m01 * m02 - m00 * m12) * inv_det;
        
    //     Some(Self(Vec4::from_array([inv_xx, inv_yy, inv_zz, inv_xy]), Vec2::from_array([inv_xz, inv_yz])))
    // }

    pub fn eigens(&self) -> ([f32; 3], [Vec3A; 3]) {
        const MAX_ITERS: usize = 32;
        // Relative tolerance based on matrix scale
        let eps: f32 = {
            let s = self.0[0].abs() + self.0[1].abs() + self.0[2].abs();
            1e-6_f32 * s.max(1.0)
        };

        // Unpack symmetric matrix into columns
        let mut current = Mat3A::from_cols(
            Vec3A::from_array([self.0.x, self.0.w, self.1.x]),
            Vec3A::from_array([self.0.w, self.0.y, self.1.y]),
            Vec3A::from_array([self.1.x, self.1.y, self.0.z]),
        );
        // Accumulate eigenvectors (columns)
        let mut eigs: Mat3A = Mat3A::IDENTITY;
    
        #[inline]
        fn off_diag_norm2(a: &Mat3A) -> f32 {
            let a01 = a.col(0)[1];
            let a02 = a.col(0)[2];
            let a12 = a.col(1)[2];
            a01*a01 + a02*a02 + a12*a12
        }
    
        let mut k = 0;
        while k < MAX_ITERS && off_diag_norm2(&current) > (eps*eps) {
            // choose largest |off-diagonal|
            let mut p = 0usize;
            let mut q = 1usize;
            let mut max_val = current.col(0)[1].abs();
            let cand = [(0,2, current.col(0)[2].abs()), (1,2, current.col(1)[2].abs())];
            for (i,j,val) in cand {
                if val > max_val {
                    max_val = val; p = i; q = j;
                }
            }
    
            let apq = current.col(p)[q];
            if apq.abs() > eps {
                let app = current.col(p)[p];
                let aqq = current.col(q)[q];
                let tau = aqq - app;
                let phi = 0.5 * (2.0 * apq).atan2(tau);
                let (c, s) = (phi.cos(), phi.sin());
    
                // A = J^T A J  (symmetric update)
                for r in 0..3 {
                    let arp = current.col(r)[p];
                    let arq = current.col(r)[q];
                    current.col_mut(r)[p] = c*arp - s*arq;
                    current.col_mut(r)[q] = s*arp + c*arq;
                }
                for r in 0..3 {
                    let apr = current.col(p)[r];
                    let aqr = current.col(q)[r];
                    current.col_mut(p)[r] = c*apr - s*aqr;
                    current.col_mut(q)[r] = s*apr + c*aqr;
                }
                current.col_mut(p)[q] = 0.0;
                current.col_mut(q)[p] = 0.0;
    
                // V = V J
                for r in 0..3 {
                    let vrp = eigs.col(r)[p];
                    let vrq = eigs.col(r)[q];
                    eigs.col_mut(r)[p] = c*vrp - s*vrq;
                    eigs.col_mut(r)[q] = s*vrp + c*vrq;
                }
            }
            k += 1;
        }
    
        // Eigenvalues on diagonal; columns of V are eigenvectors
        let vals = [current.col(0)[0], current.col(1)[1], current.col(2)[2]];
        let mut vecs: [Vec3A; 3] = [
            Vec3A::from_array([eigs.col(0)[0], eigs.col(1)[0], eigs.col(2)[0]]),
            Vec3A::from_array([eigs.col(0)[1], eigs.col(1)[1], eigs.col(2)[1]]),
            Vec3A::from_array([eigs.col(0)[2], eigs.col(1)[2], eigs.col(2)[2]]),
        ];
    
        // Normalize vectors
        for j in 0..3 {
            let n = (vecs[j][0]*vecs[j][0] + vecs[j][1]*vecs[j][1] + vecs[j][2]*vecs[j][2]).sqrt();
            if n > 0.0 {
                vecs[j][0] /= n; vecs[j][1] /= n; vecs[j][2] /= n;
            }
        }
    
        // Sort by descending eigenvalue, keeping alignment
        let mut idx = [0usize, 1, 2];
        idx.sort_by(|&a, &b| vals[b].total_cmp(&vals[a]));
        let sorted_vals = [vals[idx[0]], vals[idx[1]], vals[idx[2]]];
        let sorted_vecs = [vecs[idx[0]], vecs[idx[1]], vecs[idx[2]]];
    
        (sorted_vals, sorted_vecs)
    }

    pub fn positive_eigens(&self) -> ([f32; 3], [Vec3A; 3]) {
        let (vals, mut vecs_cols) = self.eigens();

        // Ensure right-handed basis (determinant > 0)
        let det =
            vecs_cols[0][0] * (vecs_cols[1][1] * vecs_cols[2][2] - vecs_cols[1][2] * vecs_cols[2][1]) -
            vecs_cols[0][1] * (vecs_cols[1][0] * vecs_cols[2][2] - vecs_cols[1][2] * vecs_cols[2][0]) +
            vecs_cols[0][2] * (vecs_cols[1][0] * vecs_cols[2][1] - vecs_cols[1][1] * vecs_cols[2][0]);

        if det < 0.0 {
            vecs_cols[2] = Vec3A::from_array([-vecs_cols[2][0], -vecs_cols[2][1], -vecs_cols[2][2]]);
        }
        (vals, vecs_cols)
    }
}
