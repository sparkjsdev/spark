import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GeneratorMapping } from './SplatAccumulator';
import { GsplatGenerator, SplatGenerator } from './SplatGenerator';
import { SplatMesh } from './SplatMesh';
import { DynoBool, DynoProgram, DynoProgramTemplate, DynoVec3 } from './dyno';
import * as THREE from "three";
export declare class NewSplatAccumulator {
    time: number;
    deltaTime: number;
    viewToWorld: THREE.Matrix4;
    viewOrigin: THREE.Vector3;
    viewDirection: THREE.Vector3;
    static viewCenterUniform: DynoVec3<THREE.Vector3, "value">;
    static viewDirUniform: DynoVec3<THREE.Vector3, "value">;
    static sortRadialUniform: DynoBool<string>;
    maxSplats: number;
    numSplats: number;
    target: THREE.WebGLArrayRenderTarget | null;
    mapping: GeneratorMapping[];
    version: number;
    mappingVersion: number;
    constructor();
    dispose(): void;
    getTextures(): THREE.DataArrayTexture[];
    static emptyTexture: THREE.DataArrayTexture;
    static emptyTextures: THREE.DataArrayTexture[];
    generateMapping(splatCounts: number[]): {
        maxSplats: number;
        mapping: {
            base: number;
            count: number;
        }[];
    };
    ensureGenerate({ maxSplats }: {
        maxSplats: number;
    }): boolean;
    private saveRenderState;
    private resetRenderState;
    prepareProgramMaterial(generator: GsplatGenerator): {
        program: DynoProgram;
        material: THREE.RawShaderMaterial;
    };
    static programTemplate: DynoProgramTemplate;
    static generatorProgram: Map<GsplatGenerator, DynoProgram>;
    static fullScreenQuad: FullScreenQuad;
    generate({ generator, base, count, renderer, }: {
        generator: GsplatGenerator;
        base: number;
        count: number;
        renderer: THREE.WebGLRenderer;
    }): {
        nextBase: number;
    };
    prepareGenerate({ renderer, scene, time, camera, sortRadial, renderSize, previous, lodInstances, }: {
        renderer: THREE.WebGLRenderer;
        scene: THREE.Scene;
        time: number;
        camera: THREE.Camera;
        sortRadial: boolean;
        renderSize: THREE.Vector2;
        previous: NewSplatAccumulator;
        lodInstances?: Map<SplatMesh, {
            numSplats: number;
            texture: THREE.DataTexture;
        }>;
    }): {
        sameMapping: boolean;
        version: number;
        mappingVersion: number;
        visibleGenerators: SplatGenerator[];
        generate: () => void;
    };
    checkVersions(otherMapping: GeneratorMapping[]): {
        splatsUpdated: boolean;
        mappingUpdated: boolean;
    };
}
