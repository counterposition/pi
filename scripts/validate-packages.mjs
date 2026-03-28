import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");

if (!existsSync(packagesDir)) {
  console.error("Missing packages/ directory.");
  process.exit(1);
}

const entries = await readdir(packagesDir, { withFileTypes: true });
const packageDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const errors = [];
const validated = [];

for (const dirName of packageDirs) {
  const packageDir = join(packagesDir, dirName);
  const packageJsonPath = join(packageDir, "package.json");

  if (!existsSync(packageJsonPath)) {
    errors.push(`${dirName}: missing package.json`);
    continue;
  }

  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const relativeDir = relative(repoRoot, packageDir).replace(/\\/g, "/");

  requireNonEmptyString(pkg.name, `${dirName}: package.json name is required`, errors);
  requireNonEmptyString(pkg.version, `${dirName}: package.json version is required`, errors);
  requireNonEmptyString(pkg.description, `${dirName}: package.json description is required`, errors);
  requireNonEmptyString(pkg.license, `${dirName}: package.json license is required`, errors);

  if (pkg.engines?.node !== ">=24") {
    errors.push(`${dirName}: engines.node must be '>=24'`);
  }

  if (pkg.publishConfig?.access !== "public") {
    errors.push(`${dirName}: publishConfig.access must be 'public'`);
  }

  if (pkg.repository?.directory !== relativeDir) {
    errors.push(`${dirName}: repository.directory must be '${relativeDir}'`);
  }

  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    errors.push(`${dirName}: files allowlist is required`);
  }

  if (!existsSync(join(packageDir, "README.md"))) {
    errors.push(`${dirName}: missing README.md`);
  }

  if (!findLicenseFile(packageDir)) {
    errors.push(`${dirName}: missing LICENSE file`);
  }

  for (const field of ["extensions", "skills", "prompts", "themes"]) {
    const paths = pkg.pi?.[field];
    if (!Array.isArray(paths)) continue;

    for (const assetPath of paths) {
      if (!existsSync(join(packageDir, assetPath))) {
        errors.push(`${dirName}: pi.${field} entry is missing '${assetPath}'`);
      }
    }
  }

  if (Array.isArray(pkg.pi?.extensions)) {
    if (!pkg.files.includes("extensions/")) {
      errors.push(`${dirName}: extension packages must include 'extensions/' in files`);
    }

    if (existsSync(join(packageDir, "src")) && !pkg.files.includes("src/")) {
      errors.push(`${dirName}: package uses src/ and must include it in files`);
    }

    for (const peerName of ["@mariozechner/pi-ai", "@mariozechner/pi-coding-agent"]) {
      if (!pkg.peerDependencies?.[peerName]) {
        errors.push(`${dirName}: missing peer dependency '${peerName}'`);
      }
    }
  }

  if (Array.isArray(pkg.pi?.skills)) {
    const localSkillsDir = join(packageDir, "skills");
    const localSkillDirs = existsSync(localSkillsDir)
      ? (await readdir(localSkillsDir, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];

    if (localSkillDirs.length !== 1) {
      errors.push(`${dirName}: skill packages must contain exactly one skill directory`);
    } else {
      const skillName = localSkillDirs[0];
      const canonicalSkillDir = join(repoRoot, "skills", skillName);
      const packagedSkillDir = join(localSkillsDir, skillName);

      if (!existsSync(canonicalSkillDir)) {
        errors.push(`${dirName}: missing canonical skill '${skillName}' under skills/`);
      } else if (!(await directoriesEqual(canonicalSkillDir, packagedSkillDir))) {
        errors.push(`${dirName}: packaged skill '${skillName}' is out of sync with canonical source`);
      }
    }
  }

  validated.push(pkg.name ?? dirName);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${validated.length} package(s): ${validated.join(", ")}`);

function requireNonEmptyString(value, message, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(message);
  }
}

function findLicenseFile(packageDir) {
  for (const candidate of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    if (existsSync(join(packageDir, candidate))) {
      return candidate;
    }
  }
  return null;
}

async function directoriesEqual(leftDir, rightDir) {
  const leftFiles = await listFiles(leftDir);
  const rightFiles = await listFiles(rightDir);

  if (leftFiles.length !== rightFiles.length) {
    return false;
  }

  for (let index = 0; index < leftFiles.length; index += 1) {
    if (leftFiles[index] !== rightFiles[index]) {
      return false;
    }

    const leftContent = await readFile(join(leftDir, leftFiles[index]));
    const rightContent = await readFile(join(rightDir, rightFiles[index]));

    if (!leftContent.equals(rightContent)) {
      return false;
    }
  }

  return true;
}

async function listFiles(rootDir, currentDir = rootDir) {
  const results = [];
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".DS_Store") continue;

    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFiles(rootDir, fullPath)));
      continue;
    }

    results.push(relative(rootDir, fullPath).replace(/\\/g, "/"));
  }

  return results;
}
