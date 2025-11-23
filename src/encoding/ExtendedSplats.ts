import * as THREE from "three";
import type { IterableSplatData, SplatCallback, SplatData } from "../Splat";
import {
  LN_SCALE_MAX,
  LN_SCALE_MIN,
  SH_DEGREE_TO_NUM_COEFF,
  SPLAT_TEX_WIDTH,
} from "../defines";
import {
  computeMaxSplats,
  decodeQuatOctXy88R8,
  encodeQuatOctXy88R8,
  floatBitsToUint,
  floatToUint8,
  getTextureSize,
  uintBitsToFloat,
} from "../utils";
import type { ResizableSplatEncoder } from "./encoder";

export type ExtendedSplatsOptions = {
  // Reserve space for at least this many splats when constructing the collection
  // initially. The array will automatically resize past maxSplats so setting it is
  // an optional optimization. (default: 0)
  maxSplats?: number;
  // Override number of splats in packed array to use only a subset.
  // (default: length of packed array / 4)
  numSplats?: number;
  numSh?: number;
};

export class ExtendedSplats implements IterableSplatData {
  maxSplats = 0;
  numSplats = 0;
  numSh = 0;
  packedArray1: Uint32Array<ArrayBuffer>;
  packedArray2: Uint32Array<ArrayBuffer>;
  packedShArray: Uint8Array<ArrayBuffer> | null;

  private splatTexture1: THREE.DataArrayTexture | null = null;
  private splatTexture2: THREE.DataArrayTexture | null = null;
  private shTexture: THREE.DataArrayTexture | null = null;
  private needsUpdate = false;

