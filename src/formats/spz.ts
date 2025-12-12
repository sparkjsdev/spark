import * as THREE from "three";
import { SH_C0, SH_DEGREE_TO_NUM_COEFF } from "../defines";
import type { SplatEncoder, UnpackResult } from "../encoding/encoder";
import { GunzipReader, fromHalf } from "../utils";

export async function unpackSpz<T>(
  fileBytes: Uint8Array<ArrayBuffer>,
  splatEncoder: SplatEncoder<T>,
): Promise<UnpackResult<T>> {
  const spz = new SpzReader({ fileBytes });
  await spz.parseHeader();
  const numSplats = spz.numSplats;
  splatEncoder.allocate(numSplats, spz.shDegree);

  await spz.parseSplats(splatEncoder);

  return { unpacked: splatEncoder.closeTransferable(), numSplats };
}

// SPZ file format reader

export class SpzReader {
  private fileBytes: Uint8Array<ArrayBuffer>;
  private reader: GunzipReader;

  version = -1;
  numSplats = 0;
  shDegree = 0;
  fractionalBits = 0;
  flags = 0;
  flagAntiAlias = false;
  reserved = 0;
  private headerParsed = false;
  private parsed = false;

  constructor({
    fileBytes,
  }: { fileBytes: Uint8Array<ArrayBuffer> | ArrayBuffer }) {
    this.fileBytes =
      fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;
    this.reader = new GunzipReader(this.fileBytes);
  }

  async parseHeader() {
    if (this.headerParsed) {
      throw new Error("SPZ file header already parsed");
    }

    const header = new DataView((await this.reader.read(16)).buffer);
    if (header.getUint32(0, true) !== 0x5053474e) {
      throw new Error("Invalid SPZ file");
    }
    this.version = header.getUint32(4, true);
    if (this.version < 1 || this.version > 3) {
      throw new Error(`Unsupported SPZ version: ${this.version}`);
    }

    this.numSplats = header.getUint32(8, true);
    this.shDegree = header.getUint8(12);
    this.fractionalBits = header.getUint8(13);
    this.flags = header.getUint8(14);
    this.flagAntiAlias = (this.flags & 0x01) !== 0;
    this.reserved = header.getUint8(15);
    this.headerParsed = true;
    this.parsed = false;
  }

  async parseSplats<T>(splatEncoder: SplatEncoder<T>) {
    if (!this.headerParsed) {
      throw new Error("SPZ file header must be parsed first");
    }
    if (this.parsed) {
      throw new Error("SPZ file already parsed");
    }
    this.parsed = true;

    if (this.version === 1) {
      // float16 centers
      const centerBytes = await this.reader.read(this.numSplats * 3 * 2);
      const centerUint16 = new Uint16Array(centerBytes.buffer);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const x = fromHalf(centerUint16[i3]);
        const y = fromHalf(centerUint16[i3 + 1]);
        const z = fromHalf(centerUint16[i3 + 2]);
        splatEncoder.setSplatCenter(i, x, y, z);
      }
    } else if (this.version === 2 || this.version === 3) {
      // 24-bit fixed-point centers
      const fixed = 1 << this.fractionalBits;
      const centerBytes = await this.reader.read(this.numSplats * 3 * 3);
      for (let i = 0; i < this.numSplats; i++) {
        const i9 = i * 9;
        const x =
          (((centerBytes[i9 + 2] << 24) |
            (centerBytes[i9 + 1] << 16) |
            (centerBytes[i9] << 8)) >>
            8) /
          fixed;
        const y =
          (((centerBytes[i9 + 5] << 24) |
            (centerBytes[i9 + 4] << 16) |
            (centerBytes[i9 + 3] << 8)) >>
            8) /
          fixed;
        const z =
          (((centerBytes[i9 + 8] << 24) |
            (centerBytes[i9 + 7] << 16) |
            (centerBytes[i9 + 6] << 8)) >>
            8) /
          fixed;
        splatEncoder.setSplatCenter(i, x, y, z);
      }
    } else {
      throw new Error("Unreachable");
    }

