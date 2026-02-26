#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const stringReplacements = {
  "site/index.html": {
    replacements: {
      "../../examples/": "./examples/",
      "../../docs/": "./docs/",
      "../../viewer/": "./viewer/",
    },
  },
  "site/viewer/index.html": {
    replacements: {
      "../js/vendor/three/build/three.module.js":
        "../examples/js/vendor/three/build/three.module.js",
      "/examples/js/vendor/three/examples/jsm/":
        "../examples/js/vendor/three/examples/jsm/",
      "../../dist/spark.module.js": "../dist/spark.module.js",
    },
  },
  "site/docs/index.html": {
    replacements: {
      "../../examples/": "../examples/",
      "../../docs/": "../docs/",
      "../../viewer/": "../viewer/",
    },
  },
};

/**
 * Escape string for RegExp
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply replacements
 */
function processFile(filePath, replacements) {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    console.warn(`⚠File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(absPath, "utf8");

  for (const [from, to] of Object.entries(replacements)) {
    const regex = new RegExp(escapeRegex(from), "g");
    content = content.replace(regex, to);
  }

  fs.writeFileSync(absPath, content);
  console.log(`Updated: ${filePath}`);
}

/**
 * Run
 */
for (const [filePath, { replacements }] of Object.entries(stringReplacements)) {
  processFile(filePath, replacements);
}

console.log("URLs replaced.");
