import { PackedSplats } from './PackedSplats';
import { SplatMesh } from './SplatMesh';
import * as THREE from "three";
export declare function constructGrid({ splats, extents, stepSize, pointRadius, pointShadowScale, opacity, color, }: {
    splats: PackedSplats;
    extents: THREE.Box3;
    stepSize?: number;
    pointRadius?: number;
    pointShadowScale?: number;
    opacity?: number;
    color?: THREE.Color | ((color: THREE.Color, point: THREE.Vector3) => void);
}): void;
export declare function constructAxes({ splats, scale, axisRadius, axisShadowScale, origins, }: {
    splats: PackedSplats;
    scale?: number;
    axisRadius?: number;
    axisShadowScale?: number;
    origins?: THREE.Vector3[];
}): void;
export declare function constructSpherePoints({ splats, origin, radius, maxDepth, filter, pointRadius, pointThickness, color, }: {
    splats: PackedSplats;
    origin?: THREE.Vector3;
    radius?: number;
    maxDepth?: number;
    filter?: ((point: THREE.Vector3) => boolean) | null;
    pointRadius?: number;
    pointThickness?: number;
    color?: THREE.Color | ((color: THREE.Color, point: THREE.Vector3) => void);
}): void;
export declare function textSplats({ text, font, fontSize, color, rgb, dotRadius, textAlign, lineHeight, objectScale, }: {
    text: string;
    font?: string;
    fontSize?: number;
    color?: THREE.Color;
    rgb?: THREE.Color;
    dotRadius?: number;
    textAlign?: "left" | "center" | "right" | "start" | "end";
    lineHeight?: number;
    objectScale?: number;
}): SplatMesh;
export declare function imageSplats({ url, dotRadius, subXY, forEachSplat, }: {
    url: string;
    dotRadius?: number;
    subXY?: number;
    forEachSplat?: (width: number, height: number, index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => number | null;
}): SplatMesh;
