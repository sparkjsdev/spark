# Performance Tuning

Rendering millions of splats at 60+ fps can be a demanding task, especially for mobile-class GPUs. Each splat is rendered as two triangles that span the footprint of a Gaussian up to `sqrt(8)` standard deviations (default value) from the center. Each splat is rendered as a transparent object and must be blended back-to-front.

As a quick rule-of-thumb, the following "splat budgets" are recommended:

- Quest 3: 1 million splats or less, not too many splats concentrated in a small area
- Android phone: 1-2 million splats
- iPhone: 1-3 million splats
- Computer: 1-5 million splats (10-20+ million on some desktops)

Each splat incurs overhead in transforming it via SplatAccumulator for sorting and rendering, and at around 1 million splats this becomes a bottleneck on some systems. Unintuitively, when a large number of splats are concentrated in a small area (for example 500K splats from a Trellis object at a small screen scale) they can bottleneck the GPU's rendering and blending ability. 

## `maxStdDev`

Adjust `SparkRenderer.maxStdDev` (either directly on `SparkRenderer` or via constructor options) to a value less than the default `Math.sqrt(8)`. This limits the extent of the Gaussian fall-off, which by default is approx 2.8. For VR a good value is `Math.sqrt(5)`, which is perceptually very similar to the default.

## `THREE.WebGLRenderer.antialias`

When constructing a `THREE.WebGLRenderer` you should set `antialias: false` (default value) to avoid the overhead of multisampling. Rendering splats doesn't benefit from multisampling, and adds a significant amount of overhead when drawing millions of splats.

## `renderer.setPixelRatio(window.devicePixelRatio)`

Although `SparkRenderer` is designed to work with any `devicePixelRatio`, it may impact performance due to the increased number of pixels to render and blend. If your scene consists of mostly splats, consider whether you have enough splats to justify the high DPI rendering.