    {
      const bytes = await this.reader.read(this.numSplats);
      for (let i = 0; i < this.numSplats; i++) {
        splatEncoder.setSplatAlpha(i, bytes[i] / 255);
      }
    }
    {
      const rgbBytes = await this.reader.read(this.numSplats * 3);
      const scale = SH_C0 / 0.15;
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const r = (rgbBytes[i3] / 255 - 0.5) * scale + 0.5;
        const g = (rgbBytes[i3 + 1] / 255 - 0.5) * scale + 0.5;
        const b = (rgbBytes[i3 + 2] / 255 - 0.5) * scale + 0.5;
        splatEncoder.setSplatRgb(i, r, g, b);
      }
    }
    {
      const scalesBytes = await this.reader.read(this.numSplats * 3);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const scaleX = Math.exp(scalesBytes[i3] / 16 - 10);
        const scaleY = Math.exp(scalesBytes[i3 + 1] / 16 - 10);
        const scaleZ = Math.exp(scalesBytes[i3 + 2] / 16 - 10);
        splatEncoder.setSplatScales(i, scaleX, scaleY, scaleZ);
      }
    }
    if (this.version === 3) {
      // Version 3 uses a trick called "smallest three" to compress the rotation quaternions
      // achieving better precision. "Optimizing orientation" section at https://gafferongames.com/post/snapshot_compression/ A quaternion length must be 1: x^2+y^2+z^2+w^2 = 1
      // We can drop one component and reconstruct it with the identity above.
      // Largest component is dropped for best numerical precision.
      // Quaternion stored in 32 bits
      // 10 bits singed integer for each of the 3 components + 2 bits indicating the index of dropped component.
      // vs 8 bits for each component uncompressed (spz version < 3)
      // Max Value after extracting largest component v is another component v
      // (v,v,0,0)
      // v^2 + v^2 = 1
      // v = 1 / sqrt(2);
      const maxValue = 1 / Math.sqrt(2); // 0.7071
      const quatBytes = await this.reader.read(this.numSplats * 4);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 4;
        const quaternion = [0, 0, 0, 0];
        const values = [
          quatBytes[i3],
          quatBytes[i3 + 1],
          quatBytes[i3 + 2],
          quatBytes[i3 + 3],
        ];
        // all values are packed in 32 bits (10 per each of 3 components + 2 bits of index of larged value)
        const combinedValues =
          values[0] + (values[1] << 8) + (values[2] << 16) + (values[3] << 24);
        // each component value is 9 bits + sign (1 bit)
        const valueMask = (1 << 9) - 1;
        // extract index of the largest element. 2 top bits.
        const largestIndex = combinedValues >>> 30;
        let remainingValues = combinedValues;
        let sumSquares = 0;

        for (let i = 3; i >= 0; --i) {
          if (i !== largestIndex) {
            // extract current value and sign.
            const value = remainingValues & valueMask;
            const sign = (remainingValues >>> 9) & 0x1;
            // each value is represented as 10 bits. Shift to next one.
            remainingValues = remainingValues >>> 10;
            // convert to range [0,1] and then to [0, 0.7071]
            quaternion[i] = maxValue * (value / valueMask);
            // apply sign.
            quaternion[i] = sign === 0 ? quaternion[i] : -quaternion[i];
            // accumulate the sum of squares
            sumSquares += quaternion[i] * quaternion[i];
          }
        }

        // quartenion length must be 1 (x^2+y^2+z^2+w^2 = 1)
        // so can reconstruct largest component from the other 3.
        // w = sqrt(1 - x^2 - y^2 - z^2);
        const square = 1 - sumSquares;
        quaternion[largestIndex] = Math.sqrt(Math.max(square, 0));

        splatEncoder.setSplatQuat(
          i,
          quaternion[0],
          quaternion[1],
          quaternion[2],
          quaternion[3],
        );
      }
    } else {
      const quatBytes = await this.reader.read(this.numSplats * 3);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const quatX = quatBytes[i3] / 127.5 - 1;
        const quatY = quatBytes[i3 + 1] / 127.5 - 1;
        const quatZ = quatBytes[i3 + 2] / 127.5 - 1;
        const quatW = Math.sqrt(
          Math.max(0, 1 - quatX * quatX - quatY * quatY - quatZ * quatZ),
        );
        splatEncoder.setSplatQuat(i, quatX, quatY, quatZ, quatW);
      }
    }

    if (this.shDegree >= 1) {
      const shCoefficients = SH_DEGREE_TO_NUM_COEFF[this.shDegree];
      const sh = new Float32Array(shCoefficients);
      const shBytes = await this.reader.read(this.numSplats * shCoefficients);

      for (let i = 0; i < this.numSplats; i++) {
        for (let j = 0; j < shCoefficients; ++j) {
          sh[j] = (shBytes[i * shCoefficients + j] - 128) / 128;
        }
        splatEncoder.setSplatSh(i, sh);
      }
    }
  }
}