  constructor(
    packedArray1: Uint32Array<ArrayBuffer>,
    packedArray2: Uint32Array<ArrayBuffer>,
    packedShArray: Uint8Array<ArrayBuffer> | null,
    options: ExtendedSplatsOptions,
  ) {
    this.packedArray1 = packedArray1;
    this.packedArray2 = packedArray2;
    this.packedShArray = packedShArray;
    // Calculate number of horizontal texture rows that could fit in array.
    // A properly initialized packedArray should already take into account the
    // width and height of the texture and be rounded up with padding.
    this.maxSplats = Math.floor(this.packedArray1.length / 4);
    this.maxSplats =
      Math.floor(this.maxSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    this.numSplats = Math.min(
      this.maxSplats,
      options.numSplats ?? Number.POSITIVE_INFINITY,
    );
    // FIXME: Derive from packedShArray length or make required argument?
    this.numSh = options.numSh ?? 0;
  }

  setupMaterial(material: THREE.ShaderMaterial) {
    material.defines.USE_EXTENDED_SPLAT = true;
    material.defines.SPLAT_DECODE_FN = "decodeExtendedSplatDefault";
    material.defines.SPLAT_SH_DECODE_FN = "decodePackedSphericalHarmonics";
    material.defines.NUM_PACKED_SH = this.numSh;

    if (!material.uniforms.packedSplats1) {
      material.uniforms.splatTexture1 = { value: null };
      material.uniforms.splatTexture2 = { value: null };
      material.uniforms.shTexture = { value: null };
      material.uniforms.rgbMinMaxLnScaleMinMax = { value: new THREE.Vector4() };
    }
    material.uniforms.splatTexture1.value = this.getTexture(
      "splatTexture1",
      "packedArray1",
    );
    material.uniforms.splatTexture2.value = this.getTexture(
      "splatTexture2",
      "packedArray2",
    );
    if (this.packedShArray) {
      material.uniforms.shTexture.value = this.getTexture(
        "shTexture",
        "packedShArray",
      );
    }
  }

  getTexture(
    textureKey: "splatTexture1" | "splatTexture2" | "shTexture",
    arrayKey: "packedArray1" | "packedArray2" | "packedShArray",
  ): THREE.DataArrayTexture | null {
    if (this.needsUpdate || !this[textureKey]) {
      this.needsUpdate = false;

      if (!this[arrayKey]) {
        throw new Error("No packed splats");
      }

      if (this[textureKey]) {
        const { width, height, depth } = this[textureKey].image;
        if (this.maxSplats !== width * height * depth) {
          // The existing source texture isn't the right size, so dispose it
          this[textureKey].dispose();
          this[textureKey] = null;
        }
      }

      if (!this[textureKey]) {
        // Allocate a new source texture of the right size
        let { width, height, depth } = getTextureSize(this.maxSplats);
        if (textureKey === "shTexture") {
          width *= this.numSh;
        }
        this[textureKey] = new THREE.DataArrayTexture(
          new Uint32Array(this[arrayKey].buffer),
          width,
          height,
          depth,
        );
        this[textureKey].format = THREE.RGBAIntegerFormat;
        this[textureKey].type = THREE.UnsignedIntType;
        this[textureKey].internalFormat = "RGBA32UI";
        this[textureKey].needsUpdate = true;
      } else if (this[arrayKey].buffer !== this[textureKey].image.data.buffer) {
        // The source texture is the right size, update the data
        this[textureKey].image.data = new Uint8Array(this[arrayKey].buffer);
      }
    }

    return this[textureKey];
  }

  iterateCenters(
    callback: (index: number, x: number, y: number, z: number) => void,
  ) {
    for (let i = 0; i < this.numSplats; i++) {
      const i4 = i * 4;
      callback(
        i,
        uintBitsToFloat(this.packedArray1[i4 + 0]),
        uintBitsToFloat(this.packedArray1[i4 + 1]),
        uintBitsToFloat(this.packedArray1[i4 + 2]),
      );
    }
  }

  iterateSplats(callback: SplatCallback) {
    const shCoeffients = SH_DEGREE_TO_NUM_COEFF[this.numSh];
    const sh = this.numSh > 0 ? new Float32Array(shCoeffients) : undefined;

    for (let i = 0; i < this.numSplats; i++) {
      const i4 = i * 4;
      const word0 = this.packedArray1[i4 + 0];
      const word1 = this.packedArray1[i4 + 1];
      const word2 = this.packedArray1[i4 + 2];
      const word3 = this.packedArray1[i4 + 3];
      const word4 = this.packedArray2[i4 + 0];
      const word5 = this.packedArray2[i4 + 1];
      const word6 = this.packedArray2[i4 + 2];
      const word7 = this.packedArray2[i4 + 3];

      const r = (word5 & 0xff) / 255;
      const g = ((word5 >>> 8) & 0xff) / 255;
      const b = ((word5 >>> 16) & 0xff) / 255;
      const a = ((word5 >>> 24) & 0xff) / 255;

      const lnScaleScale = (LN_SCALE_MAX - LN_SCALE_MIN) / 1023.0;
      const uScalesX = word3 & 0x3ff;
      const scaleX = Math.exp(LN_SCALE_MIN + uScalesX * lnScaleScale);
      const uScalesY = (word3 >>> 10) & 0x3ff;
      const scaleY = Math.exp(LN_SCALE_MIN + uScalesY * lnScaleScale);
      const uScalesZ = (word3 >>> 20) & 0x3ff;
      const scaleZ = Math.exp(LN_SCALE_MIN + uScalesZ * lnScaleScale);

      decodeQuatOctXy88R8(word4, tempQuaternion);

      if (sh && this.packedShArray) {
        for (let j = 0; j < shCoeffients; j++) {
          sh[j] = (this.packedShArray[i * shCoeffients + j] - 127) / 127;
        }
      }

      callback(
        i,
        uintBitsToFloat(word0),
        uintBitsToFloat(word1),
        uintBitsToFloat(word2),
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

  dispose(): void {
    if (this.splatTexture1) {
      this.splatTexture1.dispose();
      this.splatTexture1.source.data = null;
    }
    if (this.splatTexture2) {
      this.splatTexture2.dispose();
      this.splatTexture2.source.data = null;
    }
    if (this.shTexture) {
      this.shTexture.dispose();
      this.shTexture.source.data = null;
    }
    this.packedArray1 = EMPTY_UINT32_ARRAY;
    this.packedArray2 = EMPTY_UINT32_ARRAY;
    this.packedShArray = null;
    this.numSplats = -1;
    this.maxSplats = 0;
  }

  static encodingName = "extended";

  static createSplatEncoder(): ResizableSplatEncoder<EncodedExtendedSplats> {
    const context: EncodedExtendedSplats = {
      numSplats: 0,
      maxSplats: 0,
      numSh: 0,
      packedArray1: new Uint32Array(),
      packedArray2: new Uint32Array(),
      packedShArray: null,
    };
    // Keep track of the head when pushing splats
    let head = 0;

    return {
      allocate(numSplats: number, numShBands: number) {
        context.numSplats = numSplats;
        context.maxSplats = computeMaxSplats(numSplats);
        context.numSh = numShBands;
        context.packedArray1 = new Uint32Array(context.maxSplats * 4);
        context.packedArray2 = new Uint32Array(context.maxSplats * 4);
        if (numShBands > 0) {
          context.packedShArray = new Uint8Array(
            context.maxSplats * 16 * numShBands,
          );
        }
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
          context.packedArray1 = new Uint32Array(
            context.packedArray1.buffer.transfer(context.maxSplats * 16),
          );
          context.packedArray2 = new Uint32Array(
            context.packedArray2.buffer.transfer(context.maxSplats * 16),
          );
          if (context.packedShArray) {
            context.packedShArray = new Uint8Array(
              context.packedShArray.buffer.transfer(
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
        const i4 = index * 4;
        context.packedArray1[i4 + 0] = floatBitsToUint(x);
        context.packedArray1[i4 + 1] = floatBitsToUint(y);
        context.packedArray1[i4 + 2] = floatBitsToUint(z);
      },

      setSplatScales(index, scaleX, scaleY, scaleZ) {
        const lnScaleMin = LN_SCALE_MIN;
        const lnScaleMax = LN_SCALE_MAX;
        const lnScaleScale = 1023.0 / (lnScaleMax - lnScaleMin);
        const uScaleX = THREE.MathUtils.clamp(
          Math.round((Math.log(scaleX) - lnScaleMin) * lnScaleScale),
          0,
          1023,
        );
        const uScaleY = THREE.MathUtils.clamp(
          Math.round((Math.log(scaleY) - lnScaleMin) * lnScaleScale),
          0,
          1023,
        );
        const uScaleZ = THREE.MathUtils.clamp(
          Math.round((Math.log(scaleZ) - lnScaleMin) * lnScaleScale),
          0,
          1023,
        );

        const i4 = index * 4;
        context.packedArray1[i4 + 3] =
          uScaleX | (uScaleY << 10) | (uScaleZ << 20);
      },

      setSplatQuat(index, quatX, quatY, quatZ, quatW) {
        const uQuat = encodeQuatOctXy88R8(
          tempQuaternion.set(quatX, quatY, quatZ, quatW),
        );
        const uQuatX = uQuat & 0xff;
        const uQuatY = (uQuat >>> 8) & 0xff;
        const uQuatZ = (uQuat >>> 16) & 0xff;

        const i4 = index * 4;
        context.packedArray2[i4 + 0] = uQuatX | (uQuatY << 8) | (uQuatZ << 16);
      },

      setSplatRgba(index, r, g, b, a) {
        // FIXME: Extended range
        const uR = floatToUint8(r);
        const uG = floatToUint8(g);
        const uB = floatToUint8(b);
        const uA = floatToUint8(a);
        const i4 = index * 4;
        context.packedArray2[i4 + 1] = uR | (uG << 8) | (uB << 16) | (uA << 24);
      },

      setSplatRgb(index, r, g, b) {
        // FIXME: Extended range
        const uR = floatToUint8(r);
        const uG = floatToUint8(g);
        const uB = floatToUint8(b);

        const i4 = index * 4;
        context.packedArray2[i4 + 1] =
          uR |
          (uG << 8) |
          (uB << 16) |
          (context.packedArray2[i4 + 1] & 0xff000000);
      },

      setSplatAlpha(index, a) {
        const uA = floatToUint8(a);

        const i4 = index * 4;
        context.packedArray2[i4 + 1] =
          (context.packedArray2[i4 + 1] & 0x00ffffff) | (uA << 24);
      },

      setSplatSh(index, sh) {
        if (!context.packedShArray) {
          throw new Error(
            "No array for spherical harmonics has been allocated",
          );
        }

        const stride = context.numSh * 16;
        const startIndex = index * stride;
        for (let i = 0; i < SH_DEGREE_TO_NUM_COEFF[context.numSh]; i++) {
          context.packedShArray[startIndex + i] = Math.max(
            -127,
            Math.min(127, sh[i] * 127),
          );
        }
      },

      closeTransferable() {
        return context;
      },

      close() {
        return ExtendedSplats.fromTransferable(context);
      },
    };
  }

  static fromTransferable(context: EncodedExtendedSplats) {
    return new ExtendedSplats(
      context.packedArray1,
      context.packedArray2,
      context.packedShArray,
      {
        numSplats: context.numSplats,
        numSh: context.numSh,
      },
    );
  }
}

export type EncodedExtendedSplats = {
  numSplats: number;
  maxSplats: number;
  numSh: number;
  packedArray1: Uint32Array<ArrayBuffer>;
  packedArray2: Uint32Array<ArrayBuffer>;
  packedShArray: Uint8Array<ArrayBuffer> | null;
};

const tempQuaternion = new THREE.Quaternion();
const EMPTY_UINT32_ARRAY = new Uint32Array(0);
