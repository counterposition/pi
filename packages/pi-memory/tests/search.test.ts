import { describe, expect, it } from "vitest";

import { formatRelativeAge, searchEntries } from "../src/search.js";
import type { ParsedEntry } from "../src/types.js";

describe("search", () => {
  it("requires all query words and respects word boundaries", () => {
    const matches = searchEntries(
      [
        makeEntry({
          id: "mem_boundary",
          heading: "Use pnpm",
          body: "Use pnpm for package management.",
        }),
        makeEntry({
          id: "mem_substring",
          heading: "Noise",
          body: "xpnpmx should not match as a word boundary.",
        }),
      ],
      { query: "pnpm package" },
      new Date("2026-04-06T00:00:00Z"),
    );

    expect(matches.results.map((result) => result.id)).toEqual(["mem_boundary"]);
  });

  it("ranks heading matches ahead of body-only matches", () => {
    const matches = searchEntries(
      [
        makeEntry({
          id: "mem_heading",
          heading: "Redis startup requirement",
          body: "Run Redis before the tests.",
        }),
        makeEntry({
          id: "mem_body",
          heading: "Testing note",
          body: "Redis startup requirement applies before the tests.",
        }),
      ],
      { query: "redis startup requirement" },
      new Date("2026-04-06T00:00:00Z"),
    );

    expect(matches.results.map((result) => result.id)).toEqual(["mem_heading", "mem_body"]);
  });

  it("prefers project results over equally relevant global results", () => {
    const matches = searchEntries(
      [
        makeEntry({
          id: "mem_global",
          scope: "global",
          heading: "Package manager",
          body: "Use pnpm for package management.",
        }),
        makeEntry({
          id: "mem_project",
          scope: "project",
          heading: "Package manager",
          body: "Use pnpm for package management.",
        }),
      ],
      { query: "package manager" },
      new Date("2026-04-06T00:00:00Z"),
    );

    expect(matches.results.map((result) => result.id)).toEqual(["mem_project", "mem_global"]);
  });

  it("uses recency as a tiebreaker and formats relative age", () => {
    const matches = searchEntries(
      [
        makeEntry({
          id: "mem_old",
          heading: "Flaky test workaround",
          body: "Clear caches before rerunning the suite.",
          updated: "2026-01-01",
        }),
        makeEntry({
          id: "mem_new",
          heading: "Flaky test workaround",
          body: "Clear caches before rerunning the suite.",
          updated: "2026-04-05",
        }),
      ],
      { query: "flaky test workaround" },
      new Date(2026, 3, 6, 9, 0),
    );

    expect(matches.results.map((result) => result.id)).toEqual(["mem_new", "mem_old"]);
    expect(matches.results[1].updatedLabel).toBe("2026-01-01 (3 months ago)");
    expect(formatRelativeAge(Date.UTC(2026, 3, 6), new Date(2026, 3, 6, 9, 0))).toBe("today");
  });

  it("treats updated dates as local calendar days", () => {
    expect(formatRelativeAge(Date.UTC(2026, 3, 7), new Date(2026, 3, 8, 9, 0))).toBe(
      "1 day ago",
    );
  });

  it("truncates results to maxResults and keeps the highest-ranked matches", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      makeEntry({
        id: `mem_many_${String(index).padStart(2, "0")}`,
        heading: `Many entry ${String(index + 1).padStart(2, "0")}`,
        body: "This many topic entry exists to exercise max results truncation.",
      }),
    );

    const defaultCap = searchEntries(entries, { query: "many topic entry truncation" });
    expect(defaultCap.results).toHaveLength(10);
    expect(defaultCap.results.map((result) => result.id)).toEqual(
      entries.slice(0, 10).map((entry) => entry.id),
    );

    const customCap = searchEntries(entries, {
      query: "many topic entry truncation",
      maxResults: 3,
    });
    expect(customCap.results).toHaveLength(3);
    expect(customCap.results.map((result) => result.id)).toEqual(
      entries.slice(0, 3).map((entry) => entry.id),
    );

    const noCap = searchEntries(entries, { query: "many topic entry truncation", maxResults: 50 });
    expect(noCap.results).toHaveLength(12);
    expect(noCap.results.map((result) => result.id)).toEqual(entries.map((entry) => entry.id));
  });
});

function makeEntry(
  overrides: Partial<ParsedEntry> & Pick<ParsedEntry, "id" | "heading" | "body">,
): ParsedEntry {
  const updated = overrides.updated ?? "2026-04-01";

  return {
    id: overrides.id,
    syntheticId: overrides.syntheticId ?? false,
    scope: overrides.scope ?? "project",
    sourceKind: overrides.sourceKind ?? "topic",
    filePath: overrides.filePath ?? `/tmp/${overrides.id}.md`,
    heading: overrides.heading,
    body: overrides.body,
    bodyText: overrides.body.trim(),
    status: overrides.status ?? "active",
    updated,
    updatedAt: Date.UTC(
      Number(updated.slice(0, 4)),
      Number(updated.slice(5, 7)) - 1,
      Number(updated.slice(8, 10)),
    ),
    metadata: overrides.metadata ?? {},
    metadataPairs: overrides.metadataPairs ?? [],
    lineSpan: overrides.lineSpan ?? { start: 1, end: 4 },
    raw: overrides.raw ?? "",
    rawStartOffset: overrides.rawStartOffset ?? 0,
    rawEndOffset: overrides.rawEndOffset ?? 0,
    afterHeadingOffset: overrides.afterHeadingOffset ?? 0,
    bodyStartOffset: overrides.bodyStartOffset ?? 0,
    fileMtimeMs: overrides.fileMtimeMs ?? Date.UTC(2026, 3, 1),
  };
}
