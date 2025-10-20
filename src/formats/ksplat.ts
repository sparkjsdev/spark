import { SH_DEGREE_TO_NUM_COEFF } from "../defines";
import type { SplatEncoder, UnpackResult } from "../encoding/encoder";
import { fromHalf } from "../utils";

type KsplatCompression = {
  bytesPerCenter: number;
  bytesPerScale: number;
  bytesPerRotation: number;
  bytesPerColor: number;
  bytesPerSphericalHarmonicsComponent: number;
  scaleOffsetBytes: number;
  rotationOffsetBytes: number;
  colorOffsetBytes: number;
  sphericalHarmonicsOffsetBytes: number;
  scaleRange: number;
};

const KSPLAT_COMPRESSION: Record<number, KsplatCompression> = {
  0: {
    bytesPerCenter: 12,
    bytesPerScale: 12,
    bytesPerRotation: 16,
    bytesPerColor: 4,
    bytesPerSphericalHarmonicsComponent: 4,
    scaleOffsetBytes: 12,
    rotationOffsetBytes: 24,
    colorOffsetBytes: 40,
    sphericalHarmonicsOffsetBytes: 44,
    scaleRange: 1,
  },
  1: {
    bytesPerCenter: 6,
    bytesPerScale: 6,
    bytesPerRotation: 8,
    bytesPerColor: 4,
    bytesPerSphericalHarmonicsComponent: 2,
    scaleOffsetBytes: 6,
    rotationOffsetBytes: 12,
    colorOffsetBytes: 20,
    sphericalHarmonicsOffsetBytes: 24,
    scaleRange: 32767,
  },
  2: {
    bytesPerCenter: 6,
    bytesPerScale: 6,
    bytesPerRotation: 8,
    bytesPerColor: 4,
    bytesPerSphericalHarmonicsComponent: 1,
    scaleOffsetBytes: 6,
    rotationOffsetBytes: 12,
    colorOffsetBytes: 20,
    sphericalHarmonicsOffsetBytes: 24,
    scaleRange: 32767,
  },
};

