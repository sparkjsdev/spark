import { SparkRenderer } from './SparkRenderer';
import { SplatAccumulator } from './SplatAccumulator';
import { SplatGeometry } from './SplatGeometry';
import * as THREE from "three";
export type SparkViewpointOptions = {
    /**
     * Controls whether to auto-update its sort order whenever the SparkRenderer
     * updates the Gsplats. If you expect to render/display from this viewpoint
     * most frames, set this to true.
     * @default false
     */
    autoUpdate?: boolean;
    /**
     * Set a THREE.Camera for this viewpoint to follow.
     * @default undefined
     */
    camera?: THREE.Camera;
    /**
     * Set an explicit view-to-world transformation matrix for this viewpoint (equivalent
     * to camera.matrixWorld), overrides any camera setting.
     * @default undefined
     */
    viewToWorld?: THREE.Matrix4;
    /**
     * Configure viewpoint with an off-screen render target.
     * @default undefined
     */
    target?: {
        /**
         * Width of the render target in pixels.
         */
        width: number;
        /**
         * Height of the render target in pixels.
         */
        height: number;
        /**
         * If you want to be able to render a scene that depends on this target's
         * output (for example, a recursive viewport), set this to true to enable
         * double buffering.
         * @default false
         */
        doubleBuffer?: boolean;
        /**
         * Super-sampling factor for the render target. Values 1-4 are supported.
         * Note that re-sampling back down to .width x .height is done on the CPU
         * with simple averaging only when calling readTarget().
         * @default 1
         */
        superXY?: number;
    };
    /**
     * Callback function that is called when the render target texture is updated.
     * Receives the texture as a parameter. Use this to update a viewport with
     * the latest viewpoint render each frame.
     * @default undefined
     */
    onTextureUpdated?: (texture: THREE.Texture) => void;
    /**
     * Whether to sort splats radially (geometric distance) from the viewpoint (true)
     * or by Z-depth (false). Most scenes are trained with the Z-depth sort metric
     * and will render more accurately at certain viewpoints. However, radial sorting
     * is more stable under viewpoint rotations.
     * @default true
     */
    sortRadial?: boolean;
    /**
     * Distance threshold for re-sorting splats. If the viewpoint moves more than
     * this distance, splats will be re-sorted.
     * @default 0.01 units
     */
    sortDistance?: number;
    /**
     * View direction dot product threshold for re-sorting splats. For
     * sortRadial: true we use 0.99 while sortRadial: false uses 0.999 because it is
     * more sensitive to view direction.
     * @default 0.99 if sortRadial else 0.999
     */
    sortCoorient?: boolean;
    /**
     * Constant added to Z-depth to bias values into the positive range for
     * sortRadial: false, but also used for culling Gsplats "well behind"
     * the viewpoint origin
     * @default 1.0
     */
    depthBias?: number;
    /**
     * Set this to true if rendering a 360 to disable "behind the viewpoint"
     * culling during sorting. This is set automatically when rendering 360 envMaps
     * using the SparkRenderer.renderEnvMap() utility function.
     * @default false
     */
    sort360?: boolean;
    sort32?: boolean;
    stochastic?: boolean;
};
export declare class SparkViewpoint {
    spark: SparkRenderer;
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
    sort32?: boolean;
    stochastic: boolean;
    display: {
        accumulator: SplatAccumulator;
        viewToWorld: THREE.Matrix4;
        geometry: SplatGeometry;
    } | null;
    private sorting;
    private pending;
    private sortingCheck;
    private readback16;
    private readback32;
    private orderingFreelist;
    constructor(options: SparkViewpointOptions & {
        spark: SparkRenderer;
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
