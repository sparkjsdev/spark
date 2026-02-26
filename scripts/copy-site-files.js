import fs from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy static files to docs directory.
copyDir("examples", "docs/examples");

// Create CNAME file
await writeFile("docs/CNAME", "sparkjs.dev\n");
await copyFile("examples.html", "docs/examples/index.html");
await copyDir("docs/examples/viewer", "docs/viewer");
await mkdir("docs/examples/vendor", { recursive: true });
copyDir("node_modules/three", "docs/examples/js/vendor/three");
copyDir("node_modules/lil-gui", "docs/examples/js/vendor/lil-gui");
copyDir("node_modules/stats.js", "docs/examples/js/vendor/stats.js");
copyDir("dist", "docs/dist");
console.log("Site generated in docs directory.");
