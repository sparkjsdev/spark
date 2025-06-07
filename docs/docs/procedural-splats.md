# Procedural Splats

Spark makes it easy to create Gaussian splat collections procedurally, and includes some splat constructors that are useful for common tasks like creating a grid or text made of splats. The example "Procedural Splats" puts some of these to use in a scene.

## Adding splats to a collection

To create a `PackedSplats` with custom, procedurally-derived splats use the methods `pushSplat` or `setSplat`:
```javascript
const splats = new PackedSplats();
const center = new THREE.Vector3(0, 0, 0);
const scales = new THREE.Vector3(0.1, 0.1, 0.1);
const quaternion = new THREE.Quaternion();
const opacity = 1.0;
const color = new THREE.Color()
splats.pushSplat(center, scales, quaternion, opacity, color);
...
```

Note that calling `.pushSplat` and `.setSplat` will automatically resize the `PackedSplats` array to fit the splat. Additionally, the center, scales, etc parameters are encoded into 16 bytes, and the original objects passed in (such as `center: THREE.Vector3`) are no longer used. Re-using these objects for all the splats is a good idea.

Alternatively, you can use the `construct` initializer callback:
```javascript
const splats = new PackedSplats({
  construct: (splats) => {
    ...
    for (let i = 0; i < NUM_SPLATS; ++i) {
      // Compute splat #i
      ...
      splats.pushSplat(center, scales, quaternion, opacity, color);
    }
  },
});
```

Once you've created your `PackedSplats`, render it to the scene via a `SplatMesh`:
```javascript
const mesh = new SplatMesh({ packedSplats: splats });
scene.add(mesh);
```

Alternatively, you can create the `SplatMesh` and its splats in the initializer, which internally passes your constructor to its contained `PackedSplats`:
```javascript
const mesh = new SplatMesh({
  constructSplats: (splats) => {
    for (let i = 0; i < NUM_SPLATS; ++i) {
      // Compute splat #i
      ...
      splats.pushSplat(center, scales, quaternion, opacity, color);
    }
  },
});
scene.add(mesh);
```

## Grid

```javascript
import { constructGrid } from "@sparkjs-dev/spark";

const grid = new SplatMesh({
  constructSplats: (splats) => constructGrid({
    splats,
    extents: new THREE.Box3(
      new THREE.Vector3(-10, -10, -10),
      new THREE.Vector3(10, 10, 10),
    ),
  }),
});
scene.add(grid);
```

### Required parameters

| Parameter | Description |
|-----------|-------------|
| `splats` | PackedSplats object to add splats to |
| `extents` | min and max box extents of the grid |

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `stepSize` | `1` | step size along each grid axis |
| `pointRadius` | `0.01` | spherical radius of each splat |
| `pointShadowScale` | `2.0` | relative size of the "shadow copy" of each splat placed behind it |
| `opacity` | `1.0` | splat opacity |
| `color` | RGB-modulated grid | splat color (THREE.Color) or function to set color for position: ((THREE.Color, THREE.Vector3) => void) |


## XYZ axis

```javascript
import { constructAxes } from "@sparkjs-dev/spark";

const axes = new SplatMesh({
  constructSplats: (splats) => constructAxes({ splats }),
});
axes.position.set(0, 0, -1);
scene.add(axes);
```

### Required parameters

| Parameter | Description |
|-----------|-------------|
| `splats` | PackedSplats object to add splats to |

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `scale` | `0.25` | scale (splat scale along axis) |
| `axisRadius` | `0.0075` | radius of the axes (splat scale orthogonal to axis) |
| `axisShadowScale` | `2.0` | relative size of the "shadow copy" of each splat placed behind it |
| `origins` | `[new THREE.Vector3()]` | origins of the axes (default single axis at origin) |


## Splat sphere

```javascript
import { constructSpherePoints } from "@sparkjs-dev/spark";

const sphere = new SplatMesh({
  constructSplats: (splats) => constructSpherePoints({
    splats,
    maxDepth: 4,
  }),
});
scene.add(sphere);
```

### Required parameters

| Parameter | Description |
|-----------|-------------|
| `splats` | PackedSplats object to add splats to |

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `origin` | `new THREE.Vector3()` | center of the sphere (default: origin) |
| `radius` | `1.0` | radius of the sphere |
| `maxDepth` | `3` | maximum depth of recursion for subdividing the sphere. Warning: splat count grows exponentially with depth |
| `filter` | `null` | filter function to apply to each point, for example to select points in a certain direction or other function ((THREE.Vector3) => boolean) |
| `pointRadius` | `0.02` | radius of each oriented splat |
| `pointThickness` | `0.001` | flatness of each oriented splat |
| `color` | `new THREE.Color(1, 1, 1)` | color of each splat (THREE.Color) or function to set color for point: ((THREE.Color, THREE.Vector3) => void) |


## Rasterizing Text

```typescript
const splats = textSplats({
  text: string;
  font?: string;
  fontSize?: number;
  color?: THREE.Color;
  rgb?: THREE.Color;
  dotRadius?: number;
  textAlign?: "left" | "center" | "right" | "start" | "end";
  lineHeight?: number;
});
scene.add(splats);
```

