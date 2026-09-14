# On-demand rendering

By default a Three.js app renders continuously with `renderer.setAnimationLoop()`, and Spark's asynchronous work (splat sorting, LoD selection, fetching and paging in chunks of a `paged` `SplatMesh`) simply rides along with each frame. If your scene is mostly static, or you want to save power on mobile, you can instead render only when something changed. This page explains what Spark needs from you to make that work, with a vanilla Three.js example and a React Three Fiber example.

## How Spark drives its own work

Spark does its work from inside `renderer.render()`: that is when it checks the camera, kicks off sorts and LoD updates in its workers, and pages in newly streamed chunks. Results come back asynchronously, and each one needs another render to become visible. In a continuous animation loop the next frame is always coming, so this is invisible. In an on-demand app there is no next frame unless someone asks for one, so Spark needs a way to ask.

That is what the `onDirty` option on `SparkRenderer` is for. Spark calls it (at most once per rendered frame) whenever it has something new to show or needs another frame to make progress:

- A splat sort finished.
- A new LoD selection was computed.
- A `SplatMesh` finished loading.
- A streamed chunk of a `paged` `SplatMesh` landed and is waiting to be paged in.
- LoD work was requested while the LoD worker was still busy, so it needs to be retried.

Do **not** call `render()` on a timer to "poll" for progress; that defeats the purpose and can leave gaps where loading appears to stall. Pass `onDirty` and render once whenever it fires.

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

Your application must also call `requestRender()` for its own changes (camera moves, objects added/removed/transformed, material changes), since Spark only notices those during a render. If you use one of the Three.js controls, hook its `change` event:

```javascript
controls.addEventListener("change", requestRender);
```

See `examples/on-demand/` for a complete example with a streamed `.rad` file and a frame counter showing how few frames are actually rendered.

## React Three Fiber

The same pattern maps directly onto React Three Fiber's on-demand mode: set `frameloop="demand"` on the `Canvas` and wire `onDirty` to R3F's `invalidate()`, which schedules exactly one frame. Add both objects to the scene with `<primitive>` so R3F manages their lifetime:

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

Nothing else is required: R3F renders once on mount, that render kicks off Spark's loading, sorting and LoD work, and each completed step calls `invalidate()` to request the next frame. Anything your own components change (props that move the camera or a `SplatMesh`, adding or removing meshes) should also call `invalidate()`, as usual in demand mode.

## Related

- [Spark Level-of-Detail](lod-getting-started.md) for building `.rad` files and enabling `paged` streaming.
- [SparkRenderer](spark-renderer.md) for the full list of constructor options, including `onDirty`.
- [Performance tuning](performance.md) for other ways to reduce GPU and CPU load.
