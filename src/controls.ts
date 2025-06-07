import * as THREE from "three";

// Spark controls for keyboard + mouse, game pad, or mobile multi-touch

const DEFAULT_MOVEMENT_SPEED = 1.0;
const DEFAULT_ROLL_SPEED = 2.0;
const DEFAULT_ROTATE_SPEED = 0.002;
const DEFAULT_SLIDE_SPEED = 0.006;
const DEFAULT_SCROLL_SPEED = 0.0015;
const DEFAULT_ROLL_SPRING = 0.0;
const DEFAULT_ROTATE_INERTIA = 0.15;
const DEFAULT_MOVE_INERTIA = 0.15;
const DEFAULT_STICK_THRESHOLD = 0.1;
const DEFAULT_FPS_ROTATE_SPEED = 2.0;

// Time limit for double-finger press (pinch etc)
const DUAL_PRESS_MS = 200;
// Time limit for double-click/double-tap
const DOUBLE_PRESS_LIMIT_MS = 400;
// Distance limit for double-click
const DOUBLE_PRESS_DISTANCE = 50;

// Standard WASD movement keys with R+F for up/down
const WASD_KEYCODE_MOVE = {
  KeyW: new THREE.Vector3(0, 0, -1),
  KeyS: new THREE.Vector3(0, 0, 1),
  KeyA: new THREE.Vector3(-1, 0, 0),
  KeyD: new THREE.Vector3(1, 0, 0),
  KeyR: new THREE.Vector3(0, 1, 0),
  KeyF: new THREE.Vector3(0, -1, 0),
};

// Arrow key movement with PageUp/PageDown
const ARROW_KEYCODE_MOVE = {
  ArrowUp: new THREE.Vector3(0, 0, -1),
  ArrowDown: new THREE.Vector3(0, 0, 1),
  ArrowLeft: new THREE.Vector3(-1, 0, 0),
  ArrowRight: new THREE.Vector3(1, 0, 0),
  PageUp: new THREE.Vector3(0, 1, 0),
  PageDown: new THREE.Vector3(0, -1, 0),
};

// Rolling with Q/E
const QE_KEYCODE_ROTATE = {
  KeyQ: new THREE.Vector3(0, 0, 1),
  KeyE: new THREE.Vector3(0, 0, -1),
};

// Home/End/Insert/Delete for rotation
const ARROW_KEYCODE_ROTATE = {
  Home: new THREE.Vector3(0, -1, 0),
  End: new THREE.Vector3(0, 1, 0),
  Insert: new THREE.Vector3(-1, 0, 0),
  Delete: new THREE.Vector3(1, 0, 0),
};

// SparkControls provides simple, intuitive controls for navigating 3D space that
// use the keyboard + mouse, game pad, or mobile multi-touch. Internally it
// instantiates and updates a `FpsMovement` and `PointerControls` instance.

export class SparkControls {
  fpsMovement: FpsMovement;
  pointerControls: PointerControls;
  lastTime = 0;

  constructor({ canvas }: { canvas: HTMLCanvasElement }) {
    this.fpsMovement = new FpsMovement({});
    this.pointerControls = new PointerControls({ canvas });
  }

  update(control: THREE.Object3D) {
    const time = performance.now();
    const deltaTime = (time - (this.lastTime || time)) / 1000;
    this.lastTime = time;

    this.fpsMovement.update(deltaTime, control);
    this.pointerControls.update(deltaTime, control);
  }
}

// FpsMovement implements controls that will be familiar to anyone who plays
// First Person Shooters using keyboard + mouse or a gamepad. Creating a FpsMovement
// instance provides many parameters for configuring the controls.
//
// When gamepads are connected, FpsMovement will always use gamepad index 0
// for twin-stick movement and rotation.
//
// If xr is passed in, the WebXR controllers can be used as a split gamepad
// to control movement and rotation. (tested on Quest 3)

export class FpsMovement {
  moveSpeed: number;
  rollSpeed: number;
  stickThreshold: number;
  rotateSpeed: number;
  keycodeMoveMapping: { [key: string]: THREE.Vector3 };
  keycodeRotateMapping: { [key: string]: THREE.Vector3 };
  gamepadMapping: {
    [button: number]: "shift" | "ctrl" | "rollLeft" | "rollRight";
  };
  capsMultiplier: number;
  shiftMultiplier: number;
  ctrlMultiplier: number;
  xr?: THREE.WebXRManager;
  // Enable/disable controls updates
  enable = true;

