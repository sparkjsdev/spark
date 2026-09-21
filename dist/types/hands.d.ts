import { type Object3D, Quaternion, Vector3, type WebXRManager } from "three";
import { SplatMesh } from "./SplatMesh";
export declare const JointEnum: {
    readonly w: "wrist";
    readonly t0: "thumb-metacarpal";
    readonly t1: "thumb-phalanx-proximal";
    readonly t2: "thumb-phalanx-distal";
    readonly t3: "thumb-tip";
    readonly i0: "index-finger-metacarpal";
    readonly i1: "index-finger-phalanx-proximal";
    readonly i2: "index-finger-phalanx-intermediate";
    readonly i3: "index-finger-phalanx-distal";
    readonly i4: "index-finger-tip";
    readonly m0: "middle-finger-metacarpal";
    readonly m1: "middle-finger-phalanx-proximal";
    readonly m2: "middle-finger-phalanx-intermediate";
    readonly m3: "middle-finger-phalanx-distal";
    readonly m4: "middle-finger-tip";
    readonly r0: "ring-finger-metacarpal";
    readonly r1: "ring-finger-phalanx-proximal";
    readonly r2: "ring-finger-phalanx-intermediate";
    readonly r3: "ring-finger-phalanx-distal";
    readonly r4: "ring-finger-tip";
    readonly p0: "pinky-finger-metacarpal";
    readonly p1: "pinky-finger-phalanx-proximal";
    readonly p2: "pinky-finger-phalanx-intermediate";
    readonly p3: "pinky-finger-phalanx-distal";
    readonly p4: "pinky-finger-tip";
};
export type JointId = keyof typeof JointEnum;
export declare const JOINT_IDS: JointId[];
export declare const NUM_JOINTS: number;
export declare const JOINT_INDEX: {
    [key in JointId]: number;
};
export declare const JOINT_RADIUS: {
    [key in JointId]: number;
};
export declare const JOINT_SEGMENTS: JointId[][];
export declare const JOINT_SEGMENT_STEPS: number[][];
export declare const JOINT_TIPS: JointId[];
export declare const FINGER_TIPS: JointId[];
export declare enum Hand {
    left = "left",
    right = "right"
}
export declare const HANDS: Hand[];
export type Joint = {
    position: Vector3;
    quaternion: Quaternion;
    radius: number;
};
export type HandJoints = {
    [key in JointId]?: Joint;
};
export type HandsJoints = {
    [key in Hand]?: HandJoints;
};
export declare class XrHands {
    hands: HandsJoints;
    last: HandsJoints;
    values: Record<string, number>;
    tests: Record<string, boolean>;
    lastTests: Record<string, boolean>;
    updated: boolean;
    update({ xr, xrFrame }: {
        xr: WebXRManager;
        xrFrame: XRFrame;
    }): void;
    makeGhostMesh(): SplatMesh;
    distance(handA: Hand, jointA: JointId, handB: Hand, jointB: JointId, last?: boolean): number;
    separation(handA: Hand, jointA: JointId, handB: Hand, jointB: JointId, last?: boolean): number;
    touching(handA: Hand, jointA: JointId, handB: Hand, jointB: JointId, last?: boolean): number;
    allTipsTouching(hand: Hand, last?: boolean): number;
    triTipsTouching(hand: Hand, last?: boolean): number;
}
export declare class HandMovement {
    xrHands: XrHands;
    control: Object3D;
    moveInertia: number;
    rotateInertia: number;
    lastGrip: {
        [key in Hand]?: Vector3;
    };
    lastPivot: Vector3;
    rotateVelocity: number;
    velocity: Vector3;
    constructor({ xrHands, control, moveInertia, rotateInertia, }: {
        xrHands: XrHands;
        control: Object3D;
        moveInertia?: number;
        rotateInertia?: number;
    });
    update(deltaTime: number): void;
}
