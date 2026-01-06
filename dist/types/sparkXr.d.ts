import { SplatMesh } from './SplatMesh';
import * as THREE from "three";
export interface SparkXrOptions {
    renderer: THREE.WebGLRenderer;
    element?: HTMLElement;
    elementId?: string;
    button?: boolean | SparkXrButton;
    onMouseLeaveOpacity?: number;
    mode?: "vr" | "ar" | "arvr" | "vrar";
    fixedFoveation?: number;
    frameBufferScaleFactor?: number;
    referenceSpaceType?: "local" | "local-floor" | "unbounded" | "viewer";
    enableHands?: boolean;
    allowMobileXr?: boolean;
    sessionInit?: XRSessionInit;
    onReady?: (supported: boolean) => void | Promise<void>;
    onEnterXr?: () => void | Promise<void>;
    onExitXr?: () => void | Promise<void>;
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
export type XrGamepads = {
    left?: Gamepad;
    right?: Gamepad;
};
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
export declare const DEFAULT_CONTROLLER_MOVE_SPEED = 1;
export declare const DEFAULT_CONTROLLER_ROTATE_SPEED = 4;
export declare const DEFAULT_CONTROLLER_ROLL_SPEED = 2;
export declare const DEFAULT_CONTROLLER_FAST_MULTIPLIER = 5;
export declare const DEFAULT_CONTROLLER_SLOW_MULTIPLIER: number;
export declare const DEFAULT_CONTROLLER_MOVE_HEADING = false;
export declare const DEFAULT_CONTROLLER_GETMOVE: (gamepads: XrGamepads, sparkXr: SparkXr) => THREE.Vector3;
export declare const DEFAULT_CONTROLLER_GETROTATE: (gamepads: XrGamepads, sparkXr: SparkXr) => THREE.Vector3;
export declare const DEFAULT_CONTROLLER_GETFAST: (gamepads: XrGamepads, sparkXr: SparkXr) => boolean;
export declare const DEFAULT_CONTROLLER_GETSLOW: (gamepads: XrGamepads, sparkXr: SparkXr) => boolean;
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
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    radius: number;
};
export type HandJoints = {
    [key in JointId]?: Joint;
};
export declare class SparkXr {
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
    lastControllersUpdate: number;
    enableHands: boolean;
    hands: XrHand[];
    constructor(options: SparkXrOptions);
    private initializeXr;
    toggleXr(): Promise<void>;
    private updateElement;
    private static createButton;
    xrSupported(): boolean;
    static JointEnum: typeof JointEnum;
    static JOINT_IDS: ("w" | "t0" | "t1" | "t2" | "t3" | "i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "r0" | "r1" | "r2" | "r3" | "r4" | "p0" | "p1" | "p2" | "p3" | "p4")[];
    static NUM_JOINTS: number;
    static JOINT_INDEX: {
        w: number;
        t0: number;
        t1: number;
        t2: number;
        t3: number;
        i0: number;
        i1: number;
        i2: number;
        i3: number;
        i4: number;
        m0: number;
        m1: number;
        m2: number;
        m3: number;
        m4: number;
        r0: number;
        r1: number;
        r2: number;
        r3: number;
        r4: number;
        p0: number;
        p1: number;
        p2: number;
        p3: number;
        p4: number;
    };
    static JOINT_RADIUS: {
        w: number;
        t0: number;
        t1: number;
        t2: number;
        t3: number;
        i0: number;
        i1: number;
        i2: number;
        i3: number;
        i4: number;
        m0: number;
        m1: number;
        m2: number;
        m3: number;
        m4: number;
        r0: number;
        r1: number;
        r2: number;
        r3: number;
        r4: number;
        p0: number;
        p1: number;
        p2: number;
        p3: number;
        p4: number;
    };
    static JOINT_SEGMENTS: ("w" | "t0" | "t1" | "t2" | "t3" | "i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "r0" | "r1" | "r2" | "r3" | "r4" | "p0" | "p1" | "p2" | "p3" | "p4")[][];
    static JOINT_SEGMENT_STEPS: number[][];
    static JOINT_TIPS: ("w" | "t0" | "t1" | "t2" | "t3" | "i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "r0" | "r1" | "r2" | "r3" | "r4" | "p0" | "p1" | "p2" | "p3" | "p4")[];
    static FINGER_TIPS: ("w" | "t0" | "t1" | "t2" | "t3" | "i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "r0" | "r1" | "r2" | "r3" | "r4" | "p0" | "p1" | "p2" | "p3" | "p4")[];
    static Hand: typeof Hand;
    static HANDS: Hand[];
    left(): XrHand;
    right(): XrHand;
    updateControllers(camera: THREE.Camera): void;
    updateHands({ xrFrame }: {
        xrFrame: XRFrame;
    }): void;
    makeJointSplats(hand: Hand): JointSplats;
    snapshotHands(time: number): {
        time: number;
        hands: (HandSnapshot | undefined)[];
    };
}
type JointSnapshot = {
    pos: number[];
    quat: number[];
    radius: number;
};
type HandSnapshot = {
    [key in JointId]?: JointSnapshot;
};
type HandsSnapshot = {
    time: number;
    hands: (HandSnapshot | undefined)[];
};
export declare function lerpHandsSnapshots(snapshots: HandsSnapshot[], time: number): HandsSnapshot | null;
export declare class XrHand {
    hand: Hand;
    joints?: HandJoints;
    lastJoints?: HandJoints;
    constructor(hand: Hand);
    static newFromSnapshot(hand: Hand, snapshot: HandSnapshot): XrHand;
    valid(): boolean;
    snapshotJoints(): HandSnapshot | undefined;
    toFlatArray(): Float32Array<ArrayBuffer> | undefined;
}
export declare class JointSplats extends SplatMesh {
    hand: Hand;
    constructor(hand: Hand);
    private scratchCenter;
    private scratchQuat;
    private scratchScales;
    private scratchColor;
    updateJoints(joints?: HandJoints): void;
}
export {};
