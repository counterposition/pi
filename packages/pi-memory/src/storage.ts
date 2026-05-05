import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  MemoryRoots,
  MemoryScope,
  MemorySearchScope,
  MemoryStatusSummary,
  ProjectIdentity,
} from "./types.js";

export function resolveMemoryRoots(agentDir: string, identity: ProjectIdentity): MemoryRoots {
  const memoryDir = path.join(agentDir, "memory");
  const globalRoot = path.join(memoryDir, "global");
  const projectRoot = path.join(memoryDir, "projects", identity.projectId);

  return {
    agentDir,
    memoryDir,
    globalRoot,
    projectRoot,
    rootDirs: {
      global: globalRoot,
      project: projectRoot,
    },
    inboxDirs: {
      global: path.join(globalRoot, "inbox"),
      project: path.join(projectRoot, "inbox"),
    },
    topicDirs: {
      global: path.join(globalRoot, "topics"),
      project: path.join(projectRoot, "topics"),
    },
  };
}

export async function ensureMemoryRoots(roots: MemoryRoots): Promise<void> {
  await Promise.all([
    fs.mkdir(roots.inboxDirs.global, { recursive: true }),
    fs.mkdir(roots.topicDirs.global, { recursive: true }),
    fs.mkdir(roots.inboxDirs.project, { recursive: true }),
    fs.mkdir(roots.topicDirs.project, { recursive: true }),
  ]);
}

export async function listTopicFiles(
  roots: MemoryRoots,
  scope: MemorySearchScope = "all",
): Promise<Array<{ filePath: string; scope: MemoryScope }>> {
  const files: Array<{ filePath: string; scope: MemoryScope }> = [];

  for (const resolvedScope of scopesFor(scope)) {
    const directory = roots.topicDirs[resolvedScope];
    const entries = await safeReadDir(directory);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      files.push({
        filePath: path.join(directory, entry.name),
        scope: resolvedScope,
      });
    }
  }

  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

export async function getTopicNames(
  roots: MemoryRoots,
  scope: MemorySearchScope = "all",
): Promise<string[]> {
  const files = await listTopicFiles(roots, scope);
  return files.map(({ filePath }) => path.basename(filePath, ".md"));
}

export async function getMemoryStatusSummary(roots: MemoryRoots): Promise<MemoryStatusSummary> {
  const files = await listTopicFiles(roots, "all");
  let lastModifiedAt = 0;

  for (const { filePath } of files) {
    const stats = await fs.stat(filePath);
    lastModifiedAt = Math.max(lastModifiedAt, stats.mtimeMs);
  }

  return {
    topicFileCount: files.length,
    lastModified: lastModifiedAt > 0 ? new Date(lastModifiedAt).toISOString().slice(0, 10) : null,
    memoryDir: roots.memoryDir,
    globalRoot: roots.globalRoot,
    projectRoot: roots.projectRoot,
  };
}

export function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isManagedToolPath(inputPath: string, cwd: string, roots: MemoryRoots): boolean {
  const managedRoots = [
    roots.memoryDir,
    roots.globalRoot,
    roots.projectRoot,
    roots.inboxDirs.global,
    roots.inboxDirs.project,
    roots.topicDirs.global,
    roots.topicDirs.project,
  ];
  const resolved = path.resolve(cwd, inputPath);

  if (managedRoots.some((rootPath) => pathIsInside(rootPath, resolved))) {
    return true;
  }

  const traversalPrefix = getTraversalPrefixPath(inputPath, cwd);
  return traversalPrefix
    ? managedRoots.some((rootPath) => pathIsInside(rootPath, traversalPrefix))
    : false;
}

function scopesFor(scope: MemorySearchScope): MemoryScope[] {
  return scope === "all" ? ["global", "project"] : [scope];
}

async function safeReadDir(directory: string): Promise<Array<Dirent<string>>> {
  try {
    return await fs.readdir(directory, { encoding: "utf8", withFileTypes: true });
  } catch {
    return [];
  }
}

function getTraversalPrefixPath(inputPath: string, cwd: string): string | null {
  const root = path.isAbsolute(inputPath) ? path.parse(inputPath).root : cwd;
  const segments = inputPath.split(/[\\/]+/u);
  let current = root;
  let advanced = false;

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      return advanced ? current : null;
    }
    current = path.join(current, segment);
    advanced = true;
  }

  return null;
}
