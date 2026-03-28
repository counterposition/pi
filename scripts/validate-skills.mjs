import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(repoRoot, "skills");

if (!existsSync(skillsDir)) {
  console.error("Missing skills/ directory.");
  process.exit(1);
}

const entries = await readdir(skillsDir, { withFileTypes: true });
const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

if (skillDirs.length === 0) {
  console.error("No skills found in skills/.");
  process.exit(1);
}

const errors = [];

for (const skillName of skillDirs) {
  const skillPath = join(skillsDir, skillName);
  const skillFile = join(skillPath, "SKILL.md");
  const readmeFile = join(skillPath, "README.md");

  if (!existsSync(skillFile)) {
    errors.push(`${skillName}: missing SKILL.md`);
    continue;
  }

  if (!existsSync(readmeFile)) {
    errors.push(`${skillName}: missing README.md`);
  }

  const content = await readFile(skillFile, "utf8");
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter) {
    errors.push(`${skillName}: missing or invalid frontmatter`);
    continue;
  }

  if (!frontmatter.name) {
    errors.push(`${skillName}: frontmatter is missing name`);
  }

  if (!frontmatter.description) {
    errors.push(`${skillName}: frontmatter is missing description`);
  }

  if (frontmatter.name && frontmatter.name !== skillName) {
    errors.push(`${skillName}: directory name does not match frontmatter name '${frontmatter.name}'`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${skillDirs.length} skill(s): ${skillDirs.join(", ")}`);

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;

  const data = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) return null;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    data[key] = value;
  }

  return data;
}
