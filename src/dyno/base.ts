import type { IUniform } from "three";
import type { DynoType } from "./types";
import {
  DynoLiteral,
  DynoOutput,
  type DynoVal,
  DynoValue,
  type HasDynoOut,
  valType,
} from "./value";

const DEFAULT_INDENT = "    ";

export class Compilation {
  globals: Set<string> = new Set();
  statements: string[] = [];
  uniforms: Record<string, IUniform> = {};
  declares: Set<string> = new Set();
  updaters: (() => void)[] = [];
  sequence = 0;
  indent: string = DEFAULT_INDENT;

  constructor({ indent }: { indent?: string } = {}) {
    this.indent = indent ?? DEFAULT_INDENT;
  }

  nextSequence() {
    return this.sequence++;
  }
}

export type IOTypes = Record<string, DynoType>;
type GenerateContext<InTypes extends IOTypes, OutTypes extends IOTypes> = {
  inputs: { [K in keyof InTypes]?: string };
  outputs: { [K in keyof OutTypes]?: string };
  compile: Compilation;
};

export class Dyno<InTypes extends IOTypes, OutTypes extends IOTypes> {
  inTypes: InTypes;
  outTypes: OutTypes;

  inputs: { [K in keyof InTypes]?: DynoVal<InTypes[K]> };
  update?: () => void;
  globals?: ({
    inputs,
    outputs,
    compile,
  }: GenerateContext<InTypes, OutTypes>) => string[];
  statements?: ({
    inputs,
    outputs,
    compile,
  }: GenerateContext<InTypes, OutTypes>) => string[];
  generate: ({
    inputs,
    outputs,
    compile,
  }: GenerateContext<InTypes, OutTypes>) => {
    globals?: string[];
    statements?: string[];
    uniforms?: Record<string, IUniform>;
  };

  constructor({
    inTypes,
    outTypes,
    inputs,
    update,
    globals,
    statements,
    generate,
  }: {
    inTypes?: InTypes;
    outTypes?: OutTypes;
    inputs?: { [K in keyof InTypes]?: DynoVal<InTypes[K]> };
    update?: () => void;
    globals?: ({
      inputs,
      outputs,
      compile,
    }: GenerateContext<InTypes, OutTypes>) => string[];
    statements?: ({
      inputs,
      outputs,
      compile,
    }: GenerateContext<InTypes, OutTypes>) => string[];
    generate?: ({
      inputs,
      outputs,
      compile,
    }: GenerateContext<InTypes, OutTypes>) => {
      globals?: string[];
      statements?: string[];
      uniforms?: Record<string, IUniform>;
    };
  }) {
    this.inTypes = inTypes ?? ({} as InTypes);
    this.outTypes = outTypes ?? ({} as OutTypes);
    this.inputs = inputs ?? {};
    this.update = update;

    this.globals = globals;
    this.statements = statements;
    this.generate =
      generate ??
      (({ inputs, outputs, compile }) => {
        return {
          globals: this.globals?.({ inputs, outputs, compile }),
          statements: this.statements?.({ inputs, outputs, compile }),
        };
      });
  }

  get outputs(): { [K in keyof OutTypes]: DynoVal<OutTypes[K]> } {
    const outputs = {} as { [K in keyof OutTypes]: DynoVal<OutTypes[K]> };
    for (const key in this.outTypes) {
      outputs[key] = new DynoOutput(this, key);
    }
    return outputs;
  }

  apply(inputs: { [K in keyof InTypes]?: DynoVal<InTypes[K]> }): {
    [K in keyof OutTypes]: DynoVal<OutTypes[K]>;
  } {
    Object.assign(this.inputs, inputs);
    return this.outputs;
  }

