import assert from "node:assert";
import type { PackedSplats } from "../src/PackedSplats.js";
import { PlyWriter } from "../src/PlyWriter.js";
import { SH_C0 } from "../src/ply.js";

// Mock Vector3-like object
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Mock Quaternion-like object
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

// Mock Color-like object
interface Col {
  r: number;
  g: number;
  b: number;
}

// Mock splat data structure
interface MockSplat {
  center: Vec3;
  scales: Vec3;
  quaternion: Quat;
  opacity: number;
  color: Col;
}

// Create a mock PackedSplats that mimics the real interface
function createMockPackedSplats(splats: MockSplat[]): PackedSplats {
  return {
    numSplats: splats.length,
    forEachSplat(
      callback: (
        index: number,
        center: Vec3,
        scales: Vec3,
        quaternion: Quat,
        opacity: number,
        color: Col,
      ) => void,
    ) {
      for (let i = 0; i < splats.length; i++) {
        const s = splats[i];
        callback(i, s.center, s.scales, s.quaternion, s.opacity, s.color);
      }
    },
  } as PackedSplats;
}

// Helper to find header end in PLY data
function findHeaderEnd(data: Uint8Array): number {
  const decoder = new TextDecoder();
  for (let i = 0; i < data.length - 10; i++) {
    const slice = decoder.decode(data.slice(i, i + 11));
    if (slice === "end_header\n") {
      return i + 11;
    }
  }
  return -1;
}

// Test 1: PlyWriter constructor with default options
{
  const mockSplats = createMockPackedSplats([]);
  const writer = new PlyWriter(mockSplats);

  assert.strictEqual(
    writer.options.format,
    "binary_little_endian",
    "Default format should be binary_little_endian",
  );
}

// Test 2: PlyWriter constructor with custom format
{
  const mockSplats = createMockPackedSplats([]);
  const writer = new PlyWriter(mockSplats, { format: "binary_big_endian" });

  assert.strictEqual(
    writer.options.format,
    "binary_big_endian",
    "Custom format should be respected",
  );
}

