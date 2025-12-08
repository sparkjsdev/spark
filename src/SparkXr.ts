import * as THREE from "three";
import { SplatMesh } from "./SplatMesh";

export interface SparkXrOptions {
  renderer: THREE.WebGLRenderer;
  // Element to attach enter/exit click handler to
  element?: HTMLElement;
  // ID of element to attach enter/exit click handler to
  elementId?: string;
  // Create a button to enter/exit XR
  // Optionally provide button text or HTML
  // Default is true - create a button
  button?: boolean | SparkXrButton;
  // Blur out element when mouse leaves it
  // Default is 0.5 - 50% opacity
  onMouseLeaveOpacity?: number;
  // Default is "vrar" - Try VR then AR
  mode?: "vr" | "ar" | "arvr" | "vrar";
  // fixedFoveation: XrManager.setFoveation(...)
  fixedFoveation?: number;
  // https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/XRWebGLLayer#framebufferscalefactor
  // Default is 0.5 - 50% resolution for better frame rate
  frameBufferScaleFactor?: number;
  // https://developer.mozilla.org/en-US/docs/Web/API/XRReferenceSpace#reference_space_types
  // Defaults is "local" - origin is the user's position when starting XR session
  referenceSpaceType?: "local" | "local-floor" | "unbounded" | "viewer";
  // Enable hand tracking
  // Default is false
  enableHands?: boolean;
  // Allow WebXR entry on mobile phones that expose navigator.xr
  // Defaults to false - blocks phones to avoid unusable split-screen modes
  allowMobileXr?: boolean;
  // Session init options
  // Default is empty - no additional options
  sessionInit?: XRSessionInit;
  // Callback function called when SparkXr is ready
  // Default is undefined - no callback
  onReady?: (supported: boolean) => void | Promise<void>;
  // Callback function called when entering XR
  // Default is undefined - no callback
  onEnterXr?: () => void | Promise<void>;
  // Callback function called when exiting XR
  // Default is undefined - no callback
  onExitXr?: () => void | Promise<void>;
  // ztroller movement and rotation options
  controllers?: SparkXrControllers;
}

export interface SparkXrButton {
  enterXrHtml?: string;
  exitXrHtml?: string;
  enterVrHtml?: string;
  exitVrHtml?: string;
  enterArHtml?: string;
  exitArHtml?: string;
  enterXrText?: string;
  exitXrText?: string;
  enterVrText?: string;
  exitVrText?: string;
  enterArText?: string;
  exitArText?: string;
  style?: CSSStyleDeclaration;
  enterStyle?: CSSStyleDeclaration;
  exitStyle?: CSSStyleDeclaration;
  zIndex?: number;
}

export type XrGamepads = { left?: Gamepad; right?: Gamepad };

export interface SparkXrControllers {
  moveSpeed?: number;
  rotateSpeed?: number;
  rollSpeed?: number;
  fastMultiplier?: number;
  slowMultiplier?: number;
  moveHeading?: boolean;
  getMove?: (gamepads: XrGamepads, sparkXr: SparkXr) => THREE.Vector3;
  getRotate?: (gamepads: XrGamepads, sparkXr: SparkXr) => THREE.Vector3;
  getFast?: (gamepads: XrGamepads, sparkXr: SparkXr) => boolean;
  getSlow?: (gamepads: XrGamepads, sparkXr: SparkXr) => boolean;
}

export const DEFAULT_CONTROLLER_MOVE_SPEED = 1.0;
export const DEFAULT_CONTROLLER_ROTATE_SPEED = 4.0;
export const DEFAULT_CONTROLLER_ROLL_SPEED = 2.0;
export const DEFAULT_CONTROLLER_FAST_MULTIPLIER = 5;
export const DEFAULT_CONTROLLER_SLOW_MULTIPLIER = 1 / 5;
export const DEFAULT_CONTROLLER_MOVE_HEADING = false;

export const DEFAULT_CONTROLLER_GETMOVE = (
  gamepads: XrGamepads,
  sparkXr: SparkXr,
) =>
  new THREE.Vector3(
    gamepads.left?.axes[2] ?? 0,
    (gamepads.left?.buttons[0].value ?? 0) -
      (gamepads.left?.buttons[1].value ?? 0),
    gamepads.left?.axes[3] ?? 0,
  );