  compile({
    inputs,
    outputs,
    compile,
  }: {
    inputs: { [K in keyof InTypes]?: string };
    outputs: { [K in keyof OutTypes]?: string };
    compile: Compilation;
  }): string[] {
    const result = [
      `// ${this.constructor.name}(${Object.values(inputs).join(", ")}) => (${Object.values(outputs).join(", ")})`,
    ];

    const declares: (keyof OutTypes)[] = [];
    for (const key in outputs) {
      const name = outputs[key];
      if (name && !compile.declares.has(name)) {
        compile.declares.add(name);
        declares.push(key);
      }
    }

    const { globals, statements, uniforms } = this.generate({
      inputs,
      outputs,
      compile,
    });
    for (const global of globals ?? []) {
      compile.globals.add(global);
    }
    for (const key in uniforms) {
      compile.uniforms[key] = uniforms[key];
    }
    if (this.update) {
      compile.updaters.push(this.update);
    }

    for (const key of declares) {
      const name = outputs[key];
      if (name) {
        if (!compile.uniforms[name]) {
          result.push(`${dynoDeclare(name, this.outTypes[key])};`);
        }
      }
    }

    if (statements?.length) {
      result.push("{");
      result.push(...statements.map((line) => compile.indent + line));
      result.push("}");
    }
    return result;
  }
}

export type DynoBlockType<InTypes extends IOTypes, OutTypes extends IOTypes> = (
  inputs: { [K in keyof InTypes]?: DynoVal<InTypes[K]> },
  outputs: { [K in keyof OutTypes]?: DynoVal<OutTypes[K]> },
  { roots }: { roots: Dyno<IOTypes, IOTypes>[] },
) => { [K in keyof OutTypes]?: DynoVal<OutTypes[K]> } | undefined;

export class DynoBlock<
  InTypes extends IOTypes,
  OutTypes extends IOTypes,
