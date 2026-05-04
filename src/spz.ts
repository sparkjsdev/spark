import * as THREE from "three";
import {
  SplatData,
  type TranscodeSpzInput,
  getSplatFileType,
  getSplatFileTypeFromPath,
} from "./SplatLoader";
import {
  compress as zstdCompress,
  decompress as zstdDecompress,
  init as zstdInit,
} from "@bokuweb/zstd-wasm";
import { GunzipReader, fromHalf, normalize } from "./utils";

// Lazy, idempotent initialization of the ZSTD WASM module. The first call
// fetches/instantiates the WASM blob; subsequent calls return the cached promise.
let zstdInitPromise: Promise<void> | null = null;
function ensureZstdInit(): Promise<void> {
  if (!zstdInitPromise) {
    zstdInitPromise = zstdInit();
  }
  return zstdInitPromise;
}

import { decodeAntiSplat } from "./antisplat";
import { SplatFileType } from "./defines";
import { decodeKsplat } from "./ksplat";
import { PlyReader } from "./ply";

// SPZ file format reader

export class SpzReader {
  fileBytes: Uint8Array;
  // null for v4 (ZSTD), set for v1-v3 (gzip)
  reader: GunzipReader | null = null;
  // Pre-decompressed attribute streams for v4: [positions, alphas, colors, scales, rotations, sh?]
  v4Streams: Uint8Array[] | null = null;

  version = -1;
  numSplats = 0;
  shDegree = 0;
  fractionalBits = 0;
  flags = 0;
  flagAntiAlias = false;
  flagLod = false;
  reserved = 0;
  headerParsed = false;
  parsed = false;

  constructor({ fileBytes }: { fileBytes: Uint8Array | ArrayBuffer }) {
    this.fileBytes =
      fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;
    // V4 files start with NGSP magic directly; v1-v3 are gzip-compressed.
    const b = this.fileBytes;
    const isV4 =
      b.length >= 4 &&
      b[0] === 0x4e &&
      b[1] === 0x47 &&
      b[2] === 0x53 &&
      b[3] === 0x50;
    if (!isV4) {
      this.reader = new GunzipReader({
        fileBytes: this.fileBytes as Uint8Array<ArrayBuffer>,
      });
    }
  }

  async parseHeader() {
    if (this.headerParsed) {
      throw new Error("SPZ file header already parsed");
    }

    if (this.reader === null) {
      // V4: 32-byte NGSP header, attributes in separate ZSTD-compressed streams.
      if (this.fileBytes.length < 32) {
        throw new Error("SPZ v4 file too short");
      }
      const view = new DataView(
        this.fileBytes.buffer,
        this.fileBytes.byteOffset,
        this.fileBytes.byteLength,
      );
      this.version = view.getUint32(4, true);
      if (this.version !== 4) {
        throw new Error(`Unsupported SPZ version: ${this.version}`);
      }
      this.numSplats = view.getUint32(8, true);
      this.shDegree = view.getUint8(12);
      this.fractionalBits = view.getUint8(13);
      this.flags = view.getUint8(14);
      this.flagAntiAlias = (this.flags & 0x01) !== 0;
      this.flagLod = (this.flags & 0x80) !== 0;
      this.reserved = 0;
      const numStreams = view.getUint8(15);
      const tocByteOffset = view.getUint32(16, true);
      await ensureZstdInit();
      this.v4Streams = this._loadV4Streams(numStreams, tocByteOffset, view);
    } else {
      // V1-V3: 16-byte NGSP header inside gzip stream.
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
      this.flagLod = (this.flags & 0x80) !== 0;
      this.reserved = header.getUint8(15);
    }

    this.headerParsed = true;
    this.parsed = false;
  }

  private _loadV4Streams(
    numStreams: number,
    tocByteOffset: number,
    view: DataView,
  ): Uint8Array[] {
    // TOC layout: numStreams × 16 bytes, each entry = [compressedSize u64 LE][uncompressedSize u64 LE].
    // Compressed streams follow immediately after the TOC in this order:
    //   positions, alphas, colors, scales, rotations, SH (zero-size streams skipped)
    const tocEntrySize = 16;
    const tocEnd = tocByteOffset + numStreams * tocEntrySize;
    if (tocEnd > this.fileBytes.byteLength) {
      throw new Error("SPZ v4: TOC extends beyond file end");
    }
    const streams: Uint8Array[] = [];
    let dataOffset = tocEnd;
    for (let i = 0; i < numStreams; i++) {
      const e = tocByteOffset + i * tocEntrySize;
      const compressedSizeLo = view.getUint32(e, true);
      const compressedSizeHi = view.getUint32(e + 4, true);
      if (compressedSizeHi !== 0) {
        throw new Error("SPZ v4: stream size exceeds 4GB");
      }
      const compressedSize = compressedSizeLo;
      const compressed = this.fileBytes.subarray(
        dataOffset,
        dataOffset + compressedSize,
      );
      streams.push(zstdDecompress(compressed));
      dataOffset += compressedSize;
    }
    return streams;
  }

