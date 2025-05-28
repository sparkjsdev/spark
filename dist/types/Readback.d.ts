import { Dyno } from './dyno';
import { DynoProgram, DynoProgramTemplate } from './dyno/program';
import * as THREE from "three";
export type Rgba8Readback = Dyno<{
    index: "int";
}, {
    rgba8: "vec4";
}>;
export type ReadbackBuffer = ArrayBuffer | Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array;
export declare class Readback {
    renderer?: THREE.WebGLRenderer;
    target?: THREE.WebGLArrayRenderTarget;
    capacity: number;
    count: number;
    constructor({ renderer }?: {
        renderer?: THREE.WebGLRenderer;
    });
    dispose(): void;
    ensureBuffer<B extends ReadbackBuffer>(count: number, buffer: B): B;
    ensureCapacity(capacity: number): void;
    prepareProgramMaterial(reader: Rgba8Readback): {
        program: DynoProgram;
        material: THREE.RawShaderMaterial;
    };
    private saveRenderState;
    private resetRenderState;
    private process;
    private read;
    render({ reader, count, renderer, }: {
        reader: Rgba8Readback;
        count: number;
        renderer?: THREE.WebGLRenderer;
    }): void;
    readback<B extends ReadbackBuffer>({ readback, }: {
        readback: B;
    }): Promise<B>;
    renderReadback<B extends ReadbackBuffer>({ reader, count, renderer, readback, }: {
        reader: Rgba8Readback;
        count: number;
        renderer?: THREE.WebGLRenderer;
        readback: B;
    }): Promise<B>;
    getTexture(): THREE.DataArrayTexture | undefined;
    static programTemplate: DynoProgramTemplate | null;
    static readbackProgram: Map<Rgba8Readback, DynoProgram>;
    static geometry: THREE.PlaneGeometry;
    static mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial, THREE.Object3DEventMap>;
    static scene: THREE.Scene;
    static camera: THREE.Camera;
}
