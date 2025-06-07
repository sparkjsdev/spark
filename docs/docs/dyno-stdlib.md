# Dyno Standard Library

The Spark `dyno` system provides a standard library of `Dyno` blocks that cover most of the built-in functions in GLSL ES 3.0, including data conversion, logic, math, trigonometry, linear algebra, texture lookups, transforms, managing uniform variables, hashing & RNG, and of course managing splat data.

We use the convention of PascalCase for the names of the `Dyno` classes, and camelCase for the names of equivalent helper functions that are more ergonomic to use. For example, you can equivalently write:
```typescript
const sum = new dyno.Add({ a, b });
const sum = dyno.add(a, b);
```

The second form will create the `dyno.Add` class with appropriate constructor options. In the tables below we will opt for the camelCase variant for brevity.

## Data type conversion

The following functions use standard GLSL casting rules, which means that for example `bool(1)` will return `true` and `bool(0)` will return `false`.

| **Function** | **Description** |
|----------|-------------|
| `bool(value): DynoVal<"bool">` | Convert a value to a boolean |
| `int(value): DynoVal<"int">` | Convert a value to a signed integer |
| `uint(value): DynoVal<"uint">` | Convert a value to an unsigned integer |
| `float(value): DynoVal<"float">` | Convert a value to a floating-point number |
| `bvec<N>(value): DynoVal<"bvec<N>">` | Convert a value to a boolean vector of length N |
| `ivec<N>(value): DynoVal<"ivec<N>">` | Convert a value to a signed integer vector of length N |
| `uvec<N>(value): DynoVal<"uvec<N>">` | Convert a value to an unsigned integer vector of length N |
| `vec<N>(value): DynoVal<"vec<N>">` | Convert a value to a floating-point vector of length N |
| `mat<N>(value): DynoVal<"mat<M>">` | Convert a value to a NxN matrix |
| `floatBitsToInt(value: DynoVal<"float">): DynoVal<"int">` | Reinterpret the bits of a float as an integer |
| `floatBitsToUint(value: DynoVal<"float">): DynoVal<"uint">` | Reinterpret the bits of a float as an unsigned integer |
| `intBitsToFloat(value: DynoVal<"int">): DynoVal<"float">` | Reinterpret the bits of an integer as a float |
| `uintBitsToFloat(value: DynoVal<"uint">): DynoVal<"float">` | Reinterpret the bits of an unsigned integer as a float |
| `packSnorm2x16(value: DynoVal<"vec2">): DynoVal<"uint">` | Encode a vec2 from -1..1 as a 16-bit signed integer and pack into a 32-bit uint |
| `unpackSnorm2x16(value: DynoVal<"uint">): DynoVal<"vec2">` | Decode a 32-bit uint as a vec2 from -1..1 |
| `packUnorm2x16(value: DynoVal<"vec2">): DynoVal<"uint">` | Encode a vec2 from 0..1 as a 16-bit unsigned integer and pack into a 32-bit uint |
| `unpackUnorm2x16(value: DynoVal<"uint">): DynoVal<"vec2">` | Decode a 32-bit uint as a vec2 from 0..1 |
| `packHalf2x16(value: DynoVal<"vec2">): DynoVal<"uint">` | Encode a vec2 as two float16 values and pack into a 32-bit uint |
| `unpackHalf2x16(value: DynoVal<"uint">): DynoVal<"vec2">` | Decode a 32-bit uint as two float16 values |
| `uintToRgba8(value: DynoVal<"uint">): DynoVal<"vec4">` | Decode a 32-bit uint as a vec4 of 8-bit unsigned integers |

## Logic

The following logic and bit operations follow standard GLSL ES 3.0 semantics.