  // Currently active event.key values
  keydown: { [key: string]: boolean };
  // Currently active event.code values
  keycode: { [key: string]: boolean };

  constructor({
    moveSpeed,
    rollSpeed,
    stickThreshold,
    rotateSpeed,
    keycodeMoveMapping,
    keycodeRotateMapping,
    gamepadMapping,
    capsMultiplier,
    shiftMultiplier,
    ctrlMultiplier,
    xr,
  }: {
    // Base movement speed (default DEFAULT_MOVEMENT_SPEED)
    moveSpeed?: number;
    // Base roll speed (default DEFAULT_ROLL_SPEED)
    rollSpeed?: number;
    // Stick threshold (default DEFAULT_STICK_THRESHOLD)
    stickThreshold?: number;
    // Speed of rotation when using gamepad or keys (default DEFAULT_FPS_ROTATE_SPEED)
    rotateSpeed?: number;
    // Maps keyboard keys to movement directions
    // (default {...WASD_KEYCODE_MOVE, ...ARROW_KEYCODE_MOVE})
    keycodeMoveMapping?: { [key: string]: THREE.Vector3 };
    // Maps keyboard keys to rotation directions
    // (default {...QE_KEYCODE_ROTATE, ...ARROW_KEYCODE_ROTATE})
    keycodeRotateMapping?: { [key: string]: THREE.Vector3 };
    // Maps gamepad buttons to control actions
    // (default {4: "rollLeft", 5: "rollRight", 6: "ctrl", 7: "shift"})
    gamepadMapping?: {
      [button: number]: "shift" | "ctrl" | "rollLeft" | "rollRight";
    };
    // Speed multiplier when Caps Lock is active (default: 10)
    capsMultiplier?: number;
    // Speed multiplier when Shift is active (default: 5)
    shiftMultiplier?: number;
    // Speed multiplier when Ctrl is active (default: 1/5)
    ctrlMultiplier?: number;
    // Optional WebXR manager for XR controller stick support
    xr?: THREE.WebXRManager;
  } = {}) {
    this.moveSpeed = moveSpeed ?? DEFAULT_MOVEMENT_SPEED;
    this.rollSpeed = rollSpeed ?? DEFAULT_ROLL_SPEED;
    this.stickThreshold = stickThreshold ?? DEFAULT_STICK_THRESHOLD;
    this.rotateSpeed = rotateSpeed ?? DEFAULT_FPS_ROTATE_SPEED;
    this.keycodeMoveMapping = keycodeMoveMapping ?? {
      ...WASD_KEYCODE_MOVE,
      ...ARROW_KEYCODE_MOVE,
    };
    this.keycodeRotateMapping = keycodeRotateMapping ?? {
      ...QE_KEYCODE_ROTATE,
      ...ARROW_KEYCODE_ROTATE,
    };
    this.gamepadMapping = gamepadMapping ?? {
      4: "rollLeft",
      5: "rollRight",
      6: "ctrl",
      7: "shift",
    };
    this.capsMultiplier = capsMultiplier ?? 10.0;
    this.shiftMultiplier = shiftMultiplier ?? 5.0;
    this.ctrlMultiplier = ctrlMultiplier ?? 1.0 / 5.0;

    this.xr = xr;

    this.keydown = {};
    this.keycode = {};

    document.addEventListener("keydown", (event) => {
      this.keydown[event.key] = true;
      this.keycode[event.code] = true;
    });
    document.addEventListener("keyup", (event) => {
      this.keydown[event.key] = false;
      this.keycode[event.code] = false;
    });
    window.addEventListener("blur", () => {
      this.keydown = {};
      this.keycode = {};
    });
  }