export const DEFAULT_CONTROLLER_GETROTATE = (
  gamepads: XrGamepads,
  sparkXr: SparkXr,
) => new THREE.Vector3(gamepads.right?.axes[2] ?? 0, 0, 0);
export const DEFAULT_CONTROLLER_GETFAST = (
  gamepads: XrGamepads,
  sparkXr: SparkXr,
) => gamepads.right?.buttons[0]?.pressed ?? false;
export const DEFAULT_CONTROLLER_GETSLOW = (
  gamepads: XrGamepads,
  sparkXr: SparkXr,
) => gamepads.right?.buttons[1]?.pressed ?? false;

export enum JointEnum {
  w = "wrist",
  t0 = "thumb-metacarpal",
  t1 = "thumb-phalanx-proximal",
  t2 = "thumb-phalanx-distal",
  t3 = "thumb-tip",
  i0 = "index-finger-metacarpal",
  i1 = "index-finger-phalanx-proximal",
  i2 = "index-finger-phalanx-intermediate",
  i3 = "index-finger-phalanx-distal",
  i4 = "index-finger-tip",
  m0 = "middle-finger-metacarpal",
  m1 = "middle-finger-phalanx-proximal",
  m2 = "middle-finger-phalanx-intermediate",
  m3 = "middle-finger-phalanx-distal",
  m4 = "middle-finger-tip",
  r0 = "ring-finger-metacarpal",
  r1 = "ring-finger-phalanx-proximal",
  r2 = "ring-finger-phalanx-intermediate",
  r3 = "ring-finger-phalanx-distal",
  r4 = "ring-finger-tip",
  p0 = "pinky-finger-metacarpal",
  p1 = "pinky-finger-phalanx-proximal",
  p2 = "pinky-finger-phalanx-intermediate",
  p3 = "pinky-finger-phalanx-distal",
  p4 = "pinky-finger-tip",
}
export type JointId = keyof typeof JointEnum;
export const JOINT_IDS = Object.keys(JointEnum) as JointId[];
export const NUM_JOINTS = JOINT_IDS.length;

export const JOINT_INDEX: { [key in JointId]: number } = {
  w: 0,
  t0: 1,
  t1: 2,
  t2: 3,
  t3: 4,
  i0: 5,
  i1: 6,
  i2: 7,
  i3: 8,
  i4: 9,
  m0: 10,
  m1: 11,
  m2: 12,
  m3: 13,
  m4: 14,
  r0: 15,
  r1: 16,
  r2: 17,
  r3: 18,
  r4: 19,
  p0: 20,
  p1: 21,
  p2: 22,
  p3: 23,
  p4: 24,
};

export const JOINT_RADIUS: { [key in JointId]: number } = {
  w: 0.02,
  t0: 0.015,
  t1: 0.012,
  t2: 0.0105,
  t3: 0.0085,
  i0: 0.022,
  i1: 0.012,
  i2: 0.0085,
  i3: 0.0075,
  i4: 0.0065,
  m0: 0.021,
  m1: 0.012,
  m2: 0.008,
  m3: 0.0075,
  m4: 0.0065,
  r0: 0.019,
  r1: 0.011,
  r2: 0.0075,
  r3: 0.007,
  r4: 0.006,
  p0: 0.012,
  p1: 0.01,
  p2: 0.007,
  p3: 0.0065,
  p4: 0.0055,
};

export const JOINT_SEGMENTS: JointId[][] = [
  ["w", "t0", "t1", "t2", "t3"],
  ["w", "i0", "i1", "i2", "i3", "i4"],
  ["w", "m0", "m1", "m2", "m3", "m4"],
  ["w", "r0", "r1", "r2", "r3", "r4"],
  ["w", "p0", "p1", "p2", "p3", "p4"],
];

export const JOINT_SEGMENT_STEPS: number[][] = [
  [8, 10, 8, 6],
  [8, 19, 14, 8, 6],
  [8, 19, 14, 8, 6],
  [8, 19, 14, 8, 6],
  [8, 19, 14, 8, 6],
];

