import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProjectIdentity } from "../src/identity.js";
import { ensureMemoryRoots, resolveMemoryRoots } from "../src/storage.js";
import type { MemoryRoots, ProjectIdentity } from "../src/types.js";

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export async function createFixtureEnvironment(): Promise<{
  tempDir: string;
  roots: MemoryRoots;
  identity: ProjectIdentity;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-"));
  const agentDir = path.join(tempDir, "agent");
  const identity = createTestIdentity();
  const roots = resolveMemoryRoots(agentDir, identity);

  await ensureMemoryRoots(roots);
  await fs.cp(path.join(FIXTURE_ROOT, "global"), roots.rootDirs.global, { recursive: true });
  await fs.cp(path.join(FIXTURE_ROOT, "project"), roots.rootDirs.project, { recursive: true });

  return {
    tempDir,
    roots,
    identity,
  };
}

export async function createRuntimeFixtureEnvironment(): Promise<{
  tempDir: string;
  cwd: string;
  roots: MemoryRoots;
  identity: ProjectIdentity;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-runtime-"));
  const cwd = path.join(tempDir, "workspace");
  const agentDir = path.join(tempDir, "agent");

  await fs.mkdir(cwd, { recursive: true });

  const identity = resolveProjectIdentity(cwd);
  const roots = resolveMemoryRoots(agentDir, identity);

  await ensureMemoryRoots(roots);
  await fs.cp(path.join(FIXTURE_ROOT, "global"), roots.rootDirs.global, { recursive: true });
  await fs.cp(path.join(FIXTURE_ROOT, "project"), roots.rootDirs.project, { recursive: true });

  return {
    tempDir,
    cwd,
    roots,
    identity,
  };
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  await fs.rm(tempDir, { recursive: true, force: true });
}

export function fixturePath(...segments: string[]): string {
  return path.join(FIXTURE_ROOT, ...segments);
}

export function createTestIdentity(): ProjectIdentity {
  return {
    anchorPath: "/repo/.git",
    normalizedAnchor: "/repo/.git",
    projectId: "repo-0123456789abcdef0123",
    slug: "repo",
    displayName: "repo",
    mode: "git",
  };
}