  async parseSplats(
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
    {
      childCounts,
      childStarts,
    }: {
      childCounts?: (index: number, count: number) => void;
      childStarts?: (index: number, start: number) => void;
    } = {},
  ) {
    if (!this.headerParsed) {
      throw new Error("SPZ file header must be parsed first");
    }
    if (this.parsed) {
      throw new Error("SPZ file already parsed");
    }
    this.parsed = true;

    // Unified attribute reader: v4 returns pre-decompressed streams in order;
    // v1-v3 reads sequentially from the gzip stream.
    let streamIdx = 0;
    const read =
      this.v4Streams !== null
        ? async (_n: number): Promise<Uint8Array> =>
            this.v4Streams![streamIdx++]
        : async (n: number): Promise<Uint8Array> =>
            await this.reader!.read(n);

    if (this.version === 1) {
      // float16 centers
      const centerBytes = await read(this.numSplats * 3 * 2);
      const centerUint16 = new Uint16Array(centerBytes.buffer);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const x = fromHalf(centerUint16[i3]);
        const y = fromHalf(centerUint16[i3 + 1]);
        const z = fromHalf(centerUint16[i3 + 2]);
        centerCallback?.(i, x, y, z);
      }
    } else {
      // 24-bit fixed-point centers (v2/v3/v4)
      const fixed = 1 << this.fractionalBits;
      const centerBytes = await read(this.numSplats * 3 * 3);
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
    }

    {
      const bytes = await read(this.numSplats);
      for (let i = 0; i < this.numSplats; i++) {
        alphaCallback?.(i, bytes[i] / 255);
      }
    }
    {
      const rgbBytes = await read(this.numSplats * 3);
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
      const scalesBytes = await read(this.numSplats * 3);
      for (let i = 0; i < this.numSplats; i++) {
        const i3 = i * 3;
        const scaleX = Math.exp(scalesBytes[i3] / 16 - 10);
        const scaleY = Math.exp(scalesBytes[i3 + 1] / 16 - 10);
        const scaleZ = Math.exp(scalesBytes[i3 + 2] / 16 - 10);
        scalesCallback?.(i, scaleX, scaleY, scaleZ);
      }
    }
    if (this.version >= 3) {
      // Smallest-three quaternion encoding (v3 and v4): drop the largest component and
      // store the three smallest at 9-bit precision + 1-bit sign, plus 2-bit index of
      // the dropped component, all packed into 32 bits.
      const maxValue = 1 / Math.sqrt(2); // max magnitude of any non-largest component
      const quatBytes = await read(this.numSplats * 4);
      for (let i = 0; i < this.numSplats; i++) {
        const i4 = i * 4;
        const quaternion = [0, 0, 0, 0];
        const combinedValues =
          quatBytes[i4] +
          (quatBytes[i4 + 1] << 8) +
          (quatBytes[i4 + 2] << 16) +
          (quatBytes[i4 + 3] << 24);
        const valueMask = (1 << 9) - 1;
        const largestIndex = combinedValues >>> 30;
        let remainingValues = combinedValues;
        let sumSquares = 0;

        for (let j = 3; j >= 0; --j) {
          if (j !== largestIndex) {
            const value = remainingValues & valueMask;
            const sign = (remainingValues >>> 9) & 0x1;
            remainingValues = remainingValues >>> 10;
            quaternion[j] = maxValue * (value / valueMask);
            quaternion[j] = sign === 0 ? quaternion[j] : -quaternion[j];
            sumSquares += quaternion[j] * quaternion[j];
          }
        }

        quaternion[largestIndex] = Math.sqrt(Math.max(1 - sumSquares, 0));

        quatCallback?.(
          i,
          quaternion[0],
          quaternion[1],
          quaternion[2],
          quaternion[3],
        );
      }
    } else {
      // First-three quaternion encoding (v1/v2): store x/y/z as uint8, reconstruct w.
      const quatBytes = await read(this.numSplats * 3);
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
      const shBytes = await read(
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
    // LOD extension is only present in gzip-based (v1-v3) files.
    if (this.flagLod && this.reader !== null) {
      let bytes = await this.reader.read(this.numSplats * 2);
      for (let i = 0; i < this.numSplats; i++) {
        const i2 = i * 2;
        const count = bytes[i2] + (bytes[i2 + 1] << 8);
        childCounts?.(i, count);
      }

      bytes = await this.reader.read(this.numSplats * 4);
      for (let i = 0; i < this.numSplats; i++) {
        const i4 = i * 4;
        const start =
          bytes[i4] +
          (bytes[i4 + 1] << 8) +
          (bytes[i4 + 2] << 16) +
          (bytes[i4 + 3] << 24);
        childStarts?.(i, start);
      }
    }
  }
}

const SH_DEGREE_TO_VECS: Record<number, number> = { 1: 3, 2: 8, 3: 15 };
const SH_C0 = 0.28209479177387814;

export const SPZ_MAGIC = 0x5053474e; // NGSP = Niantic gaussian splat
export const SPZ_VERSION = 4;
export const FLAG_ANTIALIASED = 0x1;
const NGSP_HEADER_SIZE = 32;
const TOC_ENTRY_SIZE = 16; // [compressedSize u64 LE][uncompressedSize u64 LE]
const ZSTD_COMPRESSION_LEVEL = 12;

// SPZ v4 writer: each attribute lives in its own Uint8Array buffer; finalize() ZSTD-compresses
// each one and assembles the [header | TOC | streams] file layout.
export class SpzWriter {
  positions: Uint8Array; // 9 bytes per splat (24-bit signed fixed-point x,y,z)
  alphas: Uint8Array; // 1 byte per splat
  colors: Uint8Array; // 3 bytes per splat
  scales: Uint8Array; // 3 bytes per splat (log-encoded)
  rotations: Uint8Array; // 4 bytes per splat (smallest-three quaternion)
  sh: Uint8Array; // SH_DEGREE_TO_VECS[shDegree] * 3 bytes per splat (length 0 if shDegree==0)
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
    this.numSplats = numSplats;
    this.shDegree = shDegree;
    this.fractionalBits = fractionalBits;
    this.fraction = 1 << fractionalBits;
    this.flagAntiAlias = flagAntiAlias;

