import { SplatEncoding } from './PackedSplats';
import { RgbaArray } from './RgbaArray';
import { SparkViewpoint, SparkViewpointOptions } from './SparkViewpoint';
import { SplatAccumulator } from './SplatAccumulator';
import { SplatGenerator } from './SplatGenerator';
import * as THREE from "three";
export type SparkRendererOptions = {
    /**
     * Pass in your THREE.WebGLRenderer instance so Spark can perform work
     * outside the usual render loop. Should be created with antialias: false
     * (default setting) as WebGL anti-aliasing doesn't improve Gaussian Splatting
     * rendering and significantly reduces performance.
     */
    renderer: THREE.WebGLRenderer;
    /**
     * Whether to use premultiplied alpha when accumulating splat RGB
     * @default true
     */
    premultipliedAlpha?: boolean;
    /**
     * Pass in a THREE.Clock to synchronize time-based effects across different
     * systems. Alternatively, you can set the SparkRenderer properties time and
     * deltaTime directly. (default: new THREE.Clock)
     */
    clock?: THREE.Clock;
    /**
     * Controls whether to check and automatically update Gsplat collection after
     * each frame render.
     * @default true
     */
    autoUpdate?: boolean;
    /**
     * Controls whether to update the Gsplats before or after rendering. For WebXR
     * this must be false in order to complete rendering as soon as possible.
     * @default false
     */
    preUpdate?: boolean;
    /**
     * Distance threshold for SparkRenderer movement triggering a Gsplat update at
     * the new origin.
     * @default 1.0
     */
    originDistance?: number;
    /**
     * Maximum standard deviations from the center to render Gaussians. Values
     * Math.sqrt(5)..Math.sqrt(8) produce good results and can be tweaked for
     * performance.
     * @default Math.sqrt(8)
     */
    maxStdDev?: number;
    /**
     * Maximum pixel radius for splat rendering.
     * @default 512.0
     */
    maxPixelRadius?: number;
    /**
     * Minimum alpha value for splat rendering.
     * @default 0.5 * (1.0 / 255.0)
     */
    minAlpha?: number;
    /**
     * Enable 2D Gaussian splatting rendering ability. When this mode is enabled,
     * any scale x/y/z component that is exactly 0 (minimum quantized value) results
     * in the other two non-0 axis being interpreted as an oriented 2D Gaussian Splat,
     * rather instead of the usual projected 3DGS Z-slice. When reading PLY files,
     * scale values less than e^-30 will be interpreted as 0.
     * @default false
     */
    enable2DGS?: boolean;
    /**
     * Scalar value to add to 2D splat covariance diagonal, effectively blurring +
     * enlarging splats. In scenes trained without the Gsplat anti-aliasing tweak
     * this value was typically 0.3, but with anti-aliasing it is 0.0
     * @default 0.0
     */
    preBlurAmount?: number;
    /**
     * Scalar value to add to 2D splat covarianve diagonal, with opacity adjustment
     * to correctly account for "blurring" when anti-aliasing. Typically 0.3
     * (equivalent to approx 0.5 pixel radius) in scenes trained with anti-aliasing.
     */
    blurAmount?: number;
    /**
     * Depth-of-field distance to focal plane
     */
    focalDistance?: number;
    /**
     * Full-width angle of aperture opening (in radians), 0.0 to disable
     * @default 0.0
     */
    apertureAngle?: number;
    /**
     * Modulate Gaussian kernel falloff. 0 means "no falloff, flat shading",
     * while 1 is the normal Gaussian kernel.
     * @default 1.0
     */
    falloff?: number;
    /**
     * X/Y clipping boundary factor for Gsplat centers against view frustum.
     * 1.0 clips any centers that are exactly out of bounds, while 1.4 clips
     * centers that are 40% beyond the bounds.
     * @default 1.4
     */
    clipXY?: number;
    /**
     * Parameter to adjust projected splat scale calculation to match other renderers,
     * similar to the same parameter in the MKellogg 3DGS renderer. Higher values will
     * tend to sharpen the splats. A value 2.0 can be used to match the behavior of
     * the PlayCanvas renderer.
     * @default 1.0
     */
    focalAdjustment?: number;
    /**
     * Configures the SparkViewpointOptions for the default SparkViewpoint
     * associated with this SparkRenderer. Notable option: sortRadial (sort by
     * radial distance or Z-depth)
     */
    view?: SparkViewpointOptions;
    /**
     * Override the default splat encoding ranges for the PackedSplats.
     * (default: undefined)
     */
    splatEncoding?: SplatEncoding;
};
export declare class SparkRenderer extends THREE.Mesh {
    renderer: THREE.WebGLRenderer;
    premultipliedAlpha: boolean;
    material: THREE.ShaderMaterial;
    uniforms: ReturnType<typeof SparkRenderer.makeUniforms>;
    autoUpdate: boolean;
    preUpdate: boolean;
    needsUpdate: boolean;
    originDistance: number;
    maxStdDev: number;
    maxPixelRadius: number;
    minAlpha: number;
    enable2DGS: boolean;
    preBlurAmount: number;
    blurAmount: number;
    focalDistance: number;
    apertureAngle: number;
    falloff: number;
    clipXY: number;
    focalAdjustment: number;
    splatEncoding: SplatEncoding;
    splatTexture: null | {
        enable?: boolean;
        texture?: THREE.Data3DTexture;
        multiply?: THREE.Matrix2;
        add?: THREE.Vector2;
        near?: number;
        far?: number;
        mid?: number;
    };
    time?: number;
    deltaTime?: number;
    clock: THREE.Clock;
    active: SplatAccumulator;
    private freeAccumulators;
    private accumulatorCount;
    defaultView: SparkViewpoint;
    autoViewpoints: SparkViewpoint[];
    private rotateToAccumulator;
    private translateToAccumulator;
    private modifier;
    private lastFrame;
    private lastUpdateTime;
    private defaultCameras;
    private lastStochastic;
    viewpoint: SparkViewpoint;
    private pendingUpdate;
    private envViewpoint;
    private static cubeRender;
    private static pmrem;
    static EMPTY_SPLAT_TEXTURE: THREE.Data3DTexture;
    constructor(options: SparkRendererOptions);
    static makeUniforms(): {
        renderSize: {
            value: THREE.Vector2;
        };
        near: {
            value: number;
        };
        far: {
            value: number;
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
        maxPixelRadius: {
            value: number;
        };
        minAlpha: {
            value: number;
        };
        stochastic: {
            value: boolean;
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
        focalDistance: {
            value: number;
        };
        apertureAngle: {
            value: number;
        };
        falloff: {
            value: number;
        };
        clipXY: {
            value: number;
        };
        focalAdjustment: {
            value: number;
        };
        splatTexEnable: {
            value: boolean;
        };
        splatTexture: {
            type: string;
            value: THREE.Data3DTexture;
        };
        splatTexMul: {
            value: THREE.Matrix2;
        };
        splatTexAdd: {
            value: THREE.Vector2;
        };
        splatTexNear: {
            value: number;
        };
        splatTexFar: {
            value: number;
        };
        splatTexMid: {
            value: number;
        };
        packedSplats: {
            type: string;
            value: THREE.DataArrayTexture;
        };
        rgbMinMaxLnScaleMinMax: {
            value: THREE.Vector4;
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
    newViewpoint(options: SparkViewpointOptions): SparkViewpoint;
    onBeforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
    prepareViewpoint(viewpoint?: SparkViewpoint): void;
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