// SPZ file format writer

export const SPZ_MAGIC = 0x5053474e; // NGSP = Niantic gaussian splat
export const SPZ_VERSION = 3;
export const FLAG_ANTIALIASED = 0x1;

export class SpzWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private numSplats: number;
  readonly shDegree: number;
  private fractionalBits: number;
  private fraction: number;
  private flagAntiAlias: boolean;
  clippedCount = 0;

  constructor({
    numSplats,
    shDegree,
    fractionalBits = 12,
    flagAntiAlias = true,
  }: {
    numSplats: number;
    shDegree: number;
    fractionalBits?: number;
    flagAntiAlias?: boolean;
  }) {
    const splatSize =
      9 + // Position
      1 + // Opacity
      3 + // Scale
      3 + // DC-rgb
      4 + // Rotation
      SH_DEGREE_TO_NUM_COEFF[shDegree];
    const bufferSize = 16 + numSplats * splatSize;
    this.buffer = new ArrayBuffer(bufferSize);
    this.view = new DataView(this.buffer);

    this.view.setUint32(0, SPZ_MAGIC, true); // NGSP
    this.view.setUint32(4, SPZ_VERSION, true);
    this.view.setUint32(8, numSplats, true);
    this.view.setUint8(12, shDegree);
    this.view.setUint8(13, fractionalBits);
    this.view.setUint8(14, flagAntiAlias ? FLAG_ANTIALIASED : 0);
    this.view.setUint8(15, 0); // Reserved

    this.numSplats = numSplats;
    this.shDegree = shDegree;
    this.fractionalBits = fractionalBits;
    this.fraction = 1 << fractionalBits;
    this.flagAntiAlias = flagAntiAlias;
  }

  setCenter(index: number, x: number, y: number, z: number) {
    // Divide by this.fraction and round to nearest integer,
    // then write as 3-bytes per x then y then z.
    const xRounded = Math.round(x * this.fraction);
    const xInt = Math.max(-0x7fffff, Math.min(0x7fffff, xRounded));
    const yRounded = Math.round(y * this.fraction);
    const yInt = Math.max(-0x7fffff, Math.min(0x7fffff, yRounded));
    const zRounded = Math.round(z * this.fraction);
    const zInt = Math.max(-0x7fffff, Math.min(0x7fffff, zRounded));
    const clipped = xRounded !== xInt || yRounded !== yInt || zRounded !== zInt;
    if (clipped) {
      this.clippedCount += 1;
    }
    const i9 = index * 9;
    const base = 16 + i9;
    this.view.setUint8(base, xInt & 0xff);
    this.view.setUint8(base + 1, (xInt >> 8) & 0xff);
    this.view.setUint8(base + 2, (xInt >> 16) & 0xff);
    this.view.setUint8(base + 3, yInt & 0xff);
    this.view.setUint8(base + 4, (yInt >> 8) & 0xff);
    this.view.setUint8(base + 5, (yInt >> 16) & 0xff);
    this.view.setUint8(base + 6, zInt & 0xff);
    this.view.setUint8(base + 7, (zInt >> 8) & 0xff);
    this.view.setUint8(base + 8, (zInt >> 16) & 0xff);
  }

  setAlpha(index: number, alpha: number) {
    const base = 16 + this.numSplats * 9 + index;
    this.view.setUint8(
      base,
      Math.max(0, Math.min(255, Math.round(alpha * 255))),
    );
  }

  static scaleRgb(r: number) {
    const v = ((r - 0.5) / (SH_C0 / 0.15) + 0.5) * 255;
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  setRgb(index: number, r: number, g: number, b: number) {
    const base = 16 + this.numSplats * 10 + index * 3;
    this.view.setUint8(base, SpzWriter.scaleRgb(r));
    this.view.setUint8(base + 1, SpzWriter.scaleRgb(g));
    this.view.setUint8(base + 2, SpzWriter.scaleRgb(b));
  }

  setScale(index: number, scaleX: number, scaleY: number, scaleZ: number) {
    const base = 16 + this.numSplats * 13 + index * 3;
    this.view.setUint8(
      base,
      Math.max(0, Math.min(255, Math.round((Math.log(scaleX) + 10) * 16))),
    );
    this.view.setUint8(
      base + 1,
      Math.max(0, Math.min(255, Math.round((Math.log(scaleY) + 10) * 16))),
    );
    this.view.setUint8(
      base + 2,
      Math.max(0, Math.min(255, Math.round((Math.log(scaleZ) + 10) * 16))),
    );
  }

  setQuat(
    index: number,
    ...q: [number, number, number, number] // x, y, z, w
  ) {
    const base = 16 + this.numSplats * 16 + index * 4;

    const quat = normalize(q);

    // Find largest component
    let iLargest = 0;
    for (let i = 1; i < 4; ++i) {
      if (Math.abs(quat[i]) > Math.abs(quat[iLargest])) {
        iLargest = i;
      }
    }

    // Since -quat represents the same rotation as quat, transform the quaternion so the largest element
    // is positive. This avoids having to send its sign bit.
    const negate = quat[iLargest] < 0 ? 1 : 0;

    // Do compression using sign bit and 9-bit precision per element.
    let comp = iLargest;
    for (let i = 0; i < 4; ++i) {
      if (i !== iLargest) {
        const negbit = (quat[i] < 0 ? 1 : 0) ^ negate;
        const mag = Math.floor(
          ((1 << 9) - 1) * (Math.abs(quat[i]) / Math.SQRT1_2) + 0.5,
        );
        comp = (comp << 10) | (negbit << 9) | mag;
      }
    }

    this.view.setUint8(base, comp & 0xff);
    this.view.setUint8(base + 1, (comp >> 8) & 0xff);
    this.view.setUint8(base + 2, (comp >> 16) & 0xff);
    this.view.setUint8(base + 3, (comp >>> 24) & 0xff);
  }

  static quantizeSh(sh: number, bits: number) {
    const value = Math.round(sh * 128) + 128;
    const bucketSize = 1 << (8 - bits);
    const quantized =
      Math.floor((value + bucketSize / 2) / bucketSize) * bucketSize;
    return Math.max(0, Math.min(255, quantized));
  }

  setSh(index: number, sh: ArrayLike<number>) {
    const base =
      16 + this.numSplats * 20 + index * SH_DEGREE_TO_NUM_COEFF[this.shDegree];
    for (let i = 0; i < SH_DEGREE_TO_NUM_COEFF[this.shDegree]; ++i) {
      this.view.setUint8(base + i, SpzWriter.quantizeSh(sh[i], i >= 9 ? 4 : 5));
    }
  }

  async finalize(): Promise<Uint8Array> {
    const input = new Uint8Array(this.buffer);
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(input);
        controller.close();
      },
    });
    const compressed = stream.pipeThrough(new CompressionStream("gzip"));
    const response = new Response(compressed);
    const buffer = await response.arrayBuffer();
    console.log(
      "Compressed",
      input.length,
      "bytes to",
      buffer.byteLength,
      "bytes",
    );
    return new Uint8Array(buffer);
  }
}

const tempQuat = new THREE.Quaternion();
function normalize(
  quat: [number, number, number, number],
): [number, number, number, number] {
  return tempQuat.fromArray(quat).normalize().toArray(quat);
}