export const JOINT_TIPS: JointId[] = ["t3", "i4", "m4", "r4", "p4"];
export const FINGER_TIPS: JointId[] = ["i4", "m4", "r4", "p4"];

export enum Hand {
  left = "left",
  right = "right",
}
export const HANDS = Object.keys(Hand) as Hand[];

const XR_HEADSET_HINTS =
  /Quest|OculusBrowser|VisionOS|XRBrowser|Pico|Lynx|MagicLeap/i;

function isLikelyMobilePhone() {
  const ua = navigator.userAgent ?? "";
  if (XR_HEADSET_HINTS.test(ua)) {
    return false;
  }

  const androidMobile = /Android/i.test(ua) || /Mobile/i.test(ua);
  if (androidMobile) {
    return true;
  }

  const uaData = (
    navigator as Navigator & {
      userAgentData?: { mobile?: boolean };
    }
  ).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") {
    return uaData.mobile;
  }

  return false;
}

export type Joint = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  radius: number;
};

export type HandJoints = { [key in JointId]?: Joint };

export class SparkXr {
  renderer: THREE.WebGLRenderer;
  xr?: XRSystem;
  element?: HTMLElement;
  button?: SparkXrButton;
  mode: XRSessionMode | "initializing" | "not_supported";
  sessionInit?: XRSessionInit;
  session?: XRSession;
  onEnterXr?: () => void;
  onExitXr?: () => void;

  controllers?: SparkXrControllers;
  lastControllersUpdate = 0;

  enableHands: boolean;
  hands: XrHand[] = [];

  constructor(options: SparkXrOptions) {
    this.renderer = options.renderer;
    this.xr = navigator.xr;
    this.mode = "initializing";
    this.onEnterXr = options.onEnterXr;
    this.onExitXr = options.onExitXr;
    this.enableHands = options.enableHands ?? false;
    this.controllers = options.controllers;

    Promise.resolve()
      .then(() => {
        if (!this.xr) {
          this.mode = "not_supported";
          return;
        }

        if (!options.allowMobileXr && isLikelyMobilePhone()) {
          this.mode = "not_supported";
          return;
        }

        if (this.enableHands) {
          this.hands = [new XrHand(Hand.left), new XrHand(Hand.right)];
        }

        let element: HTMLElement | undefined = undefined;
        let button: SparkXrButton | undefined = undefined;
        if (options.element) {
          element = options.element;
        } else if (options.elementId) {
          element = document.getElementById(options.elementId) ?? undefined;
        } else {
          element = SparkXr.createButton();
          button =
            options.button == null || typeof options.button === "boolean"
              ? {}
              : options.button;
        }

        if (!element) {
          throw new Error("No element or button provided");
        }

        element.style.display = "none";
        element.classList.add("hidden");
        this.button = button;
        this.element = element;

        const opacity = options.onMouseLeaveOpacity?.toString();
        if (opacity !== undefined) {
          element.addEventListener("mouseleave", () => {
            element.style.opacity = opacity;
          });
          element.addEventListener("mouseenter", () => {
            element.style.opacity = "";
          });
        }

        return this.initializeXr(options);
      })
      .then(() => {
        return options.onReady?.(this.mode !== "not_supported");
      })
      .catch((error) => {
        alert(`Error initializing SparkXr: ${error}`);
      });
  }

  private async initializeXr(options: SparkXrOptions) {
    if (!this.xr || !this.element) {
      return;
    }
    const element = this.element;

    const modes = {
      vr: ["immersive-vr"],
      ar: ["immersive-ar"],
      arvr: ["immersive-ar", "immersive-vr"],
      vrar: ["immersive-vr", "immersive-ar"],
    }[options.mode ?? "vrar"] as XRSessionMode[] | undefined;
    if (!modes) {
      throw new Error(`Invalid mode: ${options.mode}`);
    }

    let supported = null;
    for (const mode of modes) {
      if (await this.xr.isSessionSupported(mode)) {
        supported = mode;
        break;
      }
    }

    if (!supported) {
      this.mode = "not_supported";
      return;
    }
    this.mode = supported;

    const referenceSpaceType = options.referenceSpaceType ?? "local";

    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType(referenceSpaceType);

    if (options.fixedFoveation !== undefined) {
      this.renderer.xr.setFoveation(options.fixedFoveation);
    }
    const frameBufferScaleFactor = options.frameBufferScaleFactor ?? 0.5;
    this.renderer.xr.setFramebufferScaleFactor(frameBufferScaleFactor);

    const optionalFeatures = options.sessionInit?.optionalFeatures ?? [];
    if (options.enableHands) {
      optionalFeatures.push("hand-tracking");
    }

    const requiredFeatures = options.sessionInit?.requiredFeatures ?? [];
    requiredFeatures.push(referenceSpaceType);

    this.sessionInit = {
      ...options.sessionInit,
      optionalFeatures,
      requiredFeatures,
    };
    // console.log("* this.sessionInit", this.sessionInit);

    element.addEventListener("click", () => {
      this.toggleXr();
    });

    this.updateElement();
  }