export function unpackKsplat<T>(
  fileBytes: Uint8Array,
  splatEncoder: SplatEncoder<T>,
): UnpackResult<T> {
  const HEADER_BYTES = 4096;
  const SECTION_BYTES = 1024;

  let headerOffset = 0;
  const header = new DataView(fileBytes.buffer, headerOffset, HEADER_BYTES);
  headerOffset += HEADER_BYTES;

  const versionMajor = header.getUint8(0);
  const versionMinor = header.getUint8(1);
  if (versionMajor !== 0 || versionMinor < 1) {
    throw new Error(
      `Unsupported .ksplat version: ${versionMajor}.${versionMinor}`,
    );
  }
  const maxSectionCount = header.getUint32(4, true);
  // const sectionCount = header.getUint32(8, true);
  // const maxSplatCount = header.getUint32(12, true);
  const splatCount = header.getUint32(16, true);
  const compressionLevel = header.getUint16(20, true);
  if (compressionLevel < 0 || compressionLevel > 2) {
    throw new Error(`Invalid .ksplat compression level: ${compressionLevel}`);
  }
  // const sceneCenterX = header.getFloat32(24, true);
  // const sceneCenterY = header.getFloat32(28, true);
  // const sceneCenterZ = header.getFloat32(32, true);
  const minSphericalHarmonicsCoeff = header.getFloat32(36, true) || -1.5;
  const maxSphericalHarmonicsCoeff = header.getFloat32(40, true) || 1.5;

  let sectionBase = HEADER_BYTES + maxSectionCount * SECTION_BYTES;

  for (let sectionIndex = 0; sectionIndex < maxSectionCount; ++sectionIndex) {
    const section = new DataView(fileBytes.buffer, headerOffset, SECTION_BYTES);
    headerOffset += SECTION_BYTES;

    const sectionSplatCount = section.getUint32(0, true);
    const sectionMaxSplatCount = section.getUint32(4, true);
    const bucketSize = section.getUint32(8, true);
    const bucketCount = section.getUint32(12, true);
    const bucketBlockSize = section.getFloat32(16, true);
    const bucketStorageSizeBytes = section.getUint16(20, true);
    const compressionScaleRange =
      (section.getUint32(24, true) ||
        KSPLAT_COMPRESSION[compressionLevel]?.scaleRange) ??
      1;
    const fullBucketCount = section.getUint32(32, true);
    const fullBucketSplats = fullBucketCount * bucketSize;
    const partiallyFilledBucketCount = section.getUint32(36, true);
    const bucketsMetaDataSizeBytes = partiallyFilledBucketCount * 4;
    const bucketsStorageSizeBytes =
      bucketStorageSizeBytes * bucketCount + bucketsMetaDataSizeBytes;
    const sphericalHarmonicsDegree = section.getUint16(40, true);
    const shComponents = SH_DEGREE_TO_NUM_COEFF[sphericalHarmonicsDegree];

    // SH degrees are known, allocate splats
    if (sectionIndex === 0) {
      splatEncoder.allocate(splatCount, sphericalHarmonicsDegree);
    }

    const {
      bytesPerCenter,
      bytesPerScale,
      bytesPerRotation,
      bytesPerColor,
      bytesPerSphericalHarmonicsComponent,
      scaleOffsetBytes,
      rotationOffsetBytes,
      colorOffsetBytes,
      sphericalHarmonicsOffsetBytes,
    } = KSPLAT_COMPRESSION[compressionLevel];
    const bytesPerSplat =
      bytesPerCenter +
      bytesPerScale +
      bytesPerRotation +
      bytesPerColor +
      shComponents * bytesPerSphericalHarmonicsComponent;
    const splatDataStorageSizeBytes = bytesPerSplat * sectionMaxSplatCount;
    const storageSizeBytes =
      splatDataStorageSizeBytes + bucketsStorageSizeBytes;

    const shIndex = [
      // Sh1
      0, 3, 6, 1, 4, 7, 2, 5, 8,
      // Sh2
      9, 14, 19, 10, 15, 20, 11, 16, 21, 12, 17, 22, 13, 18, 23,
      // Sh3
      24, 31, 38, 25, 32, 39, 26, 33, 40, 27, 34, 41, 28, 35, 42, 29, 36, 43,
      30, 37, 44,
    ].slice(0, shComponents);
    const sh = new Float32Array(shComponents);

    const compressionScaleFactor = bucketBlockSize / 2 / compressionScaleRange;
    const bucketsBase = sectionBase + bucketsMetaDataSizeBytes;
    const dataBase = sectionBase + bucketsStorageSizeBytes;
    const data = new DataView(
      fileBytes.buffer,
      dataBase,
      splatDataStorageSizeBytes,
    );
    const bucketArray = new Float32Array(
      fileBytes.buffer,
      bucketsBase,
      bucketCount * 3,
    );
    const partiallyFilledBucketLengths = new Uint32Array(
      fileBytes.buffer,
      sectionBase,
      partiallyFilledBucketCount,
    );

    function getSh(splatOffset: number, component: number) {
      if (compressionLevel === 0) {
        return data.getFloat32(
          splatOffset + sphericalHarmonicsOffsetBytes + component * 4,
          true,
        );
      }
      if (compressionLevel === 1) {
        return fromHalf(
          data.getUint16(
            splatOffset + sphericalHarmonicsOffsetBytes + component * 2,
            true,
          ),
        );
      }
      const t =
        data.getUint8(splatOffset + sphericalHarmonicsOffsetBytes + component) /
        255;
      return (
        minSphericalHarmonicsCoeff +
        t * (maxSphericalHarmonicsCoeff - minSphericalHarmonicsCoeff)
      );
    }

    let partialBucketIndex = fullBucketCount;
    let partialBucketBase = fullBucketSplats;

    for (let i = 0; i < sectionSplatCount; ++i) {
      const splatOffset = i * bytesPerSplat;

      let bucketIndex: number;
      if (i < fullBucketSplats) {
        bucketIndex = Math.floor(i / bucketSize);
      } else {
        const bucketLength =
          partiallyFilledBucketLengths[partialBucketIndex - fullBucketCount];
        if (i >= partialBucketBase + bucketLength) {
          partialBucketIndex += 1;
          partialBucketBase += bucketLength;
        }
        bucketIndex = partialBucketIndex;
      }

      const x =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + 0, true)
          : (data.getUint16(splatOffset + 0, true) - compressionScaleRange) *
              compressionScaleFactor +
            bucketArray[3 * bucketIndex + 0];
      const y =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + 4, true)
          : (data.getUint16(splatOffset + 2, true) - compressionScaleRange) *
              compressionScaleFactor +
            bucketArray[3 * bucketIndex + 1];
      const z =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + 8, true)
          : (data.getUint16(splatOffset + 4, true) - compressionScaleRange) *
              compressionScaleFactor +
            bucketArray[3 * bucketIndex + 2];

      const scaleX =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + scaleOffsetBytes + 0, true)
          : fromHalf(data.getUint16(splatOffset + scaleOffsetBytes + 0, true));
      const scaleY =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + scaleOffsetBytes + 4, true)
          : fromHalf(data.getUint16(splatOffset + scaleOffsetBytes + 2, true));
      const scaleZ =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + scaleOffsetBytes + 8, true)
          : fromHalf(data.getUint16(splatOffset + scaleOffsetBytes + 4, true));

      const quatW =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + rotationOffsetBytes + 0, true)
          : fromHalf(
              data.getUint16(splatOffset + rotationOffsetBytes + 0, true),
            );
      const quatX =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + rotationOffsetBytes + 4, true)
          : fromHalf(
              data.getUint16(splatOffset + rotationOffsetBytes + 2, true),
            );
      const quatY =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + rotationOffsetBytes + 8, true)
          : fromHalf(
              data.getUint16(splatOffset + rotationOffsetBytes + 4, true),
            );
      const quatZ =
        compressionLevel === 0
          ? data.getFloat32(splatOffset + rotationOffsetBytes + 12, true)
          : fromHalf(
              data.getUint16(splatOffset + rotationOffsetBytes + 6, true),
            );

      const r = data.getUint8(splatOffset + colorOffsetBytes + 0) / 255;
      const g = data.getUint8(splatOffset + colorOffsetBytes + 1) / 255;
      const b = data.getUint8(splatOffset + colorOffsetBytes + 2) / 255;
      const opacity = data.getUint8(splatOffset + colorOffsetBytes + 3) / 255;

      splatEncoder.setSplat(
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

      if (sphericalHarmonicsDegree >= 1) {
        for (const [i, key] of shIndex.entries()) {
          sh[i] = getSh(splatOffset, key);
        }
        splatEncoder.setSplatSh(i, sh);
      }
    }
    sectionBase += storageSizeBytes;
  }
  return { unpacked: splatEncoder.closeTransferable(), numSplats: splatCount };
}
