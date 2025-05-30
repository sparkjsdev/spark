import { Dyno, IOTypes } from './base';
import * as THREE from "three";
export declare class DynoProgram {
    graph: Dyno<IOTypes, IOTypes>;
    template: DynoProgramTemplate;
    inputs: Record<string, string>;
    outputs: Record<string, string>;
    shader: string;
    uniforms: Record<string, THREE.IUniform>;
    updaters: (() => void)[];
    constructor({ graph, inputs, outputs, template, }: {
        graph: Dyno<IOTypes, IOTypes>;
        inputs?: Record<string, string>;
        outputs?: Record<string, string>;
        template: DynoProgramTemplate;
    });
    prepareMaterial(): THREE.RawShaderMaterial;
    update(): void;
}
export declare class DynoProgramTemplate {
    before: string;
    between: string;
    after: string;
    indent: string;
    constructor(template: string);
    generate({ globals, statements, }: {
        globals: Set<string>;
        statements: string[];
    }): string;
}
