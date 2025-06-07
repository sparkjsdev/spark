#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

// Import directly from source to avoid worker system
import { transcodeSpz } from "../dist/spark.module.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(`Usage: to-spz.js [options] <file_or_url>...

Convert Gaussian Splat files to optimized .spz format.

Supported input formats:
  .ply      PLY Gaussian Splat files
  .spz      SPZ format (for reprocessing/filtering)
  .splat    AntiSplat format
  .ksplat   KSplat format
  http(s)   Direct URLs to splat files

Options:
  --filter-zero         Filter out splats with zero opacity
  --filter-opacity N    Filter out splats with opacity <= N (0.0-1.0)
  --min x,y,z           Minimum AABB (e.g. --min 0,0,0)
  --max x,y,z           Maximum AABB (e.g. --max 1,1,1)
  --min-x N             Minimum X coordinate
  --max-x N             Maximum X coordinate
  --min-y N             Minimum Y coordinate
  --max-y N             Maximum Y coordinate
  --min-z N             Minimum Z coordinate
  --max-z N             Maximum Z coordinate
  --x-range min,max     X coordinate range (e.g. --x-range -1,1)
  --y-range min,max     Y coordinate range (e.g. --y-range -1,1)
  --z-range min,max     Z coordinate range (e.g. --z-range -1,1)
  --max-sh N            Maximum SH degree to output (0-3, default: auto-detect from input)
  --fractional-bits N   Fractional bits for coordinate precision (default: 12, range: 6-24)
