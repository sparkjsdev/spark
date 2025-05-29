import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { rm } from "node:fs/promises";
import path from "node:path";

const siteRemoteURL = "git@github.com:forge-gfx/forge-gfx.github.io.git";
const siteRepoDir = "site-repo";
const siteBuild = "site";

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...options });
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function emptyDirectory(directoryPath) {
  try {
    const files = await fs.readdir(directoryPath);

    for (const file of files) {
      if (file === ".git" || file === "CNAME") continue;

      const filePath = path.join(directoryPath, file);
      const stat = await fs.lstat(filePath);

      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }

      console.log("Deleted:", filePath);
    }
  } catch (err) {
    console.error("Error processing directory:", err);
  }
}

try {
  await fs.access(siteRepoDir);
} catch {
  run(`git clone ${siteRemoteURL} ${siteRepoDir}`);
}

run("git reset --hard", { cwd: siteRepoDir });
run("git fetch origin", { cwd: siteRepoDir });
run("git merge --ff-only origin/main", { cwd: siteRepoDir });
await emptyDirectory(siteRepoDir);
await copyDir(siteBuild, siteRepoDir);
run("git add .", { cwd: siteRepoDir });
run('git commit -m "Update Forge site"', { cwd: siteRepoDir });
run("git push origin main", { cwd: siteRepoDir });