  async toggleXr() {
    if (!this.xr || !this.sessionInit) {
      // console.log("* !this.xr || !this.sessionInit");
      return;
    }

    if (!this.session) {
      try {
        const mode = this.mode as XRSessionMode;
        const session = await this.xr.requestSession(mode, this.sessionInit);
        this.session = session;
        // console.log("* this.session", this.session);

        const onSessionEnded = () => {
          session?.removeEventListener("end", onSessionEnded);
          session?.removeEventListener("visibilitychange", visibilityChanged);
          this.session = undefined;

          this.updateElement();
          this.onExitXr?.();
        };

        let lastVisibilityState = session.visibilityState;
        const visibilityChanged = () => {
          if (
            session?.visibilityState === "visible-blurred" &&
            lastVisibilityState === "visible"
          ) {
            session?.end();
          }
          lastVisibilityState = session?.visibilityState;
        };

        this.session?.addEventListener("end", onSessionEnded);
        this.session?.addEventListener("visibilitychange", visibilityChanged);

        await this.renderer.xr.setSession(this.session);
        // console.log("* setSession");

        return this.onEnterXr?.();
      } catch (error) {
        console.error("Error requesting XR session", error);
        return;
      }
    } else {
      this.session.end();
      // console.log("* end session");
    }
  }

  private updateElement() {
    const mode = this.mode as XRSessionMode;
    const element = this.element;
    if (element) {
      element.style.display = "";
      element.classList.remove("hidden");

      const button = typeof this.button === "boolean" ? {} : this.button;
      if (button) {
        if (!this.session) {
          const enterHtml =
            (mode === "immersive-vr"
              ? button.enterVrHtml
              : button.enterArHtml) ?? button.enterXrHtml;
          const enterText =
            (mode === "immersive-vr"
              ? button.enterVrText
              : button.enterArText) ?? button.enterXrText;
          if (enterHtml) {
            element.innerHTML = enterHtml;
          } else if (enterText) {
            element.textContent = enterText;
          } else {
            element.textContent =
              mode === "immersive-vr" ? "ENTER VR" : "ENTER AR";
          }
        } else {
          const exitHtml =
            (mode === "immersive-vr" ? button.exitVrHtml : button.exitArHtml) ??
            button.exitXrHtml;
          const exitText =
            (mode === "immersive-vr" ? button.exitVrText : button.exitArText) ??
            button.exitXrText;
          if (exitHtml) {
            element.innerHTML = exitHtml;
          } else if (exitText) {
            element.textContent = exitText;
          } else {
            element.textContent =
              mode === "immersive-vr" ? "EXIT VR" : "EXIT AR";
          }
        }

        element.style.display = "";
      }
    }
  }

  private static createButton() {
    const button = document.createElement("button");
    Object.assign(button.style, {
      position: "absolute",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "40px 40px",
      border: "2px solid #fff",
      borderRadius: "16px",
      background: "rgba(0,0,0,0.1)",
      color: "#fff",
      font: "bold 28px sans-serif",
      textAlign: "center",
      userSelect: "none",
      zIndex: "999",
    });
    document.body.appendChild(button);
    return button;
  }

  xrSupported() {
    return !!this.xr;
  }