### Required parameters

| Parameter | Description |
|-----------|-------------|
| `text` | text string to display |

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `font` | `"Arial"` | browser font to render text with |
| `fontSize` | `32` | font size in pixels/splats |
| `color` | `new THREE.Color(1, 1, 1)` | SplatMesh.recolor tint assuming white splats |
| `rgb` | `new THREE.Color(1, 1, 1)` | Individual splat color |
| `dotRadius` | `0.8` | splat radius (0.8 covers 1-unit spacing well) |
| `textAlign` | `"start"` | text alignment: "left", "center", "right", "start", "end" |
| `lineHeight` | `1.0` | line spacing multiplier, lines delimited by "\n" |

## Turning images into splats

```typescript
const image = imageSplats({
  url: string;
  dotRadius?: number;
  subXY?: number;
  forEachSplat?: (
    width: number,
    height: number,
    index: number,
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) => number | null;
});
scene.add(image);
```

### Required parameters

| Parameter | Description |
|-----------|-------------|
| `url` | URL of the image to convert to splats (example: `url: "./image.png"`) |

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dotRadius` | `0.8` | Radius of each splat, default covers 1-unit spacing well |
| `subXY` | `1` | Subsampling factor for the image. Higher values reduce resolution, for example 2 will halve the width and height by averaging |
| `forEachSplat` | `undefined` | Optional callback function to modify each splat before it's added. Return null to skip adding the splat, or a number to set the opacity and add the splat with parameter values in the objects center, rgba etc. were passed into the forEachSplat callback. Ending the callback in `return opacity;` will retain the original opacity. |

### Example

```javascript
// Load RGBA image from image.png, subsample it 2x
// horizontally and vertically, and create splats for
// the resulting pixels that have at least 10% opacity.
const image = imageSplats({
  url: "./image.png",
  subXY: 2,
  forEachSplat: (width, height, index, center, scales, quaternion, opacity, color) => {
    // Only keep splats with opacity 10% or higher
    return (opacity >= 0.1) ? opacity : null;
  },
});
scene.add(image);
```

## Particle Effects

Some of the building blocks are meant to serve as "code inspiration", showing how a particle effect animation can be achieved using a "stateless" `dyno` computation graph that uses only the splat `index` input to produce pseudo-random numbers that drive various randomized particle effects.

Note that splat sorting takes a little bit of time and can "lag behind" the splat updates each frame, so it's important that there is a reasonably stable correspondence between each frame's splat output for the same `index`.

### `generators.staticBox(...options)`

In `staticBox` you provide a 3D box to render random "static" splats within. The AABB is sliced up into a 3D grid of cells, and random X/Y/Z points within those cells are sampled each frame, retaining consistency in splat position between successive frames.

### `generators.snowBox(...options)`

Similarly, `snowBox` produces splat trajectories that move in a deterministic fashion over time, with high similarity between adjacent frames. See "VFX - Particle Simulation" for an example that creates a `snowBox`.

A snowBox instance has a collection of properties that can be tuned to achieve different particle effects. DEFAULT_SNOW and DEFAULT_RAIN are example parameter sets that look a lot like snow and rain, and can be used as a starting point for further tweaking: `const mySnow = { ...DEFAULT_SNOW, density: 500 };`

```typescript
const snowControls = generators.snowBox({
  box,
  minY,
  numSplats,
  density,
  anisoScale,
  minScale,
  maxScale,
  fallDirection,
  fallVelocity,
  wanderScale,
  wanderVariance,
  color1,
  color2,
  opacity,
  onFrame,
});
scene.add(snowControls.snow);
```

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| `box` | `new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))` | min and max box extents of the snowBox |
| `minY` | `Number.NEGATIVE_INFINITY` | minimum y-coordinate to clamp particle position, which can be used to fake hitting a ground plane and lingering there for a bit |
| `numSplats` | calculated from box and density | number of splats to generate |
| `density` | `100` | density of splats per unit volume |
| `anisoScale` | `new THREE.Vector3(1, 1, 1)` | The xyz anisotropic scale of the splat, which can be used for example to elongate rain particles |
| `minScale` | `0.001` | Minimum splat particle scale |
| `maxScale` | `0.005` | Maximum splat particle scale |
| `fallDirection` | `new THREE.Vector3(0, -1, 0)` | The average direction of fall |
| `fallVelocity` | `0.02` | The average speed of the fall (multiplied with fallDirection) |
| `wanderScale` | `0.01` | The world scale of wandering overlay motion |
| `wanderVariance` | `2` | Controls how uniformly the particles wander in sync, more variance means more randomness in the motion |
| `color1` | `new THREE.Color(1, 1, 1)` | Color 1 of the two colors interpolated between |
| `color2` | `new THREE.Color(0.5, 0.5, 1)` | Color 2 of the two colors interpolated between |
| `opacity` | `1` | The base opacity of the splats |
| `onFrame` | `undefined` | Optional callback function to call each frame |
