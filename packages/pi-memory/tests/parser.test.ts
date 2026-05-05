import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatIsoDate,
  mergeParsedEntries,
  parseMemoryFile,
  parseMemoryFileSource,
} from "../src/parser.js";
import { fixturePath } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("parser", () => {
  it("preserves file preamble and assigns synthetic IDs for missing entry IDs", async () => {
    const parsed = await parseMemoryFile(fixturePath("project", "topics", "build.md"), "project");

    expect(parsed.preamble).toContain("---");
    expect(parsed.preamble).toContain("# Build");
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[2].syntheticId).toBe(true);
    expect(parsed.entries[2].id).toMatch(/^synthetic_/u);
    expect(parsed.warnings.map((warning) => warning.code)).toContain("missing-id");
  });

  it("treats fenced code blocks as part of the current entry", async () => {
    const parsed = await parseMemoryFile(
      fixturePath("project", "topics", "codeblocks.md"),
      "project",
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].body).toContain("## not a heading");
  });

  it("keeps only the last duplicate ID within a file", async () => {
    const parsed = await parseMemoryFile(
      fixturePath("project", "topics", "duplicates.md"),
      "project",
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].heading).toBe("Second duplicate");
    expect(parsed.warnings.map((warning) => warning.code)).toContain("duplicate-id-in-file");
  });

  it("returns empty-body entries and warns on missing status and updated metadata", async () => {
    const parsed = await parseMemoryFile(fixturePath("project", "topics", "empty.md"), "project");

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].bodyText).toBe("");
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["missing-id", "missing-status", "missing-updated"]),
    );
  });

  it("prefers the more recently modified file when duplicate IDs appear across files", () => {
    const older = parseMemoryFileSource({
      filePath: "/tmp/older.md",
      scope: "project",
      fileMtimeMs: Date.UTC(2026, 0, 1),
      source:
        "# Topic\n\n## Older\n- ID: mem_shared\n- Status: active\n- Updated: 2026-01-01\n\nOlder entry.\n",
    });
    const newer = parseMemoryFileSource({
      filePath: "/tmp/newer.md",
      scope: "global",
      fileMtimeMs: Date.UTC(2026, 3, 1),
      source:
        "# Topic\n\n## Newer\n- ID: mem_shared\n- Status: active\n- Updated: 2026-04-01\n\nNewer entry.\n",
    });
    const merged = mergeParsedEntries([...older.entries, ...newer.entries]);

    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].filePath).toBe("/tmp/newer.md");
    expect(merged.warnings.map((warning) => warning.code)).toContain("duplicate-id-across-files");
  });

  it("skips binary files with a warning instead of throwing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-binary-"));
    tempDirs.push(tempDir);

    const filePath = path.join(tempDir, "binary.md");
    await fs.writeFile(filePath, Buffer.from([0x00, 0x01, 0x02]));

    const parsed = await parseMemoryFile(filePath, "project");

    expect(parsed.entries).toEqual([]);
    expect(parsed.warnings.map((warning) => warning.code)).toContain("binary-file");
  });

  it("formats dates using local calendar components", () => {
    expect(formatIsoDate(new Date(2026, 3, 7, 21, 0))).toBe("2026-04-07");
  });
});
