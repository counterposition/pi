import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mutationQueue = vi.hoisted(() => {
  const tails = new Map<string, Promise<void>>();
  const calls: string[] = [];

  return {
    calls,
    reset() {
      calls.splice(0);
      tails.clear();
    },
    async withFileMutationQueue<T>(filePath: string, work: () => Promise<T>): Promise<T> {
      calls.push(filePath);

      const previous = tails.get(filePath) ?? Promise.resolve();
      let releaseTail: () => void = () => {};
      const tail = new Promise<void>((resolve) => {
        releaseTail = resolve;
      });
      const queuedTail = previous.then(() => tail);
      tails.set(filePath, queuedTail);

      await previous;
      try {
        return await work();
      } finally {
        releaseTail();
        if (tails.get(filePath) === queuedTail) {
          tails.delete(filePath);
        }
      }
    },
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  withFileMutationQueue: mutationQueue.withFileMutationQueue,
}));

import { parseMemoryFile, parseMemoryFileSource } from "../src/parser.js";
import { ensureMemoryRoots, resolveMemoryRoots } from "../src/storage.js";
import { moveMemoryEntry, planMemoryWrite, writeMemoryEntry } from "../src/write-path.js";
import { createFixtureEnvironment, createTestIdentity, fixturePath } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  mutationQueue.reset();
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("write path", () => {
  it("plans topic names, filenames, and entry headings deterministically", () => {
    const plan = planMemoryWrite({
      topic: "  Build System  ",
      content: "## Use pnpm\n\nAlways use pnpm in this repo.",
    });

    expect(plan.normalizedTopic).toBe("Build System");
    expect(plan.fileName).toBe("build-system.md");
    expect(plan.title).toBe("Build System");
    expect(plan.heading).toBe("Use pnpm");
    expect(plan.body).toBe("Always use pnpm in this repo.");
  });

  it("derives a heading from the first sentence when content has no level-2 heading", () => {
    const plan = planMemoryWrite({
      topic: "Notes",
      content: "Remember this forever. Second sentence.",
    });

    expect(plan.heading).toBe("Remember this forever");
    expect(plan.body).toBe("Second sentence.");
  });

  it("creates a new topic file with the required preamble", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-write-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    const result = await writeMemoryEntry(roots, {
      topic: "Build",
      content: "## Use pnpm\n\nAlways use pnpm.",
    });
    const source = await fs.readFile(result.filePath, "utf8");

    expect(source.startsWith("# Build\n\n")).toBe(true);
    expect(source).toContain("## Use pnpm");
  });

  it("stores the updated date using the local calendar day", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-write-local-date-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    const result = await writeMemoryEntry(
      roots,
      {
        topic: "Movies",
        content: "## Watched Project Hail Mary\n\nWatched it yesterday evening.",
      },
      {
        now: new Date(2026, 3, 7, 21, 0),
      },
    );

    expect(result.updated).toBe("2026-04-07");
  });

  it("appends new entries while preserving the existing preamble byte-for-byte", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-write-existing-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);
    const targetPath = path.join(roots.topicDirs.project, "build.md");
    const fixtureSource = await fs.readFile(fixturePath("project", "topics", "build.md"), "utf8");
    await fs.writeFile(targetPath, fixtureSource, "utf8");

    const originalPreamble = parseMemoryFileSource({
      filePath: targetPath,
      scope: "project",
      source: fixtureSource,
      fileMtimeMs: Date.now(),
    }).preamble;

    await writeMemoryEntry(roots, {
      topic: "Build",
      content: "## New build note\n\nRemember the newer build convention.",
    });
    const updatedSource = await fs.readFile(targetPath, "utf8");

    expect(updatedSource.startsWith(originalPreamble)).toBe(true);
    expect(updatedSource).toContain("## New build note");
  });

  it("participates in Pi's file mutation queue for external same-path writes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-queue-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    const targetPath = path.join(roots.topicDirs.project, "build.md");
    await fs.writeFile(targetPath, "# Build\n\n", "utf8");
    const realTargetPath = await fs.realpath(targetPath);

    let releaseExternal: () => void = () => {};
    let externalWrite: Promise<void> | undefined;
    const externalEntered = new Promise<void>((resolve) => {
      externalWrite = mutationQueue.withFileMutationQueue(realTargetPath, async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseExternal = release;
        });
        const source = await fs.readFile(realTargetPath, "utf8");
        await fs.writeFile(
          realTargetPath,
          `${source}## External queued note\n- ID: mem_external\n- Status: active\n- Updated: 2026-04-06\n\nExternal mutation.\n`,
          "utf8",
        );
      });
    });

    await externalEntered;

    let writeFinished = false;
    const memoryWrite = writeMemoryEntry(roots, {
      topic: "Build",
      content: "## Queued memory note\n\nMemory write waited for the external mutation.",
    }).then((result) => {
      writeFinished = true;
      return result;
    });

    await Promise.resolve();
    expect(writeFinished).toBe(false);

    releaseExternal();
    if (!externalWrite) throw new Error("external write did not start");
    const [result] = await Promise.all([memoryWrite, externalWrite]);
    const source = await fs.readFile(realTargetPath, "utf8");

    expect(source).toContain("## External queued note");
    expect(source).toContain(result.entryId);
    expect(source).toContain("## Queued memory note");
    expect(mutationQueue.calls.filter((filePath) => filePath === realTargetPath)).toHaveLength(2);
  });

  it("rejects oversized bodies and obvious secrets", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-write-guards-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    await expect(
      writeMemoryEntry(roots, {
        topic: "Build",
        content: `## Huge\n\n${"a".repeat(2_001)}`,
      }),
    ).rejects.toThrow(/2,000 characters/u);

    await expect(
      writeMemoryEntry(roots, {
        topic: "Secrets",
        content: "## Secret\n\nAPI_KEY=abcdef",
      }),
    ).rejects.toThrow(/obvious secrets/u);
  });

  it("cleans up temporary files when rename fails", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-write-failure-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    await expect(
      writeMemoryEntry(
        roots,
        {
          topic: "Build",
          content: "## Use pnpm\n\nAlways use pnpm.",
        },
        {
          fsOps: {
            lstat: fs.lstat,
            mkdir: async (directory, options) => {
              await fs.mkdir(directory, options);
            },
            readFile: fs.readFile,
            realpath: fs.realpath,
            rename: async () => {
              throw new Error("rename failed");
            },
            stat: fs.stat,
            unlink: fs.unlink,
            writeFile: fs.writeFile,
          },
        },
      ),
    ).rejects.toThrow(/rename failed/u);

    const files = await fs.readdir(roots.topicDirs.project);
    expect(files.filter((fileName) => fileName.includes(".tmp"))).toEqual([]);
  });

  it("fails cleanly when the topic file is read-only", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-readonly-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    const targetPath = path.join(roots.topicDirs.project, "build.md");
    const originalSource = "# Build\n\nExisting memory.\n";
    await fs.writeFile(targetPath, originalSource, "utf8");

    await expect(
      writeMemoryEntry(
        roots,
        {
          topic: "Build",
          content: "## Read-only test\n\nThis should fail.",
        },
        {
          fsOps: {
            lstat: fs.lstat,
            mkdir: async (directory, options) => {
              await fs.mkdir(directory, options);
            },
            readFile: fs.readFile,
            realpath: fs.realpath,
            rename: fs.rename,
            stat: fs.stat,
            unlink: fs.unlink,
            writeFile: async (filePath, content, encoding) => {
              await fs.writeFile(filePath, content, encoding);
              if (filePath.includes(".tmp")) {
                throw new Error("permission denied");
              }
            },
          },
        },
      ),
    ).rejects.toThrow(/permission denied/u);

    const source = await fs.readFile(targetPath, "utf8");
    expect(source).toBe(originalSource);

    const files = await fs.readdir(roots.topicDirs.project);
    expect(files.filter((fileName) => fileName.includes(".tmp"))).toEqual([]);
  });

  it("moves an existing entry into a different scope without leaving a duplicate behind", async () => {
    const environment = await createFixtureEnvironment();
    tempDirs.push(environment.tempDir);

    const sourcePath = path.join(environment.roots.topicDirs.global, "preferences.md");
    const targetPath = path.join(environment.roots.topicDirs.project, "preferences.md");
    const parsedSource = await parseMemoryFile(sourcePath, "global");
    const targetEntry = parsedSource.entries[1];

    const result = await moveMemoryEntry(environment.roots, targetEntry, {
      targetScope: "project",
    });
    const updatedSource = await fs.readFile(sourcePath, "utf8");
    const updatedTarget = await fs.readFile(targetPath, "utf8");
    const realTargetPath = await fs.realpath(targetPath);

    expect(result.entryId).toBe(targetEntry.id);
    expect(result.sourceFilePath).toBe(sourcePath);
    expect(result.targetFilePath).toBe(realTargetPath);
    expect(result.targetScope).toBe("project");
    expect(result.createdTopic).toBe(true);
    expect(updatedSource).not.toContain(targetEntry.id);
    expect(updatedTarget).toContain(targetEntry.id);
    expect(updatedTarget).toContain(`## ${targetEntry.heading}`);
  });

  it("backfills a real ID when moving a synthetic entry and removes an emptied source file", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-move-synthetic-"));
    tempDirs.push(tempDir);

    const roots = resolveMemoryRoots(path.join(tempDir, "agent"), createTestIdentity());
    await ensureMemoryRoots(roots);

    const sourcePath = path.join(roots.topicDirs.project, "solo.md");
    await fs.writeFile(
      sourcePath,
      "# Solo\n\n## One note\n- Status: active\n- Updated: 2026-04-04\n\nKeep this around.\n",
      "utf8",
    );
    const parsed = await parseMemoryFile(sourcePath, "project");

    const result = await moveMemoryEntry(roots, parsed.entries[0], {
      targetScope: "global",
    });
    const targetPath = path.join(roots.topicDirs.global, "solo.md");
    const targetSource = await fs.readFile(targetPath, "utf8");
    const realTargetPath = await fs.realpath(targetPath);

    expect(result.syntheticIdBackfilled).toBe(true);
    expect(result.entryId).toMatch(/^mem_/u);
    expect(result.targetFilePath).toBe(realTargetPath);
    await expect(fs.stat(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(targetSource).toContain(`- ID: ${result.entryId}`);
    expect(targetSource).toContain("- Updated: 2026-04-04");
    expect(targetSource).toContain("## One note");
  });
});
