import {
  Color,
  Matrix4,
  type Object3D,
  Quaternion,
  Vector3,
  type WebXRManager,
} from "three";
import { SplatMesh } from "./SplatMesh";

// Experimental WebXR hand tracking and movement

const DEFAULT_MOVE_INERTIA = 0.5;
const DEFAULT_ROTATE_INERTIA = 0.5;
const TOUCH_BIAS = 0.0;

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
  t0: 0.02,
  t1: 0.014,
  t2: 0.0115,
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

export type Joint = {
  position: Vector3;
  quaternion: Quaternion;
  radius: number;
};

export type HandJoints = { [key in JointId]?: Joint };
export type HandsJoints = { [key in Hand]?: HandJoints };

export class XrHands {
  hands: HandsJoints = {};
  last: HandsJoints = {};

  values: Record<string, number> = {};
  tests: Record<string, boolean> = {};
  lastTests: Record<string, boolean> = {};

  updated = false;

  update({ xr, xrFrame }: { xr: WebXRManager; xrFrame: XRFrame }) {
    const xrSession = xr.getSession();
    if (!xrSession) {
      return;
    }
    const referenceSpace = xr.getReferenceSpace();
    if (!referenceSpace) {
      return;
    }
    if (!xrFrame.getJointPose) {
      return;
    }

    this.last = this.hands;
    this.lastTests = this.tests;

    this.hands = {};
    this.values = {};
    this.tests = {};

    for (const inputSource of xrSession.inputSources) {
      if (!inputSource.hand) {
        continue;
      }

      const hand = inputSource.handedness as Hand;
      this.hands[hand] = {};

      // Iterate over JointId
      for (const jointId of JOINT_IDS) {
        const jointSpace = inputSource.hand.get(JointEnum[jointId]);
        if (jointSpace) {
          const jointPose = xrFrame.getJointPose(jointSpace, referenceSpace);
          if (jointPose) {
            const { position, orientation } = jointPose.transform;
            this.hands[hand][jointId] = {
              position: new Vector3(position.x, position.y, position.z),
              quaternion: new Quaternion(
                orientation.x,
                orientation.y,
                orientation.z,
                orientation.w,
              ),
              radius: jointPose.radius || 0.001,
            };
          }
        }
      }
    }

    for (const hand of HANDS) {
      for (const { key, value } of [
        { key: `${hand}AllTips`, value: this.allTipsTouching(hand) },
        {
          key: `${hand}IndexThumb`,
          value: this.touching(hand, "i4", hand, "t3"),
        },
        {
          key: `${hand}MiddleThumb`,
          value: this.touching(hand, "m4", hand, "t3"),
        },
        {
          key: `${hand}RingThumb`,
          value: this.touching(hand, "r4", hand, "t3"),
        },
        {
          key: `${hand}PinkyThumb`,
          value: this.touching(hand, "p4", hand, "t3"),
        },
        { key: `${hand}TriTips`, value: this.triTipsTouching(hand) },
      ]) {
        this.values[key] = value;
        this.tests[key] =
          value === 1.0
            ? true
            : value === 0.0
              ? false
              : (this.lastTests[key] ?? false);
      }
    }
  }

