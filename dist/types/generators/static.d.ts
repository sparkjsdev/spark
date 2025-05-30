import { SplatGenerator } from '../SplatGenerator';
import * as THREE from "three";
export declare function staticBox({ box, cells, dotScale, color, opacity, }: {
    box: THREE.Box3;
    cells: THREE.Vector3;
    dotScale: number;
    color?: THREE.Color;
    opacity?: number;
}): SplatGenerator;