// Test 3: Export generates valid PLY header
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
    {
      center: { x: 1, y: 1, z: 1 },
      scales: { x: 0.2, y: 0.2, z: 0.2 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.8,
      color: { r: 1.0, g: 0.5, b: 0.0 },
    },
    {
      center: { x: 2, y: 2, z: 2 },
      scales: { x: 0.3, y: 0.3, z: 0.3 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 1.0,
      color: { r: 0.0, g: 1.0, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  assert.ok(headerEndIndex > 0, "Should find end_header marker");

  const header = new TextDecoder().decode(result.slice(0, headerEndIndex));

  assert.ok(header.startsWith("ply\n"), "Header should start with 'ply'");
  assert.ok(
    header.includes("format binary_little_endian 1.0"),
    "Header should include format",
  );
  assert.ok(
    header.includes("element vertex 3"),
    "Header should include correct vertex count",
  );
  assert.ok(header.includes("property float x"), "Header should include x");
  assert.ok(header.includes("property float y"), "Header should include y");
  assert.ok(header.includes("property float z"), "Header should include z");
  assert.ok(
    header.includes("property float scale_0"),
    "Header should include scale_0",
  );
  assert.ok(
    header.includes("property float scale_1"),
    "Header should include scale_1",
  );
  assert.ok(
    header.includes("property float scale_2"),
    "Header should include scale_2",
  );
  assert.ok(
    header.includes("property float rot_0"),
    "Header should include rot_0",
  );
  assert.ok(
    header.includes("property float rot_1"),
    "Header should include rot_1",
  );
  assert.ok(
    header.includes("property float rot_2"),
    "Header should include rot_2",
  );
  assert.ok(
    header.includes("property float rot_3"),
    "Header should include rot_3",
  );
  assert.ok(
    header.includes("property float opacity"),
    "Header should include opacity",
  );
  assert.ok(
    header.includes("property float f_dc_0"),
    "Header should include f_dc_0",
  );
  assert.ok(
    header.includes("property float f_dc_1"),
    "Header should include f_dc_1",
  );
  assert.ok(
    header.includes("property float f_dc_2"),
    "Header should include f_dc_2",
  );
  assert.ok(header.includes("end_header"), "Header should end with end_header");
}

// Test 4: Export generates correct binary size
{
  const numSplats = 5;
  const splats: MockSplat[] = [];
  for (let i = 0; i < numSplats; i++) {
    splats.push({
      center: { x: i, y: i, z: i },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    });
  }

  const mockSplats = createMockPackedSplats(splats);
  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  // Each splat is 14 float32 = 56 bytes
  const bytesPerSplat = 14 * 4;
  const expectedBinarySize = numSplats * bytesPerSplat;

  const headerEndIndex = findHeaderEnd(result);
  const binarySize = result.length - headerEndIndex;

  assert.strictEqual(
    binarySize,
    expectedBinarySize,
    `Binary data size should be ${expectedBinarySize} bytes (${numSplats} splats * 56 bytes)`,
  );
}

// Test 5: Binary data contains correct position values (little endian)
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 1.5, y: 2.5, z: 3.5 },
      scales: { x: 0.1, y: 0.2, z: 0.3 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const binaryData = result.slice(headerEndIndex);
  const dataView = new DataView(binaryData.buffer, binaryData.byteOffset);

  // Position is first 3 floats (little endian)
  const x = dataView.getFloat32(0, true);
  const y = dataView.getFloat32(4, true);
  const z = dataView.getFloat32(8, true);

  assert.strictEqual(x, 1.5, "X position should be 1.5");
  assert.strictEqual(y, 2.5, "Y position should be 2.5");
  assert.strictEqual(z, 3.5, "Z position should be 3.5");
}

// Test 6: Scale values are log-encoded
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 1.0, y: Math.E, z: Math.exp(2) }, // log: 0, 1, 2
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const binaryData = result.slice(headerEndIndex);
  const dataView = new DataView(binaryData.buffer, binaryData.byteOffset);

  // Scale values start at offset 12 (after x, y, z)
  const scale0 = dataView.getFloat32(12, true);
  const scale1 = dataView.getFloat32(16, true);
  const scale2 = dataView.getFloat32(20, true);

  assert.ok(
    Math.abs(scale0 - 0) < 0.0001,
    `Log scale_0 for scale=1 should be 0, got ${scale0}`,
  );
  assert.ok(
    Math.abs(scale1 - 1) < 0.0001,
    `Log scale_1 for scale=e should be 1, got ${scale1}`,
  );
  assert.ok(
    Math.abs(scale2 - 2) < 0.0001,
    `Log scale_2 for scale=e^2 should be 2, got ${scale2}`,
  );
}

// Test 7: Zero scale uses fallback value
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0, y: 0, z: 0 }, // Zero scale (2DGS)
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const binaryData = result.slice(headerEndIndex);
  const dataView = new DataView(binaryData.buffer, binaryData.byteOffset);

  // Scale values start at offset 12
  const scale0 = dataView.getFloat32(12, true);
  const scale1 = dataView.getFloat32(16, true);
  const scale2 = dataView.getFloat32(20, true);

  // Zero scale should use -12 as fallback
  assert.strictEqual(scale0, -12, "Zero scale_0 should use -12 fallback");
  assert.strictEqual(scale1, -12, "Zero scale_1 should use -12 fallback");
  assert.strictEqual(scale2, -12, "Zero scale_2 should use -12 fallback");
}

