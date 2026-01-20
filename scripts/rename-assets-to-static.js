import { execSync } from "node:child_process";
import {
  copyFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

const siteDirectory = "site";
const oldAssets = join(siteDirectory, "assets");
const newAssets = join(siteDirectory, "static");

// Rename assets directory
console.log(`Renaming ${oldAssets} → ${newAssets}...`);
renameSync(oldAssets, newAssets);
replaceInHtmlFiles(siteDirectory);

function replaceInHtmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      replaceInHtmlFiles(fullPath);
    } else if (stat.isFile() && extname(fullPath) === ".html") {
      const html = readFileSync(fullPath, "utf-8");

      // Replace relative/local asset references ONLY (exclude external URLs like https://sparkjs.dev/..)
      const updated = html.replace(
        /(["'(=])((?:\.\.\/)*|\.\/|\/)assets\//g,
        (_, prefix, rel) => `${prefix}${rel}static/`,
      );
      if (updated !== html) {
        writeFileSync(fullPath, updated);
      }
    }
  }
}

// Copy Azure Static Web Apps config if it exists
const swaConfig = "staticwebapp.config.json";
try {
  copyFileSync(swaConfig, join(siteDirectory, swaConfig));
  console.log(`Copied ${swaConfig} to ${siteDirectory}/`);
} catch {
  // Config file is optional - skip if not present
}
