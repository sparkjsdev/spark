import { BinaryOp, UnaryOp } from "./base.js";
import type { FloatTypes } from "./types.js";
import type { DynoVal } from "./value.js";

export const radians = <A extends FloatTypes>(
  degrees: DynoVal<A>,
): DynoVal<A> => new Radians({ degrees });
export const degrees = <A extends FloatTypes>(
  radians: DynoVal<A>,
): DynoVal<A> => new Degrees({ radians });

export const sin = <A extends FloatTypes>(radians: DynoVal<A>): DynoVal<A> =>
  new Sin({ radians });
export const cos = <A extends FloatTypes>(radians: DynoVal<A>): DynoVal<A> =>
  new Cos({ radians });
export const tan = <A extends FloatTypes>(radians: DynoVal<A>): DynoVal<A> =>
  new Tan({ radians });

export const asin = <A extends FloatTypes>(sin: DynoVal<A>): DynoVal<A> =>
  new Asin({ sin });
export const acos = <A extends FloatTypes>(cos: DynoVal<A>): DynoVal<A> =>
  new Acos({ cos });
export const atan = <A extends FloatTypes>(tan: DynoVal<A>): DynoVal<A> =>
  new Atan({ tan });
export const atan2 = <A extends FloatTypes>(
  y: DynoVal<A>,
  x: DynoVal<A>,
): DynoVal<A> => new Atan2({ y, x });

export const sinh = <A extends FloatTypes>(x: DynoVal<A>): DynoVal<A> =>
  new Sinh({ x });
export const cosh = <A extends FloatTypes>(x: DynoVal<A>): DynoVal<A> =>
  new Cosh({ x });
export const tanh = <A extends FloatTypes>(x: DynoVal<A>): DynoVal<A> =>
  new Tanh({ x });

export const asinh = <A extends FloatTypes>(x: DynoVal<A>): DynoVal<A> =>
  new Asinh({ x });
export const acosh = <A extends FloatTypes>(x: DynoVal<A>): DynoVal<A> =>
  new Acosh({ x });
export const atanh = <A extends FloatTypes>(x: DynoVal<A>): DynoVal<A> =>
  new Atanh({ x });

export class Radians<A extends FloatTypes> extends UnaryOp<A, A, "radians"> {
  constructor({ degrees }: { degrees: DynoVal<A> }) {
    super({ a: degrees, outTypeFunc: (aType) => aType, outKey: "radians" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.radians} = radians(${inputs.a});`,
    ];
  }
}

export class Degrees<A extends FloatTypes> extends UnaryOp<A, A, "degrees"> {
  constructor({ radians }: { radians: DynoVal<A> }) {
    super({ a: radians, outTypeFunc: (aType) => aType, outKey: "degrees" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.degrees} = degrees(${inputs.a});`,
    ];
  }
}

export class Sin<A extends FloatTypes> extends UnaryOp<A, A, "sin"> {
  constructor({ radians }: { radians: DynoVal<A> }) {
    super({ a: radians, outTypeFunc: (aType) => aType, outKey: "sin" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.sin} = sin(${inputs.a});`,
    ];
  }
}

export class Cos<A extends FloatTypes> extends UnaryOp<A, A, "cos"> {
  constructor({ radians }: { radians: DynoVal<A> }) {
    super({ a: radians, outTypeFunc: (aType) => aType, outKey: "cos" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.cos} = cos(${inputs.a});`,
    ];
  }
}

export class Tan<A extends FloatTypes> extends UnaryOp<A, A, "tan"> {
  constructor({ radians }: { radians: DynoVal<A> }) {
    super({ a: radians, outTypeFunc: (aType) => aType, outKey: "tan" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.tan} = tan(${inputs.a});`,
    ];
  }
}

export class Asin<A extends FloatTypes> extends UnaryOp<A, A, "asin"> {
  constructor({ sin }: { sin: DynoVal<A> }) {
    super({ a: sin, outTypeFunc: (aType) => aType, outKey: "asin" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.asin} = asin(${inputs.a});`,
    ];
  }
}

export class Acos<A extends FloatTypes> extends UnaryOp<A, A, "acos"> {
  constructor({ cos }: { cos: DynoVal<A> }) {
    super({ a: cos, outTypeFunc: (aType) => aType, outKey: "acos" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.acos} = acos(${inputs.a});`,
    ];
  }
}

export class Atan<A extends FloatTypes> extends UnaryOp<A, A, "atan"> {
  constructor({ tan }: { tan: DynoVal<A> }) {
    super({ a: tan, outTypeFunc: (aType) => aType, outKey: "atan" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.atan} = atan(${inputs.a});`,
    ];
  }
}

export class Atan2<A extends FloatTypes> extends BinaryOp<A, A, A, "atan2"> {
  constructor({ y, x }: { y: DynoVal<A>; x: DynoVal<A> }) {
    super({
      a: y,
      b: x,
      outTypeFunc: (aType, bType) => aType,
      outKey: "atan2",
    });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.atan2} = atan2(${inputs.a}, ${inputs.b});`,
    ];
  }
}

export class Sinh<A extends FloatTypes> extends UnaryOp<A, A, "sinh"> {
  constructor({ x }: { x: DynoVal<A> }) {
    super({ a: x, outTypeFunc: (aType) => aType, outKey: "sinh" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.sinh} = sinh(${inputs.a});`,
    ];
  }
}

export class Cosh<A extends FloatTypes> extends UnaryOp<A, A, "cosh"> {
  constructor({ x }: { x: DynoVal<A> }) {
    super({ a: x, outTypeFunc: (aType) => aType, outKey: "cosh" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.cosh} = cosh(${inputs.a});`,
    ];
  }
}

export class Tanh<A extends FloatTypes> extends UnaryOp<A, A, "tanh"> {
  constructor({ x }: { x: DynoVal<A> }) {
    super({ a: x, outTypeFunc: (aType) => aType, outKey: "tanh" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.tanh} = tanh(${inputs.a});`,
    ];
  }
}

export class Asinh<A extends FloatTypes> extends UnaryOp<A, A, "asinh"> {
  constructor({ x }: { x: DynoVal<A> }) {
    super({ a: x, outTypeFunc: (aType) => aType, outKey: "asinh" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.asinh} = asinh(${inputs.a});`,
    ];
  }
}

export class Acosh<A extends FloatTypes> extends UnaryOp<A, A, "acosh"> {
  constructor({ x }: { x: DynoVal<A> }) {
    super({ a: x, outTypeFunc: (aType) => aType, outKey: "acosh" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.acosh} = acosh(${inputs.a});`,
    ];
  }
}

export class Atanh<A extends FloatTypes> extends UnaryOp<A, A, "atanh"> {
  constructor({ x }: { x: DynoVal<A> }) {
    super({ a: x, outTypeFunc: (aType) => aType, outKey: "atanh" });
    this.statements = ({ inputs, outputs }) => [
      `${outputs.atanh} = atanh(${inputs.a});`,
    ];
  }
}
