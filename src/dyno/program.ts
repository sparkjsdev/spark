import * as THREE from "three";

import { IDENT_VERTEX_SHADER } from "../utils";
import { Compilation, type Dyno, type IOTypes } from "./base";

export class DynoProgram {
  graph: Dyno<IOTypes, IOTypes>;
  template: DynoProgramTemplate;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  shader: string;
  uniforms: Record<string, THREE.IUniform>;
  updaters: (() => void)[];

  constructor({
    graph,
    inputs,
    outputs,
    template,
  }: {
    graph: Dyno<IOTypes, IOTypes>;
    inputs?: Record<string, string>;
    outputs?: Record<string, string>;
    template: DynoProgramTemplate;
  }) {
    this.graph = graph;
    this.template = template;
    this.inputs = inputs ?? {};
    this.outputs = outputs ?? {};

    const compile = new Compilation({ indent: this.template.indent });
    for (const key in this.outputs) {
      if (this.outputs[key]) {
        compile.declares.add(this.outputs[key]);
      }
    }
    const statements = graph.compile({
      inputs: this.inputs,
      outputs: this.outputs,
      compile,
    });

    this.shader = template.generate({ globals: compile.globals, statements });
    this.uniforms = compile.uniforms;
    this.updaters = compile.updaters;
    // console.log("*** COMPILED SHADER", this.shader);
    // console.log("*** UNIFORMS", this.uniforms);
  }

  prepareMaterial(): THREE.RawShaderMaterial {
    return getMaterial(this);
  }

  update() {
    for (const updater of this.updaters) {
      updater();
    }
  }
}

export class DynoProgramTemplate {
  before: string;
  between: string;
  after: string;
  indent: string;

  constructor(template: string) {
    const globals = template.match(/^([ \t]*)\{\{\s*GLOBALS\s*\}\}/m);
    const statements = template.match(/^([ \t]*)\{\{\s*STATEMENTS\s*\}\}/m);
    if (!globals || !statements) {
      throw new Error(
        "Template must contain {{ GLOBALS }} and {{ STATEMENTS }}",
      );
    }

    this.before = template.substring(0, globals.index);
    this.between = template.substring(
      (globals.index as number) + globals[0].length,
      statements.index,
    );
    this.after = template.substring(
      (statements.index as number) + statements[0].length,
    );
    this.indent = statements[1];
  }

  generate({
    globals,
    statements,
  }: { globals: Set<string>; statements: string[] }): string {
    return (
      this.before +
      Array.from(globals).join("\n\n") +
      this.between +
      statements.map((s) => this.indent + s).join("\n") +
      this.after
    );
  }
}

const programMaterial = new WeakMap<DynoProgram, THREE.RawShaderMaterial>();

function getMaterial(program: DynoProgram): THREE.RawShaderMaterial {
  let material = programMaterial.get(program);
  if (material) {
    return material;
  }

  material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: IDENT_VERTEX_SHADER,
    fragmentShader: program.shader,
    uniforms: program.uniforms,
  });
  programMaterial.set(program, material);
  return material;
}