    this.positions = new Uint8Array(numSplats * 9);
    this.alphas = new Uint8Array(numSplats);
    this.colors = new Uint8Array(numSplats * 3);
    this.scales = new Uint8Array(numSplats * 3);
    this.rotations = new Uint8Array(numSplats * 4);
    const shVecs = SH_DEGREE_TO_VECS[shDegree] || 0;
    this.sh = new Uint8Array(numSplats * shVecs * 3);
  }

  setCenter(index: number, x: number, y: number, z: number) {
    // Divide by this.fraction, round to nearest integer, write as 3 bytes per axis.
    const xRounded = Math.round(x * this.fraction);
    const xInt = Math.max(-0x7fffff, Math.min(0x7fffff, xRounded));
    const yRounded = Math.round(y * this.fraction);
    const yInt = Math.max(-0x7fffff, Math.min(0x7fffff, yRounded));
    const zRounded = Math.round(z * this.fraction);
    const zInt = Math.max(-0x7fffff, Math.min(0x7fffff, zRounded));
    if (xRounded !== xInt || yRounded !== yInt || zRounded !== zInt) {
      this.clippedCount += 1;
    }
    const base = index * 9;
    this.positions[base] = xInt & 0xff;
    this.positions[base + 1] = (xInt >> 8) & 0xff;
    this.positions[base + 2] = (xInt >> 16) & 0xff;
    this.positions[base + 3] = yInt & 0xff;
    this.positions[base + 4] = (yInt >> 8) & 0xff;
    this.positions[base + 5] = (yInt >> 16) & 0xff;
    this.positions[base + 6] = zInt & 0xff;
    this.positions[base + 7] = (zInt >> 8) & 0xff;
    this.positions[base + 8] = (zInt >> 16) & 0xff;
  }

  setAlpha(index: number, alpha: number) {
    this.alphas[index] = Math.max(
      0,
      Math.min(255, Math.round(alpha * 255)),
    );
  }

