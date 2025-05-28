import { PackedSplats } from './PackedSplats';
import { GsplatGenerator, SplatGenerator, SplatModifier } from './SplatGenerator';
import * as THREE from "three";
export type GeneratorMapping = {
    node: SplatGenerator;
    generator?: GsplatGenerator;
    version: number;
    base: number;
    count: number;
};
export declare class SplatAccumulator {
    splats: PackedSplats;
    toWorld: THREE.Matrix4;
    mapping: GeneratorMapping[];
    refCount: number;
    splatsVersion: number;
    mappingVersion: number;
    ensureGenerate(maxSplats: number): void;
    generateSplats({ renderer, modifier, generators, forceUpdate, originToWorld, }: {
        renderer: THREE.WebGLRenderer;
        modifier: SplatModifier;
        generators: GeneratorMapping[];
        forceUpdate?: boolean;
        originToWorld: THREE.Matrix4;
    }): boolean;
    hasCorrespondence(other: SplatAccumulator): boolean;
}
