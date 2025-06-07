# Controls

A program using `Spark` can use any camera control scheme that is compatible with THREE.js and will typically manipulate a `THREE.Camera` object's transform. `Spark` also ships with simple, intuitive controls for navigating 3D space that use the keyboard + mouse, game pad, or mobile multi-touch. To add these controls, you can create a `SparkControls` instance:

```typescript
const controls = new SparkControls({
  canvas: HTMLCanvasElement;
});

renderer.setAnimationLoop((time) => {
  renderer.render(scene, camera);
  controls.update(camera);
});
```

`SparkControls` instantiates two classes `FpsMovement` and `PointerControls` that it updates internally. You can also instantiate and use these two classes separately:

## `class FpsMovement`

`FpsMovement` implements controls that will be familiar to anyone who plays First Person Shooters using keyboard + mouse or a gamepad. Creating a `FpsMovement` instance provides many parameters:

```typescript
const fpsMovement = new FpsMovement({
  moveSpeed?: number;
  rollSpeed?: number;
  stickThreshold?: number;
  rotateSpeed?: number;
  keycodeMoveMapping?: { [key: string]: THREE.Vector3 };
  keycodeRotateMapping?: { [key: string]: THREE.Vector3 };
  gamepadMapping?: {
    [button: number]: "shift" | "ctrl" | "rollLeft" | "rollRight";
  };
  capsMultiplier?: number;
  shiftMultiplier?: number;
  ctrlMultiplier?: number;
  xr?: THREE.WebXRManager;
});
```
When gamepads are connected, `FpsMovement` will always use gamepad index 0 for twin-stick movement and rotation.

If `xr` is passed in, the WebXR controllers can be used as a split gamepad to control movement and rotation. (tested on Quest 3)

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `moveSpeed` | `1.0` | Base movement speed |
| `rollSpeed` | `2.0` | Speed of roll rotation |
| `stickThreshold` | `0.1` | Deadzone for gamepad analog sticks |
| `rotateSpeed` | `2.0` | Speed of rotation when using gamepad or keys |
| `keycodeMoveMapping` | `{...WASD_KEYCODE_MOVE, ...ARROW_KEYCODE_MOVE}` | Maps keyboard keys to movement directions |
| `keycodeRotateMapping` | `{...QE_KEYCODE_ROTATE, ...ARROW_KEYCODE_ROTATE}` | Maps keyboard keys to rotation directions |
| `gamepadMapping` | `{4: "rollLeft", 5: "rollRight", 6: "ctrl", 7: "shift"}` | Maps gamepad buttons to actions |
| `capsMultiplier` | `10.0` | Speed multiplier when Caps Lock is active |
| `shiftMultiplier` | `5.0` | Speed multiplier when Shift is held |
| `ctrlMultiplier` | `0.2` | Speed multiplier when Ctrl is held |
| `xr` | `undefined` | Optional WebXR manager for XR controller stick support

### `update(deltaTime, control)`

Call this method in your render loop with `control` set to the object to control (`THREE.Camera` or a `THREE.Object3D` that contains it), with `deltaTime` in seconds since the last update.
The update method handles:

- Processing keyboard input for movement and rotation
- Processing gamepad input for movement and rotation
- Applying speed multipliers based on modifier keys and gamepad buttons
- Applying movement and rotation to the controlled object


## `class PointerControls`

`PointerControls` implements pointer/mouse/touch controls on the canvas, for both desktop and mobile web applications. Creating a new control:
```typescript
const pointerControls = new PointerControls({
  canvas: HTMLCanvasElement;
  rotateSpeed?: number;
  slideSpeed?: number;
  scrollSpeed?: number;
  reverseRotate?: boolean;
  reverseSlide?: boolean;
  reverseSwipe?: boolean;
  reverseScroll?: boolean;
  moveInertia?: number;
  rotateInertia?: number;
  doublePress?: ({
    position,
    intervalMs,
  }: { position: THREE.Vector2; intervalMs: number }) => void;
})
```

### Require parameters

| Parameter | Description |
|-----------|-------------|
| `canvas` | The HTML canvas element to attach pointer events to |

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rotateSpeed` | `0.002` | Speed of rotation when dragging |
| `slideSpeed` | `0.006` | Speed of sliding when dragging with right button or two fingers |
| `scrollSpeed` | `0.0015` | Speed of movement when using mouse wheel |
| `reverseRotate` | `false` | Reverse the direction of rotation |
| `reverseSlide` | `false` | Reverse the direction of sliding |
| `reverseSwipe` | `false` | Reverse the direction of swipe gestures |
| `reverseScroll` | `false` | Reverse the direction of scroll wheel movement |
| `moveInertia` | `0.15` | Inertia factor for movement |
| `rotateInertia` | `0.15` | Inertia factor for rotation |
| `doublePress` | `undefined` | Callback function for double-press/double-tap events |

### `update(deltaTime, control)`

Call this method in your render loop with `control` set to the object to control (`THREE.Camera` or a `THREE.Object3D` that contains it), with `deltaTime` in seconds since the last update.

The update method handles:

- Processing pointer/mouse/touch movements for rotation
- Handling dual-press touch gestures for camera movement
- Applying scroll wheel input
- Calculating and applying inertia for smooth motion
- Updating the camera position and orientation


## Adding a simple GUI to configure controls

Add `lil-gui` to your package (`npm add lil-gui`) to provide a simple configurable GUI.

```typescript
import GUI from "lil-gui";

const gui = new GUI({ title: "Settings + Controls" }).close();
const controlOptions = {
  reversePointerFps: false,
  reversePointerPan: false,
};
gui
  .add(controlOptions, "reversePointerFps")
  .name("Reverse Pointer FPS")
  .onChange((value: boolean) => {
    pointerControls.reverseRotate = value;
    pointerControls.reverseScroll = value;
  });
gui
  .add(controlOptions, "reversePointerPan")
  .name("Reverse Pointer Pan")
  .onChange((value: boolean) => {
    pointerControls.reverseSlide = value;
    pointerControls.reverseSwipe = value;
  });
```
