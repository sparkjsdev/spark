# Dyno shaders

The `dyno` shader graph system is one of the architectural pillars of Spark, allowing you to create custom computation graphs using Javascript (and optionally GLSL) that are compiled to GLSL and run on the GPU, similar to shader graph systems in modern 3D graphics engines.

A core component of this system is the class `Dyno` and its subclasses, which can be thought of as function blocks with multiple typed inputs and outputs. Values passed between such blocks are of type `DynoVal<T>`, where `T` must be a `DynoType`, representing a GPU type in GLSL. Using TypeScript, Spark ensures type safety and static validation of the GPU computation graph. 

All `dyno` code is contained within `src/dyno`, and has definitions which cover all built-in GLSL ES 3.0 types (`"int"`, `"float"`, `"vec"`, etc.) and most of the standard functions (`mul`, `cross`, `texelFetch`, etc.). Note that regular Javascript functions can't be part of a `dyno` computation graph: instead of `x + y` you should use `dyno.add(x, y)`. You can also define your own custom types and `dyno` blocks, both by compositing existing `dyno` functions or by writing GLSL code directly.

Spark currently uses these Dynos in two main places:

- Dynamically generating splats from `SplatGenerator`/`SplatMesh` into the scene
- Computing the splat distance metric for CPU readback and sorting

At the lowest layer, these are executed as pseudo-compute shaders by the classes `PackedSplats` and `Readback`, respectively. A `PackedSplats` is a collection of splats stored in a cache-efficient 16-byte/splat format, which can be loaded from a splat file URL, or generated via `dyno` program that maps an integer index `DynoVal<"int">` to a `DynoVal<Gsplat>`, a GLSL struct type that contains all the splat parameters. Similarly, `Readback` takes a `dyno` program that maps an index `DynoVal<"int">` to a RGBA8 value via a `DynoVal<"vec4">`, producing a 32-bit value per index that can then be read back to the CPU for splat sorting.

Learning to build and use `dyno` programs is probably best approached by starting with the Particle Simulation example and by examining `SplatMesh.constructGenerator()` for a more complex graph. `SplatMesh` also has two injection points `objectModifier` and `worldModifier` that allow you to inject `dyno` component into the standard splat generation pipeline to modify an existing splat object before it is rendered.

## `type DynoType`

A `DynoType` can be either a string that corresponds to a built-in GLSL type, or `{ type: "MyType" }` for a user-defined type. These types are used both for identifying value types `DynoVal<T extends DynoType>` and for declaring input/output types for `Dyno` blocks, for example `{ index: "int" }` or `{ gsplat: Gsplat }` (`Gsplat` is defined as `{ type: "Gsplat" }`). Spark uses these to enforce TypeScript constraints on inputs+outputs of `Dyno` blocks to generate correct GLSL code.

### Build-in types

A built-in GLSL type can be single-valued (`"int"`, `"uint"`, `"float"`, `"bool"`), vector (`"vec4"`, `"ivec3"`, `"bvec2"`), matrix (`"mat4"`, `"mat2x3"`), or a sampler (`"sampler2D"`, `"usampler3D"`, etc).

### Custom types

Spark defines a handful of custom types that are useful: `Gsplat`, `TPackedSplats`, `SdfArray`, `TRgbaArray`, and `SplatSkinning`.  For example, in `src/dyno/splats.ts` we define `Gsplat` as `{ type: "Gsplat" }` along with a helper function:

```typescript
export const defineGsplat = unindent(`
  struct Gsplat {
    vec3 center;
    uint flags;
    vec3 scales;
    int index;
    vec4 quaternion;
    vec4 rgba;
  };
  const uint GSPLAT_FLAG_ACTIVE = 1u << 0u;

  bool isGsplatActive(uint flags) {
    return (flags & GSPLAT_FLAG_ACTIVE) != 0u;
  }
`);
```

When declaring a new user type, you should also define how that type will appear in GLSL, along with any other definitions or utility functions that are useful for that type. When creating a new `Dyno` block you can then include these definitions wherever a `Gsplat` type is used to make sure these global definitions are available.

## `type DynoVal<T extends DynoType>`

A `DynoVal<T extends DynoType>` corresponds to a value of type `T` in the GLSL computation graph. These values can come from a literal/constant value, a uniform (a value that can be updated every frame from your program), or the output of a `Dyno` block.

### `DynoLiteral` / `dynoLiteral`

The class `DynoLiteral<T extends DynoType>` is a `DynoVal` whose constant value is given as a GLSL literal string. For example, `new DynoLiteral("float", "1.0")` or `new DynoLiteral("vec3", "vec3(1.0, 2.0, 3.0)")` produce `DynoVal`s that can be used as inputs in a `dyno` graph.

The helper function `dynoLiteral(type, literal)` is a shorthand for `new DynoLiteral(type, literal)`.

### `DynoConst` / `dynoConst`

Creating a new `DynoConst<T extends DynoType>` is similar to a `DynoLiteral`, but the value is given as a Javascript value, which is converted to a GLSL literal string. For example, `new DynoConst("float", 1.0)` or `new DynoConst("vec3", new THREE.Vector3(1.0, 2.0, 3.0))` produce `DynoVal`s that can be used as inputs in a `dyno` graph.

You can also use the helper function `dynoConst(type, value)` to create a `DynoConst`.

### `DynoOutput`

