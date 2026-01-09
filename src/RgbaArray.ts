import * as THREE from "three";

import { DynoPackedSplats, type PackedSplats } from "./PackedSplats";
import { Readback, type Rgba8Readback } from "./Readback";
import { SPLAT_TEX_WIDTH } from "./defines";
import {
  Dyno,
  type DynoBlock,
  DynoInt,
  DynoUniform,
  type DynoVal,
  add,
  dynoBlock,
  readPackedSplatRange,
  splitGsplat,
  unindent,
  unindentLines,
} from "./dyno";
import { getTextureSize } from "./utils";

// An RgbaArray is a collection of ordered RGBA8 values, which can be used as a dyno
// data source, for example for recoloring Gsplats via SplatMesh.splatRgba.
// It can be instantiated from a Uint8Array of RGBA8 values, or it can be
// generated using a Rgba8Readback dyno program.

export type RgbaArrayOptions = {
  // Reserve space for at least this many RGBA values.
  capacity?: number;
  // Use the provided array of RGBA8 values as the source.
  array?: Uint8Array;
  // The number of actual RGBA8 values in the array.
  count?: number;
};

export class RgbaArray {
  capacity = 0;
  count = 0;
  array: Uint8Array | null = null;

  readback: Readback | null = null;
  source: THREE.DataArrayTexture | null = null;
  // Set to true if source array is updated to have it upload to GPU
  needsUpdate = true;

  // Use this as a TRgbaArray in a dyno graph
  dyno: DynoUniform<typeof TRgbaArray, "rgbaArray">;

