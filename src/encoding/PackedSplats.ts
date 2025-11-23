import * as THREE from "three";
import type { IterableSplatData, SplatCallback, SplatData } from "../Splat";
import {
  LN_SCALE_MAX,
  LN_SCALE_MIN,
  SCALE_ZERO,
  SH_DEGREE_TO_NUM_COEFF,
  SPLAT_TEX_HEIGHT,
  SPLAT_TEX_WIDTH,
} from "../defines";
import {
  computeMaxSplats,
  decodeQuatOctXy88R8,
  encodeQuatOctXy88R8,
  floatToUint8,
  fromHalf,
  getTextureSize,
  toHalf,
} from "../utils";
import type { ResizableSplatEncoder } from "./encoder";

export type SplatEncoding = {
  rgbMin?: number;
  rgbMax?: number;
  lnScaleMin?: number;
  lnScaleMax?: number;
  sh1Min?: number;
  sh1Max?: number;
  sh2Min?: number;
  sh2Max?: number;
  sh3Min?: number;
  sh3Max?: number;
};

export const DEFAULT_SPLAT_ENCODING: SplatEncoding = {
  rgbMin: 0,
  rgbMax: 1,
  lnScaleMin: LN_SCALE_MIN,
  lnScaleMax: LN_SCALE_MAX,
  sh1Min: -1,
  sh1Max: 1,
  sh2Min: -1,
  sh2Max: 1,
  sh3Min: -1,
  sh3Max: 1,
};

export type PackedSplatsOptions = {
  // Reserve space for at least this many splats when constructing the collection
  // initially. The array will automatically resize past maxSplats so setting it is
  // an optional optimization. (default: 0)
  maxSplats?: number;
  // Override number of splats in packed array to use only a subset.
  // (default: length of packed array / 4)
  numSplats?: number;
  numSh?: number;
  // Override the default splat encoding ranges for the PackedSplats.
  // (default: undefined)
  splatEncoding?: SplatEncoding;
};

export class PackedSplats implements IterableSplatData {
  maxSplats = 0;
  numSplats = 0;
  numSh = 0;
  packedArray: Uint32Array<ArrayBuffer>;
  private shArray: Uint8Array<ArrayBuffer> | null = null;
  readonly splatEncoding?: SplatEncoding;

  private texture: THREE.DataArrayTexture | null = null;
  private shTexture: THREE.DataArrayTexture | null = null;
  private needsUpdate = false;