> extends Dyno<InTypes, OutTypes> {
  construct: DynoBlockType<InTypes, OutTypes>;

  constructor({
    inTypes,
    outTypes,
    inputs,
    update,
    globals,
    construct,
  }: {
    inTypes?: InTypes;
    outTypes?: OutTypes;
    inputs?: { [K in keyof InTypes]?: DynoVal<InTypes[K]> };
    update?: () => void;
    globals?: ({
      inputs,
      outputs,
      compile,
    }: GenerateContext<InTypes, OutTypes>) => string[];
    construct: DynoBlockType<InTypes, OutTypes>;
  }) {
    super({
      inTypes,
      outTypes,
      inputs,
      update,
      globals,
      generate: (args) => this.generateBlock(args),
    });
    this.construct = construct;
  }

  generateBlock({
    inputs,
    outputs,
    compile,
  }: {
    inputs: { [K in keyof InTypes]?: string };
    outputs: { [K in keyof OutTypes]?: string };
    compile: Compilation;
  }) {
    const blockInputs: { [K in keyof InTypes]?: DynoVal<InTypes[K]> } = {};
    const blockOutputs: { [K in keyof OutTypes]?: DynoVal<OutTypes[K]> } = {};

    for (const key in inputs) {
      if (inputs[key] != null) {
        blockInputs[key] = new DynoLiteral(this.inTypes[key], inputs[key]);
      }
    }
    for (const key in outputs) {
      if (outputs[key] != null) {
        blockOutputs[key] = new DynoValue(this.outTypes[key]);
      }
    }

    const options: { roots: Dyno<IOTypes, IOTypes>[] } = { roots: [] };
    const returned = this.construct(blockInputs, blockOutputs, options);

    for (const global of this.globals?.({ inputs, outputs, compile }) ?? []) {
      compile.globals.add(global);
    }

    const ordering: Dyno<IOTypes, IOTypes>[] = [];
    const nodeOuts = new Map<
      Dyno<IOTypes, IOTypes>,
      { sequence: number; outNames: Map<string, string>; newOuts: Set<string> }
    >();

    function visit(
      node: Dyno<IOTypes, IOTypes>,
      outKey?: string,
      outName?: string,
    ) {
      let outs = nodeOuts.get(node);
      if (!outs) {
        // First time visiting this node
        outs = {
          sequence: compile.nextSequence(),
          outNames: new Map(),
          newOuts: new Set(),
        };
        nodeOuts.set(node, outs);

        for (const key in node.inputs) {
          let input = node.inputs[key];
          while (input) {
            if (input instanceof DynoValue) {
              if (input instanceof DynoOutput) {
                visit(input.dyno, input.key);
              }
              break;
            }
            // Must be as HasDynoOut<T>
            if (typeof input.dynoOut !== "function") {
              throw new Error(
                `dynoOut is not a function for ${input.constructor.name}`,
              );
            }
            input = input.dynoOut();
          }
        }
        ordering.push(node);
      }
      if (outKey) {
        if (!outName) {
          outs.newOuts.add(outKey);
        }
        outs.outNames.set(outKey, outName ?? `${outKey}_${outs.sequence}`);
      }
    }

    for (const root of options.roots) {
      visit(root);
    }

    for (const key in blockOutputs) {
      let value = returned?.[key] ?? blockOutputs[key];
      while (value) {
        if (value instanceof DynoValue) {
          if (value instanceof DynoOutput) {
            visit(value.dyno, value.key, outputs[key]);
          }
          break;
        }
        // Must be as HasDynoOut<T>
        value = value.dynoOut();
      }
      blockOutputs[key] = value;
    }

    const steps = [];

    for (const dyno of ordering) {
      // compile.statements.push(`// ${dyno.constructor.name}(${Object.values(inputs).join(", ")}) => (${Object.values(outputs).join(", ")})`);

      const inputs: Record<string, string> = {};
      const outputs: Record<string, string> = {};

      for (const key in dyno.inputs) {
        let value = dyno.inputs[key];
        while (value) {
          if (value instanceof DynoValue) {
            if (value instanceof DynoLiteral) {
              inputs[key] = value.getLiteral();
            } else if (value instanceof DynoOutput) {
              const source = nodeOuts.get(value.dyno)?.outNames.get(value.key);
              if (!source) {
                throw new Error(
                  `Source not found for ${value.dyno.constructor.name}.${value.key}`,
                );
              }
              inputs[key] = source;
            }
            break;
          }
          // Must be as HasDynOut<T>
          value = value.dynoOut();
        }
      }

      const outs = nodeOuts.get(dyno) ?? { outNames: new Map() };
      for (const [key, name] of outs.outNames.entries()) {
        outputs[key] = name;
      }

      const newSteps = dyno.compile({ inputs, outputs, compile });
      steps.push(newSteps);
    }

    const literalOutputs = [];
    for (const key in outputs) {
      if (blockOutputs[key] instanceof DynoLiteral) {
        literalOutputs.push(
          `${outputs[key]} = ${blockOutputs[key].getLiteral()};`,
        );
      }
    }
    if (literalOutputs.length > 0) {
      steps.push(literalOutputs);
    }

    const statements = steps.flatMap((step, index) => {
      // Add a blank line between steps
      return index === 0 ? step : ["", ...step];
    });
    return { statements };
  }
}

export function dynoBlock<
  InTypes extends Record<string, DynoType>,
  OutTypes extends Record<string, DynoType>,
>(
  inTypes: InTypes,
  outTypes: OutTypes,
  construct: DynoBlockType<InTypes, OutTypes>,
  { update, globals }: { update?: () => void; globals?: () => string[] } = {},
) {
  return new DynoBlock({ inTypes, outTypes, construct, update, globals });
}

export function dyno<
  InTypes extends Record<string, DynoType>,
  OutTypes extends Record<string, DynoType>,
>({
  inTypes,
  outTypes,
  inputs,
  update,
  globals,
  statements,
  generate,
}: {
  inTypes: InTypes;
  outTypes: OutTypes;
  inputs?: { [K in keyof InTypes]?: DynoVal<InTypes[K]> };
  update?: () => void;
  globals?: ({
    inputs,
    outputs,
    compile,
  }: GenerateContext<InTypes, OutTypes>) => string[];
  statements?: ({
    inputs,
    outputs,
    compile,
  }: GenerateContext<InTypes, OutTypes>) => string[];
  generate?: ({
    inputs,
    outputs,
    compile,
  }: GenerateContext<InTypes, OutTypes>) => {
    globals?: string[];
    statements?: string[];
    uniforms?: Record<string, IUniform>;
  };
}) {
  return new Dyno({
    inTypes,
    outTypes,
    inputs,
    update,
    globals,
    statements,
    generate,
  });
}

