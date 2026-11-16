import { BinaryOp, Dyno, TrinaryOp, UnaryOp } from "./base.js";
import {
  type AddOutput,
  type ClampOutput,
  type DivOutput,
  type IModOutput,
  type IsInfOutput,
  type IsNanOutput,
  type MaxOutput,
  type MinOutput,
  type MixOutput,
  type ModOutput,
  type MulOutput,
  type SmoothstepOutput,
  type StepOutput,
  type SubOutput,
  absOutputType,
  addOutputType,
  ceilOutputType,
  clampOutputType,
  divOutputType,
  exp2OutputType,
  expOutputType,
  floorOutputType,
  fractOutputType,
  imodOutputType,
  inversesqrtOutputType,
  isInfOutputType,
  isNanOutputType,
  log2OutputType,
  logOutputType,
  maxOutputType,
  minOutputType,
  mixOutputType,
  modOutputType,
  modfOutputType,
  mulOutputType,
  negOutputType,
  powOutputType,
  roundOutputType,
  signOutputType,
  smoothstepOutputType,
  sqrOutputType,
  sqrtOutputType,
  stepOutputType,
  subOutputType,
  truncOutputType,
} from "./mathTypes.js";
import type {
  AllIntTypes,
  AllSignedTypes,
  AllValueTypes,
  BoolTypes,
  FloatTypes,
  SignedTypes,
  ValueTypes,
} from "./types.js";
import { type DynoVal, valType } from "./value.js";

export const add = <A extends AllValueTypes, B extends AllValueTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<AddOutput<A, B>> => new Add({ a, b });
export const sub = <A extends AllValueTypes, B extends AllValueTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<SubOutput<A, B>> => new Sub({ a, b });
export const mul = <A extends AllValueTypes, B extends AllValueTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<MulOutput<A, B>> => new Mul({ a, b });
export const div = <A extends AllValueTypes, B extends AllValueTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<DivOutput<A, B>> => new Div({ a, b });
export const imod = <A extends AllIntTypes, B extends AllIntTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<IModOutput<A, B>> => new IMod({ a, b });
export const mod = <A extends FloatTypes, B extends FloatTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<ModOutput<A, B>> => new Mod({ a, b });
export const modf = <A extends FloatTypes>(a: DynoVal<A>) =>
  new Modf({ a }).outputs;

export const neg = <A extends AllSignedTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Neg({ a });
export const abs = <A extends SignedTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Abs({ a });
export const sign = <A extends SignedTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Sign({ a });
export const floor = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Floor({ a });
export const ceil = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Ceil({ a });
export const trunc = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Trunc({ a });
export const round = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Round({ a });
export const fract = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Fract({ a });

export const pow = <A extends FloatTypes>(
  a: DynoVal<A>,
  b: DynoVal<A>,
): DynoVal<A> => new Pow({ a, b });
export const exp = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Exp({ a });
export const exp2 = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Exp2({ a });
export const log = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Log({ a });
export const log2 = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Log2({ a });
export const sqr = <A extends ValueTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Sqr({ a });
export const sqrt = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new Sqrt({ a });
export const inversesqrt = <A extends FloatTypes>(a: DynoVal<A>): DynoVal<A> =>
  new InverseSqrt({ a });

export const min = <A extends ValueTypes, B extends ValueTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<MinOutput<A, B>> => new Min({ a, b });
export const max = <A extends ValueTypes, B extends ValueTypes>(
  a: DynoVal<A>,
  b: DynoVal<B>,
): DynoVal<MaxOutput<A, B>> => new Max({ a, b });
export const clamp = <A extends ValueTypes, MinMax extends ValueTypes>(
  a: DynoVal<A>,
  min: DynoVal<MinMax>,
  max: DynoVal<MinMax>,
): DynoVal<ClampOutput<A, MinMax>> => new Clamp({ a, min, max });
export const mix = <A extends FloatTypes, T extends FloatTypes | BoolTypes>(
  a: DynoVal<A>,
  b: DynoVal<A>,
  t: DynoVal<T>,
): DynoVal<MixOutput<A, T>> => new Mix({ a, b, t });
export const step = <A extends FloatTypes, B extends FloatTypes>(
  edge: DynoVal<A>,
  x: DynoVal<B>,
): DynoVal<StepOutput<A, B>> => new Step({ edge, x });
export const smoothstep = <X extends FloatTypes, Edge extends X | "float">(
  edge0: DynoVal<Edge>,
  edge1: DynoVal<Edge>,
  x: DynoVal<X>,
): DynoVal<SmoothstepOutput<Edge, Edge, X>> =>
  new Smoothstep({ edge0, edge1, x });

export const isNan = <A extends FloatTypes>(
  a: DynoVal<A>,
): DynoVal<IsNanOutput<A>> => new IsNan({ a });
export const isInf = <A extends FloatTypes>(
  a: DynoVal<A>,
): DynoVal<IsInfOutput<A>> => new IsInf({ a });

