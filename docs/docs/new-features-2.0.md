# New Features in 2.0

The main driver for the new "Spark 2.0" is to enable huge worlds made of dynamic 3D Gaussian Splats. In past releases we were limited by how many splats a typical GPU / laptop / mobile device could render in real-time. We were also limited by how many splats we could store in memory, and huge downloads without streaming capabilities made large scenes impractical. Even loading + decoding a multi-GB .PLY file would fail because the browser couldn't allocate buffers that size. Finally, some splat scenes with big coordinates would exhibit quantization artifacts.

## 2.0 Overview

The new Spark 2.0 is a complete solution for creating, streaming, and [rendering huge 3DGS worlds](/examples/streaming-lod/) on the web on any device. Any splat file can be loaded and turned into a ["Level-of-Detail (LoD) Splat Tree"](new-spark-renderer.md) with all the original splats as leaf nodes, and interior nodes representing downsampled versions of the splats all the way up to the top "root splat" that has the average color and shape of all the original splats combined.

- **Steady, tunable frame rate:** As you move around the scene, Spark computes "slices" through this tree that picks the best set of `N` splats from your current viewpoint, taking into account your distance to each splat and the view frustum. By setting a fixed `N` (default 500K - 2.5M depending on your device type) we can ensure that Spark never has to render more than `N` splats each frame, resulting in a steady, high frame rate. No matter how many splats there are globally in the scene, Spark can traverse the tree in `O(N log N)` time and render it (very roughly) in `O(N + ..)` time. By adjusting `N` up or down it can trade off between frame rate and splat detail.

- **Composite LoD worlds:** Spark 2.0 also supports LoD rendering across *multiple splat objects* simultaneously, traversing multiple trees jointly to compute the optimal set of splats that maximizes the minimum screen-space splat size. This allows you to easily create [huge composite worlds](/examples/multi-lod/) by simply adding as many splat object parts as you want anywhere in space, and Spark will compute the best global subset of all the splats to render each frame. Splat objects can be added and removed dynamically at any time, each with their own custom shader graphs and parameters.

- **Downsampling splats:** Spark ships with two selectable algorithms for computing LoD splat trees, a quick and compact algorithm `tiny-lod` (intended to be run on-demand) and a higher-quality `bhatt-lod` (intended for pre-processing for faster load times). Both methods can be run using a command-line tool or directly in the browser from your 3DGS app, allowing you to load a regular splat file and automatically create an LoD tree, and modify the splats and regenerate the LoD tree on-demand.

- **Streamable LoD file format:** Spark also defines a new, extensible, and configurable file format `.RAD` (RADiance field) that can store the precomputed LoD splat tree, and enables streaming arbitrary chunks of splats via HTTP Range requests. Splats are loaded starting from the coarsest root splats and automatically prioritizes fetching chunks that will resolve detail best depending on your position and viewpoint. Any input splat file can be turned into a "coarse-to-fine" representation and load instantly in your 3DGS app, filling in detail as quickly as the network connection allows.

- **Shared, paged/streaming splat buffers:**  To manage the memory usage of huge composite worlds, Spark 2.0 implements a shared LRU "splat page table" (akin to an OS/CPU virtual paging system). It pre-allocates a fixed GPU memory pool for splats (default 16 M splats) that is shared across all splat object instances in the scene, fetching chunks of splats over the network, evicting the oldest or least useful chunks for the current viewpoint. Scenes with 100 M or 1 G+ splats can be rendered in real-time on mobile devices with limited GPU memory, and Spark automatically prioritizes and manages it according to the current scene splat objects and viewpoint.

- **High-precision splat encoding:** Spark 0.1 uses a compact 16-byte/splat encoding `PackedSplats` that reduces memory and bandwidth usage, but float16-encoded center coordinates caused striping and other quantization artifacting for large scenes. Spark 2.0 adds a new `ExtSplats` with an extended 32-byte/splat encoding with float32 center coordinates and higher precision and range elsewhere as well.

Despite these features, Spark 2.0 is mostly backward compatible with 0.1, and most apps will require no changes except for more specialized use cases.

## Additional Features