export function dynoDeclare(name: string, type: DynoType, count?: number) {
  const typeStr = typeof type === "string" ? type : type.type;
  if (!typeStr) {
    throw new Error(`Invalid DynoType: ${String(type)}`);
  }
  return `${typeStr} ${name}${count != null ? `[${count}]` : ""}`;
}

export function unindentLines(s: string): string[] {
  let seenNonEmpty = false;
  const lines = s
    .split("\n")
    .map((line) => {
      const trimmedLine = line.trimEnd();
      if (seenNonEmpty) {
        return trimmedLine;
      }
      if (trimmedLine.length > 0) {
        seenNonEmpty = true;
        return trimmedLine;
      }
      return null;
    })
    .filter((line) => line != null);
  while (lines.length > 0 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }
  if (lines.length === 0) {
    return [];
  }

  const indent = lines[0].match(/^\s*/)?.[0];
  if (!indent) {
    return lines; // No indent, return as is
  }
  // Remove indent from the beginning of each line
  const regex = new RegExp(`^${indent}`);
  return lines.map((line) => line.replace(regex, ""));
}

export function unindent(s: string): string {
  return unindentLines(s).join("\n");
}

export class UnaryOp<
    A extends DynoType,
    OutType extends DynoType,
    OutKey extends string,
  >
  extends Dyno<{ a: A }, { [key in OutKey]: OutType }>
  implements HasDynoOut<OutType>
{
  constructor({
    a,
    outKey,
    outTypeFunc,
  }: { a: DynoVal<A>; outKey: OutKey; outTypeFunc: (aType: A) => OutType }) {
    const inTypes = { a: valType(a) };
    const outType = outTypeFunc(valType(a));
    const outTypes = { [outKey]: outType } as { [key in OutKey]: OutType };
    super({ inTypes, outTypes, inputs: { a } });
    this.outKey = outKey;
  }

  outKey: OutKey;
  dynoOut(): DynoValue<OutType> {
    return new DynoOutput(this, this.outKey);
  }
}

export class BinaryOp<
    A extends DynoType,
    B extends DynoType,
    OutType extends DynoType,
    OutKey extends string,
  >
  extends Dyno<{ a: A; b: B }, { [key in OutKey]: OutType }>
  implements HasDynoOut<OutType>
{
  constructor({
    a,
    b,
    outKey,
    outTypeFunc,
  }: {
    a: DynoVal<A>;
    b: DynoVal<B>;
    outKey: OutKey;
    outTypeFunc: (aType: A, bType: B) => OutType;
  }) {
    const inTypes = { a: valType(a), b: valType(b) };
    const outType = outTypeFunc(valType(a), valType(b));
    const outTypes = { [outKey]: outType } as { [key in OutKey]: OutType };
    super({ inTypes, outTypes, inputs: { a, b } });
    this.outKey = outKey;
  }

  outKey: OutKey;
  dynoOut(): DynoValue<OutType> {
    return new DynoOutput(this, this.outKey);
  }
}

export class TrinaryOp<
    A extends DynoType,
    B extends DynoType,
    C extends DynoType,
    OutType extends DynoType,
    OutKey extends string,
  >
  extends Dyno<{ a: A; b: B; c: C }, { [key in OutKey]: OutType }>
  implements HasDynoOut<OutType>
{
  constructor({
    a,
    b,
    c,
    outKey,
    outTypeFunc,
  }: {
    a: DynoVal<A>;
    b: DynoVal<B>;
    c: DynoVal<C>;
    outKey: OutKey;
    outTypeFunc: (aType: A, bType: B, cType: C) => OutType;
  }) {
    const inTypes = { a: valType(a), b: valType(b), c: valType(c) };
    const outType = outTypeFunc(valType(a), valType(b), valType(c));
    const outTypes = { [outKey]: outType } as { [key in OutKey]: OutType };
    super({ inTypes, outTypes, inputs: { a, b, c } });
    this.outKey = outKey;
  }

  outKey: OutKey;
  dynoOut(): DynoValue<OutType> {
    return new DynoOutput(this, this.outKey);
  }
}
