# Spark 3DGUT Plan

This note summarizes the current plan for adding a 3DGUT-style renderer to Spark using only the existing `splatVertex` and `splatFragment` shaders.

The intended scope is:

- pinhole camera only
- no new buffers or pre-pass
- no changes to sorting, batching, or renderer structure
- keep Spark's current per-splat inputs: center, scales, quaternion, color, opacity
- keep the current "one instanced quad per splat" pipeline

The key idea is:

- in the vertex shader, replace the current Jacobian/affine projection with an Unscented Transform (UT) projection of the 3D Gaussian to screen space
- in the fragment shader, replace the current 2D screen-space Gaussian falloff with a 3D ray/Gaussian max-response evaluation

This matches the high-level split used by 3DGUT:

- UT is used to compute a good projected 2D footprint under the camera model
- final per-pixel alpha is computed from the 3D Gaussian and the camera ray, not from a 2D ellipse falloff

## Practical Consequences

This design is redundant by construction:

- the vertex shader runs 4 times per splat
- therefore the 7 sigma points and their projection are recomputed 4 times

That is acceptable for the first implementation because:

- it fits directly into Spark's current shader architecture
- it avoids any renderer or buffer changes
- it lets us validate the visual behavior first

## What Changes in Spark

Current Spark path:

- `splatVertex`: unpack splat, build projected 2D covariance using the center Jacobian, derive ellipse axes, place quad
- `splatFragment`: evaluate a 2D Gaussian based on `vSplatUv`

New 3DGUT-style path:

- `splatVertex`: unpack splat, move it to view space, build 7 UT sigma points, project them, compute 2D mean/covariance, derive ellipse axes, place quad, pass 3D Gaussian data to fragment via `flat` varyings
- `splatFragment`: reconstruct the pixel ray in view space, evaluate the Gaussian at the point of maximum response along that ray, and output premultiplied alpha/color

## Vertex Shader Responsibilities

The vertex shader should do the following per vertex invocation:

1. Decode the original splat.
2. Transform the splat center and orientation into view space.
3. Build 7 sigma points for the 3D Gaussian in view space.
4. Project the 7 sigma points through the current pinhole projection.
5. Compute the weighted 2D mean and covariance in screen space.
6. Diagonalize the 2D covariance and derive the two oriented ellipse axes.
7. Use those axes to place the current quad corner.
8. Pass enough per-splat 3D data to the fragment shader to evaluate the max-response alpha without any further texture fetches.

## Fragment Shader Responsibilities

The fragment shader should do the following:

1. Reconstruct the pixel ray in view space from `gl_FragCoord`, `renderSize`, and the projection matrix.
2. Use the per-splat Gaussian data passed from the vertex shader.
3. Evaluate the Gaussian's maximum response along the ray.
4. Convert that response into alpha.
5. Output color using Spark's existing premultiplied-alpha path.

## Recommended Parameters

### `adjustedStdDev`

Use Spark's existing `adjustedStdDev` as the bound scale for the quad.

Reason:

- Spark already uses `adjustedStdDev` as its support radius control
- it handles the current alpha-stretch behavior for stronger splats
- it is the closest existing Spark equivalent to the support multiplier used in 3DGUT-like bounding

So instead of introducing a new constant such as `BOUND_K = 3.33`, use:

- `boundScale = adjustedStdDev`

This keeps behavior aligned with current Spark tuning.

### UT parameters

Use the same default UT parameters as the inspected 3DGUT code:

- `alpha = 0.1`
- `beta = 2.0`
- `kappa = 0.0`

These are conventional and already used in the CUDA implementation we examined.

### Blur / antialiasing

Keep Spark's current anti-aliasing / blur logic conceptually where possible:

- diagonal blur added to the 2D covariance in the vertex shader
- optional alpha compensation factor multiplied into the final opacity

This is not the core of 3DGUT, but it keeps Spark behavior stable and should reduce visual regressions.

## Vertex Shader Pseudocode

This pseudocode intentionally follows Spark's current dataflow rather than the exact CUDA structure.

