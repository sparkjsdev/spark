import fs from "node:fs";
import { copyFile, mkdir, rename, rmSync } from "node:fs/promises";
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

// Example usage:
const sourceDir = "examples";
const destinationDir = "site/examples";

copyDir("examples", "site/examples");
await copyFile("index.html", "site/examples/index.html");
await rename("site/examples/viewer", "site/viewer");
await mkdir("site/examples/vendor", { recursive: true });
copyDir("node_modules/three", "site/examples/js/vendor/three");
copyDir("dist", "site/dist");
console.log("Site generated in site directory.");
