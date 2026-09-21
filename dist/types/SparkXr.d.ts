import * as THREE from "three";
import { SplatMesh } from "./SplatMesh";
import { Hand, type JointId } from "./hands";
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
    leftIsHand?: boolean;
    rightIsHand?: boolean;
};
export interface SparkXrControllers {
    moveSpeed?: number;
    rotateSpeed?: number;
    rollSpeed?: number;
    fastMultiplier?: number;
    slowMultiplier?: number;
    moveHeading?: boolean;
    moveDirection?: boolean;
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
    static readonly JointEnum: {
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
    static readonly JOINT_IDS: ("i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "p0" | "p1" | "p2" | "p3" | "p4" | "r0" | "r1" | "r2" | "r3" | "r4" | "t0" | "t1" | "t2" | "t3" | "w")[];
    static readonly NUM_JOINTS: number;
    static readonly JOINT_INDEX: {
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
        p0: number;
        p1: number;
        p2: number;
        p3: number;
        p4: number;
        r0: number;
        r1: number;
        r2: number;
        r3: number;
        r4: number;
        t0: number;
        t1: number;
        t2: number;
        t3: number;
        w: number;
    };
    static readonly JOINT_RADIUS: {
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
        p0: number;
        p1: number;
        p2: number;
        p3: number;
        p4: number;
        r0: number;
        r1: number;
        r2: number;
        r3: number;
        r4: number;
        t0: number;
        t1: number;
        t2: number;
        t3: number;
        w: number;
    };
    static readonly JOINT_SEGMENTS: ("i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "p0" | "p1" | "p2" | "p3" | "p4" | "r0" | "r1" | "r2" | "r3" | "r4" | "t0" | "t1" | "t2" | "t3" | "w")[][];
    static readonly JOINT_SEGMENT_STEPS: number[][];
    static readonly JOINT_TIPS: ("i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "p0" | "p1" | "p2" | "p3" | "p4" | "r0" | "r1" | "r2" | "r3" | "r4" | "t0" | "t1" | "t2" | "t3" | "w")[];
    static readonly FINGER_TIPS: ("i0" | "i1" | "i2" | "i3" | "i4" | "m0" | "m1" | "m2" | "m3" | "m4" | "p0" | "p1" | "p2" | "p3" | "p4" | "r0" | "r1" | "r2" | "r3" | "r4" | "t0" | "t1" | "t2" | "t3" | "w")[];
    static readonly Hand: typeof Hand;
    static readonly HANDS: Hand[];
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