| **Function** | **Description** |
|----------|-------------|
| `and(a, b)` | Logical (for bool output) or bit-wise (for integer output) AND |
| `or(a, b)` | Logical (for bool output) or bit-wise (for integer output) OR |
| `xor(a, b)` | Logical (for bool output) or bit-wise (for integer output) XOR |
| `not(a)` | Logical NOT (for bool output) or bit-wise NOT (for integer output) |
| `lessThan(a, b)` | Less than |
| `lessThanEqual(a, b)` | Less than or equal to |
| `greaterThan(a, b)` | Greater than |
| `greaterThanEqual(a, b)` | Greater than or equal to |
| `equal(a, b)` | Equal |
| `notEqual(a, b)` | Not equal |
| `any(a: DynoVal<"bvec<N>">)` | True if any component of the vector is true |
| `all(a: DynoVal<"bvec<N>">)` | True if all components of the vector are true |
| `select(cond, t: DynoVal<T>, f: DynoVal<T>): DynoVal<T>` | Select between two values based on a condition |
| `compXor(a)` | Component-wise XOR of a boolean or integer vector |

## Math

The following math functions follow standard GLSL ES 3.0 semantics, for example rules around multiplication of vector and matrix types.

| **Function** | **Description** |
|----------|-------------|
| `add(a, b)` | Addition |
| `sub(a, b)` | Subtraction |
| `mul(a, b)` | Multiplication |
| `div(a, b)` | Division |
| `imod(a, b)` | Integer modulus |
| `mod(a, b)` | Floating-point modulus |
| `modf(a)` | Seperate a floating-point number into its fractional and integer parts |
| `neg(a)` | Negation |
| `abs(a)` | Absolute value |
| `sign(a)` | Sign of a number |
| `floor(a)` | Floor of a floating-point number |
| `ceil(a)` | Ceiling of a floating-point number |
| `trunc(a)` | Truncate a floating-point number toward negative infinity |
| `round(a)` | Round a floating-point number to the nearest integer |
| `fract(a)` | Fractional part of a floating-point number |
| `pow(a, b)` | a ^ b |
| `exp(a)` | e ^ a |
| `exp2(a)` | 2 ^ a |
| `log(a)` | Natural logarithm of a |
| `log2(a)` | Base-2 logarithm of a |
| `sqr(a)` | a * a |
| `sqrt(a)` | Square root of a |
| `inversesqrt(a)` | 1 / sqrt(a) |
| `min(a, b)` | Minimum of two values |
| `max(a, b)` | Maximum of two values |
| `clamp(a, min, max)` | Clamp a value between two others |
| `mix(a, b, t)` | Linear interpolation between two values |
| `step(edge, x)` | 0 if x < edge, 1 otherwise |
| `smoothstep(edge0, edge1, x)` | 0 if x <= edge0, 1 if x >= edge1, otherwise a smooth Hermite interpolation between 0 and 1 |
| `isNan(a)` | True if a is NaN |
| `isInf(a)` | True if a is infinite |

## Trigonometry

| **Function** | **Description** |
|----------|-------------|
| `radians(degrees)` | Convert degrees to radians |
| `degrees(radians)` | Convert radians to degrees |
| `sin(x)` | Sine of x |
| `cos(x)` | Cosine of x |
| `tan(x)` | Tangent of x |
| `asin(x)` | Arcsine of x |
| `acos(x)` | Arccosine of x |
| `atan(x)` | Arctangent of x |
| `atan2(y, x)` | Arctangent of y/x |
| `sinh(x)` | Hyperbolic sine of x |
| `cosh(x)` | Hyperbolic cosine of x |
| `tanh(x)` | Hyperbolic tangent of x |
| `asinh(x)` | Inverse hyperbolic sine of x |
| `acosh(x)` | Inverse hyperbolic cosine of x |
| `atanh(x)` | Inverse hyperbolic tangent of x |

## Linear Algebra