- **Multiple independent viewpoints AND renderers:** In Spark 0.1 you could render multiple independent viewpoints from the same set of RGBA splats, but you could not render different sets of splats or different shader effects at the same time. Spark 2.0 supports multiple viewpoints by allowing multiple independent `SparkRenderer`s, each with their own viewpoint and able to render a different scene or different effects. Renderers can be used in an off-line mode, updating only when requested and rendering individual frames, for example for video output.

- **Simple LoD-on-load:** Turning any splat file into an LoD splat tree is as simple as `scene.add(new SplatMesh({ url: "./my-splats.spz", lod: true }));`. This will invoke the tiny-lod algorithm in a background WebWorker (1-3 sec for 1M input splats) and render a down-sampled version as soon as it completes.

- **Switching between LoD and non-LoD versions:** In some cases you may want display the LoD'd splats but still have access to the original, non-LoD splats. For example, you may have an RGBA overlay or need to sync changes with offline systems. Creating the SplatMesh with `{ url, lod: true, nonLod: true }` instructs Spark to keep both versions and switch between them instantly using `SplatMesh.enableLod`.

- **Creating an LoD on-demand:** A `PackedSplats` or `ExtSplats` without an LoD representation can have one built in a background WebWorker on-demand by calling `.createLodSplats()`. Repeated updates to the original splat data can be propagated to the LoD version.

- **Command-line LoD tree builder:** Spark 2.0 includes the command-line tool `build-lod` that can input any splat file or wildcard of files, pre-build the LoD tree, and save it as a `.RAD` file for faster loading and streaming. 

- **Tunable LoD detail levels:** Different 3DGS applications will want to emphasize more detail, or higher frame rate, so the Spark 2.0 LoD system allows you to adjust the splat detail level up or down from platform-default values. Additional foveation parameters allow you to emphasize splats in front of the viewer within the frustum, foveated toward the center, increasing the effective splat detail where the user is looking. These parameters can be adjusted globally and also individually per-SplatMesh.

- **Huge file support:** In Spark 0.1 loading a splat file would first need to be fully loaded into a Uint8Array, preventing GB-sized files from loading. Spark 2.0 adds the ability to load from a `ReadableStream`, enabling multi-GB file loading from URLs or local drag-n-drop files.

- **Selectable ExtSplats encoding:** The new "extended splat" encoding can be individually enabled for a loaded `SplatMesh`, the global intermediary `SplatAccumulator`, and the shared virtual splat buffer `SplatPager`, allowing you to use it only where it's needed.

- **Chainable splat modifiers:** Dynamic `SplatMesh` object/world Dyno modifiers can now be chained together, making it easy to composite splat transformations and effects.

- **Customizable splat shader code:** Spark 2.0 allows you to tap into and edit the vertex + fragment shaders and uniforms used to render the individual splats, enabling new classes of effects that were previously impossible without modifying Spark itself. For example, adding a texture to the splat, or rendering real-time dynamic splat portals (see experimental `SparkPortals.ts`).

- **Simple, customizable AR/VR wrapper:** A new `SparkXr` class makes it easy to create an AR/VR experience, with UI button support, hand tracking, and more.

- **Experimental Covariance Splats for anisotropic scaling:** In Spark 0.1, non-uniform scaling is ignored. In Spark 2.0, initializing `SparkRenderer` with `{ covSplats: true }` enables a new internal encoding that stores the 3D symmetric covariance matrix instead of scale+rotation, which enables non-uniform scaling (any affine transformation). All existing splat Dyno pipelines are backward-compatible and are converted to the new representation automatically. Non-uniform scaling is rendered correctly and transforms to the covariance matrix can be done directly by a new class of splat modifiers.

- **Experimental Linear Blend Skinning for rigged characters:** Spark 0.1 supported dual-quaternion blending for "skinned splats" consisting of B deformable bones and N x 4 bone indices and weights per splat. Using the new covariance splats, Spark 2.0 has experimental support for Linear Blend Skinning, which is more typically used for rigged character animation. This opens up the door to animating splat "characters" using existing mesh-based rigging systems.

- **Experimental real-time splat portals:** Spark 2.0 includes an experimental `SparkPortals` that allows you to render dynamic splats through portals that allow you to "look through them" into different parts of a scene of different scenes altogether. Portals and splats rendered through portals can move and change dynamically, opening up the possible for new 3D splat experiences with interconnected non-contiguous spaces.
