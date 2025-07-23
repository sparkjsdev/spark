import * as THREE from "three";
import {
  SplatData,
  SplatFileType,
  type TranscodeSpzInput,
  getSplatFileType,
  getSplatFileTypeFromPath,
} from "./SplatLoader";
import { GunzipReader, fromHalf } from "./utils";

import { decodeAntiSplat } from "./antisplat";
import { decodeKsplat } from "./ksplat";
import { PlyReader } from "./ply";

// SPZ file format reader

export class SpzReader {
  fileBytes: Uint8Array;
  reader: GunzipReader;

  version: number;
  numSplats: number;
  shDegree: number;
  fractionalBits: number;
  flags: number;
  flagAntiAlias: boolean;
  reserved: number;
  parsed: boolean;

  constructor({ fileBytes }: { fileBytes: Uint8Array | ArrayBuffer }) {
    this.fileBytes =
      fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;
    this.reader = new GunzipReader({ fileBytes: this.fileBytes });

    const header = new DataView(this.reader.read(16).buffer);
    if (header.getUint32(0, true) !== 0x5053474e) {
      throw new Error("Invalid SPZ file");
    }
    this.version = header.getUint32(4, true);
    if (this.version < 1 || this.version > 2) {
      throw new Error(`Unsupported SPZ version: ${this.version}`);
    }

    this.numSplats = header.getUint32(8, true);
    this.shDegree = header.getUint8(12);
    this.fractionalBits = header.getUint8(13);
    this.flags = header.getUint8(14);
    this.flagAntiAlias = (this.flags & 0x01) !== 0;
    this.reserved = header.getUint8(15);
    this.parsed = false;
  }

  parseSplats(
    centerCallback?: (index: number, x: number, y: number, z: number) => void,
    alphaCallback?: (index: number, alpha: number) => void,
    rgbCallback?: (index: number, r: number, g: number, b: number) => void,
    scalesCallback?: (
      index: number,
      scaleX: number,
      scaleY: number,
      scaleZ: number,
    ) => void,
    quatCallback?: (
      index: number,
      quatX: number,
      quatY: number,
      quatZ: number,
      quatW: number,
    ) => void,
    shCallback?: (
      index: number,
      sh1: Float32Array,
      sh2?: Float32Array,
      sh3?: Float32Array,
    ) => void,
  ) {
    if (this.parsed) {
      throw new Error("SPZ file already parsed");
    }
    this.parsed = true;

    if (this.version === 1) {
      // float16 centers
      const centerBytes = this.reader.read(this.numSplats * 3 * 2);
      const centerUint16 = new Uint16Array(centerBytes.buffer);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const x = fromHalf(centerUint16[i3]);
        const y = fromHalf(centerUint16[i3 + 1]);
        const z = fromHalf(centerUint16[i3 + 2]);
        centerCallback?.(i, x, y, z);
      }
    } else if (this.version === 2) {
      // 24-bit fixed-point centers
      const fixed = 1 << this.fractionalBits;
      const centerBytes = this.reader.read(this.numSplats * 3 * 3);
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
        centerCallback?.(i, x, y, z);
      }
    } else {
      throw new Error("Unreachable");
    }

    {
      const bytes = this.reader.read(this.numSplats);
      for (let i = 0; i < this.numSplats; i++) {
        alphaCallback?.(i, bytes[i] / 255);
      }
    }
    {
      const rgbBytes = this.reader.read(this.numSplats * 3);
      const scale = SH_C0 / 0.15;
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const r = (rgbBytes[i3] / 255 - 0.5) * scale + 0.5;
        const g = (rgbBytes[i3 + 1] / 255 - 0.5) * scale + 0.5;
        const b = (rgbBytes[i3 + 2] / 255 - 0.5) * scale + 0.5;
        rgbCallback?.(i, r, g, b);
      }
    }
    {
      const scalesBytes = this.reader.read(this.numSplats * 3);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const scaleX = Math.exp(scalesBytes[i3] / 16 - 10);
        const scaleY = Math.exp(scalesBytes[i3 + 1] / 16 - 10);
        const scaleZ = Math.exp(scalesBytes[i3 + 2] / 16 - 10);
        scalesCallback?.(i, scaleX, scaleY, scaleZ);
      }
    }
    {
      const quatBytes = this.reader.read(this.numSplats * 3);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const quatX = quatBytes[i3] / 127.5 - 1;
        const quatY = quatBytes[i3 + 1] / 127.5 - 1;
        const quatZ = quatBytes[i3 + 2] / 127.5 - 1;
        const quatW = Math.sqrt(
          Math.max(0, 1 - quatX * quatX - quatY * quatY - quatZ * quatZ),
        );
        quatCallback?.(i, quatX, quatY, quatZ, quatW);
      }
    }

    if (shCallback && this.shDegree >= 1) {
      const sh1 = new Float32Array(3 * 3);
      const sh2 = this.shDegree >= 2 ? new Float32Array(5 * 3) : undefined;
      const sh3 = this.shDegree >= 3 ? new Float32Array(7 * 3) : undefined;
      const shBytes = this.reader.read(
        this.numSplats * SH_DEGREE_TO_VECS[this.shDegree] * 3,
      );

      let offset = 0;
      for (let i = 0; i < this.numSplats; i++) {
        for (let j = 0; j < 9; ++j) {
          sh1[j] = (shBytes[offset + j] - 128) / 128;
        }
        offset += 9;
        if (sh2) {
          for (let j = 0; j < 15; ++j) {
            sh2[j] = (shBytes[offset + j] - 128) / 128;
          }
          offset += 15;
        }
        if (sh3) {
          for (let j = 0; j < 21; ++j) {
            sh3[j] = (shBytes[offset + j] - 128) / 128;
          }
          offset += 21;
        }
        shCallback?.(i, sh1, sh2, sh3);
      }
    }
  }
}

