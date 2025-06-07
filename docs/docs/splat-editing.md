# Splat Editing

Spark provides the ability to apply "edits" to splats as part of the standard `SplatMesh` pipeline. These edits take the form of a sequence of operations, applied one at a time to the set of splats in its `packedSplats`. Each operation evaluates a 7-dimensional field (RGBA and XYZ displacement) at each splat's center point in space that derives from 1 or more Signed Distance Field shapes (such as spheres, boxes, planes, etc.), blended together and across inside-outside boundaries.

The result is a an RGBA,XYZ value for each splat, which combined with SplatEditRgbaBlendMode.MULTIPLY/SET_RGB/ADD_RGBA can be used to create special effects. For example, simulating simple lighting can be done with MULTIPLY or ADD_RGBA to light up or adjust the color in regions of space, using spheres for point light sources or infinite cone for a spotlight. Using MULTIPLY with opacity=0 can be used to delete splats from a region of space. The splats can also be displaced in space using the XYZ values, and adjusted each frame to create smooth deformations in space.

## Creating a splat edit operation

A `SplatEdit` operation can be assigned to a particular `SplatMesh` through its `.edits[]` property or by adding the `SplatEdit` as a child of the `SplatMesh` in the scene hierarchy. If the `SplatEdit` has no `SplatMesh` ancestor, its edits will apply globally to all `SplatMesh`es whose `editable` property is set to the default `true`.

```typescript
const edit = new SplatEdit({
  name?: string;
  rgbaBlendMode?: SplatEditRgbaBlendMode;
  sdfSmooth?: number;
  softEdge?: number;
  invert?: boolean;
  sdfs?: SplatEditSdf[];
});
scene.add(edit);
```

### Optional parameters

| Parameter       | Default                                  | Description                                                                                                  |
|-----------------|------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| `name`          | `undefined` (auto‐generated to `Edit <n>`) | Name of this edit operation. If you omit it, a default `"Edit 1"`, `"Edit 2"`, … is assigned.              |
| `rgbaBlendMode` | `SplatEditRgbaBlendMode.MULTIPLY`        | How the SDF’s RGBA modifies each splat’s RGBA: multiply, overwrite RGB, or add RGBA.                         |
| `sdfSmooth`     | `0.0`                                    | Smoothing (in world‐space units) for blending between multiple SDF shapes at their boundaries.              |
| `softEdge`      | `0.0`                                    | Soft‐edge falloff radius (in world‐space units) around each SDF shape’s surface.                             |
| `invert`        | `false`                                  | Invert the SDF evaluation (inside/outside swap).                                                             |
| `sdfs`          | `null`                                   | Explicit array of `SplatEditSdf` objects to include. If `null`, any child `SplatEditSdf` instances are used. |

### RGBA blend modes

When creating a `SplatEdit` you can specify a `rgbaBlendMode?: SplatEditRgbaBlendMode` value from the enum to choose between 3 blend modes:

| Blend Mode                                | Description                                                                                                          |
|-------------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| `MULTIPLY`        | The RGBA of the splat is multiplied component-wise by the SDF’s RGBA value at that point in space. (default)                   |
| `SET_RGB`         | Ignore the Alpha value in the SDF, but set the splat’s RGB to equal the SDF’s RGB value at that point.               |
| `ADD_RGBA`        | Add the SDF’s RGBA value at that point to the RGBA value of the splat. This can produce hyper-saturated results, but is useful to easily “light up” areas. Note that having non-zero opacity is often not what you want because low-opacity splats will be made more opaque.|

## Adding an SDF RGBA-XYZ shape to the edit operation

```typescript
const shape1 = new SplatEditSdf({
  type?: SplatEditSdfType;
  invert?: boolean;
  opacity?: number;
  color?: THREE.Color;
  displace?: THREE.Vector3;
  radius?: number;
});
edit.add(shape1);
```

### Optional parameters

| Parameter   | Default                            | Description                                                                                                                        |
|-------------|------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| `type`      | `SPHERE`          | The SDF shape type: `ALL`, `PLANE`, `SPHERE`, `BOX`, `ELLIPSOID`, `CYLINDER`, `CAPSULE`, or `INFINITE_CONE`.                        |
| `invert`    | `false`                            | Invert the SDF evaluation, swapping inside and outside regions.                                                                    |
| `opacity`   | `1.0`                              | Opacity / "alpha" value used differently by blending modes |
| `color`     | `Color(1, 1, 1)`   | RGB color applied within the shape.                                                                                                |
| `displace`  | `Vector3(0, 0, 0)` | XYZ displacement applied to splat positions inside the shape.                                                                      |
| `radius`    | `0.0`                              | Shape-specific size parameter: sphere radius, box corner rounding, cylinder/capsule radius, or for the infinite cone the angle factor (opening half-angle = π/4 × `radius`). |

### SDF Shapes

The following SDF shapes are available in the `SplatEditSdfType` enum:

| SDF Type | Description | SDF Parameters |
|----------|-------------|------------|
| `ALL`       | Affects all points in space                                | None |
| `PLANE`     | Infinite plane                                            | position, rotation |
| `SPHERE`    | Sphere                                                    | position, radius |
| `BOX`       | Box (with optional corner rounding)                       | position, rotation, sizes, radius |
| `ELLIPSOID` | Ellipsoid                                                 | position, rotation, sizes |
| `CYLINDER`  | Cylinder                                                  | position, rotation, size_y |
| `CAPSULE`   | Capsule                                                   | position, rotation, size_y |
| `INFINITE_CONE` | Infinite cone | position, rotation, radius=angle |

## Adding multiple SDF RGBA-XYZ shapes to the edit operation

RGBA-XYZ values are computed by blending together values from all SDF shapes using the exponential "softmax" function, which is commutative (so blending order within a `SplatEdit` operation doesn't matter). The parameter `SplatEdit.sdfSmooth` controls the blending scale *between* SDF shapes, while `SplatEdit.softEdge` controls the scale of soft inside-outside shape boundaries. Their default values start at `0.0` and should be increased to soften the edges.

Note that XYZ displacement values are blended in the same way as RGBA, with a resulting displacement field that can be quite complex but "softly" blends between shapes. These RGBA-XYZ edits, along with time-based and overlapping fields can create many interesting animations and special effects, such as rippling leaves in the wind, an angry fire, or a looping water effect. Simply update the `SplatEdit` and `SplatEditSdf` objects and the operations will be applied immediately to the splats in the scene.