```glsl
// outputs
out vec2 vLocalUv;          // optional coarse support test in fragment
flat out vec4 vRgba;
flat out vec3 vCenterVS;
flat out vec3 vIsclRot0;
flat out vec3 vIsclRot1;
flat out vec3 vIsclRot2;
flat out float vAlphaScale;

void main() {
    // 1) Decode splat from existing Spark storage
    decode centerWS, scales, quatWS, rgba

    if (invalid or alpha too small) {
        place offscreen
        return
    }

    // 2) Transform center/orientation into view space
    centerVS = quatVec(renderToViewQuat, centerWS) + renderToViewPos
    quatVS   = quatQuat(renderToViewQuat, quatWS)

    if (centerVS behind camera) {
        place offscreen
        return
    }

    // 3) Build 7 sigma points in view space
    R = quatToMat3(quatVS)
    lambda = alpha^2 * (3 + kappa) - 3
    s = sqrt(3 + lambda)

    sigma[0] = centerVS
    sigma[1] = centerVS + s * scales.x * R[0]
    sigma[2] = centerVS + s * scales.y * R[1]
    sigma[3] = centerVS + s * scales.z * R[2]
    sigma[4] = centerVS - s * scales.x * R[0]
    sigma[5] = centerVS - s * scales.y * R[1]
    sigma[6] = centerVS - s * scales.z * R[2]

    wMean[0] = lambda / (3 + lambda)
    wCov[0]  = wMean[0] + (1 - alpha^2 + beta)
    wMean[i>0] = 1 / (2 * (3 + lambda))
    wCov[i>0]  = 1 / (2 * (3 + lambda))

    // 4) Project sigma points to pixel space
    for each sigma[i]:
        clip = projectionMatrix * vec4(sigma[i], 1)
        if invalid:
            place offscreen
            return
        pixel[i] = project clip to pixel coordinates using renderSize

    // 5) Compute weighted 2D mean/covariance
    meanPx = sum_i wMean[i] * pixel[i]
    covPx  = sum_i wCov[i] * outer(pixel[i] - meanPx, pixel[i] - meanPx)

    // 6) Apply Spark's optional blur / AA treatment
    covPx += blurAmount * I
    alphaScale = optional opacity compensation factor

    // 7) Eigendecompose 2x2 covariance
    (eigVec0, eigVec1, eigVal0, eigVal1) = eigen decomposition

    boundScale = adjustedStdDev
    axis0Px = eigVec0 * boundScale * sqrt(eigVal0)
    axis1Px = eigVec1 * boundScale * sqrt(eigVal1)

    // 8) Convert center and axes to NDC
    centerNdc = pixelToNdc(meanPx, renderSize)
    axis0Ndc  = pixelDeltaToNdc(axis0Px, renderSize)
    axis1Ndc  = pixelDeltaToNdc(axis1Px, renderSize)

    // 9) Build the final quad corner
    clipCenter = projectionMatrix * vec4(centerVS, 1)
    corner = position.xy
    ndcXY = centerNdc + corner.x * axis0Ndc + corner.y * axis1Ndc
    gl_Position = vec4(ndcXY * clipCenter.w, clipCenter.z, clipCenter.w)

    // 10) Prepare 3D Gaussian data for fragment stage
    // A = S^{-1} * R^T in view space
    isclRot = diag(1 / scales) * transpose(R)

    vLocalUv = corner * adjustedStdDev
    vRgba = rgba
    vCenterVS = centerVS
    vIsclRot0 = isclRot[0]
    vIsclRot1 = isclRot[1]
    vIsclRot2 = isclRot[2]
    vAlphaScale = alphaScale
}
```

## Fragment Shader Pseudocode

The fragment shader should no longer evaluate a 2D Gaussian in screen space. Instead it should evaluate the 3D Gaussian response along the current pixel ray.

