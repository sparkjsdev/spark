import type * as THREE from "three";
export declare class VRButton {
    static createButton(renderer: THREE.WebGLRenderer, sessionInit?: XRSessionInit): HTMLElement | null;
    static registerSessionGrantedListener(): null | undefined;
    static xrSessionIsGranted: boolean;
}