  static JointEnum = JointEnum;
  static JOINT_IDS = JOINT_IDS;
  static NUM_JOINTS = NUM_JOINTS;
  static JOINT_INDEX = JOINT_INDEX;
  static JOINT_RADIUS = JOINT_RADIUS;
  static JOINT_SEGMENTS = JOINT_SEGMENTS;
  static JOINT_SEGMENT_STEPS = JOINT_SEGMENT_STEPS;
  static JOINT_TIPS = JOINT_TIPS;
  static FINGER_TIPS = FINGER_TIPS;
  static Hand = Hand;
  static HANDS = HANDS;

  left() {
    return this.hands[0];
  }

  right() {
    return this.hands[1];
  }

  updateControllers(camera: THREE.Camera) {
    const cameraFrame = camera.parent as THREE.Group;

    const now = performance.now();
    const deltaTime = (now - (this.lastControllersUpdate || now)) / 1000;
    this.lastControllersUpdate = now;

    const xrGamepads: XrGamepads = {};
    for (const source of this.renderer.xr.getSession()?.inputSources ?? []) {
      const gamepad = source.gamepad;
      if (
        gamepad &&
        (source.handedness === "left" || source.handedness === "right")
      ) {
        xrGamepads[source.handedness] = gamepad;
      }
    }

    const rotate = (
      this.controllers?.getRotate ?? DEFAULT_CONTROLLER_GETROTATE
    )(xrGamepads, this);
    rotate.multiply(
      new THREE.Vector3(
        this.controllers?.rotateSpeed ?? DEFAULT_CONTROLLER_ROTATE_SPEED,
        this.controllers?.rotateSpeed ?? DEFAULT_CONTROLLER_ROTATE_SPEED,
        this.controllers?.rollSpeed ?? DEFAULT_CONTROLLER_ROLL_SPEED,
      ),
    );

    if (rotate.manhattanLength() > 0.0) {
      rotate.multiplyScalar(deltaTime);
      const eulers = new THREE.Euler(-rotate.y, -rotate.x, rotate.z, "YXZ");
      const quat = new THREE.Quaternion().setFromEuler(eulers);

      const pivot = camera.getWorldPosition(new THREE.Vector3());
      cameraFrame.parent?.worldToLocal(pivot);

      cameraFrame.position.sub(pivot);
      cameraFrame.position.applyQuaternion(quat);
      cameraFrame.position.add(pivot);
      cameraFrame.quaternion.premultiply(quat);
    }

    const move = (this.controllers?.getMove ?? DEFAULT_CONTROLLER_GETMOVE)(
      xrGamepads,
      this,
    );

    let moveSpeed =
      this.controllers?.moveSpeed ?? DEFAULT_CONTROLLER_MOVE_SPEED;
    if (
      (this.controllers?.getFast ?? DEFAULT_CONTROLLER_GETFAST)(
        xrGamepads,
        this,
      )
    ) {
      moveSpeed *= DEFAULT_CONTROLLER_FAST_MULTIPLIER;
    }
    if (
      (this.controllers?.getSlow ?? DEFAULT_CONTROLLER_GETSLOW)(
        xrGamepads,
        this,
      )
    ) {
      moveSpeed *= DEFAULT_CONTROLLER_SLOW_MULTIPLIER;
    }

    if (this.controllers?.moveHeading) {
      move.applyQuaternion(camera.quaternion);
    }
    move.applyQuaternion(cameraFrame.quaternion);

    move.multiplyScalar(deltaTime * moveSpeed);
    cameraFrame.position.add(move);
  }

  updateHands({ xrFrame }: { xrFrame: XRFrame }) {
    const xrSession = this.renderer.xr.getSession();
    if (!xrSession) {
      return;
    }
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!referenceSpace) {
      return;
    }
    if (!xrFrame.getJointPose) {
      return;
    }

    for (const hand of this.hands) {
      if (hand) {
        hand.lastJoints = hand.joints;
        hand.joints = undefined;
      }
    }