  // Call this method in your render loop with `control` set to the object to control
  // (`THREE.Camera` or a `THREE.Object3D` that contains it), with `deltaTime`
  // in seconds since the last update.
  update(deltaTime: number, control: THREE.Object3D) {
    if (!this.enable) {
      return;
    }

    // Update gamepad / XR controllers

    const sticks = [new THREE.Vector2(), new THREE.Vector2()];
    const gamepad = navigator.getGamepads()[0];
    if (gamepad) {
      sticks[0].set(gamepad.axes[0], gamepad.axes[1]);
      sticks[1].set(gamepad.axes[2], gamepad.axes[3]);
    }
    const gamepadButtons =
      gamepad?.buttons.map((button) => button.pressed) || [];

    const xrSources = Array.from(this.xr?.getSession()?.inputSources ?? []);
    for (const source of xrSources) {
      const gamepad = source.gamepad;
      if (gamepad) {
        switch (source.handedness) {
          case "none": {
            sticks[0].x += gamepad.axes[0];
            sticks[0].y += gamepad.axes[1];
            sticks[1].x += gamepad.axes[2];
            sticks[1].y += gamepad.axes[3];
            break;
          }
          case "left": {
            sticks[0].x += gamepad.axes[2];
            sticks[0].y += gamepad.axes[3];
            break;
          }
          case "right": {
            sticks[1].x += gamepad.axes[2];
            sticks[1].y += gamepad.axes[3];
            break;
          }
        }
      }
    }

    for (const stick of sticks) {
      stick.x = Math.abs(stick.x) >= this.stickThreshold ? stick.x : 0;
      stick.y = Math.abs(stick.y) >= this.stickThreshold ? stick.y : 0;
    }

    // Rotation

    const rotate = new THREE.Vector3(
      sticks[1].x,
      sticks[1].y,
      0,
    ).multiplyScalar(this.rotateSpeed);

    for (const [keycode, rot] of Object.entries(this.keycodeRotateMapping)) {
      if (this.keycode[keycode]) {
        rotate.add(rot);
      }
    }
    for (const button in this.gamepadMapping) {
      if (gamepadButtons[Number.parseInt(button)]) {
        switch (this.gamepadMapping[button]) {
          case "rollLeft":
            rotate.z += 1;
            break;
          case "rollRight":
            rotate.z -= 1;
            break;
        }
      }
    }

    rotate.multiply(
      new THREE.Vector3(this.rotateSpeed, this.rotateSpeed, this.rollSpeed),
    );

    if (rotate.manhattanLength() > 0.0) {
      rotate.multiplyScalar(deltaTime);
      const eulers = new THREE.Euler().setFromQuaternion(
        control.quaternion,
        "YXZ",
      );
      eulers.y -= rotate.x;
      eulers.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, eulers.x - rotate.y),
      );
      eulers.z = Math.max(-Math.PI, Math.min(Math.PI, eulers.z + rotate.z));
      control.quaternion.setFromEuler(eulers);
    }

    // Movement

    const moveVector = new THREE.Vector3(sticks[0].x, 0, sticks[0].y);

    for (const [keycode, move] of Object.entries(this.keycodeMoveMapping)) {
      if (this.keycode[keycode]) {
        moveVector.add(move);
      }
    }

    let speedMultiplier = 1.0;
    if (this.keydown.CapsLock) {
      speedMultiplier *= this.capsMultiplier;
    }
    if (this.keycode.ShiftLeft || this.keycode.ShiftRight) {
      speedMultiplier *= this.shiftMultiplier;
    }
    if (this.keycode.ControlLeft || this.keycode.ControlRight) {
      speedMultiplier *= this.ctrlMultiplier;
    }
    for (const button in this.gamepadMapping) {
      if (gamepadButtons[Number.parseInt(button)]) {
        switch (this.gamepadMapping[button]) {
          case "shift":
            speedMultiplier *= this.shiftMultiplier;
            break;
          case "ctrl":
            speedMultiplier *= this.ctrlMultiplier;
            break;
        }
      }
    }

    // Apply movement in view direction
    moveVector.applyQuaternion(control.quaternion);
    control.position.add(
      moveVector.multiplyScalar(this.moveSpeed * speedMultiplier * deltaTime),
    );
  }
}

type PointerState = {
  initial: THREE.Vector2;
  last: THREE.Vector2;
  position: THREE.Vector2;
  pointerId: number;
  button?: number;
  timeStamp: DOMHighResTimeStamp;
};

// `PointerControls` implements pointer/mouse/touch controls on the canvas,
// for both desktop and mobile web applications.

