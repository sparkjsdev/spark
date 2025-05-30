import { ForgeViewpoint, ForgeViewpointOptions } from './ForgeViewpoint';
import { RgbaArray } from './RgbaArray';
import { SplatAccumulator } from './SplatAccumulator';
import { SplatGenerator } from './SplatGenerator';
import * as THREE from "three";
export type ForgeRendererOptions = {
    renderer: THREE.WebGLRenderer;
    clock?: THREE.Clock;
    autoUpdate?: boolean;
    preUpdate?: boolean;
    originDistance?: number;
    maxStdDev?: number;
    enable2DGS?: boolean;
    preBlurAmount?: number;
    blurAmount?: number;
    falloff?: number;
    clipXY?: number;
    view?: ForgeViewpointOptions;
};
export declare class ForgeRenderer extends THREE.Mesh {
    renderer: THREE.WebGLRenderer;
    material: THREE.ShaderMaterial;
    uniforms: ReturnType<typeof ForgeRenderer.makeUniforms>;
    autoUpdate: boolean;
    preUpdate: boolean;
    originDistance: number;
    maxStdDev: number;
    enable2DGS: boolean;
    preBlurAmount: number;
    blurAmount: number;
    falloff: number;
    clipXY: number;
    time?: number;
    deltaTime?: number;
    clock: THREE.Clock;
    active: SplatAccumulator;
    private freeAccumulators;
    private accumulatorCount;
    defaultView: ForgeViewpoint;
    autoViewpoints: ForgeViewpoint[];
    private rotateToAccumulator;
    private translateToAccumulator;
    private modifier;
    private lastFrame;
    private lastUpdateTime;
    private defaultCameras;
    viewpoint: ForgeViewpoint;
    private pendingUpdate;
    private envViewpoint;
    private static cubeRender;
    private static pmrem;
    constructor(options: ForgeRendererOptions);
    static makeUniforms(): {
        renderSize: {
            value: THREE.Vector2;
        };
        numSplats: {
            value: number;
        };
        renderToViewQuat: {
            value: THREE.Quaternion;
        };
        renderToViewPos: {
            value: THREE.Vector3;
        };
        maxStdDev: {
            value: number;
        };
        enable2DGS: {
            value: boolean;
        };
        preBlurAmount: {
            value: number;
        };
        blurAmount: {
            value: number;
        };
        falloff: {
            value: number;
        };
        clipXY: {
            value: number;
        };
        packedSplats: {
            type: string;
            value: THREE.DataArrayTexture;
        };
        time: {
            value: number;
        };
        deltaTime: {
            value: number;
        };
        encodeLinear: {
            value: boolean;
        };
        debugFlag: {
            value: boolean;
        };
    };
    private canAllocAccumulator;
    private maybeAllocAccumulator;
    releaseAccumulator(accumulator: SplatAccumulator): void;
    newViewpoint(options: ForgeViewpointOptions): ForgeViewpoint;
    onBeforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
    prepareViewpoint(viewpoint?: ForgeViewpoint): void;
    update({ scene, viewToWorld, }: {
        scene: THREE.Scene;
        viewToWorld?: THREE.Matrix4;
    }): void;
    updateInternal({ scene, originToWorld, viewToWorld, }: {
        scene: THREE.Scene;
        originToWorld?: THREE.Matrix4;
        viewToWorld?: THREE.Matrix4;
    }): boolean;
    private compileScene;
    renderEnvMap({ renderer, scene, worldCenter, size, near, far, hideObjects, update, }: {
        renderer?: THREE.WebGLRenderer;
        scene: THREE.Scene;
        worldCenter: THREE.Vector3;
        size?: number;
        near?: number;
        far?: number;
        hideObjects?: THREE.Object3D[];
        update?: boolean;
    }): Promise<THREE.Texture>;
    recurseSetEnvMap(root: THREE.Object3D, envMap: THREE.Texture): void;
    getRgba({ generator, rgba, }: {
        generator: SplatGenerator;
        rgba?: RgbaArray;
    }): RgbaArray;
    readRgba({ generator, rgba, }: {
        generator: SplatGenerator;
        rgba?: RgbaArray;
    }): Promise<Uint8Array>;
}
