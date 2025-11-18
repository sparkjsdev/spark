import type * as THREE from "three";
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
    hands?: boolean;
    sessionInit?: XRSessionInit;
    onReady?: (supported: boolean) => void | Promise<void>;
    onEnterXr?: () => void | Promise<void>;
    onExitXr?: () => void | Promise<void>;
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
    constructor(options: SparkXrOptions);
    private initializeXr;
    toggleXr(): Promise<void>;
    private updateElement;
    private static createButton;
    xrSupported(): boolean;
}