```glsl
in vec2 vLocalUv;
flat in vec4 vRgba;
flat in vec3 vCenterVS;
flat in vec3 vIsclRot0;
flat in vec3 vIsclRot1;
flat in vec3 vIsclRot2;
flat in float vAlphaScale;

void main() {
    // Optional conservative trim of quad corners
    if (dot(vLocalUv, vLocalUv) > adjustedStdDev * adjustedStdDev) {
        discard
    }

    // 1) Reconstruct view-space pixel ray for pinhole camera
    ndc = vec2(
        2 * gl_FragCoord.x / renderSize.x - 1,
        2 * gl_FragCoord.y / renderSize.y - 1
    )

    rayDirVS = normalize(vec3(
        ndc.x / projectionMatrix[0][0],
        ndc.y / projectionMatrix[1][1],
        -1
    ))

    // 2) Rebuild A = S^{-1} * R^T
    A = mat3(vIsclRot0, vIsclRot1, vIsclRot2)

    // 3) Evaluate max response along the ray
    // Camera origin in view space is approximately (0,0,0)
    gro = A * (-vCenterVS)
    grd = normalize(A * rayDirVS)
    gcrod = cross(grd, gro)
    grayDist = dot(gcrod, gcrod)

    alpha = vRgba.a * vAlphaScale * exp(-0.5 * grayDist)

    if (alpha < minAlpha) {
        discard
    }

    rgb = vRgba.rgb
    if (encodeLinear) {
        rgb = srgbToLinear(rgb)
    }

    // 4) Keep Spark's current premultiplied-alpha output convention
    fragColor = vec4(rgb * alpha, alpha)
}
```

## Important Notes

### Why pass `isclRot`

Passing `A = S^{-1} * R^T` from the vertex shader avoids fragment texture fetches and lets the fragment shader evaluate the 3D Gaussian directly.

This matches the structure used in the CUDA renderer, where the ray is transformed into normalized Gaussian space before computing the response.

### Why use `flat` varyings

The fragment shader should not interpolate the Gaussian center or transform basis across the quad. These values are per-splat, not per-vertex.

Therefore use `flat` varyings for:

- color / opacity
- view-space center
- rows or columns of `isclRot`
- any alpha compensation term

### Why keep `vLocalUv`

`vLocalUv` is optional, but useful:

- it cheaply discards obvious empty corners of the quad
- it provides a debugging view similar to the current Spark support region

The actual alpha should still come from the 3D ray/Gaussian evaluation, not from `vLocalUv`.

## Expected Tradeoffs

Advantages:

- no renderer architecture changes
- no additional buffers or pre-pass
- keeps current Spark instanced-quad flow
- gives a 3DGUT-style projection and fragment response

Disadvantages:

- expensive vertex shader due to redundant UT work across 4 vertices
- more varyings than current Spark path
- pinhole only in this version

## Summary

To render a 3DGUT-style splat in Spark using only the current vertex/fragment framework:

- replace the current 2D affine/Jacobian projection with UT projection of 7 sigma points in `splatVertex`
- use the UT-derived 2D mean/covariance to build the quad axes, with `adjustedStdDev` as the support scale
- pass per-splat 3D Gaussian data to the fragment shader via `flat` varyings
- replace the current 2D Gaussian fragment falloff with a max-response ray/Gaussian evaluation in `splatFragment`
- keep Spark's current premultiplied-alpha blending and renderer structure unchanged

This is the simplest implementation path that is faithful to the intended 3DGUT-style behavior while fitting directly into Spark's existing shader architecture.

## Appendix: Additional Implementation Details

This appendix captures the important details from the 3DGUT paper, the HTGS paper, and the CUDA implementation we inspected that are useful when making the actual Spark shader edits.

### A.1 What is faithful to 3DGUT, and what is a Spark adaptation

The following parts are faithful to the 3DGUT forward renderer:

- use the Unscented Transform to estimate a projected 2D footprint from 7 sigma points
- evaluate the Gaussian at the point of maximum response along the camera ray
- keep the final alpha as `opacity * exp(-0.5 * grayDist)` after transforming the ray into normalized Gaussian space

The following parts are Spark-specific adaptations:

- using an oriented quad built from the 2D covariance eigenvectors
- recomputing the UT 4 times per splat in the vertex shader
- continuing to rely on Spark's existing global draw order rather than a per-tile list
- using Spark's current uniforms, alpha handling, and premultiplied output path

