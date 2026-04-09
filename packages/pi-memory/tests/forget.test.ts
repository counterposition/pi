import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseMemoryFile } from "../src/parser.js";
import { invalidateMemoryEntry } from "../src/write-path.js";
import { cleanupTempDir, createFixtureEnvironment } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => cleanupTempDir(directory)));
});

describe("forget invalidation", () => {
  it("backfills a real ID for synthetic entries and marks them invalid", async () => {
    const environment = await createFixtureEnvironment();
    tempDirs.push(environment.tempDir);

    const filePath = path.join(environment.roots.topicDirs.project, "build.md");
    const originalSource = await fs.readFile(filePath, "utf8");
    const originalParsed = await parseMemoryFile(filePath, "project");
    const target = originalParsed.entries[2];

    const result = await invalidateMemoryEntry(environment.roots, target);
    const updatedSource = await fs.readFile(filePath, "utf8");
    const updatedParsed = await parseMemoryFile(filePath, "project");
    const updatedTarget = updatedParsed.entries.find((entry) => entry.id === result.entryId);

    expect(result.syntheticIdBackfilled).toBe(true);
    expect(result.entryId).toMatch(/^mem_/u);
    expect(updatedSource.startsWith(originalParsed.preamble)).toBe(true);
    expect(updatedSource).toContain(`- ID: ${result.entryId}`);
    expect(updatedSource).toContain("- Status: invalid");
    expect(updatedSource).not.toContain(target.id);
    expect(updatedTarget?.raw).toContain(`## ${target.heading}\n\n- ID: ${result.entryId}`);
    expect(
      updatedParsed.entries
        .filter((entry) => entry.id !== result.entryId)
        .map((entry) => entry.raw),
    ).toEqual(
      originalParsed.entries.filter((entry) => entry.id !== target.id).map((entry) => entry.raw),
    );
    expect(originalSource.startsWith(originalParsed.preamble)).toBe(true);
  });

  it("preserves existing IDs when invalidating normal entries", async () => {
    const environment = await createFixtureEnvironment();
    tempDirs.push(environment.tempDir);

    const filePath = path.join(environment.roots.topicDirs.global, "preferences.md");
    const parsed = await parseMemoryFile(filePath, "global");
    const target = parsed.entries[1];

    const result = await invalidateMemoryEntry(environment.roots, target);
    const updatedSource = await fs.readFile(filePath, "utf8");

    expect(result.syntheticIdBackfilled).toBe(false);
    expect(result.entryId).toBe(target.id);
    expect(updatedSource).toContain(`- ID: ${target.id}`);
    expect(updatedSource).toContain("- Status: invalid");
  });
});
