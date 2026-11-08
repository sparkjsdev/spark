# 4D Gaussian Splats

Spark can play dynamic scenes stored as 4D Gaussian splats: a person that moves, an animated object, a short volumetric video. This is an experimental feature. It is implemented as an example (`examples/4dgs`) on top of the public API (`SplatMesh`, `objectModifier` and Dyno), it does not change the engine, and it plays files in a **4D compressed PLY** format that is described below.

The representation follows [FreeTimeGS](https://zju3dv.github.io/freetimegs/): every Gaussian can appear at any time and place, moves with a velocity, and fades in and out with a Gaussian over time. Nothing is uploaded per frame. A file is loaded once and the animation runs on the GPU: only the current time changes.

## How it works

Besides the usual splat attributes, every Gaussian has a time center `t0`, a temporal scale `sigma` and a velocity `v`. At time `t` it is drawn at

```
center(t) = center + v * (t - t0)
alpha(t)  = alpha * exp(-0.5 * ((t - t0) / sigma)^2)
```

A Gaussian is only visible for a short moment, so a clip contains many more Gaussians than are drawn at any time. In a sample clip of 5 seconds there are about 1.3 million Gaussians in a file and about 300-400 thousand of them are visible at once.

Spark already decodes position, rotation, scale and color of a compressed PLY and ignores the two extra 4D fields. The example reads those two fields itself, writes them into two float textures that are laid out like Spark's own per-splat textures, and applies the formulas above in an `objectModifier`:

```javascript
const mesh = new SplatMesh({ fileBytes, fileName });
mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
  const { index } = dyno.splitGsplat(gsplat).outputs;
  const coord = dyno.splatTexCoord(index);
  const a = dyno.texelFetch(samplerA, coord); // (vx, vy, vz, t0)
  const b = dyno.texelFetch(samplerB, coord); // (ln sigma, ...)
  // ... move by v * (t - t0), multiply alpha by the Gaussian, drop splats below a minimum alpha
});
// every frame
uTime.value = time;
mesh.updateVersion();
```

See [Dyno overview](dyno-overview.md) for how modifiers work. The full code is in `examples/4dgs/index.html`.

## The 4D compressed PLY format

The files are [SuperSplat / PlayCanvas compressed PLY](https://blog.playcanvas.com/compressing-gaussian-splats/#compressed-ply-format) files: Gaussians are stored in chunks of 256, and `packed_position`, `packed_rotation`, `packed_scale` and `packed_color` are quantized between per-chunk minimum and maximum values. Spark reads them as it reads any compressed PLY. The 4D format adds the following.

Note: this layout was derived from sample files and verified by decoding them. It is not an official specification.

| Element | Property | Meaning |
| --- | --- | --- |
| `chunk` | `min_motion_x/y/z`, `max_motion_x/y/z` | range of the velocity in this chunk |
| `chunk` | `min_time`, `max_time` | range of the time center in this chunk |
| `chunk` | `min_time_scale`, `max_time_scale` | range of ln(sigma) in this chunk |
| `vertex` | `packed_motion` | velocity: 11, 10 and 11 bits for x, y, z (high to low), between the chunk's min and max |
| `vertex` | `packed_time` | bits 31-21: ln(sigma), 11 bits; bits 20-11: time center, 10 bits; the low 11 bits are unused |

Each value is `min + (bits / maxBits) * (max - min)`. Time is in seconds, velocity in units per second, and sigma is `exp(value)` seconds.

A clip is a series of files (`00.c.ply`, `01.c.ply`, ...). Every file covers a fixed time window of `seglen` seconds and file `k` starts at `k * seglen`. The times inside a file are relative to the start of its window, so a Gaussian that lives longer than the window (a static background, for example) is stored in several files. The two optional header lines `comment fourd_seglen <seconds>` and `comment fourd_fps <fps>` are written by the converter script below, and the example uses `fourd_seglen` when it is present.

## Playing a clip

Open `examples/4dgs` and select the files, or pass them in the URL:

| Option | Meaning |
| --- | --- |
| `?url=clip.c.ply` | a single file |
| `?base=./clip/&count=10` | `./clip/00.c.ply` to `./clip/09.c.ply` |
| `?seglen=5` | seconds per file, when the files do not say |
| `?quality=low` | quality of the sample clip (`low` or `medium`); the default is `medium`, or `low` on a slow connection |
| `?budget=400` | draw at most about 400 thousand splats (see below) |

Without options the page loads the sample clip listed in `examples/assets.json` (`cat-medium-00.c.ply`, `cat-low-00.c.ply` and so on). In a headset it starts in AR when the device supports it and in VR otherwise. The clip appears in front of you and you can walk around it; point at the floor and press the trigger (or pinch, or tap the screen) to place it somewhere else. `?xroffset=0,0,-1.5` sets where the clip first appears, in meters relative to you.

## Streaming and performance

- The playback clock only runs while the data for the current time is loaded, and the page shows a message while it waits. The next file is downloaded when the current one is ready, and only these two files are kept in memory.
- Downloaded files are kept in the browser's Cache Storage, failed downloads are retried.
- All files use the same shader, so it is compiled once.
- If a file downloads slower than it plays, the page switches from `medium` to `low` quality by itself. Choosing a quality in the GUI turns this off.
- `?budget=N` (or the GUI) raises the minimum opacity automatically until at most about `N` thousand splats are drawn. In our tests on a Quest 3S, about 400 thousand drawn splats gave around 70 fps, while about 600 thousand gave 40-45 fps. A lower budget removes the weakest splats first and makes the image thinner.

### File size

A file takes 24 bytes per Gaussian (six 32-bit words), so the size is set by the number of Gaussians: 1.3 million Gaussians are about 31 MB and 0.83 million about 19 MB. Some measurements:

| | Size |
| --- | --- |
| `.ftgs.ply` of FreeTimeGsVanilla, 2 million Gaussians, 20 frames | 511 MB |
| the same as 4D compressed PLY | 44.3 MB |
| `.ftgs.ply`, 500 thousand Gaussians, 20 frames | 127 MB |
| the same as 4D compressed PLY | 7.28 MB |

The compressed file drops all spherical harmonic bands above the first, so colors no longer depend on the view direction. On the sample clips, gzip saves only about 1%, because the data is already quantized. Storing the bytes of every field in separate planes before compressing saves about 10%. Leaving out Gaussians that never reach a low opacity in their window saves roughly 6-15% at an opacity of 0.05 (`--min-opacity` in the converter). Storing the bytes in separate planes is not implemented. Much larger savings need a different representation that reuses the same Gaussians for longer, which is a matter of how the clip is trained.

## Creating your own 4D splats

The open-source trainer [FreeTimeGsVanilla](https://github.com/OpsiClear-4DGS/FreeTimeGsVanilla) trains the representation above from multi-view video and exports a single `.ftgs.ply` file. The script [`scripts/ftgs_to_cply.py`](https://raw.githubusercontent.com/sparkjsdev/spark/main/scripts/ftgs_to_cply.py) converts that file to the format Spark plays. In short:

1. **Input.** Synchronized multi-view images for every frame, the camera poses and intrinsics in COLMAP format, and a triangulated point cloud per frame (`points3d_frameXXXXXX.npy` and `colors_frameXXXXXX.npy`). Follow the README of FreeTimeGsVanilla for the exact layout. Renders from 3D software work as well, as long as the poses are exported correctly (see the test scene below).
2. **Combine the keyframes.** This estimates a velocity for every point by matching points of consecutive keyframes and writes an `.npz` file. In FreeTimeGsVanilla the end frame is inclusive here, and exclusive in the trainer.

    ```bash
    python src/combine_frames_fast_keyframes.py \
      --input-dir ./data/points --output-path ./data/keyframes.npz \
      --frame-start 0 --frame-end 19 --keyframe-step 1 --sample-ratio 0.25
    ```

    The number of Gaussians stayed equal to the number of points in this file during training in our runs, so `--sample-ratio` is the way to make the result smaller.
3. **Train.**

    ```bash
    python src/simple_trainer_freetime_4d_pure_relocation.py default_keyframe \
      --data-dir ./data --init-npz-path ./data/keyframes.npz --result-dir ./results/scene \
      --start-frame 0 --end-frame 20 --max-steps 30000
    ```

4. **Export** the checkpoint to a single file (check the checkpoint name in `ckpts`):

    ```bash
    python src/export_ftgs_ply.py --ckpt ./results/scene/ckpts/ckpt_29999.pt --output ./results/scene/scene.ftgs.ply
    ```

5. **Convert** it with `scripts/ftgs_to_cply.py`. The frame rate gives the real length of the clip. For a short clip:

    ```bash
    python scripts/ftgs_to_cply.py scene.ftgs.ply 00.c.ply --fps 30 --zup --ground --fit-height 1.7
    ```

    For a long clip, split it into files of 5 seconds in a folder:

    ```bash
    python scripts/ftgs_to_cply.py scene.ftgs.ply ./clip --fps 30 --chunk-seconds 5 --zup --ground
    ```

    If the clip is not upright, try it without `--zup`, or add `--rot-x 90` (or `--rot-y`, `--rot-z`).

6. **Play** it: serve the folder and open `examples/4dgs/?base=./clip/&count=N`.

The trainer needs an NVIDIA GPU and the CUDA toolkit. On Windows it runs in WSL2. A GeForce RTX 3080 was enough for clips of 20 frames and 500 thousand Gaussians. The trainer is slow for long clips: the training time grows with the number of frames.

### Test scene

To try the whole chain without your own footage, [download the test scene](https://raw.githubusercontent.com/kannotlogin/spark-assets/main/4dgs-test-scene.zip) (a ZIP file). It contains a Blender file, a model as a `.glb`, and a Blender script that places 42 cameras on a dome, renders every frame and writes the camera poses, per-frame point clouds and folder layout that FreeTimeGsVanilla expects.

### Options of the converter

| Option | Meaning |
| --- | --- |
| `--fps` | frame rate of the source video, default 30 |
| `--frames`, `--duration` | clip length, if the `.ftgs.ply` header does not give the number of frames |
| `--chunk-seconds N` | write files that each cover `N` seconds into the output folder |
| `--zup` | the trainer space is Z up (Blender, COLMAP): rotate to Y up |
| `--rot-x/y/z` | extra rotation in degrees if the clip is not upright |
| `--fit-height`, `--ground` | scale to a height in meters, and put the bottom on `y = 0` |
| `--min-opacity` | drop Gaussians that never reach this opacity in a file's window; 0.02-0.05 makes smaller files |
| `--max-splats` | keep at most this many Gaussians per file |
| `--verify` | decode every written file the way Spark does and compare it with the input |
| `--self-test` | run a built-in check without any input file |

The converter needs `numpy` only. It reads the documented layout of `.ftgs.ply` (version 1) and does not contain code of FreeTimeGsVanilla, which is licensed under the AGPL-3.0.

## Limitations

- Only the first spherical harmonic band is kept, so there are no view-dependent colors.
- The format is derived from sample files and may differ from what other tools write.
- A clip is a series of files with the same length, the time of file `k` is `k * seglen`.
- Long-lived Gaussians are repeated in every file they appear in.
- Splats are sorted on the CPU by Spark as for any other splat mesh. A clip with several million visible splats is too heavy for a headset, use `?budget` or a smaller clip.

## Credits

- **FreeTimeGS: Free Gaussian Primitives at Anytime Anywhere for Dynamic Scene Reconstruction**, Yifan Wang, Peishan Yang, Zhen Xu, Jiaming Sun, Zhanhua Zhang, Yong Chen, Hujun Bao, Sida Peng, Xiaowei Zhou, CVPR 2025 ([project page](https://zju3dv.github.io/freetimegs/), [arXiv:2506.05348](https://arxiv.org/abs/2506.05348)): the representation, the motion model and the temporal opacity.
- **[FreeTimeGsVanilla](https://github.com/OpsiClear-4DGS/FreeTimeGsVanilla)** by OpsiClear (AGPL-3.0), built on [gsplat](https://github.com/nerfstudio-project/gsplat): the open-source trainer and the documented `.ftgs.ply` layout.
- **[PlayCanvas / SuperSplat](https://blog.playcanvas.com/compressing-gaussian-splats/#compressed-ply-format)**: the compressed PLY format that the 4D files extend.
- **[4DV.ai](https://t.4dv.ai/viewer/cat)**: the sample clip (the cat).

```bibtex
@InProceedings{Wang_2025_CVPR,
    author    = {Wang, Yifan and Yang, Peishan and Xu, Zhen and Sun, Jiaming and Zhang, Zhanhua and Chen, Yong and Bao, Hujun and Peng, Sida and Zhou, Xiaowei},
    title     = {FreeTimeGS: Free Gaussian Primitives at Anytime Anywhere for Dynamic Scene Reconstruction},
    booktitle = {Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)},
    month     = {June},
    year      = {2025},
    pages     = {21750-21760}
}
```