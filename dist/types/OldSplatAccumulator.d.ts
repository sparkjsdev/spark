import { PackedSplats } from './PackedSplats';
import { GeneratorMapping } from './SplatAccumulator';
import { SplatModifier } from './SplatGenerator';
import * as THREE from "three";
export declare class OldSplatAccumulator {
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
    hasCorrespondence(other: OldSplatAccumulator): boolean;
}
