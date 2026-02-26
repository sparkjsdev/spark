import * as THREE from "three";
export declare class NewSparkMaterial extends THREE.MeshStandardMaterial {
    readonly splatUniforms: {
        renderSize: {
            value: THREE.Vector2;
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
        maxStdDev: {
            value: number;
        };
        minPixelRadius: {
            value: number;
        };
        maxPixelRadius: {
            value: number;
        };
        enableExtSplats: {
            value: boolean;
        };
        enableCovSplats: {
            value: boolean;
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
        minAlpha: {
            value: number;
        };
        enable2DGS: {
            value: boolean;
        };
        blurAmount: {
            value: number;
        };
        preBlurAmount: {
            value: number;
        };
        focalDistance: {
            value: number;
        };
        apertureAngle: {
            value: number;
        };
        clipXY: {
            value: number;
        };
        focalAdjustment: {
            value: number;
        };
        ordering: {
            value: THREE.DataTexture;
        };
        extSplats: {
            value: THREE.DataArrayTexture;
        };
        extSplats2: {
            value: THREE.DataArrayTexture;
        };
        encodeLinear: {
            value: boolean;
        };
        falloff: {
            value: number;
        };
    };
    constructor(parameters?: THREE.MeshStandardMaterialParameters);
    customProgramCacheKey(): string;
}