| **Function** | **Description** |
|----------|-------------|
| `length(a)` | Length of a vector |
| `distance(a, b)` | Distance between two vectors |
| `dot(a, b)` | Dot product of two vectors |
| `cross(a: DynoVal<"vec3">, b: DynoVal<"vec3">)` | Cross product of two 3-dimensional vectors |
| `normalize(a)` | Normalize a vector |
| `faceforward(a, b, c)` | Returns `a` if `dot(c, b) < 0`, otherwise returns `-a` |
| `reflectVec(incident, normal)` | Reflect a vector around a normal |
| `refractVec(incident, normal, eta)` | Refract a vector around a normal given an index of refraction |
| `split(a)` | Split a vector into its components |
| `combine(a)` | Create a vector from components, or inject components into an existing vector |
| `projectH(a)` | Project a vector in homogeneous coordinates |
| `extendVec(a, b)` | Extend a vector with an additional component |
| `swizzle(a, select)` | Select a subset of components from a vector |
| `compMult(a, b)` | Component-wise multiplication of two vectors |
| `outer(a, b)` | Outer product of two vectors |
| `transpose(a)` | Transpose a matrix |
| `determinant(a)` | Determinant of a matrix |
| `inverse(a)` | Invert a matrix |

## Texture lookups

| **Function** | **Description** |
|----------|-------------|
| `textureSize(texture, lod?)` | Return the size of a texture |
| `texture(texture, coord, bias?)` | Sample a texture at a continuous coordinate |
| `texelFetch(texture, coord, lod?)` | Fetch a discrete texel value from a texture |

## Transforms

| **Function** | **Description** |
|----------|-------------|
| `transformPos(position, { scale?, scales?, rotate?, translate? })` | Performs a transform of a position in 3D space, with optional uniform `scale`, anisotropic `scales`, quaternion `rotate`, and `translate` |
| `transformDir(dir, { scale?, scales?, rotate? })` | Performs a transform of a direction in 3D space, with optional uniform `scale`, anisotropic `scales`, and quaternion `rotate` |
| `transformQuat(quat, { rotate? })` | Rotate a quaternion |

## Uniform variables

Constant values and literals in `dyno` programs should not be changed often because it incurs a recompilation. To have a variable that can be changed every frame, you can declare a "uniform". The base class for uniforms provided by Spark is `DynoUniform`, which importantly contains a type, current value, and update function.

To update a uniform, simply assign a new value to the `value` property of the uniform. Alternatively, you can construct a `DynoUniform` with an `update` function that is called for each execution. This function can either update `value` directly, or return any non-`undefined` value to have it updated.

Use the following helper functions for more ergonomic creation of uniforms.

| **Function** | **Description** |
|----------|-------------|
| `dynoBool(value)` | Create a boolean uniform |
| `dynoUint(value)` | Create an unsigned integer uniform |
| `dynoInt(value)` | Create a signed integer uniform |
| `dynoFloat(value)` | Create a floating-point uniform |
| `dynoBvec<N>(value)` | Create a boolean vector of length N |
| `dynoUvec<N>(value)` | Create an unsigned integer vector of length N |
| `dynoIvec<N>(value)` | Create a signed integer vector of length N |
| `dynoVec<N>(value)` | Create a floating-point vector of length N |
| `dynoMat<N>(value)` | Create an NxN matrix |
| `dynoMat<N>x<M>(value)` | Create an NxM matrix |
| `dynoUsampler2D(texture)` | Create a uniform that lets you sample a 2D uint texture |
| `dynoIsampler2D(texture)` | Create a uniform that lets you sample a 2D int texture |
| `dynoSampler2D(texture)` | Create a uniform that lets you sample a 2D float texture |
| `dynoUsampler2DArray(texture)` | Create a uniform that lets you sample a 2D uint texture array |
| `dynoIsampler2DArray(texture)` | Create a uniform that lets you sample a 2D int texture array |
| `dynoSampler2DArray(texture)` | Create a uniform that lets you sample a 2D float texture array |
| `dynoUsampler3D(texture)` | Create a uniform that lets you sample a 3D uint texture |
| `dynoIsampler3D(texture)` | Create a uniform that lets you sample a 3D int texture |
| `dynoSampler3D(texture)` | Create a uniform that lets you sample a 3D float texture |
| `dynoUsamplerCube(texture)` | Create a uniform that lets you sample a cube uint texture |
| `dynoIsamplerCube(texture)` | Create a uniform that lets you sample a cube int texture |
| `dynoSamplerCube(texture)` | Create a uniform that lets you sample a cube float texture |
| `dynoSampler2DShadow(texture)` | Create a uniform that lets you sample a 2D float shadow texture |
| `dynoSampler2DArrayShadow(texture)` | Create a uniform that lets you sample a 2D float shadow texture array |
| `dynoSamplerCubeShadow(texture)` | Create a uniform that lets you sample a cube float shadow texture |

