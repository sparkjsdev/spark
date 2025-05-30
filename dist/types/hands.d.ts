import { Object3D, Quaternion, Vector3, WebXRManager } from 'three';
import { SplatMesh } from './SplatMesh';
export declare enum JointEnum {
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
    p4 = "pinky-finger-tip"
}
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
