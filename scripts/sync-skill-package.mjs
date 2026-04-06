import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");
const entries = existsSync(packagesDir)
  ? await readdir(packagesDir, { withFileTypes: true })
  : [];

const synced = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const packageDir = join(packagesDir, entry.name);
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) continue;

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const skillPaths = Array.isArray(packageJson.pi?.skills) ? packageJson.pi.skills : [];

  for (const skillPath of skillPaths) {
    if (typeof skillPath !== "string") continue;

    const skillName = skillPath.split("/").at(-1);
    const canonicalDir = join(repoRoot, "skills", skillName);
    const targetDir = join(packageDir, skillPath);

    if (!existsSync(canonicalDir)) {
      throw new Error(`Missing canonical skill source: ${canonicalDir}`);
    }

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(dirname(targetDir), { recursive: true });
    await cp(canonicalDir, targetDir, { recursive: true });

    const licenseSource = join(canonicalDir, "LICENSE.md");
    if (existsSync(licenseSource)) {
      await cp(licenseSource, join(packageDir, "LICENSE.md"));
    }

    const readmeSource = join(canonicalDir, "README.md");
    if (existsSync(readmeSource)) {
      await cp(readmeSource, join(packageDir, "README.md"));
    }

    synced.push(`${packageJson.name} <- ${skillName}`);
  }
}

if (synced.length === 0) {
  console.log("No skill packages found.");
} else {
  console.log(`Synced ${synced.length} skill package(s):`);
  for (const item of synced) {
    console.log(`- ${item}`);
  }
}