Important consequence:

- this will be a 3DGUT-style Spark renderer, not a byte-for-byte reproduction of the CUDA viewer

### A.2 Most important conceptual split

This is the single most important thing to preserve correctly:

- the UT projection is for support and footprint estimation
- the fragment shader is the source of truth for final per-pixel response

Said differently:

- the vertex shader decides where the splat is worth rasterizing
- the fragment shader decides how much the splat contributes at that pixel

This is why it is acceptable for the oriented quad to be only a conservative support region.

### A.3 Why this is reasonable for pinhole-only Spark

3DGUT's UT becomes most compelling when the camera model is nonlinear. For a pinhole-only renderer:

- the UT still improves over a single Jacobian linearization
- but the biggest visible difference may come from the fragment-side ray/Gaussian evaluation

HTGS is also relevant here:

- HTGS uses a perspective-correct geometric bounding construction
- HTGS also evaluates 3D Gaussian response along the viewing ray
- HTGS differs mainly in how it computes bounds and in its hybrid-transparency pipeline

For Spark, UT is still the better fit because:

- it maps naturally to the current "compute a 2D ellipse then render a quad" shader structure
- the projected covariance gives oriented axes directly
- HTGS ultimately computes an axis-aligned bound, whereas Spark already wants an oriented billboard quad

### A.4 Bound shape in Spark vs CUDA 3DGUT viewer

The CUDA renderer we inspected computes a 2D covariance but then uses axis-aligned radii for coverage and tiling.

Spark should not copy that exact bound representation.

Instead, Spark should do:

- compute the 2D covariance from the UT
- eigendecompose it
- render an oriented quad aligned to the eigenvectors

This is a valid adaptation and should be especially beneficial for:

- large skinny splats
- diagonal splats
- close-up perspective-distorted splats

### A.5 How strict to be about sigma point validity

The inspected 3DGUT code uses:

- `require_all_sigma_points_valid = true`

That means:

- if any sigma point projects invalidly, the splat is rejected for that view

For the first Spark implementation, follow the same rule.

This is conservative, but it is simple and tends to avoid unstable bounds near:

- the near plane
- the image border
- extreme projection cases

So in the vertex shader:

- if any sigma point is invalid or behind the camera, discard the splat by placing it offscreen

This is the safest initial behavior.

### A.6 Which space to build sigma points in

For pinhole Spark, build sigma points in view space, not world space.

Reason:

- world-to-view is linear
- the only nonlinear part is the pinhole projection
- building sigma points after the view transform simplifies the math and is equivalent for this purpose

So the flow should be:

- decode splat in world space
- transform center and orientation into view space
- generate sigma points in view space
- project each sigma point using the projection matrix

### A.7 Support scale choice

Use Spark's existing `adjustedStdDev` as the support multiplier.

This is preferable to introducing a new hardcoded `BOUND_K` because:

- Spark already uses it to define the current support region
- it already incorporates Spark's special alpha stretching behavior for `rgba.a > 1`
- it will keep the new path closer to current Spark tuning

So:

- use `adjustedStdDev * sqrt(eigenvalue)` as the quad-axis length

### A.8 Blur and alpha compensation

Spark's current shader adds blur to the 2D covariance and adjusts alpha afterward.

The 3DGUT CUDA code also computes an opacity-aware compensation after adding blur to the covariance.

For the first Spark pass:

- keep Spark's existing blur logic conceptually where practical
- if there is an existing opacity correction path tied to blur, preserve it as `vAlphaScale`

This is not the main novelty, but removing it entirely will likely change visual tuning more than necessary.

### A.9 Fragment evaluation details

The fragment shader should compute the response using the same structure as the CUDA code:

- `A = S^{-1} * R^T`
- `gro = A * (rayOrigin - centerVS)`
- `grd = normalize(A * rayDirVS)`
- `gcrod = cross(grd, gro)`
- `grayDist = dot(gcrod, gcrod)`
- `alpha = opacity * exp(-0.5 * grayDist)`

For Spark's pinhole camera:

