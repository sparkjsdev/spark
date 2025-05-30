import { ForgeRenderer } from './ForgeRenderer';
import { SplatAccumulator } from './SplatAccumulator';
import { SplatGeometry } from './SplatGeometry';
import * as THREE from "three";
export type ForgeViewpointOptions = {
    autoUpdate?: boolean;
    camera?: THREE.Camera;
    viewToWorld?: THREE.Matrix4;
    target?: {
        width: number;
        height: number;
        doubleBuffer?: boolean;
        superXY?: number;
    };
    onTextureUpdated?: (texture: THREE.Texture) => void;
    sortRadial?: boolean;
    sortDistance?: number;
    sortCoorient?: boolean;
    depthBias?: number;
    sort360?: boolean;
};
export declare class ForgeViewpoint {
    forge: ForgeRenderer;
    autoUpdate: boolean;
    camera?: THREE.Camera;
    viewToWorld: THREE.Matrix4;
    lastTime: number | null;
    target?: THREE.WebGLRenderTarget;
    private back?;
    onTextureUpdated?: (texture: THREE.Texture) => void;
    encodeLinear: boolean;
    superXY: number;
    private superPixels?;
    private pixels?;
    sortRadial: boolean;
    sortDistance?: number;
    sortCoorient?: boolean;
    depthBias?: number;
    sort360?: boolean;
    display: {
        accumulator: SplatAccumulator;
        viewToWorld: THREE.Matrix4;
        geometry: SplatGeometry;
    } | null;
    private sorting;
    private pending;
    private sortingCheck;
    private readback;
    private orderingFreelist;
    constructor(options: ForgeViewpointOptions & {
        forge: ForgeRenderer;
    });
    dispose(): void;
    setAutoUpdate(autoUpdate: boolean): void;
    prepare({ scene, camera, viewToWorld, update, forceOrigin, }: {
        scene: THREE.Scene;
        camera?: THREE.Camera;
        viewToWorld?: THREE.Matrix4;
        update?: boolean;
        forceOrigin?: boolean;
    }): Promise<void>;
    renderTarget({ scene, camera, }: {
        scene: THREE.Scene;
        camera?: THREE.Camera;
    }): void;
    readTarget(): Promise<Uint8Array>;
    prepareRenderPixels({ scene, camera, viewToWorld, update, forceOrigin, }: {
        scene: THREE.Scene;
        camera?: THREE.Camera;
        viewToWorld?: THREE.Matrix4;
        update?: boolean;
        forceOrigin?: boolean;
    }): Promise<Uint8Array<ArrayBufferLike>>;
    autoPoll({ accumulator }: {
        accumulator?: SplatAccumulator;
    }): void;
    private driveSort;
    private sortUpdate;
    private updateDisplay;
    static EMPTY_TEXTURE: THREE.Texture;
    private static dynos;
    private static makeSorter;
}
