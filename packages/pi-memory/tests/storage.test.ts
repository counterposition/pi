import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureMemoryRoots, isManagedToolPath, resolveMemoryRoots } from "../src/storage.js";
import { createTestIdentity } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("storage", () => {
  it("creates the expected inbox and topics directories", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-storage-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    await expect(fs.stat(roots.inboxDirs.global)).resolves.toBeDefined();
    await expect(fs.stat(roots.topicDirs.global)).resolves.toBeDefined();
    await expect(fs.stat(roots.inboxDirs.project)).resolves.toBeDefined();
    await expect(fs.stat(roots.topicDirs.project)).resolves.toBeDefined();
  });

  it("detects managed tool paths and traversal attempts", () => {
    const roots = resolveMemoryRoots("/tmp/agent", createTestIdentity());

    expect(
      isManagedToolPath("/tmp/agent/memory/global/topics/preferences.md", "/tmp/work", roots),
    ).toBe(true);
    expect(
      isManagedToolPath(
        "/tmp/agent/memory/projects/repo-0123456789abcdef0123/../escape.md",
        "/tmp/work",
        roots,
      ),
    ).toBe(true);
    expect(isManagedToolPath("/tmp/work/memory-notes.md", "/tmp/work", roots)).toBe(false);
  });
});