  constructor(
    packedArray: Uint32Array<ArrayBuffer>,
    shArray?: Uint8Array<ArrayBuffer> | null,
    options?: PackedSplatsOptions,
  ) {
    this.packedArray = packedArray;
    this.shArray = shArray ?? null;
    // Calculate number of horizontal texture rows that could fit in array.
    // A properly initialized packedArray should already take into account the
    // width and height of the texture and be rounded up with padding.
    this.maxSplats = Math.floor(this.packedArray.length / 4);
    this.maxSplats =
      Math.floor(this.maxSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    this.numSplats = Math.min(
      this.maxSplats,
      options?.numSplats ?? Number.POSITIVE_INFINITY,
    );
    this.numSh = options?.numSh ?? 0;
    this.splatEncoding = options?.splatEncoding ?? DEFAULT_SPLAT_ENCODING;
  }

  setupMaterial(material: THREE.ShaderMaterial) {
    material.defines.USE_PACKED_SPLAT = true;
    material.defines.SPLAT_DECODE_FN = "decodePackedSplatDefault";
    material.defines.SPLAT_SH_DECODE_FN = "decodePackedSphericalHarmonics";
    material.defines.NUM_PACKED_SH = this.numSh;

    if (!material.uniforms.packedSplats) {
      material.uniforms.packedSplats = { value: null };
      material.uniforms.packedShTexture = { value: null };
      material.uniforms.rgbMinMaxLnScaleMinMax = { value: new THREE.Vector4() };
    }
    material.uniforms.packedSplats.value = this.getTexture();
    material.uniforms.packedShTexture.value = this.getShTexture();
    material.uniforms.rgbMinMaxLnScaleMinMax.value.set(
      this.splatEncoding?.rgbMin ?? 0.0,
      this.splatEncoding?.rgbMax ?? 1.0,
      this.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN,
      this.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX,
    );
  }

  getTexture(): THREE.DataArrayTexture | null {
    if (this.needsUpdate || !this.texture) {
      this.needsUpdate = false;

      if (!this.packedArray) {
        throw new Error("No packed splats");
      }

      if (this.texture) {
        const { width, height, depth } = this.texture.image;
        if (this.maxSplats !== width * height * depth) {
          // The existing source texture isn't the right size, so dispose it
          this.texture.dispose();
          this.texture = null;
        }
      }

      if (!this.texture) {
        // Allocate a new source texture of the right size
        const { width, height, depth } = getTextureSize(this.maxSplats);
        this.texture = new THREE.DataArrayTexture(
          this.packedArray,
          width,
          height,
          depth,
        );
        this.texture.format = THREE.RGBAIntegerFormat;
        this.texture.type = THREE.UnsignedIntType;
        this.texture.internalFormat = "RGBA32UI";
        this.texture.needsUpdate = true;
      } else if (this.packedArray.buffer !== this.texture.image.data.buffer) {
        // The source texture is the right size, update the data
        this.texture.image.data = new Uint8Array(this.packedArray.buffer);
      }
    }

    return this.texture;
  }

  getShTexture(): THREE.DataArrayTexture | null {
    if (this.needsUpdate || !this.shTexture) {
      if (!this.shArray) {
        return null;
      }

      if (this.shTexture) {
        const { width, height, depth } = this.shTexture.image;
        if (this.maxSplats !== width * height * depth) {
          // The existing source texture isn't the right size, so dispose it
          this.shTexture.dispose();
          this.shTexture = null;
        }
      }

      if (!this.shTexture) {
        // Allocate a new source texture of the right size
        let { width, height, depth } = getTextureSize(this.maxSplats);
        width *= this.numSh;
        this.shTexture = new THREE.DataArrayTexture(
          new Uint32Array(this.shArray.buffer),
          width,
          height,
          depth,
        );
        this.shTexture.format = THREE.RGBAIntegerFormat;
        this.shTexture.type = THREE.UnsignedIntType;
        this.shTexture.internalFormat = "RGBA32UI";
        this.shTexture.needsUpdate = true;
      } else if (this.shArray.buffer !== this.shTexture.image.data.buffer) {
        // The source texture is the right size, update the data
        this.shTexture.image.data = new Uint32Array(this.shArray.buffer);
      }
    }

    return this.shTexture;
  }

  iterateCenters(
    callback: (index: number, x: number, y: number, z: number) => void,
  ) {
    for (let i = 0; i < this.numSplats; i++) {
      const i4 = i * 4;
      const word1 = this.packedArray[i4 + 1];
      const word2 = this.packedArray[i4 + 2];

      callback(
        i,
        fromHalf(word1 & 0xffff),
        fromHalf((word1 >>> 16) & 0xffff),
        fromHalf(word2 & 0xffff),
      );
    }
  }

  iterateSplats(callback: SplatCallback) {
    const shCoeffients = SH_DEGREE_TO_NUM_COEFF[this.numSh];
    const sh = this.numSh > 0 ? new Float32Array(shCoeffients) : undefined;

    for (let i = 0; i < this.numSplats; i++) {
      const i4 = i * 4;
      const word0 = this.packedArray[i4 + 0];
      const word1 = this.packedArray[i4 + 1];
      const word2 = this.packedArray[i4 + 2];
      const word3 = this.packedArray[i4 + 3];

      const rgbMin = this.splatEncoding?.rgbMin ?? 0.0;
      const rgbMax = this.splatEncoding?.rgbMax ?? 1.0;
      const rgbRange = rgbMax - rgbMin;
      const r = rgbMin + ((word0 & 0xff) / 255) * rgbRange;
      const g = rgbMin + (((word0 >>> 8) & 0xff) / 255) * rgbRange;
      const b = rgbMin + (((word0 >>> 16) & 0xff) / 255) * rgbRange;
      const a = ((word0 >>> 24) & 0xff) / 255;

      const x = fromHalf(word1 & 0xffff);
      const y = fromHalf((word1 >>> 16) & 0xffff);
      const z = fromHalf(word2 & 0xffff);

      const lnScaleMin = this.splatEncoding?.lnScaleMin ?? LN_SCALE_MIN;
      const lnScaleMax = this.splatEncoding?.lnScaleMax ?? LN_SCALE_MAX;
      const lnScaleScale = (lnScaleMax - lnScaleMin) / 254.0;
      const uScalesX = word3 & 0xff;
      const scaleX =
        uScalesX === 0
          ? 0.0
          : Math.exp(lnScaleMin + (uScalesX - 1) * lnScaleScale);
      const uScalesY = (word3 >>> 8) & 0xff;
      const scaleY =
        uScalesY === 0
          ? 0.0
          : Math.exp(lnScaleMin + (uScalesY - 1) * lnScaleScale);
      const uScalesZ = (word3 >>> 16) & 0xff;
      const scaleZ =
        uScalesZ === 0
          ? 0.0
          : Math.exp(lnScaleMin + (uScalesZ - 1) * lnScaleScale);

      const uQuat = ((word2 >>> 16) & 0xffff) | ((word3 >>> 8) & 0xff0000);
      decodeQuatOctXy88R8(uQuat, tempQuaternion);

      if (sh && this.shArray) {
        for (let j = 0; j < shCoeffients; j++) {
          sh[j] = (this.shArray[i * shCoeffients + j] - 127) / 127;
        }
      }

      callback(
        i,
        fromHalf(word1 & 0xffff),
        fromHalf((word1 >>> 16) & 0xffff),
        fromHalf(word2 & 0xffff),
        scaleX,
        scaleY,
        scaleZ,
        tempQuaternion.x,
        tempQuaternion.y,
        tempQuaternion.z,
        tempQuaternion.w,
        a,
        r,
        g,
        b,
        sh,
      );
    }
  }

  dispose() {
    if (this.texture) {
      this.texture.dispose();
      this.texture.source.data = null;
    }
    if (this.shTexture) {
      this.shTexture.dispose();
      this.shTexture.source.data = null;
    }
    this.packedArray = EMPTY_UINT32_ARRAY;
    this.shArray = null;
    this.numSplats = -1;
    this.maxSplats = 0;
  }

  static encodingName = "packed";

  static createSplatEncoder(
    encoding: SplatEncoding = DEFAULT_SPLAT_ENCODING,
  ): ResizableSplatEncoder<EncodedPackedSplats> {
    const context: EncodedPackedSplats = {
      numSplats: -1,
      maxSplats: 0,
      numSh: 0,
      packedArray: new Uint32Array(),
      shArray: null,
    };
    // Keep track of the head when pushing splats
    let head = 0;

    return {
      allocate(numSplats: number, numShBands: number) {
        if (context.numSplats !== -1) {
          throw new Error("Storage already allocated");
        }

        context.numSplats = numSplats;
        context.maxSplats = computeMaxSplats(numSplats);
        context.numSh = numShBands;
        context.packedArray = new Uint32Array(
          context.packedArray.buffer.transfer(context.maxSplats * 16),
        );

        // Allocate one RGBA32UI pixel per numShBands.
        // Each pixels can hold 16 sint8 coefficients, so
        //  1 band  => 9 coefficients (<16)
        //  2 bands => 21 coefficients (<32)
        //  3 bands => 45 coefficients (<48)
        if (numShBands >= 1)
          context.shArray = new Uint8Array(context.maxSplats * 16 * numShBands);
      },

      setSplat(
        i,
        x,
        y,
        z,
        scaleX,
        scaleY,
        scaleZ,
        quatX,
        quatY,
        quatZ,
        quatW,
        opacity,
        r,
        g,
        b,
      ) {
        this.setSplatCenter(i, x, y, z);
        this.setSplatScales(i, scaleX, scaleY, scaleZ);
        this.setSplatQuat(i, quatX, quatY, quatZ, quatW);
        this.setSplatRgba(i, r, g, b, opacity);
      },

      pushSplat(
        x,
        y,
        z,
        scaleX,
        scaleY,
        scaleZ,
        quatX,
        quatY,
        quatZ,
        quatW,
        opacity,
        r,
        g,
        b,
      ) {
        const i = head++;
        context.numSplats = head;
        if (head > context.maxSplats) {
          // Resize
          context.maxSplats = computeMaxSplats(
            Math.max(context.maxSplats, 1) * 2,
          );
          context.packedArray = new Uint32Array(
            context.packedArray.buffer.transfer(context.maxSplats * 16),
          );
          if (context.shArray) {
            context.shArray = new Uint8Array(
              context.shArray.buffer.transfer(
                context.maxSplats * 16 * context.numSh,
              ),
            );
          }
        }
        this.setSplat(
          i,
          x,
          y,
          z,
          scaleX,
          scaleY,
          scaleZ,
          quatX,
          quatY,
          quatZ,
          quatW,
          opacity,
          r,
          g,
          b,
        );
      },

      setSplatCenter(index, x, y, z) {
        const uCenterX = toHalf(x);
        const uCenterY = toHalf(y);
        const uCenterZ = toHalf(z);

        const i4 = index * 4;
        context.packedArray[i4 + 1] = uCenterX | (uCenterY << 16);
        context.packedArray[i4 + 2] =
          uCenterZ | (context.packedArray[i4 + 2] & 0xffff0000);
      },

      setSplatScales(index, scaleX, scaleY, scaleZ) {
        // Allow scales below LN_SCALE_MIN to be encoded as 0, which signifies a 2DGS
        const lnScaleMin = encoding?.lnScaleMin ?? LN_SCALE_MIN;
        const lnScaleMax = encoding?.lnScaleMax ?? LN_SCALE_MAX;
        const lnScaleScale = 254.0 / (lnScaleMax - lnScaleMin);
        const uScaleX =
          scaleX < SCALE_ZERO
            ? 0
            : THREE.MathUtils.clamp(
                Math.round((Math.log(scaleX) - lnScaleMin) * lnScaleScale) + 1,
                1,
                255,
              );
        const uScaleY =
          scaleY < SCALE_ZERO
            ? 0
            : THREE.MathUtils.clamp(
                Math.round((Math.log(scaleY) - lnScaleMin) * lnScaleScale) + 1,
                1,
                255,
              );
        const uScaleZ =
          scaleZ < SCALE_ZERO
            ? 0
            : THREE.MathUtils.clamp(
                Math.round((Math.log(scaleZ) - lnScaleMin) * lnScaleScale) + 1,
                1,
                255,
              );

        const i4 = index * 4;
        context.packedArray[i4 + 3] =
          uScaleX |
          (uScaleY << 8) |
          (uScaleZ << 16) |
          (context.packedArray[i4 + 3] & 0xff000000);
      },

      setSplatQuat(index, quatX, quatY, quatZ, quatW) {
        const uQuat = encodeQuatOctXy88R8(
          tempQuaternion.set(quatX, quatY, quatZ, quatW),
        );
        const uQuatX = uQuat & 0xff;
        const uQuatY = (uQuat >>> 8) & 0xff;
        const uQuatZ = (uQuat >>> 16) & 0xff;

        const i4 = index * 4;
        context.packedArray[i4 + 2] =
          (context.packedArray[i4 + 2] & 0x0000ffff) |
          (uQuatX << 16) |
          (uQuatY << 24);
        context.packedArray[i4 + 3] =
          (context.packedArray[i4 + 3] & 0x00ffffff) | (uQuatZ << 24);
      },

      setSplatRgba(index, r, g, b, a) {
        const rgbMin = encoding?.rgbMin ?? 0.0;
        const rgbMax = encoding?.rgbMax ?? 1.0;
        const rgbRange = rgbMax - rgbMin;
        const uR = floatToUint8((r - rgbMin) / rgbRange);
        const uG = floatToUint8((g - rgbMin) / rgbRange);
        const uB = floatToUint8((b - rgbMin) / rgbRange);
        const uA = floatToUint8(a);
        const i4 = index * 4;
        context.packedArray[i4] = uR | (uG << 8) | (uB << 16) | (uA << 24);
      },

      setSplatRgb(index, r, g, b) {
        const rgbMin = encoding?.rgbMin ?? 0.0;
        const rgbMax = encoding?.rgbMax ?? 1.0;
        const rgbRange = rgbMax - rgbMin;
        const uR = floatToUint8((r - rgbMin) / rgbRange);
        const uG = floatToUint8((g - rgbMin) / rgbRange);
        const uB = floatToUint8((b - rgbMin) / rgbRange);

        const i4 = index * 4;
        context.packedArray[i4] =
          uR | (uG << 8) | (uB << 16) | (context.packedArray[i4] & 0xff000000);
      },

      setSplatAlpha(index, a) {
        const uA = floatToUint8(a);

        const i4 = index * 4;
        context.packedArray[i4] =
          (context.packedArray[i4] & 0x00ffffff) | (uA << 24);
      },

      setSplatSh(index, sh) {
        if (context.shArray) {
          const stride = context.numSh * 16;
          const startIndex = index * stride;
          for (let i = 0; i < SH_DEGREE_TO_NUM_COEFF[context.numSh]; i++) {
            context.shArray[startIndex + i] = Math.max(
              -127,
              Math.min(127, sh[i] * 127),
            );
          }
        }
      },

      closeTransferable() {
        return context;
      },

      close() {
        return PackedSplats.fromTransferable(context);
      },
    };
  }

  static fromTransferable(context: EncodedPackedSplats) {
    return new PackedSplats(context.packedArray, context.shArray, {
      numSplats: context.numSplats,
      numSh: context.numSh,
    });
  }
}

export type EncodedPackedSplats = {
  numSplats: number;
  maxSplats: number;
  numSh: number;
  packedArray: Uint32Array<ArrayBuffer>;
  shArray: Uint8Array<ArrayBuffer> | null;
};

const tempQuaternion = new THREE.Quaternion();
const EMPTY_UINT32_ARRAY = new Uint32Array(0);
