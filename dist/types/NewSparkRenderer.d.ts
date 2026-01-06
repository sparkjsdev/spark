import { ExtSplats, PackedSplats, PagedSplats, SplatMesh, SplatPager } from '.';
import { NewSplatAccumulator } from './NewSplatAccumulator';
import { NewSplatWorker } from './NewSplatWorker';
import * as THREE from "three";
export interface NewSparkRendererOptions {
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
     * Controls whether to check and automatically update Gsplat collection after
     * each frame render.
     * @default true
     */
    autoUpdate?: boolean;
    /**
     * Controls whether to update the Gsplats before or after rendering. For WebXR
     * this must be false in order to complete rendering as soon as possible.
     * @default true
     */
    preUpdate?: boolean;
    /**
     * Maximum standard deviations from the center to render Gaussians. Values
     * Math.sqrt(5)..Math.sqrt(8) produce good results and can be tweaked for
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
     * Whether to use extended Gsplat encoding for intermediary splats.
     * @default false
     */
    extSplats?: boolean | "cov";
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
     * Whether to sort splats radially (geometric distance) from the viewpoint (true)
     * or by Z-depth (false). Most scenes are trained with the Z-depth `sort `metric
     * and will render more accurately at certain viewpoints. However, radial sorting
     * is more stable under viewpoint rotations.
     * @default true
     */
    sortRadial?: boolean;
    /**
     * Minimum interval between sort calls in milliseconds.
     * @default 1
     */
    minSortIntervalMs?: number;
    /**
     * Minimum interval between LOD calls in milliseconds.
     * @default 1
     */
    minLodIntervalMs?: number;
    enableLod?: boolean;
    /**
     * Whether to drive LOD updates (compute lodInstances, update pager, etc.).
     * Set to false to use LOD instances from another renderer without driving updates.
     * Only has effect if enableLod is true.
     * @default true (if enableLod is true)
     */
    enableDriveLod?: boolean;
    /**
     * Set the target # splats for LoD. Recommended # splats is 500K for mobile and 1.5M for desktop,
     * which is set automatically if this isn't set.
     */
    lodSplatCount?: number;
    /**
     * Scale factor for target # splats for LoD. 2.0 means 2x the recommended # splats.
     * Recommended # splats is 500K for mobile and 1.5M for desktop.
     * @default 1.0
     */
    lodSplatScale?: number;
    /**
     * Scale factor for render size. 2.0 means 2x the render size.
     * @default 1.0
     */
    renderScale?: number;
    globalLodScale?: number;
    /**
     * Allocation size of paged splats
     * @default 16777216
     */
    maxPagedSplats?: number;
    outsideFoveate?: number;
    behindFoveate?: number;
    coneFov0?: number;
    coneFov?: number;
    coneFoveate?: number;
    numLodFetchers?: number;
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
    extraUniforms?: Record<string, unknown>;
    vertexShader?: string;
    fragmentShader?: string;
    transparent?: boolean;
    depthTest?: boolean;
    depthWrite?: boolean;
}
export declare class NewSparkRenderer extends THREE.Mesh {
    renderer: THREE.WebGLRenderer;
    premultipliedAlpha: boolean;
    material: THREE.ShaderMaterial;
    uniforms: ReturnType<typeof NewSparkRenderer.makeUniforms>;
    autoUpdate: boolean;
    preUpdate: boolean;
    static sparkOverride?: NewSparkRenderer;
    renderSize: THREE.Vector2;
    maxStdDev: number;
    minPixelRadius: number;
    maxPixelRadius: number;
    extSplats: boolean | "cov";
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
    clock: THREE.Clock;
    time?: number;
    lastFrame: number;
    updateTimeoutId: number;
    orderingTexture: THREE.DataTexture | null;
    maxSplats: number;
    activeSplats: number;
    display: NewSplatAccumulator;
    current: NewSplatAccumulator;
    accumulators: NewSplatAccumulator[];
    sorting: boolean;
    sortDirty: boolean;
    lastSortTime: number;
    sortWorker: NewSplatWorker | null;
    sortTimeoutId: number;
    sortedCenter: THREE.Vector3;
    sortedDir: THREE.Vector3;
    readback32: Uint32Array<ArrayBuffer>;
    minSortIntervalMs: number;
    minLodIntervalMs: number;
    enableLod: boolean;
    enableDriveLod: boolean;
    lodSplatCount?: number;
    lodSplatScale: number;
    renderScale: number;
    globalLodScale: number;
    maxPagedSplats: number;
    outsideFoveate: number;
    behindFoveate: number;
    coneFov0: number;
    coneFov: number;
    coneFoveate: number;
    numLodFetchers: number;
    lodWorker: NewSplatWorker | null;
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
    lodPos: THREE.Vector3;
    lodQuat: THREE.Quaternion;
    lodInstances: Map<SplatMesh, {
        lodId: number;
        numSplats: number;
        indices: Uint32Array;
        texture: THREE.DataTexture;
    }>;
    lodFetchers: Promise<void>[];
    chunksToFetch: {
        lodId: number;
        chunk: number;
    }[];
    lodUpdates: {
        lodId: number;
        pageBase: number;
        chunkBase: number;
        count: number;
        lodTreeData?: Uint32Array;
    }[];
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
    constructor(options: NewSparkRendererOptions);
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
        extSplatsMode: {
            value: number;
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
    onBeforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
    update({ scene, camera, }: {
        scene: THREE.Scene;
        camera: THREE.Camera;
    }): Promise<void>;
    private updateInternal;
    private driveSort;
    private ensureLodWorker;
    private driveLod;
    private initLodTree;
    private pageSizeWarning;
    private updateLodInstances;
    private driveLodFetchers;
    private fetchLodChunk;
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
}