  static scaleRgb(r: number) {
    const v = ((r - 0.5) / (SH_C0 / 0.15) + 0.5) * 255;
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  setRgb(index: number, r: number, g: number, b: number) {
    const base = index * 3;
    this.colors[base] = SpzWriter.scaleRgb(r);
    this.colors[base + 1] = SpzWriter.scaleRgb(g);
    this.colors[base + 2] = SpzWriter.scaleRgb(b);
  }

  setScale(index: number, scaleX: number, scaleY: number, scaleZ: number) {
    const base = index * 3;
    this.scales[base] = Math.max(
      0,
      Math.min(255, Math.round((Math.log(scaleX) + 10) * 16)),
    );
    this.scales[base + 1] = Math.max(
      0,
      Math.min(255, Math.round((Math.log(scaleY) + 10) * 16)),
    );
    this.scales[base + 2] = Math.max(
      0,
      Math.min(255, Math.round((Math.log(scaleZ) + 10) * 16)),
    );
  }

  setQuat(
    index: number,
    ...q: [number, number, number, number] // x, y, z, w
  ) {
    const base = index * 4;
    const quat = normalize(q);

    // Smallest-three encoding: drop the largest component and reconstruct from |q|=1.
    let iLargest = 0;
    for (let i = 1; i < 4; ++i) {
      if (Math.abs(quat[i]) > Math.abs(quat[iLargest])) {
        iLargest = i;
      }
    }
    // -q represents the same rotation as q; flip so the largest element is positive
    // and we can avoid sending its sign bit.
    const negate = quat[iLargest] < 0 ? 1 : 0;

    // Pack: [2-bit iLargest][3 × (1-bit sign + 9-bit magnitude)] = 32 bits total.
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

    this.rotations[base] = comp & 0xff;
    this.rotations[base + 1] = (comp >> 8) & 0xff;
    this.rotations[base + 2] = (comp >> 16) & 0xff;
    this.rotations[base + 3] = (comp >>> 24) & 0xff;
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
    const base1 = index * shVecs * 3;
    for (let j = 0; j < 9; ++j) {
      this.sh[base1 + j] = SpzWriter.quantizeSh(sh1[j], 5);
    }
    if (sh2) {
      const base2 = base1 + 9;
      for (let j = 0; j < 15; ++j) {
        this.sh[base2 + j] = SpzWriter.quantizeSh(sh2[j], 4);
      }
      if (sh3) {
        const base3 = base2 + 15;
        for (let j = 0; j < 21; ++j) {
          this.sh[base3 + j] = SpzWriter.quantizeSh(sh3[j], 4);
        }
      }
    }
  }

  async finalize(): Promise<Uint8Array> {
    await ensureZstdInit();
    // Stream order matches the C++ reference encoder: positions, alphas, colors,
    // scales, rotations, sh. Zero-size streams are skipped.
    const rawStreams: Uint8Array[] = [
      this.positions,
      this.alphas,
      this.colors,
      this.scales,
      this.rotations,
    ];
    if (this.sh.length > 0) {
      rawStreams.push(this.sh);
    }

    const compressed = rawStreams.map((s) =>
      zstdCompress(s, ZSTD_COMPRESSION_LEVEL),
    );

    const numStreams = rawStreams.length;
    const tocByteOffset = NGSP_HEADER_SIZE;
    const tocSize = numStreams * TOC_ENTRY_SIZE;
    let totalCompressed = 0;
    for (const c of compressed) totalCompressed += c.length;
    const totalSize = tocByteOffset + tocSize + totalCompressed;

    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);

    // 32-byte NGSP header
    view.setUint32(0, SPZ_MAGIC, true);
    view.setUint32(4, SPZ_VERSION, true); // 4
    view.setUint32(8, this.numSplats, true);
    view.setUint8(12, this.shDegree);
    view.setUint8(13, this.fractionalBits);
    view.setUint8(14, this.flagAntiAlias ? FLAG_ANTIALIASED : 0);
    view.setUint8(15, numStreams);
    view.setUint32(16, tocByteOffset, true);
    // bytes 20-31: reserved (already zero-initialized)

    // TOC: numStreams × 16 bytes, each [compressedSize u64 LE][uncompressedSize u64 LE]
    for (let i = 0; i < numStreams; i++) {
      const e = tocByteOffset + i * TOC_ENTRY_SIZE;
      view.setUint32(e, compressed[i].length, true);
      view.setUint32(e + 4, 0, true); // hi 32 bits of compressedSize
      view.setUint32(e + 8, rawStreams[i].length, true);
      view.setUint32(e + 12, 0, true); // hi 32 bits of uncompressedSize
    }

    // Concatenated compressed streams
    let dataOffset = tocByteOffset + tocSize;
    for (const c of compressed) {
      out.set(c, dataOffset);
      dataOffset += c.length;
    }

    let totalRaw = 0;
    for (const s of rawStreams) totalRaw += s.length;
    console.log(
      `SPZ v4: ${this.numSplats} splats, ${totalRaw} bytes raw -> ${totalSize} bytes (header+TOC+ZSTD)`,
    );
    return out;
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
        await spz.parseHeader();
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