## Hashing & Random number generation

When a `dyno` program executes, each invocation for a given splat/index is effectively run in parallel, separate from the rest. In order to incorporate randomness into a `dyno` program, you must use the inputs available to the program, which is often just the `index` of the splat itself. Spark provides functions to hash any scalar or vector (integer or float) into 1-4 components of either a uint32 or float, using the PCG random number generator.

| **Function** | **Description** |
|----------|-------------|
| `pcgMix(value): DynoVal<"uint">` | Mix scalar or vector values into a single uint32 value that can be used as a seed for PCG |
| `pcgNext(state): DynoVal<"uint">` | Advance the PCG random number generator by one step |
| `pcgHash(state): DynoVal<"uint">` | Hash the PCG state into a random uint32 |
| `hash(value): DynoVal<"uint">` | Hash a scalar or vector value into a random uint32 |
| `hash2(value): DynoVal<"uvec2">` | Hash a scalar or vector value into a random uvec2 |
| `hash3(value): DynoVal<"uvec3">` | Hash a scalar or vector value into a random uvec3 |
| `hash4(value): DynoVal<"uvec4">` | Hash a scalar or vector value into a random uvec4 |
| `hashFloat(value): DynoVal<"float">` | Hash a scalar or vector value into a random float |
| `hashVec2(value): DynoVal<"vec2">` | Hash a scalar or vector value into a random vec2 |
| `hashVec3(value): DynoVal<"vec3">` | Hash a scalar or vector value into a random vec3 |
| `hashVec4(value): DynoVal<"vec4">` | Hash a scalar or vector value into a random vec4 |

## Splat data

Spark makes it easier to work with splat data by defining the GLSL struct `Gsplat` which contains the following fields:

| **Field** | **Type** | **Description** |
|----------|-------------|-------------|
| `center` | `vec3` | Center of the splat |
| `flags` | `uint` | Flags for the splat (0x1 = active) |
| `scales` | `vec3` | Scales of the splat |
| `index` | `int` | Index of the splat in the array |
| `quaternion` | `vec4` | Quaternion orientation of the splat |
| `rgba` | `vec4` | RGBA color of the splat |

This way, you can pass around a `DynoVal<Gsplat>` that contains the all the properties of a splat. The following helper functions are provided to extract the splat data from a `PackedSplats`:

| **Function** | **Description** |
|----------|-------------|
| `numPackedSplats(packedSplats)` | Get the number of splats in a `PackedSplats` |
| `readPackedSplat(packedSplats, index)` | Read a particular splat from a `PackedSplats` by index |
| `readPackedSplatRange(packedSplats, index, base, count)` | Read a particular splat from a `PackedSplats` by index but restricted to the given range |
| `splitGsplat(gsplat)` | Split a `Gsplat` into its components |
| `combineGsplat(gsplat)` | Create a `Gsplat` from components (or inject components into an existing `Gsplat`) |
| `gsplatNormal(gsplat)` | Get the `Gsplat` normal, defined as whichever X/Y/Z axis has the smallest scale |
| `transformGsplat(gsplat, { scale?, rotate?, translate?, recolor? })` | Transform a `Gsplat` and all its components by the given transform |