  makeGhostMesh(): SplatMesh {
    const center = new Vector3();
    const scales = new Vector3(0.01, 0.01, 0.01);
    const quaternion = new Quaternion(0, 0, 0, 1);
    const color = new Color(1, 1, 1);
    const CYCLE = Math.PI * 3;
    const WHITE = new Color(1, 1, 1);
    let opacity = 1.0;

    const mesh = new SplatMesh({
      onFrame: () => {
        let splatIndex = 0;
        for (const handedness of HANDS) {
          const xrHand = this.hands[handedness];
          for (const [index, segment] of JOINT_SEGMENTS.entries()) {
            for (let i = 1; i < segment.length; ++i) {
              const segmentSplats = JOINT_SEGMENT_STEPS[index][i - 1] * 2;
              const lastSegment = i + 1 === segment.length;
              const jointA = xrHand?.[segment[i - 1]];
              const jointB = xrHand?.[segment[i]];

              for (let j = 0; j < segmentSplats; ++j) {
                const t = (j + 0.5) / segmentSplats;
                opacity = 0.0;
                if (jointA && jointB) {
                  center.copy(jointA.position).lerp(jointB.position, t);
                  quaternion
                    .copy(jointA.quaternion)
                    .slerp(jointB.quaternion, t);
                  const radiusA = JOINT_RADIUS[segment[i - 1]];
                  const radiusB = JOINT_RADIUS[segment[i]];
                  let radius = (1 - t) * radiusA + t * radiusB;
                  if (lastSegment && t > 0.8) {
                    // Round out finger tips
                    radius *= Math.sqrt(1 - ((t - 0.8) / 0.2) ** 2);
                  }
                  scales.set(0.65 * radius, 0.5 * radius, 0.003);
                  color.set(
                    0.55 + 0.45 * Math.sin(center.x * CYCLE),
                    0.55 + 0.45 * Math.sin(center.y * CYCLE),
                    0.55 + 0.45 * Math.sin(center.z * CYCLE),
                  );
                  if (handedness === "right") {
                    color.set(1 - color.r, 1 - color.g, 1 - color.b);
                  }
                  opacity = 0.75;
                }
                mesh.packedSplats.setSplat(
                  splatIndex,
                  center,
                  scales,
                  quaternion,
                  opacity,
                  color,
                );
                splatIndex += 1;
              }
            }
          }
        }
        mesh.packedSplats.numSplats = splatIndex;
        mesh.packedSplats.needsUpdate = true;
        mesh.numSplats = splatIndex;
        mesh.updateVersion();
      },
    });
    return mesh;
  }

  distance(
    handA: Hand,
    jointA: JointId,
    handB: Hand,
    jointB: JointId,
    last = false,
  ): number {
    const hA = last ? this.last[handA] : this.hands[handA];
    const hB = last ? this.last[handB] : this.hands[handB];
    const jA = hA?.[jointA];
    const jB = hB?.[jointB];
    if (!jA || !jB) {
      return Number.POSITIVE_INFINITY;
    }
    return jA.position.distanceTo(jB.position);
  }