// Test 8: Quaternion values are correctly written
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 }, // Custom rotation
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const binaryData = result.slice(headerEndIndex);
  const dataView = new DataView(binaryData.buffer, binaryData.byteOffset);

  // Quaternion starts at offset 24 (after x,y,z,scale0,1,2)
  // Order is w, x, y, z (rot_0=w, rot_1=x, rot_2=y, rot_3=z)
  const rot0 = dataView.getFloat32(24, true); // w
  const rot1 = dataView.getFloat32(28, true); // x
  const rot2 = dataView.getFloat32(32, true); // y
  const rot3 = dataView.getFloat32(36, true); // z

  assert.ok(
    Math.abs(rot0 - 0.9) < 0.0001,
    `rot_0 (w) should be 0.9, got ${rot0}`,
  );
  assert.ok(
    Math.abs(rot1 - 0.1) < 0.0001,
    `rot_1 (x) should be 0.1, got ${rot1}`,
  );
  assert.ok(
    Math.abs(rot2 - 0.2) < 0.0001,
    `rot_2 (y) should be 0.2, got ${rot2}`,
  );
  assert.ok(
    Math.abs(rot3 - 0.3) < 0.0001,
    `rot_3 (z) should be 0.3, got ${rot3}`,
  );
}

// Test 9: Opacity is sigmoid-encoded
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5, // sigmoid inverse = ln(0.5/0.5) = 0
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const binaryData = result.slice(headerEndIndex);
  const dataView = new DataView(binaryData.buffer, binaryData.byteOffset);

  // Opacity is at offset 40 (after x,y,z, scale0,1,2, rot0,1,2,3)
  const sigmoidOpacity = dataView.getFloat32(40, true);

  assert.ok(
    Math.abs(sigmoidOpacity) < 0.0001,
    `Sigmoid opacity for 0.5 should be 0, got ${sigmoidOpacity}`,
  );
}

// Test 10: Opacity edge cases are clamped
{
  // Test opacity = 1.0 (would be inf without clamping)
  const mockSplats1 = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 1.0, // Clamped to 0.999
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer1 = new PlyWriter(mockSplats1);
  const result1 = writer1.export();
  const headerEndIndex1 = findHeaderEnd(result1);
  const binaryData1 = result1.slice(headerEndIndex1);
  const dataView1 = new DataView(binaryData1.buffer, binaryData1.byteOffset);
  const opacity1 = dataView1.getFloat32(40, true);

  assert.ok(
    Number.isFinite(opacity1),
    `Opacity 1.0 should produce finite value, got ${opacity1}`,
  );
  assert.ok(opacity1 > 0, "Opacity 1.0 should produce positive sigmoid value");

  // Test opacity = 0.0 (would be -inf without clamping)
  const mockSplats0 = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.0, // Clamped to 0.001
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer0 = new PlyWriter(mockSplats0);
  const result0 = writer0.export();
  const headerEndIndex0 = findHeaderEnd(result0);
  const binaryData0 = result0.slice(headerEndIndex0);
  const dataView0 = new DataView(binaryData0.buffer, binaryData0.byteOffset);
  const opacity0 = dataView0.getFloat32(40, true);

  assert.ok(
    Number.isFinite(opacity0),
    `Opacity 0.0 should produce finite value, got ${opacity0}`,
  );
  assert.ok(opacity0 < 0, "Opacity 0.0 should produce negative sigmoid value");
}

// Test 11: Color DC coefficients are correctly encoded
{
  // color = f_dc * SH_C0 + 0.5 => f_dc = (color - 0.5) / SH_C0
  const testColor = { r: 0.75, g: 0.25, b: 1.0 };
  const expectedDC0 = (testColor.r - 0.5) / SH_C0;
  const expectedDC1 = (testColor.g - 0.5) / SH_C0;
  const expectedDC2 = (testColor.b - 0.5) / SH_C0;

  const mockSplats = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: testColor,
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const binaryData = result.slice(headerEndIndex);
  const dataView = new DataView(binaryData.buffer, binaryData.byteOffset);

  // Color DC coefficients start at offset 44 (after opacity)
  const f_dc_0 = dataView.getFloat32(44, true);
  const f_dc_1 = dataView.getFloat32(48, true);
  const f_dc_2 = dataView.getFloat32(52, true);

  assert.ok(
    Math.abs(f_dc_0 - expectedDC0) < 0.0001,
    `f_dc_0 should be ${expectedDC0}, got ${f_dc_0}`,
  );
  assert.ok(
    Math.abs(f_dc_1 - expectedDC1) < 0.0001,
    `f_dc_1 should be ${expectedDC1}, got ${f_dc_1}`,
  );
  assert.ok(
    Math.abs(f_dc_2 - expectedDC2) < 0.0001,
    `f_dc_2 should be ${expectedDC2}, got ${f_dc_2}`,
  );
}