A `DynoOutput` is created internally in the `dyno` system to represent a particular named output of a `Dyno` block. For example, `dyno.splitGsplat` takes a `DynoVal<Gsplat>` as input and produces multiple outputs including `index`, `center`, `rgba`, etc., and selecting a particular output will yield the appropriate typed `DynoOutput`:

```typescript
// opacity is a DynoOutput and also a DynoVal<"float">
const { opacity } = dyno.splitGsplat(gsplat);
```

## `class Dyno<InTypes, OutTypes>`

A `Dyno` an abstract block that has named, typed inputs and outputs, both as part of its type signature (for TypeScript checking) and stored in the class (for runtime access). When creating a new `Dyno` the following constructor options are available:

| **Option** | **Description** |
|----------|-------------|
| `inTypes` | A map from input name to `DynoType`, for example `{ index: "int" }`. This must match the template parameter `InTypes` of the `Dyno` class. |
| `outTypes` | A map from output name to `DynoType`, for example `{ rgba: "vec4" }`. This must match the template parameter `OutTypes` of the `Dyno` class. |
| `inputs` | A mapping of input values that are passed to the `Dyno`, where the type of `DynoVal<T>` must match the `DynoType` in `inTypes`. |
| `update` | Optional function that is called (no return value) each time a program containing this `Dyno` is executed. This can for example be used to update any uniforms before running. |
| `globals` | Optional function that outputs global GLSL definitions needed by this block, as an array of strings. Duplicate global definition strings within the same program will be deduplicated, so you should always define all the globals you need for this block without regard to whether they are defined elsewhere. |
| `statements` | Optional function that outputs the GLSL statements to execute for this block as an array of strings. When defining a custom `Dyno` that executes GLSL, this is where your code will go. |
| `generate` | Called internally by the `dyno` compiler to generate the globals, statements, and any uniforms needed for this block. The default `generate` implementation will call `globals` and `statements` if they are defined and return these to the compiler. |

The methods `globals`, `statements`, and `generate` all take a `GenerateContext` object as argument, which consists of three properties:

| **Property** | **Description** |
|----------|-------------|
| `inputs` | A map from the input key to the *actual* GLSL variable name of that input value. The compiler will create unique names for values passed between blocks so you can reuse the same input key. If an input is NOT attached, the value will be `undefined`. |
| `outputs` | A map from the output key to the *actual* GLSL variable name of that output value. The compiler will create unique names for values passed between blocks so you can reuse the same output key. If an output is NOT connected, the value will be `undefined`. |
| `compile` | An instance of class `Compilation` that stores the context for the ongoing compilation, including global defines, statements to execute, uniforms, indentation level, etc. |

Typically you will want to define a `Dyno` subclass that constructs a `Dyno` instance with the appropriate `globals`, `statements`, and `update` etc. for your block. When generating code, use the passed in `GenerateContext` to get the names of inputs and outputs, and generate code that uses those names (via string interpolation or similar).

### Using a `Dyno`

Once defined, using your `Dyno` will typically be done as follows:
```typescript
const { sum } = new dyno.Add({ a, b }).outputs;
// Or equivalently:
const { sum } = dyno.add(a, b).outputs;
// For Dynos that implement HasDynoOut<T> you can also do
const sum = dyno.add(a, b);
```

The property `outputs` is a map from output name to a `DynoVal<T>` for each output type in `outTypes` (internally they are `DynoOutput`s).

For a `Dyno` that only has a single output, you can also implement the method `dynoOut(): DynoValue<T>` (which corresponds to the interface `HasDynoOut<T>`) to pick out a default output from `outputs`, which can help reduce redundant `.outputs` calls.

### Helper functions for GLSL code

`unindentLines(s: string): string[]`: Takes a multi-line string, removes common leading whitespace from each line, and returns the resulting array of strings. This can be useful to prepare an array of `statements` from a block of GLSL code:
```typescript
const leftAlignedLines = unindentLines(`
    float sqr(float x) {
      return x * x;
    }
`);
```

`unindent(s: string): string`: Same as for `unindentLines` but joins the resulting lines into a single string. This is useful for defining a `globals`, which are de-duplicated based on the entirety of the string rather than individual lines.

## `class DynoBlock<InTypes, OutTypes>`

A `DynoBlock` is a `Dyno` that is like a "module" in that it can contain a `Dyno` subgraph internally that is created in a closure. Although you can construct a `DynoBlock` directly it is more ergnomic to use the helper function `dynoBlock`:

```typescript
const myGsplatGenerator = dyno.dynoBlock(
  { index: "int" }, // Inputs
  { gsplat: Gsplat }, // Outputs
  ({ index }) => { // Closure mapping inputs to outputs
    let gsplat = dyno.readPackedSplat(myPackedSplats, index);
    const opacity = dyno.dynoConst("float", 1.0);
    gsplat = dyno.combineGsplat({ gsplat, opacity });
    return { gsplat };
  },
);
```

The first argument is mapping from input keys to `DynoType`, the second for output keys, and the third argument is a closure that constructs a `dyno` graph from the input `DynoVal`s and any other external `DynoVal`s (such as `myPackedSplats` in this example), and must return a map of `DynoVal`s that match the output keys. An optional fourth argument allows you to pass in additional arguments `update` (called before program execution) and `globals` (for any global definitions needed by the block).

## Helpers to design Dynos

When creating blocks that are simple operations of 1-3 inputs you can use the helper classes `UnaryOp`, `BinaryOp`, and `TrinaryOp`, which help standardize the interface. You must override the class' `statements` or `generate` method to generate the code. See examples in `src/dyno/math.ts` for how to use them.