    for (const inputSource of xrSession.inputSources) {
      if (!inputSource.hand) {
        continue;
      }
      const hand = inputSource.handedness as Hand;
      const xrHand = this.hands[hand === Hand.left ? 0 : 1];
      if (!xrHand) {
        continue;
      }

      for (const jointId of JOINT_IDS) {
        const jointSpace = inputSource.hand.get(JointEnum[jointId]);
        if (jointSpace) {
          const jointPose = xrFrame.getJointPose(jointSpace, referenceSpace);
          if (jointPose) {
            const { position, orientation } = jointPose.transform;

            if (!xrHand.joints) {
              xrHand.joints = {};
            }
            xrHand.joints[jointId] = {
              position: new THREE.Vector3(position.x, position.y, position.z),
              quaternion: new THREE.Quaternion(
                orientation.x,
                orientation.y,
                orientation.z,
                orientation.w,
              ),
              radius: JOINT_RADIUS[jointId],
            };
          }
        }
      }
    }
  }

  makeJointSplats(hand: Hand): JointSplats {
    const mesh = new JointSplats(hand);
    mesh.onFrame = () => {
      const xrHand = this.hands[hand === Hand.left ? 0 : 1];
      const joints = xrHand?.joints;
      mesh.updateJoints(joints);
    };
    return mesh;
  }

  snapshotHands(time: number) {
    const hands = [
      this.hands[0]?.snapshotJoints(),
      this.hands[1]?.snapshotJoints(),
    ];
    return { time, hands };
  }
}

type JointSnapshot = { pos: number[]; quat: number[]; radius: number };
type HandSnapshot = { [key in JointId]?: JointSnapshot };
type HandsSnapshot = {
  time: number;
  hands: (HandSnapshot | undefined)[];
};

const round4 = (value: number) => Math.round(value * 10000) / 10000;
const SCRATCH_QUAT_A = new THREE.Quaternion();
const SCRATCH_QUAT_B = new THREE.Quaternion();