export class PointerControls {
  canvas: HTMLCanvasElement;
  rotateSpeed: number;
  slideSpeed: number;
  scrollSpeed: number;
  swapRotateSlide: boolean;
  reverseRotate: boolean;
  reverseSlide: boolean;
  reverseSwipe: boolean;
  reverseScroll: boolean;
  moveInertia: number;
  rotateInertia: number;
  // Enable/disable controls updates
  enable = true;

  doublePress: ({
    position,
    intervalMs,
  }: { position: THREE.Vector2; intervalMs: number }) => void;
  // Time limit for double press (default DOUBLE_PRESS_LIMIT_MS)
  doublePressLimitMs: number;
  // Distance limit for double press (default DOUBLE_PRESS_DISTANCE)
  doublePressDistance: number;
  // Last pointer up event (default: null)
  lastUp: { position: THREE.Vector2; time: number } | null;

  // Pointer state for currently active rotating pointer
  rotating: PointerState | null;
  // Pointer state for currently active sliding pointer
  sliding: PointerState | null;
  // Whether we pressed two pointers at the same time
  dualPress: boolean;
  // Cumulative scroll movement
  scroll: THREE.Vector3;

  // Current rotation velocity
  rotateVelocity: THREE.Vector3;
  // Current movement velocity
  moveVelocity: THREE.Vector3;

  constructor({
    // The HTML canvas element to attach pointer events to
    canvas,
    // Speed of rotation (default DEFAULT_ROTATE_SPEED)
    rotateSpeed,
    // Speed of sliding when dragging with right/middle mouse button or two fingers
    // (default DEFAULT_SLIDE_SPEED)
    slideSpeed,
    // Speed of movement when using mouse scroll wheel (default DEFAULT_SCROLL_SPEED)
    scrollSpeed,
    // Swap the direction of rotation and sliding (default: false)
    swapRotateSlide,
    // Reverse the direction of rotation (default: false)
    reverseRotate,
    // Reverse the direction of sliding (default: false)
    reverseSlide,
    // Reverse the direction of swipe gestures (default: false)
    reverseSwipe,
    // Reverse the direction of scroll wheel movement (default: false)
    reverseScroll,
    // Inertia factor for movement (default: DEFAULT_MOVE_INERTIA)
    moveInertia,
    // Inertia factor for rotation (default: DEFAULT_ROTATE_INERTIA)
    rotateInertia,
    // Callback for double press events (default: () => {})
    doublePress,
  }: {
    canvas: HTMLCanvasElement;
    rotateSpeed?: number;
    slideSpeed?: number;
    scrollSpeed?: number;
    swapRotateSlide?: boolean;
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
  }) {
    this.canvas = canvas;
    this.rotateSpeed = rotateSpeed ?? DEFAULT_ROTATE_SPEED;
    this.slideSpeed = slideSpeed ?? DEFAULT_SLIDE_SPEED;
    this.scrollSpeed = scrollSpeed ?? DEFAULT_SCROLL_SPEED;
    this.swapRotateSlide = swapRotateSlide ?? false;
    this.reverseRotate = reverseRotate ?? false;
    this.reverseSlide = reverseSlide ?? false;
    this.reverseSwipe = reverseSwipe ?? false;
    this.reverseScroll = reverseScroll ?? false;
    this.moveInertia = moveInertia ?? DEFAULT_MOVE_INERTIA;
    this.rotateInertia = rotateInertia ?? DEFAULT_ROTATE_INERTIA;

    this.doublePress = doublePress ?? (() => {});
    this.doublePressLimitMs = DOUBLE_PRESS_LIMIT_MS;
    this.doublePressDistance = DOUBLE_PRESS_DISTANCE;
    this.lastUp = null;

    this.rotating = null;
    this.sliding = null;
    this.dualPress = false;
    this.scroll = new THREE.Vector3();

    this.rotateVelocity = new THREE.Vector3();
    this.moveVelocity = new THREE.Vector3();

    canvas.addEventListener("pointerdown", (event: PointerEvent) => {
      const position = this.getPointerPosition(event);
      const initial = position.clone();
      const last = position.clone();

      // Determine if we're starting a rotation pointer action
      const isRotate =
        (!this.swapRotateSlide &&
          !this.rotating &&
          (event.pointerType !== "mouse" || event.button === 0)) ||
        (this.swapRotateSlide &&
          this.sliding &&
          !this.rotating &&
          (event.pointerType !== "mouse" || event.button === 1));
      // const isRotate =
      //   !this.rotating && (event.pointerType !== "mouse" || event.button === 0);
      const { pointerId, timeStamp } = event;

      if (isRotate) {
        this.rotating = { initial, last, position, pointerId, timeStamp };
        // Capture the pointer so events continue to be delivered even if it leaves the canvas.
        canvas.setPointerCapture(event.pointerId);

        this.dualPress = false;
      } else if (!this.sliding) {
        // If it's not a rotation action and we're not yet sliding, the next
        // pointer activates a sliding action
        const button = event.pointerType === "mouse" ? event.button : undefined;
        this.sliding = {
          initial,
          last,
          position,
          pointerId,
          button,
          timeStamp,
        };
        // Capture the pointer so events continue to be delivered even if it leaves the canvas.
        canvas.setPointerCapture(event.pointerId);

        // Check if we pressed both pointers at roughly the same time
        this.dualPress =
          this.rotating != null &&
          timeStamp - this.rotating.timeStamp < DUAL_PRESS_MS;
      }
    });

    const pointerUp = (event: PointerEvent) => {
      if (this.rotating?.pointerId === event.pointerId) {
        this.rotating = null;
        canvas.releasePointerCapture(event.pointerId);
        if (this.dualPress && this.sliding) {
          canvas.releasePointerCapture(this.sliding.pointerId);
          this.sliding = null;
        }
      } else if (this.sliding?.pointerId === event.pointerId) {
        this.sliding = null;
        canvas.releasePointerCapture(event.pointerId);
        if (this.dualPress && this.rotating) {
          canvas.releasePointerCapture(this.rotating.pointerId);
          this.rotating = null;
        }
      }

      const position = this.getPointerPosition(event);
      const lastUp = this.lastUp;
      this.lastUp = { position, time: event.timeStamp };
      if (lastUp) {
        const distance = lastUp.position.distanceTo(position);
        if (distance < this.doublePressDistance) {
          const intervalMs = event.timeStamp - lastUp.time;
          if (intervalMs < this.doublePressLimitMs) {
            // We pressed and release twice within the time and distance limits
            this.lastUp = null;
            this.doublePress({ position, intervalMs });
          }
        }
      }
    };

    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);

