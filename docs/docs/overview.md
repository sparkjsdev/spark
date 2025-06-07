*Spark aims to expand what's possible with Gaussian Splatting and help 3D/4D creators bring their visions to life and share it with others.*

# Overview

3D Gaussian Splatting has emerged as a frontrunner in generative AI and 3D reconstruction. By representing 3D scenes and objects as collections of tiny oriented Gaussian-shaped blobs (aka "splats"), machine learning techniques can be used to create detailed, photorealistic 3D content that can be rendered in real-time. However, 3DGS is a relatively new technique that that can't be used in many traditional triangle-based 3D mesh rendering engines. Tools for creating, editing, and rendering 3DGS are in their infancy, mostly able to only work with a single, static 3DGS object at time.

The web's most popular 3D graphics library THREE.js, can't render 3DGS directly. Although libraries exist to render 3DGS on the web, they each come with different limitations and don't treat 3DGS objects as first-class citizens in the scene hierarchy. Limitations include: rendering only one 3DGS object at time, incorrect occlusion between 3DGS objects, inability to dynamically modify the objects, requiring WebGPU, or slow/laggy rendering. We believe 3DGS will play an important role in future 3D/4D content creation, and we built Spark to make it easy to incorporate 3DGS into online experiences.

## Spark

Spark is a dynamic 3DGS renderer built for THREE.js and WebGL2 that runs in any web browser (desktop, mobile, and WebXR). With a handful of lines of code, anyone using THREE.js can easily add 3DGS to their scenes (even by vibe coding!). By creating one or more `SplatMesh` objects and adding them to your scene, Spark will render these alongside traditional triangle-based meshes during your regular `render(scene, camera)` call. `SplatMesh` derives from `THREE.Object3D` and can be translated and rotated like any other object, placed arbitrarily in the scene hierarchy, and animated by adjusting the values each frame. A `SplatMesh` can be created from most splat file formats via the `url` parameter or by directly creating the splats one by one.

3DGS is still in its infancy, and we expect new techniques will be developed for recoloring/relighting, animation, transitions, and other creative or interactive effects. We designed Spark to be a programmable splat engine from the ground up, giving you unprecedented control over how individual splats are generated, animated, and rendered into the scene. Similar to shader graph systems in modern 3D graphics engines, Spark allows you to compose blocks of functions (called `Dyno`s) into computation graphs that can generate splats procedurally, modify them arbitrarily, or anything other computation you can imagine, and will be converted to GLSL to run on the GPU.

## Features
- Integrates with THREE.js rendering pipeline to fuse splat and mesh-based objects
- Portable: Works across almost all devices, targeting 98%+ WebGL2 support
- Renders fast even on low-powered mobile devices
- Render multiple splat objects together with correct sorting
- Most major splat file formats supported including .PLY (also compressed), .SPZ, .SPLAT, .KSPLAT
- Render multiple viewpoints simultaneously
- Fully dynamic: each splat can be transformed and edited for animation
- Real-time splat color editing, displacement, and skeletal animation
- Shader graph system to dynamically create/edit splats on the GPU