// Test 12: Empty PackedSplats exports correctly
{
  const mockSplats = createMockPackedSplats([]);
  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const decoder = new TextDecoder();
  const headerStr = decoder.decode(result);

  assert.ok(
    headerStr.includes("element vertex 0"),
    "Empty export should have 0 vertices",
  );
  assert.ok(
    headerStr.includes("end_header"),
    "Empty export should have valid header",
  );

  // Should only contain header, no binary data
  const headerEnd = findHeaderEnd(result);
  assert.strictEqual(
    result.length,
    headerEnd,
    "Empty export should have no binary data after header",
  );
}

// Test 13: Big endian format header
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 1, y: 2, z: 3 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats, { format: "binary_big_endian" });
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const header = new TextDecoder().decode(result.slice(0, headerEndIndex));

  assert.ok(
    header.includes("format binary_big_endian 1.0"),
    "Header should specify big endian format",
  );
}

// Test 14: Big endian binary data is byte-swapped
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 1.5, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const littleWriter = new PlyWriter(mockSplats, {
    format: "binary_little_endian",
  });
  const bigWriter = new PlyWriter(mockSplats, { format: "binary_big_endian" });

  const littleResult = littleWriter.export();
  const bigResult = bigWriter.export();

  const littleHeaderEnd = findHeaderEnd(littleResult);
  const bigHeaderEnd = findHeaderEnd(bigResult);

  const littleBinary = littleResult.slice(littleHeaderEnd);
  const bigBinary = bigResult.slice(bigHeaderEnd);

  // Read x value from both
  const littleView = new DataView(littleBinary.buffer, littleBinary.byteOffset);
  const bigView = new DataView(bigBinary.buffer, bigBinary.byteOffset);

  const littleX = littleView.getFloat32(0, true); // Read as little endian
  const bigX = bigView.getFloat32(0, false); // Read as big endian

  assert.strictEqual(littleX, 1.5, "Little endian X should be 1.5");
  assert.strictEqual(
    bigX,
    1.5,
    "Big endian X should be 1.5 when read correctly",
  );
}

// Test 15: Multiple splats are exported in order
{
  const mockSplats = createMockPackedSplats([
    {
      center: { x: 0, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
    {
      center: { x: 10, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
    {
      center: { x: 20, y: 0, z: 0 },
      scales: { x: 0.1, y: 0.1, z: 0.1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      opacity: 0.5,
      color: { r: 0.5, g: 0.5, b: 0.5 },
    },
  ]);

  const writer = new PlyWriter(mockSplats);
  const result = writer.export();

  const headerEndIndex = findHeaderEnd(result);
  const binaryData = result.slice(headerEndIndex);
  const dataView = new DataView(binaryData.buffer, binaryData.byteOffset);

  // Each splat is 56 bytes
  const x0 = dataView.getFloat32(0, true);
  const x1 = dataView.getFloat32(56, true);
  const x2 = dataView.getFloat32(112, true);

  assert.strictEqual(x0, 0, "First splat X should be 0");
  assert.strictEqual(x1, 10, "Second splat X should be 10");
  assert.strictEqual(x2, 20, "Third splat X should be 20");
}

console.log("✅ All PlyWriter test cases passed!");
