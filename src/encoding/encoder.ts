import type { SplatData } from "../Splat";
import { ExtendedSplats } from "./ExtendedSplats";
import { PackedSplats } from "./PackedSplats";

/**
 * Interface for encoding raw splat values into a specific encoding.
 * Used during loading and when procedurally generating splats.
 */
export interface SplatEncoder<T> {
  /**
   * Ensures that there is enough space allocated for a given amount
   * of splats and spherical harmonics. Should be called before
   * setting individual splat values.
   * @param numSplats The number of splats to hold
   * @param numShBands The number of spherical harmonics
   */
  allocate(numSplats: number, numShBands: number): void;

  setSplat(
    i: number,
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    quatX: number,
    quatY: number,
    quatZ: number,
    quatW: number,
    opacity: number,
    r: number,
    g: number,
    b: number,
  ): void;

  setSplatCenter(i: number, x: number, y: number, z: number): void;
  setSplatScales(
    i: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
  ): void;
  setSplatQuat(
    i: number,
    quatX: number,
    quatY: number,
    quatZ: number,
    quatW: number,
  ): void;
  setSplatRgba(i: number, r: number, g: number, b: number, a: number): void;
  setSplatRgb(i: number, r: number, g: number, b: number): void;
  setSplatAlpha(i: number, a: number): void;

  setSplatSh(i: number, sh: ArrayLike<number>): void;

  /**
   * Finalizes the splat encoding and returns the encoded result in a transferable representation.
   */
  closeTransferable(): T;

  /**
   * Finalizes the splat encoding and returns the SplatData.
   */
  close(): SplatData;
}

/**
 * Specialized splat encoder type that supports dynamically growing
 * the amount of splats.
 */
export interface ResizableSplatEncoder<T> extends SplatEncoder<T> {
  pushSplat(
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    quatX: number,
    quatY: number,
    quatZ: number,
    quatW: number,
    opacity: number,
    r: number,
    g: number,
    b: number,
  ): void;
}

export type UnpackResult<T = object> = {
  unpacked: T;
  numSplats: number;
};

// biome-ignore lint: Generic is used to constraint transferable type
export type SplatEncodingClass<T = any> = {
  encodingName: string;
  createSplatEncoder: (
    options?: Record<string, unknown>,
  ) => ResizableSplatEncoder<T>;
  fromTransferable: (transferable: T) => SplatData;
};

export function createSplatEncoder(
  name: string,
  options?: Record<string, unknown>,
): SplatEncoder<object> {
  switch (name) {
    case "packed":
      return PackedSplats.createSplatEncoder(options);
    case "extended":
      return ExtendedSplats.createSplatEncoder();
    default:
      throw new Error(`Unknown splat encoding: ${name}`);
  }
}

/**
 * The default splat encoding to use when loading or creating SplatData.
 */
export const DefaultSplatEncoding: SplatEncodingClass = ExtendedSplats; // TODO: Make configurable?