    document.addEventListener("pointermove", (event: PointerEvent) => {
      if (this.rotating?.pointerId === event.pointerId) {
        this.rotating.position = this.getPointerPosition(event);
      } else if (this.sliding?.pointerId === event.pointerId) {
        this.sliding.position = this.getPointerPosition(event);
      }
    });

    canvas.addEventListener("contextmenu", (event: MouseEvent) => {
      // Prevent context menu appearing on right click
      event.preventDefault();
    });

    canvas.addEventListener("wheel", (event: WheelEvent) => {
      this.scroll.add(
        new THREE.Vector3(event.deltaX, event.deltaY, event.deltaZ),
      );
      event.preventDefault();
    });
  }

  getPointerPosition(event: PointerEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  update(deltaTime: number, control: THREE.Object3D) {
    if (!this.enable) {
      return;
    }

    if (this.dualPress && this.rotating && this.sliding) {
      // We pressed both pointers at the same time, either pinching or sliding
      const motion = [
        this.rotating.position.clone().sub(this.rotating.last),
        this.sliding.position.clone().sub(this.sliding.last),
      ];
      const coincidence = motion[0].dot(motion[1]);

      if (coincidence >= 0.2) {
        // Similar directions so slide the camera on the XY plane
        const totalMotion = motion[0].clone().add(motion[1]);
        const slide = new THREE.Vector3(totalMotion.x, -totalMotion.y, 0);
        slide.multiplyScalar(this.slideSpeed * (this.reverseSwipe ? 1 : -1));
        slide.applyQuaternion(control.quaternion);
        control.position.add(slide);
        this.moveVelocity = slide.clone().multiplyScalar(1 / deltaTime);
      } else if (coincidence <= -0.2) {
        // Opposite directions so either pinch or roll motion
        const deltaDir = this.sliding.last.clone().sub(this.rotating.last);
        const deltaDist = deltaDir.length();
        deltaDir.multiplyScalar(1 / deltaDist).normalize();

        const orthoDir = new THREE.Vector2(-deltaDir.y, deltaDir.x);
        const motionDir = [motion[0].dot(deltaDir), motion[1].dot(deltaDir)];
        const motionOrtho = [motion[0].dot(orthoDir), motion[1].dot(orthoDir)];

        // Pinching motion
        const midpoint = this.rotating.last
          .clone()
          .add(this.sliding.last)
          .multiplyScalar(0.5);
        let midpointDir = new THREE.Vector3();
        if (control instanceof THREE.Camera) {
          const ndcMidpoint = new THREE.Vector2(
            (midpoint.x / this.canvas.clientWidth) * 2 - 1,
            -(midpoint.y / this.canvas.clientHeight) * 2 + 1,
          );
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(ndcMidpoint, control);
          midpointDir = raycaster.ray.direction;
        }
        const pinchOut = motionDir[1] - motionDir[0];
        const slide = midpointDir.multiplyScalar(pinchOut * this.slideSpeed);
        control.position.add(slide);
        this.moveVelocity = slide.clone().multiplyScalar(1 / deltaTime);

        // Rolling motion
        // Calculate angle of orthogonal motion change over distance deltaDist/2
        // motionOrtho[0] and 1 are already in float distance
        const angles = [
          Math.atan(motionOrtho[0] / (-0.5 * deltaDist)),
          Math.atan(motionOrtho[1] / (0.5 * deltaDist)),
        ];
        const rotate = 0.5 * (angles[0] + angles[1]);
        const eulers = new THREE.Euler().setFromQuaternion(
          control.quaternion,
          "YXZ",
        );
        eulers.z = Math.max(
          -Math.PI,
          Math.min(Math.PI, eulers.z + 0.5 * rotate),
        );
        control.quaternion.setFromEuler(eulers);
      }

      this.rotating.last.copy(this.rotating.position);
      this.sliding.last.copy(this.sliding.position);
    } else {
      // Didn't press both pointers at the same time, so we're in rotating
      // or FPS mode
      const rotate = new THREE.Vector3();
      if (this.rotating && !this.dualPress) {
        const delta = this.rotating.position.clone().sub(this.rotating.last);
        this.rotating.last.copy(this.rotating.position);
        rotate.set(delta.x, delta.y, 0);
        rotate.multiplyScalar(this.rotateSpeed * (this.reverseRotate ? -1 : 1));
        // Update rotation velocity from last delta
        this.rotateVelocity = rotate.clone().multiplyScalar(1 / deltaTime);
      } else {
        // Continue to rotate with inertia
        this.rotateVelocity.multiplyScalar(
          Math.exp(-deltaTime / this.rotateInertia),
        );
        rotate.addScaledVector(this.rotateVelocity, deltaTime);
      }

      // Apply rotation in Euler angles space
      const eulers = new THREE.Euler().setFromQuaternion(
        control.quaternion,
        "YXZ",
      );
      eulers.y -= rotate.x;
      eulers.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, eulers.x - rotate.y),
      );
      eulers.z *= Math.exp(-DEFAULT_ROLL_SPRING * deltaTime);
      control.quaternion.setFromEuler(eulers);

      if (this.sliding && !this.dualPress) {
        const delta = this.sliding.position.clone().sub(this.sliding.last);
        this.sliding.last.copy(this.sliding.position);

        // Slide on plane depending on center/right mouse button
        const slide =
          this.sliding.button !== 2
            ? new THREE.Vector3(delta.x, 0, delta.y)
            : new THREE.Vector3(delta.x, -delta.y, 0);
        slide.multiplyScalar(this.slideSpeed * (this.reverseSlide ? -1 : 1));

        slide.applyQuaternion(control.quaternion);
        control.position.add(slide);
        // Update movement velocity from last delta
        this.moveVelocity = slide.clone().multiplyScalar(1 / deltaTime);
      } else {
        // Continue to move with inertia
        this.moveVelocity.multiplyScalar(
          Math.exp(-deltaTime / this.moveInertia),
        );
        control.position.addScaledVector(this.moveVelocity, deltaTime);
      }
    }

    const scroll = this.scroll.multiplyScalar(this.scrollSpeed);
    scroll.set(scroll.x, scroll.z, scroll.y);
    if (this.reverseScroll) {
      scroll.multiplyScalar(-1);
    }
    scroll.applyQuaternion(control.quaternion);
    control.position.add(scroll);
    this.scroll.set(0, 0, 0);
  }
}