export function lerpHandsSnapshots(
  snapshots: HandsSnapshot[],
  time: number,
): HandsSnapshot | null {
  if (!snapshots.length) {
    return null;
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  if (time < first.time || time > last.time) {
    return null;
  }

  const floorIndex = findSnapshotFloorIndex(snapshots, time);
  if (floorIndex === -1) {
    return null;
  }

  const from = snapshots[floorIndex];
  const to = snapshots[floorIndex + 1];
  if (!to) {
    return cloneSnapshot(from, time);
  }

  const span = to.time - from.time;
  const factor = span > 0 ? (time - from.time) / span : 0;

  return interpolateSnapshots(from, to, factor, time);
}

function interpolateSnapshots(
  from: HandsSnapshot,
  to: HandsSnapshot,
  factor: number,
  time: number,
): HandsSnapshot {
  const maxHands = Math.max(from.hands.length, to.hands.length);
  const hands = Array.from({ length: maxHands }, (_, handIndex) =>
    lerpHandSnapshot(from.hands[handIndex], to.hands[handIndex], factor),
  );
  return { time, hands };
}

function cloneSnapshot(snapshot: HandsSnapshot, time: number): HandsSnapshot {
  return {
    time,
    hands: snapshot.hands.map((hand) => cloneHandSnapshot(hand)),
  };
}

export class XrHand {
  hand: Hand;
  joints?: HandJoints;
  lastJoints?: HandJoints;

  constructor(hand: Hand) {
    this.hand = hand;
  }

  static newFromSnapshot(hand: Hand, snapshot: HandSnapshot) {
    const h = new XrHand(hand);
    h.joints = {};
    for (const jointId of JOINT_IDS) {
      const joint = snapshot[jointId];
      if (!joint) {
        continue;
      }
      h.joints[jointId] = {
        position: new THREE.Vector3(joint.pos[0], joint.pos[1], joint.pos[2]),
        quaternion: new THREE.Quaternion(
          joint.quat[0],
          joint.quat[1],
          joint.quat[2],
          joint.quat[3],
        ),
        radius: joint.radius,
      };
    }
    return h;
  }

  valid() {
    return !!this.joints;
  }

  snapshotJoints() {
    if (!this.joints) {
      return undefined;
    }

    const snapshot: HandSnapshot = {};
    for (const jointId of JOINT_IDS) {
      const joint = this.joints[jointId];
      if (!joint) {
        continue;
      }
      snapshot[jointId] = {
        pos: joint.position.toArray().map(round4),
        quat: joint.quaternion.toArray().map(round4),
        radius: round4(joint.radius),
      };
    }
    return snapshot;
  }

  toFlatArray() {
    if (!this.joints) {
      return undefined;
    }
    const array = new Float32Array(1 + 25 * 7);
    array[0] = this.hand === Hand.left ? 0 : 1;
    let index = 1;
    for (const jointId of JOINT_IDS) {
      const joint = this.joints[jointId];
      if (joint) {
        array[index] = joint.position.x;
        array[index + 1] = joint.position.y;
        array[index + 2] = joint.position.z;
        array[index + 3] = joint.quaternion.x;
        array[index + 4] = joint.quaternion.y;
        array[index + 5] = joint.quaternion.z;
        array[index + 6] = joint.quaternion.w;
      }
      index += 7;
    }
    return array;
  }
}

function findSnapshotFloorIndex(snapshots: HandsSnapshot[], time: number) {
  let low = 0;
  let high = snapshots.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (snapshots[mid].time <= time) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high;
}

function lerpHandSnapshot(
  fromHand?: HandSnapshot,
  toHand?: HandSnapshot,
  factor = 0,
) {
  if (!fromHand || !toHand) {
    return undefined;
  }
  const hand: HandSnapshot = {};
  for (const jointId of JOINT_IDS) {
    const joint = lerpJointSnapshot(fromHand[jointId], toHand[jointId], factor);
    if (joint) {
      hand[jointId] = joint;
    }
  }
  return hand;
}

function lerpJointSnapshot(
  fromJoint?: JointSnapshot,
  toJoint?: JointSnapshot,
  factor = 0,
) {
  if (!fromJoint || !toJoint) {
    return undefined;
  }
  const pos = fromJoint.pos.map(
    (value, index) => value + (toJoint.pos[index] - value) * factor,
  );
  const quat = SCRATCH_QUAT_A.fromArray(fromJoint.quat)
    .slerp(SCRATCH_QUAT_B.fromArray(toJoint.quat), factor)
    .toArray();
  const radius =
    fromJoint.radius + (toJoint.radius - fromJoint.radius) * factor;

  return { pos, quat, radius };
}

function cloneHandSnapshot(hand?: HandSnapshot) {
  if (!hand) {
    return undefined;
  }
  const clone: HandSnapshot = {};
  for (const jointId of JOINT_IDS) {
    const joint = hand[jointId];
    if (joint) {
      clone[jointId] = cloneJointSnapshot(joint);
    }
  }
  return clone;
}

function cloneJointSnapshot(joint: JointSnapshot): JointSnapshot {
  return {
    pos: [...joint.pos],
    quat: [...joint.quat],
    radius: joint.radius,
  };
}

export class JointSplats extends SplatMesh {
  hand: Hand;

  constructor(hand: Hand) {
    super({});
    this.hand = hand;
  }

  private scratchCenter = new THREE.Vector3();
  private scratchQuat = new THREE.Quaternion(0, 0, 0, 1);
  private scratchScales = new THREE.Vector3().setScalar(0.01);
  private scratchColor = new THREE.Color(1, 1, 1);

  updateJoints(joints?: HandJoints) {
    this.visible = false;

    if (!joints) {
      return;
    }

    this.visible = true;
    let splatIndex = 0;

    for (const jointId of JOINT_IDS) {
      const joint = joints[jointId];
      if (!joint) {
        continue;
      }
      this.scratchCenter.copy(joint.position);
      this.scratchQuat.copy(joint.quaternion);
      this.scratchScales.set(
        joint.radius,
        0.75 * joint.radius,
        1.5 * joint.radius,
      );
      // this.scratchColor.set((joint.radius * 123) % 1, (joint.radius * 345) % 1, (joint.radius * 234) % 1);
      const opacity = 0.75;

      this.packedSplats.setSplat(
        splatIndex,
        this.scratchCenter,
        this.scratchScales,
        this.scratchQuat,
        opacity,
        this.scratchColor,
      );
      splatIndex += 1;
    }

    this.packedSplats.numSplats = splatIndex;
    this.packedSplats.needsUpdate = true;
    this.numSplats = splatIndex;
    this.updateVersion();
  }
}
