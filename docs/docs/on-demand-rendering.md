# On-demand rendering

By default a Three.js app renders continuously with `renderer.setAnimationLoop()`, and Spark's asynchronous work (splat sorting, LoD selection, fetching and paging in chunks of a `paged` `SplatMesh`) simply rides along with each frame. If your scene is mostly static, or you want to save power on mobile, you can instead render only when something changed. This page explains what Spark needs from you to make that work, with a vanilla Three.js example and a React Three Fiber example.

## How Spark drives its own work

Spark does its work from inside `renderer.render()`: that is when it checks the camera, kicks off sorts and LoD updates in its workers, and pages in newly streamed chunks. Results come back asynchronously, and each one needs another render to become visible. In a continuous animation loop the next frame is always coming, so this is invisible. In an on-demand app there is no next frame unless someone asks for one, so Spark needs a way to ask.

That is what the `onDirty` option on `SparkRenderer` is for. Spark calls it whenever it has something new to show or needs another frame to make progress:

- A splat sort finished.
- A new LoD selection was computed.
- A `SplatMesh` finished loading.
- A streamed chunk of a `paged` `SplatMesh` landed and is waiting to be paged in.
- LoD work was requested while the LoD worker was still busy, so it needs to be retried.

Do **not** call `render()` on a timer to "poll" for progress; that defeats the purpose and can leave gaps where loading appears to stall. Pass `onDirty` and schedule a render whenever it fires. Note that `onDirty` may be called multiple times in a frame. Therefore, rather than re-rendering immediately in `onDirty` it's better to schedule a render on the next frame and keep a flag to track if it's already been scheduled, exemplified below.

## Vanilla Three.js

```javascript
let renderScheduled = false;
function requestRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderer.render(scene, camera);
  });
}

const spark = new SparkRenderer({ renderer, onDirty: requestRender });
scene.add(spark);

const splats = new SplatMesh({ url: "./my-splats-lod.rad", paged: true });
scene.add(splats);

// Render once to kick things off; from here on Spark asks for frames.
requestRender();
```

`requestRender()` coalesces multiple requests into a single frame, so it is safe to call it from anywhere, as often as you like.

Spark only notices your application's changes during a render, so your application must call `requestRender()` whenever it changes anything visible, including:

- The camera moves, rotates, or changes its projection (FOV, aspect, near/far).
- Any object, including a `SplatMesh`, is added to or removed from the scene, or its `position`, `rotation`, `scale`, or `visible` changes.
- A `SplatMesh` property changes, such as `opacity`, `recolor`, `edits`, or `skinning`.
- Materials, lights, or other non-splat Three.js objects change.
- The window or canvas is resized.

If you use one of the Three.js controls, hook its `change` event:

```javascript
controls.addEventListener("change", requestRender);
```

See `examples/on-demand/` for a complete example with a streamed `.rad` file and a frame counter showing how few frames are actually rendered.

## React Three Fiber

The same pattern maps directly onto React Three Fiber's on-demand mode: set `frameloop="demand"` on the `Canvas` and wire `onDirty` to R3F's `invalidate()`, which schedules exactly one frame and automatically coalesces multiple calls during the same frame. Add both objects to the scene with `<primitive>` so R3F manages their lifetime:

```jsx
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useEffect, useMemo } from "react";

function Splats({ url }) {
  const { gl, invalidate } = useThree();

  const spark = useMemo(
    () => new SparkRenderer({ renderer: gl, onDirty: invalidate }),
    [gl, invalidate],
  );
  const splats = useMemo(() => new SplatMesh({ url, paged: true }), [url]);

  useEffect(() => () => spark.dispose(), [spark]);
  useEffect(() => () => splats.dispose(), [splats]);

  return (
    <>
      <primitive object={spark} />
      <primitive object={splats} />
    </>
  );
}

export function App() {
  return (
    <Canvas frameloop="demand">
      <Splats url="./my-splats-lod.rad" />
      {/* drei controls call invalidate() on camera change in demand mode */}
      <OrbitControls />
    </Canvas>
  );
}
```

R3F renders once on mount, that render kicks off Spark's loading, sorting and LoD work, and each completed step calls `invalidate()` to request the next frame. As in the vanilla example, Spark only sees your application's changes during a render, so you must call `invalidate()` after any of the changes listed above: the camera moving, a `SplatMesh` or other object being added, removed, or transformed, `SplatMesh` properties like `opacity` or `recolor` changing, and so on.

Changes made through React props (for example `<primitive object={splats} position={[x, y, z]} />`) trigger this automatically, since R3F calls `invalidate()` when it applies props in demand mode. Changes made imperatively, such as setting `splats.position` or `splats.opacity` from an event handler or effect, do not; call `invalidate()` yourself afterwards. Drei's controls already call `invalidate()` on camera change.

## Related

- [Spark Level-of-Detail](lod-getting-started.md) for building `.rad` files and enabling `paged` streaming.
- [SparkRenderer](spark-renderer.md) for the full list of constructor options, including `onDirty`.
- [Performance tuning](performance.md) for other ways to reduce GPU and CPU load.
