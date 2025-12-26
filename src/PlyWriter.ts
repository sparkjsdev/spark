// PLY file format writer for Gaussian Splatting data

import type { PackedSplats } from "./PackedSplats";
import { SH_C0 } from "./ply";

export type PlyWriterOptions = {
  // Output format (default: binary_little_endian)
  format?: "binary_little_endian" | "binary_big_endian";
};

/**
 * PlyWriter exports PackedSplats data to standard PLY format.
 *
 * The output PLY file is compatible with common 3DGS tools and can be
 * re-imported into Spark or other Gaussian splatting renderers.
 */
export class PlyWriter {
  packedSplats: PackedSplats;
  options: Required<PlyWriterOptions>;

  constructor(packedSplats: PackedSplats, options: PlyWriterOptions = {}) {
    this.packedSplats = packedSplats;
    this.options = {
      format: options.format ?? "binary_little_endian",
    };
  }

  /**
   * Generate the PLY header string.
   */
  private generateHeader(): string {
    const numSplats = this.packedSplats.numSplats;
    const format = this.options.format.replaceAll("_", " ");

    const lines = [
      "ply",
      `format ${format} 1.0`,
      `element vertex ${numSplats}`,
      "property float x",
      "property float y",
      "property float z",
      "property float scale_0",
      "property float scale_1",
      "property float scale_2",
      "property float rot_0",
      "property float rot_1",
      "property float rot_2",
      "property float rot_3",
      "property float opacity",
      "property float f_dc_0",
      "property float f_dc_1",
      "property float f_dc_2",
      "end_header",
    ];

    return `${lines.join("\n")}\n`;
  }

  /**
   * Write binary data for all splats.
   * Each splat is 14 float32 values = 56 bytes.
   */
  private writeBinaryData(): ArrayBuffer {
    const numSplats = this.packedSplats.numSplats;
    const bytesPerSplat = 14 * 4; // 14 float32 properties
    const buffer = new ArrayBuffer(numSplats * bytesPerSplat);
    const dataView = new DataView(buffer);
    const littleEndian = this.options.format === "binary_little_endian";

    let offset = 0;

    this.packedSplats.forEachSplat(
      (index, center, scales, quaternion, opacity, color) => {
        // Position: x, y, z
        dataView.setFloat32(offset, center.x, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, center.y, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, center.z, littleEndian);
        offset += 4;

        // Scale: log scale (scale_0, scale_1, scale_2)
        // Splats with scale=0 are 2DGS, use a very small value
        const lnScaleX = scales.x > 0 ? Math.log(scales.x) : -12;
        const lnScaleY = scales.y > 0 ? Math.log(scales.y) : -12;
        const lnScaleZ = scales.z > 0 ? Math.log(scales.z) : -12;
        dataView.setFloat32(offset, lnScaleX, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, lnScaleY, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, lnScaleZ, littleEndian);
        offset += 4;

        // Rotation: quaternion (rot_0=w, rot_1=x, rot_2=y, rot_3=z)
        dataView.setFloat32(offset, quaternion.w, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, quaternion.x, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, quaternion.y, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, quaternion.z, littleEndian);
        offset += 4;

        // Opacity: inverse sigmoid
        // opacity = 1 / (1 + exp(-x)) => x = -ln(1/opacity - 1) = ln(opacity / (1 - opacity))
        // Clamp opacity to avoid log(0) or log(inf)
        const clampedOpacity = Math.max(0.001, Math.min(0.999, opacity));
        const sigmoidOpacity = Math.log(clampedOpacity / (1 - clampedOpacity));
        dataView.setFloat32(offset, sigmoidOpacity, littleEndian);
        offset += 4;

        // Color: DC coefficients (f_dc_0, f_dc_1, f_dc_2)
        // color = f_dc * SH_C0 + 0.5 => f_dc = (color - 0.5) / SH_C0
        const f_dc_0 = (color.r - 0.5) / SH_C0;
        const f_dc_1 = (color.g - 0.5) / SH_C0;
        const f_dc_2 = (color.b - 0.5) / SH_C0;
        dataView.setFloat32(offset, f_dc_0, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, f_dc_1, littleEndian);
        offset += 4;
        dataView.setFloat32(offset, f_dc_2, littleEndian);
        offset += 4;
      },
    );

    return buffer;
  }

  /**
   * Export the PackedSplats as a complete PLY file.
   * @returns Uint8Array containing the PLY file data
   */
  export(): Uint8Array {
    const header = this.generateHeader();
    const headerBytes = new TextEncoder().encode(header);
    const binaryData = this.writeBinaryData();

    // Combine header and binary data
    const result = new Uint8Array(headerBytes.length + binaryData.byteLength);
    result.set(headerBytes, 0);
    result.set(new Uint8Array(binaryData), headerBytes.length);

    return result;
  }

  /**
   * Export and trigger a file download.
   * @param filename The name of the file to download
   */
  downloadAs(filename: string): void {
    const data = this.export();
    const blob = new Blob([data], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }
}