  separation(
    handA: Hand,
    jointA: JointId,
    handB: Hand,
    jointB: JointId,
    last = false,
  ): number {
    const d = this.distance(handA, jointA, handB, jointB, last);
    if (d === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    return d - JOINT_RADIUS[jointA] - JOINT_RADIUS[jointB];
  }

  touching(
    handA: Hand,
    jointA: JointId,
    handB: Hand,
    jointB: JointId,
    last = false,
  ): number {
    const d = this.separation(handA, jointA, handB, jointB, last);
    if (d === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    return 1 - Math.max(0, Math.min(1, d / 0.01 - TOUCH_BIAS));
  }

  allTipsTouching(hand: Hand, last = false): number {
    return Math.min(
      this.touching(hand, "t3", hand, "i4", last),
      this.touching(hand, "i4", hand, "m4", last),
      this.touching(hand, "m4", hand, "r4", last),
      this.touching(hand, "r4", hand, "p4", last),
      // this.touching(hand, "p4", hand, "t3", last),
    );
  }

  triTipsTouching(hand: Hand, last = false): number {
    return Math.min(
      this.touching(hand, "t3", hand, "i4", last),
      this.touching(hand, "i4", hand, "m4", last),
      this.touching(hand, "m4", hand, "t3", last),
    );
  }
}

export class HandMovement {
  xrHands: XrHands;
  control: Object3D;
  moveInertia: number;
  rotateInertia: number;

  lastGrip: { [key in Hand]?: Vector3 } = {};
  lastPivot: Vector3 = new Vector3();
  rotateVelocity = 0;
  velocity: Vector3 = new Vector3();

  constructor({
    xrHands,
    control,
    moveInertia,
    rotateInertia,
  }: {
    xrHands: XrHands;
    control: Object3D;
    moveInertia?: number;
    rotateInertia?: number;
  }) {
    this.xrHands = xrHands;
    this.control = control;
    this.moveInertia = moveInertia ?? DEFAULT_MOVE_INERTIA;
    this.rotateInertia = rotateInertia ?? DEFAULT_ROTATE_INERTIA;
  }

  update(deltaTime: number) {
    const grip: { [key in Hand]?: Vector3 } = {};
    for (const handedness of HANDS) {
      const hand = this.xrHands.hands[handedness];
      if (hand && this.xrHands.tests[`${handedness}MiddleThumb`]) {
        grip[handedness] = new Vector3()
          .add(hand.t3?.position ?? new Vector3())
          .add(hand.i4?.position ?? new Vector3())
          .add(hand.m4?.position ?? new Vector3())
          .add(hand.r4?.position ?? new Vector3())
          .add(hand.p4?.position ?? new Vector3())
          .multiplyScalar(1 / 5);
      }
    }

    if (grip.left && grip.right && this.lastGrip.left && this.lastGrip.right) {
      const mid = grip.left.clone().add(grip.right).multiplyScalar(0.5);
      const lastMid = this.lastGrip.left
        .clone()
        .add(this.lastGrip.right)
        .multiplyScalar(0.5);
      this.lastPivot = mid;

      const delta = mid.clone().applyMatrix4(this.control.matrix);
      delta.sub(lastMid.clone().applyMatrix4(this.control.matrix));
      delta.multiplyScalar(1 / deltaTime);
      this.velocity.lerp(delta, 1 - Math.exp(-20 * deltaTime));

      const angle = Math.atan2(grip.left.z - mid.z, grip.left.x - mid.x);
      const lastAngle = Math.atan2(
        this.lastGrip.left.z - lastMid.z,
        this.lastGrip.left.x - lastMid.x,
      );
      // Find closest rotation over circle between angle and lastAngle
      let closestAngle = angle - lastAngle;
      if (closestAngle > Math.PI) {
        closestAngle -= Math.PI * 2;
      } else if (closestAngle < -Math.PI) {
        closestAngle += Math.PI * 2;
      }
      const rotateVelocity = closestAngle / deltaTime;

      const blend = Math.exp(-20 * deltaTime);
      this.rotateVelocity =
        this.rotateVelocity * blend + rotateVelocity * (1 - blend);
    } else {
      this.rotateVelocity *= Math.exp(-deltaTime / this.rotateInertia);

      if (grip.left && this.lastGrip.left) {
        const delta = grip.left.clone().applyMatrix4(this.control.matrix);
        delta.sub(this.lastGrip.left.clone().applyMatrix4(this.control.matrix));
        delta.multiplyScalar(1 / deltaTime);
        this.velocity.lerp(delta, 1 - Math.exp(-20 * deltaTime));
      } else if (grip.right && this.lastGrip.right) {
        const delta = grip.right.clone().applyMatrix4(this.control.matrix);
        delta.sub(
          this.lastGrip.right.clone().applyMatrix4(this.control.matrix),
        );
        delta.multiplyScalar(1 / deltaTime);
        this.velocity.lerp(delta, 1 - Math.exp(-20 * deltaTime));
      } else {
        this.velocity.multiplyScalar(Math.exp(-deltaTime / this.moveInertia));
      }
    }

    const negPivot = this.lastPivot.clone().negate();
    const rotate = new Matrix4()
      .makeTranslation(negPivot)
      .premultiply(new Matrix4().makeRotationY(this.rotateVelocity * deltaTime))
      .premultiply(new Matrix4().makeTranslation(this.lastPivot));
    this.control.matrix.multiply(rotate);
    this.control.matrix.decompose(
      this.control.position,
      this.control.quaternion,
      this.control.scale,
    );
    this.control.updateMatrixWorld(true);

    this.control.position.sub(this.velocity.clone().multiplyScalar(deltaTime));
    this.lastGrip = grip;
  }
}