export class Add<
  A extends AllValueTypes,
  B extends AllValueTypes,
> extends BinaryOp<A, B, AddOutput<A, B>, "sum"> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "sum", outTypeFunc: addOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.sum} = ${inputs.a} + ${inputs.b};`];
    };
  }
}

export class Sub<
  A extends AllValueTypes,
  B extends AllValueTypes,
> extends BinaryOp<A, B, SubOutput<A, B>, "difference"> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "difference", outTypeFunc: subOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.difference} = ${inputs.a} - ${inputs.b};`];
    };
  }
}

export class Mul<
  A extends AllValueTypes,
  B extends AllValueTypes,
> extends BinaryOp<A, B, MulOutput<A, B>, "product"> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "product", outTypeFunc: mulOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.product} = ${inputs.a} * ${inputs.b};`];
    };
  }
}

export class Div<
  A extends AllValueTypes,
  B extends AllValueTypes,
> extends BinaryOp<A, B, DivOutput<A, B>, "quotient"> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "quotient", outTypeFunc: divOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.quotient} = ${inputs.a} / ${inputs.b};`];
    };
  }
}

export class IMod<
  A extends AllIntTypes,
  B extends AllIntTypes,
> extends BinaryOp<A, B, IModOutput<A, B>, "remainder"> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "remainder", outTypeFunc: imodOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.remainder} = ${inputs.a} % ${inputs.b};`];
    };
  }
}

export class Mod<A extends FloatTypes, B extends FloatTypes> extends BinaryOp<
  A,
  B,
  ModOutput<A, B>,
  "remainder"
> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "remainder", outTypeFunc: modOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.remainder} = mod(${inputs.a}, ${inputs.b});`];
    };
  }
}

export class Modf<A extends FloatTypes> extends Dyno<
  { a: A },
  { fract: A; integer: A }
> {
  constructor({ a }: { a: DynoVal<A> }) {
    const inTypes = { a: valType(a) };
    const outType = modfOutputType<A>(inTypes.a);
    const outTypes = {
      fract: outType,
      integer: outType,
    };
    super({ inTypes, outTypes, inputs: { a } });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.fract} = modf(${inputs.a}, ${outputs.integer});`];
    };
  }
}

export class Neg<A extends AllSignedTypes> extends UnaryOp<A, A, "neg"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "neg", outTypeFunc: negOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.neg} = -${inputs.a};`];
    };
  }
}

export class Abs<A extends SignedTypes> extends UnaryOp<A, A, "abs"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "abs", outTypeFunc: absOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.abs} = abs(${inputs.a});`];
    };
  }
}

export class Sign<A extends SignedTypes> extends UnaryOp<A, A, "sign"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "sign", outTypeFunc: signOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.sign} = sign(${inputs.a});`];
    };
  }
}

export class Floor<A extends FloatTypes> extends UnaryOp<A, A, "floor"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "floor", outTypeFunc: floorOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.floor} = floor(${inputs.a});`];
    };
  }
}

export class Ceil<A extends FloatTypes> extends UnaryOp<A, A, "ceil"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "ceil", outTypeFunc: ceilOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.ceil} = ceil(${inputs.a});`];
    };
  }
}

export class Trunc<A extends FloatTypes> extends UnaryOp<A, A, "trunc"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "trunc", outTypeFunc: truncOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.trunc} = trunc(${inputs.a});`];
    };
  }
}

export class Round<A extends FloatTypes> extends UnaryOp<A, A, "round"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "round", outTypeFunc: roundOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.round} = round(${inputs.a});`];
    };
  }
}

export class Fract<A extends FloatTypes> extends UnaryOp<A, A, "fract"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "fract", outTypeFunc: fractOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.fract} = fract(${inputs.a});`];
    };
  }
}

export class Pow<A extends FloatTypes> extends BinaryOp<A, A, A, "power"> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<A> }) {
    super({ a, b, outKey: "power", outTypeFunc: powOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.power} = pow(${inputs.a}, ${inputs.b});`];
    };
  }
}

export class Exp<A extends FloatTypes> extends UnaryOp<A, A, "exp"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "exp", outTypeFunc: expOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.exp} = exp(${inputs.a});`];
    };
  }
}

export class Exp2<A extends FloatTypes> extends UnaryOp<A, A, "exp2"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "exp2", outTypeFunc: exp2OutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.exp2} = exp2(${inputs.a});`];
    };
  }
}

export class Log<A extends FloatTypes> extends UnaryOp<A, A, "log"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "log", outTypeFunc: logOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.log} = log(${inputs.a});`];
    };
  }
}

export class Log2<A extends FloatTypes> extends UnaryOp<A, A, "log2"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "log2", outTypeFunc: log2OutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.log2} = log2(${inputs.a});`];
    };
  }
}