- `rayOrigin` in view space is effectively `(0, 0, 0)`

Therefore:

- `gro = A * (-centerVS)`

The normalization of `grd` matters and should be kept.

### A.10 Optional support trimming in fragment

The fragment shader may still use a cheap support trim such as:

- `if dot(vLocalUv, vLocalUv) > adjustedStdDev^2 discard;`

This trim is only a conservative quad-corner optimization.

It must not be treated as the real Gaussian shape.

The real alpha must come from the ray/Gaussian max-response evaluation.

### A.11 Sorting caveat

Spark will still draw splats in its current order.

This means:

- the new shading model improves projection quality and per-pixel Gaussian evaluation
- but it does not magically solve sorting artifacts

So when comparing results:

- better shape and perspective correctness should be expected
- ordering artifacts may remain because Spark is not adopting HTGS hybrid transparency or the CUDA tile-local sorted lists

This is expected and not a shader bug.

### A.12 Center depth vs true per-pixel depth

When Spark draws the oriented quad, depth and ordering are still effectively driven by the existing primitive ordering, which is based on per-splat sorting rather than per-pixel intersection depth.

The fragment shader computes the right response strength, but not a new blend order.

This matches the current Spark architecture and should be accepted for the first version.

### A.13 What to do with `covSplats`

The first implementation should focus on the regular scale+quaternion path only.

If Spark's covariance-encoded path is also needed later, it should be handled separately because:

- the UT sigma point construction naturally starts from explicit scales and orientation
- covariance-encoded splats would need a different decomposition path before the UT can be applied cleanly

So for now:

- implement the 3DGUT path for the standard splat encoding first
- leave `covSplats` alone or explicitly disable the new path when `enableCovSplats` is true

### A.14 Why `flat` varyings matter

The following should be `flat`:

- `vRgba`
- `vCenterVS`
- `vIsclRot*`
- `vAlphaScale`

These are per-splat quantities and must not interpolate across the quad.

The following may be regular varying:

- `vLocalUv`

because it is used only as a local support coordinate on the quad.

### A.15 Expected performance profile

The cost increase should mostly land in the vertex shader:

- 7 point projections per vertex invocation
- repeated 4 times per splat
- 2x2 covariance accumulation
- 2x2 eigendecomposition

The fragment shader should remain moderate:

- reconstruct view ray
- do a few matrix-vector operations
- one cross product
- one exponent

Therefore, if performance becomes a problem later, the next optimization step is obvious:

- move the UT projection into a pre-pass

But that should not be part of the first implementation.

### A.16 Debugging checklist

If the first version looks wrong, check the following in order:

1. Verify the view-space convention:
   Spark currently treats visible splats as having negative `z` in view space.
2. Verify the sigma points are built in view space using the view-space quaternion.
3. Verify pixel-to-NDC and NDC-to-pixel conversions are consistent with Spark's current code.
4. Verify the fragment ray reconstruction matches the same projection convention as the vertex shader.
5. Verify `isclRot = diag(1/scales) * transpose(R)` uses the same matrix convention as the quaternion-to-matrix helper.
6. Verify `flat` varyings are really declared `flat`.
7. Verify the old 2D Gaussian alpha logic is fully removed or bypassed in the new path.

### A.17 Minimum implementation checklist

The next context implementing the edit should ensure all of the following are done:

- replace Jacobian-based projected covariance with UT-based projected covariance in `splatVertex`
- use the resulting 2D eigenvectors/eigenvalues to build the oriented quad
- keep `adjustedStdDev` as the support multiplier
- pass `centerVS`, `isclRot`, color, and alpha scaling as `flat` varyings
- reconstruct the pinhole camera ray in `splatFragment`
- replace the current 2D falloff with the 3D max-response evaluation
- keep premultiplied-alpha output behavior compatible with current Spark blending
- start with the standard scale+quaternion path only

### A.18 One-sentence final summary

For Spark's current shader-only implementation, the correct mental model is:

- compute the projected support from a 7-point Unscented Transform in the vertex shader, then compute the true per-pixel splat response from the 3D Gaussian and the camera ray in the fragment shader.