  constructor(options: RgbaArrayOptions = {}) {
    this.dyno = new DynoUniform({
      key: "rgbaArray",
      type: TRgbaArray,
      globals: () => [defineRgbaArray],
      value: {
        texture: RgbaArray.getEmpty(),
        count: 0,
      },
      update: (value) => {
        value.texture =
          this.readback?.getTexture() ?? this.source ?? RgbaArray.getEmpty();
        value.count = this.count;
        return value;
      },
    });

    if (options.array) {
      // Initialize with given array
      this.array = options.array;
      this.capacity = Math.floor(this.array.length / 4);
      this.capacity =
        Math.floor(this.capacity / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
      this.count = Math.min(
        this.capacity,
        options.count ?? Number.POSITIVE_INFINITY,
      );
    } else {
      this.capacity = options.capacity ?? 0;
      this.count = 0;
    }
  }

  // Free up resources
  dispose() {
    if (this.readback) {
      this.readback.dispose();
      this.readback = null;
    }
    if (this.source) {
      this.source.dispose();
      this.source = null;
    }
  }

  // Ensure that our array is large enough to hold capacity RGBA8 values.
  ensureCapacity(capacity: number): Uint8Array {
    if (!this.array || capacity > (this.array?.length ?? 0) / 4) {
      this.capacity = getTextureSize(capacity).maxSplats;
      const newArray = new Uint8Array(this.capacity * 4);
      if (this.array) {
        // Copy over existing data
        newArray.set(this.array);
      }
      this.array = newArray;
    }
    return this.array;
  }

  // Get the THREE.DataArrayTexture from either the readback or the source.
  getTexture(): THREE.DataArrayTexture {
    let texture = this.readback?.getTexture();
    if (this.source || this.array) {
      texture = this.maybeUpdateSource();
    }
    return texture ?? RgbaArray.getEmpty();
  }

  // Create or get a THREE.DataArrayTexture from the data array.
  private maybeUpdateSource(): THREE.DataArrayTexture {
    if (!this.array) {
      throw new Error("No array");
    }

    if (this.needsUpdate || !this.source) {
      this.needsUpdate = false;

      if (this.source) {
        const { width, height, depth } = this.source.image;
        if (this.capacity !== width * height * depth) {
          this.source.dispose();
          this.source = null;
        }
      }
      if (!this.source) {
        const { width, height, depth } = getTextureSize(this.capacity);
        this.source = new THREE.DataArrayTexture(
          this.array as Uint8Array<ArrayBuffer>,
          width,
          height,
          depth,
        );
        this.source.format = THREE.RGBAFormat;
        this.source.type = THREE.UnsignedByteType;
        this.source.internalFormat = "RGBA8";
        this.source.needsUpdate = true;
      } else if (this.array.buffer !== this.source.image.data.buffer) {
        this.source.image.data = new Uint8Array(this.array.buffer);
      }
      this.source.needsUpdate = true;
    }
    return this.source;
  }

  // Generate the RGBA8 values from a Rgba8Readback dyno program.
  render({
    reader,
    count,
    renderer,
  }: { reader: Rgba8Readback; count: number; renderer: THREE.WebGLRenderer }) {
    if (!this.readback) {
      this.readback = new Readback({ renderer });
    }
    this.readback.render({ reader, count, renderer });
    this.capacity = this.readback.capacity;
    this.count = this.readback.count;
  }

  // Extract the RGBA8 values from a PackedSplats collection.
  fromPackedSplats({
    packedSplats,
    base,
    count,
    renderer,
  }: {
    packedSplats: PackedSplats;
    base: number;
    count: number;
    renderer: THREE.WebGLRenderer;
  }) {
    const { dynoSplats, dynoBase, dynoCount, reader } = RgbaArray.makeDynos();
    dynoSplats.packedSplats = packedSplats;
    dynoBase.value = base;
    dynoCount.value = count;
    this.render({ reader, count, renderer });
    return this;
  }

  // Read back the RGBA8 values from the readback buffer.
  async read(): Promise<Uint8Array> {
    if (!this.readback) {
      throw new Error("No readback");
    }
    if (!this.array || this.array.length < this.count * 4) {
      this.array = new Uint8Array(this.capacity * 4);
    }
    const result = await this.readback.readback({ readback: this.array });
    return result.subarray(0, this.count * 4);
  }

  private static emptySource: THREE.DataArrayTexture | null = null;

  // Can be used where you need an uninitialized THREE.DataArrayTexture like
  // a uniform you will update with the result of this.getTexture() later.
  static getEmpty(): THREE.DataArrayTexture {
    if (!RgbaArray.emptySource) {
      const emptyArray = new Uint8Array(1 * 4);
      RgbaArray.emptySource = new THREE.DataArrayTexture(emptyArray, 1, 1, 1);
      RgbaArray.emptySource.format = THREE.RGBAFormat;
      RgbaArray.emptySource.type = THREE.UnsignedByteType;
      RgbaArray.emptySource.internalFormat = "RGBA8";
      RgbaArray.emptySource.needsUpdate = true;
    }
    return RgbaArray.emptySource;
  }

  private static dynos: {
    dynoSplats: DynoPackedSplats;
    dynoBase: DynoInt<string>;
    dynoCount: DynoInt<string>;
    reader: DynoBlock<{ index: "int" }, { rgba8: "vec4" }>;
  } | null = null;

  // Create a dyno program that can extract RGBA8 values from a PackedSplats
  private static makeDynos() {
    if (!RgbaArray.dynos) {
      const dynoSplats = new DynoPackedSplats();
      const dynoBase = new DynoInt({ value: 0 });
      const dynoCount = new DynoInt({ value: 0 });
      const reader = dynoBlock(
        { index: "int" },
        { rgba8: "vec4" },
        ({ index }) => {
          if (!index) {
            throw new Error("index is undefined");
          }
          index = add(index, dynoBase);
          const gsplat = readPackedSplatRange(
            dynoSplats,
            index,
            dynoBase,
            dynoCount,
          );
          return { rgba8: splitGsplat(gsplat).outputs.rgba };
        },
      );
      RgbaArray.dynos = { dynoSplats, dynoBase, dynoCount, reader };
    }
    return RgbaArray.dynos;
  }
}

// Dyno types and definitions

export const TRgbaArray = { type: "RgbaArray" } as { type: "RgbaArray" };

export const defineRgbaArray = unindent(`
  struct RgbaArray {
    sampler2DArray texture;
    int count;
  };
`);

export function readRgbaArray(
  rgba: DynoVal<typeof TRgbaArray>,
  index: DynoVal<"int">,
): DynoVal<"vec4"> {
  const dyno = new Dyno<
    { rgba: typeof TRgbaArray; index: "int" },
    { rgba: "vec4" }
  >({
    inTypes: { rgba: TRgbaArray, index: "int" },
    outTypes: { rgba: "vec4" },
    inputs: { rgba, index },
    globals: () => [defineRgbaArray],
    statements: ({ inputs, outputs }) =>
      unindentLines(`
        if ((index >= 0) && (index < ${inputs.rgba}.count)) {
          ${outputs.rgba} = texelFetch(${inputs.rgba}.texture, splatTexCoord(index), 0);
        } else {
          ${outputs.rgba} = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `),
  });
  return dyno.outputs.rgba;
}