const SH_DEGREE_TO_VECS: Record<number, number> = { 1: 3, 2: 8, 3: 15 };
const SH_C0 = 0.28209479177387814;

export const SPZ_MAGIC = 0x5053474e; // NGSP = Niantic gaussian splat
export const SPZ_VERSION = 2;
export const FLAG_ANTIALIASED = 0x1;

export class SpzWriter {
  buffer: ArrayBuffer;
  view: DataView;
  numSplats: number;
  shDegree: number;
  fractionalBits: number;
  fraction: number;
  flagAntiAlias: boolean;
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
      9 +
      1 +
      3 +
      3 +
      3 +
      (shDegree >= 1 ? 9 : 0) +
      (shDegree >= 2 ? 15 : 0) +
      (shDegree >= 3 ? 21 : 0);
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
      // if (this.clippedCount < 10) {
      //   // Write x y z also in hex
      //   console.log(`Clipped ${index}: ${x}, ${y}, ${z} (0x${x.toString(16)}, 0x${y.toString(16)}, 0x${z.toString(16)}) -> ${xRounded}, ${yRounded}, ${zRounded} (0x${xRounded.toString(16)}, 0x${yRounded.toString(16)}, 0x${zRounded.toString(16)}) -> ${xInt}, ${yInt}, ${zInt} (0x${xInt.toString(16)}, 0x${yInt.toString(16)}, 0x${zInt.toString(16)})`);
      // }
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
    quatX: number,
    quatY: number,
    quatZ: number,
    quatW: number,
  ) {
    const base = 16 + this.numSplats * 16 + index * 3;
    const quatNeg = quatW < 0;
    this.view.setUint8(
      base,
      Math.max(
        0,
        Math.min(255, Math.round(((quatNeg ? -quatX : quatX) + 1) * 127.5)),
      ),
    );
    this.view.setUint8(
      base + 1,
      Math.max(
        0,
        Math.min(255, Math.round(((quatNeg ? -quatY : quatY) + 1) * 127.5)),
      ),
    );
    this.view.setUint8(
      base + 2,
      Math.max(
        0,
        Math.min(255, Math.round(((quatNeg ? -quatZ : quatZ) + 1) * 127.5)),
      ),
    );
  }

  static quantizeSh(sh: number, bits: number) {
    const value = Math.round(sh * 128) + 128;
    const bucketSize = 1 << (8 - bits);
    const quantized =
      Math.floor((value + bucketSize / 2) / bucketSize) * bucketSize;
    return Math.max(0, Math.min(255, quantized));
  }

  setSh(
    index: number,
    sh1: Float32Array,
    sh2?: Float32Array,
    sh3?: Float32Array,
  ) {
    const shVecs = SH_DEGREE_TO_VECS[this.shDegree] || 0;
    const base1 = 16 + this.numSplats * 19 + index * shVecs * 3;
    for (let j = 0; j < 9; ++j) {
      this.view.setUint8(base1 + j, SpzWriter.quantizeSh(sh1[j], 5));
    }
    if (sh2) {
      const base2 = base1 + 9;
      for (let j = 0; j < 15; ++j) {
        this.view.setUint8(base2 + j, SpzWriter.quantizeSh(sh2[j], 4));
      }
      if (sh3) {
        const base3 = base2 + 15;
        for (let j = 0; j < 21; ++j) {
          this.view.setUint8(base3 + j, SpzWriter.quantizeSh(sh3[j], 4));
        }
      }
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

export async function transcodeSpz(input: TranscodeSpzInput) {
  const splats = new SplatData();
  const {
    inputs,
    clipXyz,
    maxSh,
    fractionalBits = 12,
    opacityThreshold,
  } = input;
  for (const input of inputs) {
    const scale = input.transform?.scale ?? 1;
    const quaternion = new THREE.Quaternion().fromArray(
      input.transform?.quaternion ?? [0, 0, 0, 1],
    );
    const translate = new THREE.Vector3().fromArray(
      input.transform?.translate ?? [0, 0, 0],
    );
    const clip = clipXyz
      ? new THREE.Box3(
          new THREE.Vector3().fromArray(clipXyz.min),
          new THREE.Vector3().fromArray(clipXyz.max),
        )
      : undefined;

    function transformPos(pos: THREE.Vector3) {
      pos.multiplyScalar(scale);
      pos.applyQuaternion(quaternion);
      pos.add(translate);
      return pos;
    }

    function transformScales(scales: THREE.Vector3) {
      scales.multiplyScalar(scale);
      return scales;
    }

    function transformQuaternion(quat: THREE.Quaternion) {
      quat.premultiply(quaternion);
      return quat;
    }

    function withinClip(p: THREE.Vector3) {
      return !clip || clip.containsPoint(p);
    }

    function withinOpacity(opacity: number) {
      return opacityThreshold !== undefined
        ? opacity >= opacityThreshold
        : true;
    }

    let fileType = input.fileType;
    if (!fileType) {
      fileType = getSplatFileType(input.fileBytes);
      if (!fileType && input.pathOrUrl) {
        fileType = getSplatFileTypeFromPath(input.pathOrUrl);
      }
    }
    switch (fileType) {
      case SplatFileType.PLY: {
        const ply = new PlyReader({ fileBytes: input.fileBytes });
        await ply.parseHeader();
        let lastIndex: number | null = null;
        ply.parseSplats(
          (
            index,
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
          ) => {
            const center = transformPos(new THREE.Vector3(x, y, z));
            if (withinClip(center) && withinOpacity(opacity)) {
              lastIndex = splats.pushSplat();
              splats.setCenter(lastIndex, center.x, center.y, center.z);
              const scales = transformScales(
                new THREE.Vector3(scaleX, scaleY, scaleZ),
              );
              splats.setScale(lastIndex, scales.x, scales.y, scales.z);
              const quaternion = transformQuaternion(
                new THREE.Quaternion(quatX, quatY, quatZ, quatW),
              );
              splats.setQuaternion(
                lastIndex,
                quaternion.x,
                quaternion.y,
                quaternion.z,
                quaternion.w,
              );
              splats.setOpacity(lastIndex, opacity);
              splats.setColor(lastIndex, r, g, b);
            } else {
              lastIndex = null;
            }
          },
          (index, sh1, sh2, sh3) => {
            if (sh1 && lastIndex !== null) {
              splats.setSh1(lastIndex, sh1);
            }
            if (sh2 && lastIndex !== null) {
              splats.setSh2(lastIndex, sh2);
            }
            if (sh3 && lastIndex !== null) {
              splats.setSh3(lastIndex, sh3);
            }
          },
        );
        break;
      }
      case SplatFileType.SPZ: {
        const spz = new SpzReader({ fileBytes: input.fileBytes });
        const mapping = new Int32Array(spz.numSplats);
        mapping.fill(-1);
        const centers = new Float32Array(spz.numSplats * 3);
        const center = new THREE.Vector3();
        spz.parseSplats(
          (index, x, y, z) => {
            const center = transformPos(new THREE.Vector3(x, y, z));
            centers[index * 3] = center.x;
            centers[index * 3 + 1] = center.y;
            centers[index * 3 + 2] = center.z;
          },
          (index, alpha) => {
            center.fromArray(centers, index * 3);
            if (withinClip(center) && withinOpacity(alpha)) {
              mapping[index] = splats.pushSplat();
              splats.setCenter(mapping[index], center.x, center.y, center.z);
              splats.setOpacity(mapping[index], alpha);
            }
          },
          (index, r, g, b) => {
            if (mapping[index] >= 0) {
              splats.setColor(mapping[index], r, g, b);
            }
          },
          (index, scaleX, scaleY, scaleZ) => {
            if (mapping[index] >= 0) {
              const scales = transformScales(
                new THREE.Vector3(scaleX, scaleY, scaleZ),
              );
              splats.setScale(mapping[index], scales.x, scales.y, scales.z);
            }
          },
          (index, quatX, quatY, quatZ, quatW) => {
            if (mapping[index] >= 0) {
              const quaternion = transformQuaternion(
                new THREE.Quaternion(quatX, quatY, quatZ, quatW),
              );
              splats.setQuaternion(
                mapping[index],
                quaternion.x,
                quaternion.y,
                quaternion.z,
                quaternion.w,
              );
            }
          },
          (index, sh1, sh2, sh3) => {
            if (mapping[index] >= 0) {
              splats.setSh1(mapping[index], sh1);
              if (sh2) {
                splats.setSh2(mapping[index], sh2);
              }
              if (sh3) {
                splats.setSh3(mapping[index], sh3);
              }
            }
          },
        );
        break;
      }
      case SplatFileType.SPLAT:
        decodeAntiSplat(
          input.fileBytes,
          (numSplats) => {},
          (
            index,
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
          ) => {
            const center = transformPos(new THREE.Vector3(x, y, z));
            if (withinClip(center) && withinOpacity(opacity)) {
              const index = splats.pushSplat();
              splats.setCenter(index, center.x, center.y, center.z);
              const scales = transformScales(
                new THREE.Vector3(scaleX, scaleY, scaleZ),
              );
              splats.setScale(index, scales.x, scales.y, scales.z);
              const quaternion = transformQuaternion(
                new THREE.Quaternion(quatX, quatY, quatZ, quatW),
              );
              splats.setQuaternion(
                index,
                quaternion.x,
                quaternion.y,
                quaternion.z,
                quaternion.w,
              );
              splats.setOpacity(index, opacity);
              splats.setColor(index, r, g, b);
            }
          },
        );
        break;
      case SplatFileType.KSPLAT: {
        let lastIndex: number | null = null;
        decodeKsplat(
          input.fileBytes,
          (numSplats) => {},
          (
            index,
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
          ) => {
            const center = transformPos(new THREE.Vector3(x, y, z));
            if (withinClip(center) && withinOpacity(opacity)) {
              lastIndex = splats.pushSplat();
              splats.setCenter(lastIndex, center.x, center.y, center.z);
              const scales = transformScales(
                new THREE.Vector3(scaleX, scaleY, scaleZ),
              );
              splats.setScale(lastIndex, scales.x, scales.y, scales.z);
              const quaternion = transformQuaternion(
                new THREE.Quaternion(quatX, quatY, quatZ, quatW),
              );
              splats.setQuaternion(
                lastIndex,
                quaternion.x,
                quaternion.y,
                quaternion.z,
                quaternion.w,
              );
              splats.setOpacity(lastIndex, opacity);
              splats.setColor(lastIndex, r, g, b);
            } else {
              lastIndex = null;
            }
          },
          (index, sh1, sh2, sh3) => {
            if (lastIndex !== null) {
              splats.setSh1(lastIndex, sh1);
              if (sh2) {
                splats.setSh2(lastIndex, sh2);
              }
              if (sh3) {
                splats.setSh3(lastIndex, sh3);
              }
            }
          },
        );
        break;
      }
      default:
        throw new Error(`transcodeSpz not implemented for ${fileType}`);
    }
  }

  const shDegree = Math.min(
    maxSh ?? 3,
    splats.sh3 ? 3 : splats.sh2 ? 2 : splats.sh1 ? 1 : 0,
  );
  const spz = new SpzWriter({
    numSplats: splats.numSplats,
    shDegree,
    fractionalBits,
    flagAntiAlias: true,
  });

  for (let i = 0; i < splats.numSplats; ++i) {
    const i3 = i * 3;
    const i4 = i * 4;
    spz.setCenter(
      i,
      splats.centers[i3],
      splats.centers[i3 + 1],
      splats.centers[i3 + 2],
    );
    spz.setScale(
      i,
      splats.scales[i3],
      splats.scales[i3 + 1],
      splats.scales[i3 + 2],
    );
    spz.setQuat(
      i,
      splats.quaternions[i4],
      splats.quaternions[i4 + 1],
      splats.quaternions[i4 + 2],
      splats.quaternions[i4 + 3],
    );
    spz.setAlpha(i, splats.opacities[i]);
    spz.setRgb(
      i,
      splats.colors[i3],
      splats.colors[i3 + 1],
      splats.colors[i3 + 2],
    );
    if (splats.sh1 && shDegree >= 1) {
      spz.setSh(
        i,
        splats.sh1.slice(i * 9, (i + 1) * 9),
        shDegree >= 2 && splats.sh2
          ? splats.sh2.slice(i * 15, (i + 1) * 15)
          : undefined,
        shDegree >= 3 && splats.sh3
          ? splats.sh3.slice(i * 21, (i + 1) * 21)
          : undefined,
      );
    }
  }

  const spzBytes = await spz.finalize();
  return { fileBytes: spzBytes, clippedCount: spz.clippedCount };
}
