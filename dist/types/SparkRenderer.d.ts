import { ExtSplats, PackedSplats, PagedSplats, SplatMesh, SplatPager } from '.';
import { SplatAccumulator } from './SplatAccumulator';
import { SplatWorker } from './SplatWorker';
import * as THREE from "three";
export interface SparkRendererOptions {
    /**
     * Pass in your THREE.WebGLRenderer instance so Spark can perform work
     * outside the usual render loop. Should be created with antialias: false
     * (default setting) as WebGL anti-aliasing doesn't improve Gaussian Splatting
     * rendering and significantly reduces performance.
     */
    renderer: THREE.WebGLRenderer;
    /**
     * Callback function to be called when SparkRenderer needs to re-render,
     * for example when splat sort order or LoD updates complete.
     */
    onDirty?: () => void;
    /**
     * Whether to use premultiplied alpha when accumulating splat RGB
     * @default true
     */
    premultipliedAlpha?: boolean;
    /**
     * Whether to encode Gsplat with linear RGB (for environment mapping)
     * @default false
     */
    encodeLinear?: boolean;
    /**
     * Pass in a THREE.Clock to synchronize time-based effects across different
     * systems. Alternatively, you can set the property time directly.
     * (default: new THREE.Clock)
     */
    clock?: THREE.Clock;
    /**
     * Controls whether to check and automatically update Gsplat collection
     * each frame render.
     * @default true
     */
    autoUpdate?: boolean;
    /**
     * Controls whether to update the Gsplats before or after rendering. For WebXR
     * this is set to false in order to complete rendering as soon as possible.
     * @default true (if not WebXR)
     */
    preUpdate?: boolean;
    /**
     * Maximum standard deviations from the center to render Gaussians. Values
     * Math.sqrt(4)..Math.sqrt(9) produce acceptable results and can be tweaked for
     * performance.
     * @default Math.sqrt(8)
     */
    maxStdDev?: number;
    minPixelRadius?: number;
    /**
     * Maximum pixel radius for splat rendering.
     * @default 512.0
     */
    maxPixelRadius?: number;
    /**
     * Whether to use extended Gsplat encoding for intermediary accumulator splats.
     * @default false
     */
    accumExtSplats?: boolean;
    /**
     * Whether to use covariance Gsplat encoding for intermediary splats.
     * @default false
     */
    covSplats?: boolean;
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
     * Enable alternative ray-splat max response evaluation, used by 3DGUT (unscented transform),
     * 3DGRT, and HTGS.
     * @default false
     */
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
     * Whether to sort splats radially (geometric distance) from the viewpoint (true)
     * or by Z-depth (false). Most scenes are trained with the Z-depth `sort `metric
     * and will render more accurately at certain viewpoints. However, radial sorting
     * is more stable under viewpoint rotations.
     * @default true
     */
    sortRadial?: boolean;
    /**
     * Minimum interval between sort calls in milliseconds.
     * @default 0
     */
    minSortIntervalMs?: number;
    enableLod?: boolean;
    /**
     * Whether to drive LOD updates (compute lodInstances, update pager, etc.).
     * Set to false to use LOD instances from another renderer without driving updates.
     * Only has effect if enableLod is true.
     * @default true (if enableLod is true)
     */
    enableDriveLod?: boolean;
    /**
     * Whether to enable page fetching for LoD.
     * @default true
     */
    enableLodFetching?: boolean;
    /**
     * Set the target # splats for LoD. If this isn't set then default base LoD splat
     * counts will apply: 500K-750K for WebXR, 1-1.5M for mobile, and 2.5M for desktop.
     * @default 500K-2500K depending on platform
     */
    lodSplatCount?: number;
    /**
     * Scale factor for target # splats for LoD. 2.0 means 2x the base LoD splat count.
     * This is the easiest LoD parameter to adjust and will scale detail appropriately
     * for the platform.
     * @default 1.0
     */
    lodSplatScale?: number;
    /**
     * Determines the minimum screen pixel size of LoD splats. The default 1.0 means
     * the splat LoD tree will pick splats that are no smaller than 1 pixel in size.
     * Setting this to a higher value as high as 5.0 will often be indistinguishable
     * but will avoid wasting rendering capacity on tiny splats.
     * @default 1.0
     */
    lodRenderScale?: number;
    /**
     * Inflate LoD splats to ensure opacity stays <= 1.0, producing a softer appearance.
     * @default false
     */
    lodInflate?: boolean;
    /**
     * Whether to use extended Gsplat encoding for paged splats, useful for eliminating
     * quantization artifacts from splat scenes with large internal position coordinates.
     * @default false
     */
    pagedExtSplats?: boolean;
    /**
     * Allocation size of paged splats. This must be a multiple of the page size (65536).
     * @default 16777216 (256 * 65536) for desktop, 6291456 for iOS, 8,388,608 for other mobile
     */
    maxPagedSplats?: number;
    /**
     * Number of parallel chunk fetchers for LoD. These are run within a shared pool
     * of 4 background WebWorker threads, so setting it above 4 will not have any
     * effect. Setting it 3 leaves one spare worker for other loading/decoding tasks.
     * @default 3
     */
    numLodFetchers?: number;
    /**
     * Full-width angle in degrees of fixed foveation cone along the view direction
     * with no foveation applied (full resolution, foveate=1.0). Set to 0 to disable.
     * @default 90.0
     */
    coneFov0?: number;
    /**
     * Full-width angle in degrees of fixed foveation cone along the view direction
     * with reduced resolution specified by `coneFoveate`. Foveation will be applied
     * smoothly from 1.0 down to `coneFoveate` as you move outward from
     * `coneFov0` to `coneFov`. Set to 0 to disable.
     * @default 120.0
     */
    coneFov?: number;
    /**
     * Foveation scale to apply to LoD splats at the edge of coneFov. Foveation will
     * be applied smoothly from `coneFoveate` down to `behindFoveate` as you move
     * outward from `coneFov` to 180 degrees (behind the viewer).
     * @default 0.4
     */
    coneFoveate?: number;
    /**
     * Foveation scale to apply to LoD splats behind the viewer. Setting this to 0.1
     * for example will result in splats 10x larger than inside the viewing frustum.
     * @default 0.2
     */
    behindFoveate?: number;
    /**
     * How many LoD splats to generate for raycasting
     * @default 10000-25000 iff default canvas target is used
     */
    lodRaycast?: number;
    lodRaycastIntervalMs?: number;
    /**
     * Configures an offline render target for the SparkRenderer (as opposed to
     * rendering to the canvas). This is useful for rendering environment maps,
     * additional viewpoints, or video frame rendering.
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
    } & THREE.RenderTargetOptions;
    /**
     * Extra uniform values to pass to the shader.
     * @default undefined = no extra uniforms
     */
    extraUniforms?: Record<string, unknown>;
    /**
     * Replace the default `splatVertex.glsl` splat shader with a custom one.
     * @default undefined = use the default `splatVertex.glsl` shader
     */
    vertexShader?: string;
    /**
     * Replace the default `splatFragment.glsl` splat shader with a custom one.
     * @default undefined = use the default `splatFragment.glsl` shader
     */
    fragmentShader?: string;
    /**
     * Set the splat shader material to be transparent which determines if the
     * splats are rendered during the first opaque THREE.js render pass or the
     * second transparent render pass.
     * @default undefined = true
     */
    transparent?: boolean;
    /**
     * Set the splat shader material to enable depth testing which determines if the
     * splats respect the Z depth buffer and blend with other opaque objects in the scene.
     * @default undefined = true
     */
    depthTest?: boolean;
    /**
     * Set the splat shader material to enable depth writing which determines if the
     * splats write to the Z depth buffer. Note that enabling this may produce
     * undesirable results because most of the Gsplat is transparent.
     * @default undefined = false
     */
    depthWrite?: boolean;
}
export declare class SparkRenderer extends THREE.Mesh {
    readonly renderer: THREE.WebGLRenderer;
    readonly material: THREE.ShaderMaterial;
    readonly uniforms: ReturnType<typeof SparkRenderer.makeUniforms>;
    autoUpdate: boolean;
    preUpdate: boolean;
    static sparkOverride?: SparkRenderer;
    renderSize: THREE.Vector2;
    maxStdDev: number;
    minPixelRadius: number;
    maxPixelRadius: number;
    accumExtSplats: boolean;
    covSplats: boolean;
    minAlpha: number;
    enable2DGS: boolean;
    preBlurAmount: number;
    blurAmount: number;
    focalDistance: number;
    apertureAngle: number;
    falloff: number;
    clipXY: number;
    focalAdjustment: number;
    encodeLinear: boolean;
    sortRadial: boolean;
    minSortIntervalMs: number;
    clock: THREE.Clock;
    time?: number;
    lastFrame: number;
    updateTimeoutId: number;
    onDirty?: () => void;
    dirty: boolean;
    orderingTexture: THREE.DataTexture | null;
    maxSplats: number;
    activeSplats: number;
    display: SplatAccumulator;
    current: SplatAccumulator;
    accumulators: SplatAccumulator[];
    sorting: boolean;
    sortDirty: boolean;
    lastSortTime: number;
    sortWorker: SplatWorker | null;
    sortTimeoutId: number;
    sortedCenter: THREE.Vector3;
    sortedDir: THREE.Vector3;
    readback32: Uint32Array<ArrayBuffer>;
    enableLod: boolean;
    enableDriveLod: boolean;
    enableLodFetching: boolean;
    lodSplatCount?: number;
    lodSplatScale: number;
    lodRenderScale: number;
    lodInflate: boolean;
    pagedExtSplats: boolean;
    maxPagedSplats: number;
    numLodFetchers: number;
    behindFoveate: number;
    coneFov0: number;
    coneFov: number;
    coneFoveate: number;
    lodRaycast?: number;
    lodRaycastIntervalMs: number;
    lastLodRaycastTime: number;
    lodWorker: SplatWorker | null;
    lodMeshes: {
        mesh: SplatMesh;
        version: number;
    }[];
    lodDirty: boolean;
    lodIds: Map<PackedSplats | ExtSplats | PagedSplats, {
        lodId: number;
        lastTouched: number;
        rootPage?: number;
    }>;
    lodIdToSplats: Map<number, PackedSplats | ExtSplats | PagedSplats>;
    lodInitQueue: (PackedSplats | ExtSplats | PagedSplats)[];
    lastLod?: {
        pos: THREE.Vector3;
        quat: THREE.Quaternion;
        pixelScaleLimit: number;
        maxSplats: number;
        timestamp: number;
    };
    currentLod?: {
        pos: THREE.Vector3;
        quat: THREE.Quaternion;
        pixelScaleLimit: number;
        maxSplats: number;
        timestamp: number;
    };
    lodPosOverride?: THREE.Vector3;
    lodQuatOverride?: THREE.Quaternion;
    lodInstances: Map<SplatMesh, {
        lodId: number;
        numSplats: number;
        indices: Uint32Array;
        texture: THREE.DataTexture;
    }>;
    lodUpdates: {
        lodId: number;
        pageBase: number;
        chunkBase: number;
        count: number;
        lodTreeData?: Uint32Array;
    }[];
    lastTraverseTime: number;
    lastPixelLimit?: number;
    pager?: SplatPager;
    pagerId: number;
    target?: THREE.WebGLRenderTarget;
    backTarget?: THREE.WebGLRenderTarget;
    superPixels?: Uint8Array;
    targetPixels?: Uint8Array;
    superXY: number;
    flushAfterGenerate: boolean;
    flushAfterRead: boolean;
    readPause: number;
    sortPause: number;
    sortDelay: number;
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
        renderToViewQuat: {
            value: THREE.Quaternion;
        };
        renderToViewPos: {
            value: THREE.Vector3;
        };
        renderToViewBasis: {
            value: THREE.Matrix3;
        };
        renderToViewOffset: {
            value: THREE.Vector3;
        };
        maxStdDev: {
            value: number;
        };
        minPixelRadius: {
            value: number;
        };
        maxPixelRadius: {
            value: number;
        };
        minAlpha: {
            value: number;
        };
        enable2DGS: {
            value: boolean;
        };
        lodInflate: {
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
        encodeLinear: {
            value: boolean;
        };
        ordering: {
            type: string;
            value: THREE.DataTexture;
        };
        enableExtSplats: {
            value: boolean;
        };
        enableCovSplats: {
            value: boolean;
        };
        extSplats: {
            type: string;
            value: THREE.DataArrayTexture;
        };
        extSplats2: {
            type: string;
            value: THREE.DataArrayTexture;
        };
        time: {
            value: number;
        };
        deltaTime: {
            value: number;
        };
        debugFlag: {
            value: boolean;
        };
    };
    dispose(): void;
    setDirty(): void;
    onBeforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
    clearSplats(): void;
    update({ scene, camera, }: {
        scene: THREE.Scene;
        camera: THREE.Camera;
    }): Promise<void>;
    private updateInternal;
    private driveSort;
    private ensureLodWorker;
    defaultSplatTarget(): 500000 | 750000 | 1000000 | 1500000 | 2500000;
    private driveLod;
    private initLodTree;
    private pageSizeWarning;
    private updateLodInstances;
    private cleanupLodTrees;
    private updateLodIndices;
    private readbackDepth;
    private saveRenderState;
    private resetRenderState;
    private static emptyOrdering;
    render(scene: THREE.Scene, camera: THREE.Camera): void;
    renderTarget({ scene, camera, }: {
        scene: THREE.Scene;
        camera: THREE.Camera;
    }): THREE.WebGLRenderTarget;
    readTarget(): Promise<Uint8Array>;
    renderReadTarget({ scene, camera, }: {
        scene: THREE.Scene;
        camera: THREE.Camera;
    }): Promise<Uint8Array>;
    private static cubeRender;
    private static pmrem;
    renderCubeMap({ scene, worldCenter, size, near, far, hideObjects, update, filter, }: {
        scene: THREE.Scene;
        worldCenter: THREE.Vector3;
        size?: number;
        near?: number;
        far?: number;
        hideObjects: THREE.Object3D[];
        update: boolean;
        filter: boolean;
    }): Promise<THREE.CubeTexture>;
    readCubeTargets(): Promise<Uint8Array[]>;
    renderEnvMap({ scene, worldCenter, size, near, far, hideObjects, update, }: {
        scene: THREE.Scene;
        worldCenter: THREE.Vector3;
        size?: number;
        near?: number;
        far?: number;
        hideObjects: THREE.Object3D[];
        update: boolean;
    }): Promise<THREE.Texture>;
    recurseSetEnvMap(root: THREE.Object3D, envMap: THREE.Texture): void;
    getLodTreeLevel(splats: SplatMesh, level: number, pageColoring?: boolean): Promise<SplatMesh | null>;
    get premultipliedAlpha(): boolean;
    set premultipliedAlpha(value: boolean);
}