export class Sqr<A extends ValueTypes> extends UnaryOp<A, A, "sqr"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "sqr", outTypeFunc: sqrOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.sqr} = ${inputs.a} * ${inputs.a};`];
    };
  }
}

export class Sqrt<A extends FloatTypes> extends UnaryOp<A, A, "sqrt"> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "sqrt", outTypeFunc: sqrtOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.sqrt} = sqrt(${inputs.a});`];
    };
  }
}

export class InverseSqrt<A extends FloatTypes> extends UnaryOp<
  A,
  A,
  "inversesqrt"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "inversesqrt", outTypeFunc: inversesqrtOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.inversesqrt} = inversesqrt(${inputs.a});`];
    };
  }
}

export class Min<A extends ValueTypes, B extends ValueTypes> extends BinaryOp<
  A,
  B,
  MinOutput<A, B>,
  "min"
> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "min", outTypeFunc: minOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.min} = min(${inputs.a}, ${inputs.b});`];
    };
  }
}

export class Max<A extends ValueTypes, B extends ValueTypes> extends BinaryOp<
  A,
  B,
  MaxOutput<A, B>,
  "max"
> {
  constructor({ a, b }: { a: DynoVal<A>; b: DynoVal<B> }) {
    super({ a, b, outKey: "max", outTypeFunc: maxOutputType<A, B> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.max} = max(${inputs.a}, ${inputs.b});`];
    };
  }
}

export class Clamp<
  A extends ValueTypes,
  MinMax extends ValueTypes,
> extends TrinaryOp<A, MinMax, MinMax, ClampOutput<A, MinMax>, "clamp"> {
  constructor({
    a,
    min,
    max,
  }: { a: DynoVal<A>; min: DynoVal<MinMax>; max: DynoVal<MinMax> }) {
    super({
      a,
      b: min,
      c: max,
      outKey: "clamp",
      outTypeFunc: clampOutputType<A, MinMax>,
    });
    this.statements = ({ inputs, outputs }) => {
      const { a, b: min, c: max } = inputs;
      return [`${outputs.clamp} = clamp(${a}, ${min}, ${max});`];
    };
  }
}

export class Mix<
  A extends FloatTypes,
  T extends FloatTypes | BoolTypes,
> extends TrinaryOp<A, A, T, MixOutput<A, T>, "mix"> {
  constructor({ a, b, t }: { a: DynoVal<A>; b: DynoVal<A>; t: DynoVal<T> }) {
    super({ a, b, c: t, outKey: "mix", outTypeFunc: mixOutputType<A, T> });
    this.statements = ({ inputs, outputs }) => {
      const { a, b, c: t } = inputs;
      return [`${outputs.mix} = mix(${a}, ${b}, ${t});`];
    };
  }
}

export class Step<
  Edge extends FloatTypes,
  X extends FloatTypes,
> extends BinaryOp<Edge, X, StepOutput<Edge, X>, "step"> {
  constructor({ edge, x }: { edge: DynoVal<Edge>; x: DynoVal<X> }) {
    super({
      a: edge,
      b: x,
      outKey: "step",
      outTypeFunc: stepOutputType<Edge, X>,
    });
    this.statements = ({ inputs, outputs }) => {
      const { a: edge, b: x } = inputs;
      return [`${outputs.step} = step(${edge}, ${x});`];
    };
  }
}

export class Smoothstep<
  X extends FloatTypes,
  Edge extends X | "float",
> extends TrinaryOp<
  Edge,
  Edge,
  X,
  SmoothstepOutput<Edge, Edge, X>,
  "smoothstep"
> {
  constructor({
    edge0,
    edge1,
    x,
  }: { edge0: DynoVal<Edge>; edge1: DynoVal<Edge>; x: DynoVal<X> }) {
    super({
      a: edge0,
      b: edge1,
      c: x,
      outKey: "smoothstep",
      outTypeFunc: smoothstepOutputType<Edge, Edge, X>,
    });
    this.statements = ({ inputs, outputs }) => {
      const { a: edge0, b: edge1, c: x } = inputs;
      return [`${outputs.smoothstep} = smoothstep(${edge0}, ${edge1}, ${x});`];
    };
  }
}

export class IsNan<A extends FloatTypes> extends UnaryOp<
  A,
  IsNanOutput<A>,
  "isNan"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "isNan", outTypeFunc: isNanOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.isNan} = isNan(${inputs.a});`];
    };
  }
}

export class IsInf<A extends FloatTypes> extends UnaryOp<
  A,
  IsInfOutput<A>,
  "isInf"
> {
  constructor({ a }: { a: DynoVal<A> }) {
    super({ a, outKey: "isInf", outTypeFunc: isInfOutputType<A> });
    this.statements = ({ inputs, outputs }) => {
      return [`${outputs.isInf} = isInf(${inputs.a});`];
    };
  }
}