`);
    process.exit(0);
  }

  let opacityThreshold = null; // null = no filtering
  let minAABB = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let maxAABB = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  let maxShDegree = null; // null = auto-detect
  let fractionalBits = 12; // default value
  const inputs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--filter-zero") {
      opacityThreshold = 0;
    } else if (arg === "--filter-opacity") {
      const val = Number(args[++i]);
      if (Number.isNaN(val) || val < 0 || val > 1) {
        throw new Error("Invalid --filter-opacity value, expected 0.0-1.0");
      }
      opacityThreshold = val;
    } else if (arg === "--min") {
      const val = args[++i];
      minAABB = val.split(",").map(Number);
      if (minAABB.length !== 3 || minAABB.some(Number.isNaN)) {
        throw new Error("Invalid --min value, expected comma-separated x,y,z");
      }
    } else if (arg === "--max") {
      const val = args[++i];
      maxAABB = val.split(",").map(Number);
      if (maxAABB.length !== 3 || maxAABB.some(Number.isNaN)) {
        throw new Error("Invalid --max value, expected comma-separated x,y,z");
      }
    } else if (arg === "--max-sh") {
      const val = Number(args[++i]);
      if (Number.isNaN(val) || val < 0 || val > 3) {
        throw new Error("Invalid --max-sh value, expected 0-3");
      }
      maxShDegree = val;
    } else if (arg === "--fractional-bits") {
      const val = Number(args[++i]);
      if (Number.isNaN(val) || val < 6 || val > 24) {
        throw new Error("Invalid --fractional-bits value, expected 6-24");
      }
      fractionalBits = val;
    } else if (arg === "--min-x") {
      const val = Number(args[++i]);
      if (Number.isNaN(val)) {
        throw new Error("Invalid --min-x value, expected a number");
      }
      minAABB[0] = val;
    } else if (arg === "--max-x") {
      const val = Number(args[++i]);
      if (Number.isNaN(val)) {
        throw new Error("Invalid --max-x value, expected a number");
      }
      maxAABB[0] = val;
    } else if (arg === "--min-y") {
      const val = Number(args[++i]);
      if (Number.isNaN(val)) {
        throw new Error("Invalid --min-y value, expected a number");
      }
      minAABB[1] = val;
    } else if (arg === "--max-y") {
      const val = Number(args[++i]);
      if (Number.isNaN(val)) {
        throw new Error("Invalid --max-y value, expected a number");
      }
      maxAABB[1] = val;
    } else if (arg === "--min-z") {
      const val = Number(args[++i]);
      if (Number.isNaN(val)) {
        throw new Error("Invalid --min-z value, expected a number");
      }
      minAABB[2] = val;
    } else if (arg === "--max-z") {
      const val = Number(args[++i]);
      if (Number.isNaN(val)) {
        throw new Error("Invalid --max-z value, expected a number");
      }
      maxAABB[2] = val;
    } else if (arg === "--x-range") {
      const val = args[++i];
      const range = val.split(",").map(Number);
      if (range.length !== 2 || range.some(Number.isNaN)) {
        throw new Error("Invalid --x-range value, expected min,max");
      }
      minAABB[0] = range[0];
      maxAABB[0] = range[1];
    } else if (arg === "--y-range") {
      const val = args[++i];
      const range = val.split(",").map(Number);
      if (range.length !== 2 || range.some(Number.isNaN)) {
        throw new Error("Invalid --y-range value, expected min,max");
      }
      minAABB[1] = range[0];
      maxAABB[1] = range[1];
    } else if (arg === "--z-range") {
      const val = args[++i];
      const range = val.split(",").map(Number);
      if (range.length !== 2 || range.some(Number.isNaN)) {
        throw new Error("Invalid --z-range value, expected min,max");
      }
      minAABB[2] = range[0];
      maxAABB[2] = range[1];
    } else {
      inputs.push(arg);
    }
  }

  if (inputs.length === 0) {
    console.error("No input files or URLs specified.");
    process.exit(1);
  }

  // Collect all file inputs first
  const transcodeInputs = [];

  for (const input of inputs) {
    console.log(`Loading ${input}...`);
    let fileBytes;
    let pathOrUrl;

    if (input.startsWith("http://") || input.startsWith("https://")) {
      const res = await fetch(input);
      if (!res.ok) {
        console.error(
          `Failed to fetch ${input}: ${res.status} ${res.statusText}`,
        );
        continue;
      }
      const buffer = await res.arrayBuffer();
      fileBytes = new Uint8Array(buffer);
      pathOrUrl = input;
    } else {
      const data = await fs.readFile(input);
      fileBytes = new Uint8Array(data);
      pathOrUrl = input;
    }

    transcodeInputs.push({
      fileBytes: fileBytes.slice(),
      pathOrUrl,
      transform: {
        translate: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: 1,
      },
    });
  }

  if (transcodeInputs.length === 0) {
    console.error("No valid inputs to process.");
    process.exit(1);
  }

  // Setup clipping bounds if specified
  let clipXyz = undefined;
  if (
    minAABB[0] !== Number.NEGATIVE_INFINITY ||
    minAABB[1] !== Number.NEGATIVE_INFINITY ||
    minAABB[2] !== Number.NEGATIVE_INFINITY ||
    maxAABB[0] !== Number.POSITIVE_INFINITY ||
    maxAABB[1] !== Number.POSITIVE_INFINITY ||
    maxAABB[2] !== Number.POSITIVE_INFINITY
  ) {
    clipXyz = {
      min: minAABB,
      max: maxAABB,
    };
  }

  // Setup opacity threshold filtering
  if (opacityThreshold !== null) {
    console.log(
      `Applying opacity filtering: removing splats with opacity <= ${opacityThreshold}`,
    );
  }

  console.log(
    `Processing ${transcodeInputs.length} input file(s) with transcodeSpz...`,
  );
  const transcode = await transcodeSpz({
    inputs: transcodeInputs,
    maxSh: maxShDegree,
    clipXyz,
    fractionalBits,
    opacityThreshold,
  });

  // Write output file
  const firstInput = transcodeInputs[0];
  const baseName = path.basename(firstInput.pathOrUrl);
  const nameNoExt = baseName.replace(/\.[^.]+$/, "");
  const outDir =
    firstInput.pathOrUrl.startsWith("http://") ||
    firstInput.pathOrUrl.startsWith("https://")
      ? process.cwd()
      : path.dirname(firstInput.pathOrUrl);

  const outputName =
    transcodeInputs.length === 1
      ? `${nameNoExt}.spz`
      : `combined_${transcodeInputs.length}_files.spz`;

  const outPath = path.join(outDir, outputName);
  await fs.writeFile(outPath, transcode.fileBytes);
  console.log(`Wrote ${outPath} (${transcode.fileBytes.length} bytes)`);

  if (transcode.clippedCount && transcode.clippedCount > 0) {
    console.log(`Clipped ${transcode.clippedCount} splats.`);
    console.log(
      `Consider decreasing fractional-bits from ${fractionalBits} to reduce clipping.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
