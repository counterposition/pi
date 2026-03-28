import { describe, expect, it } from "vitest";

import { formatFetchContent, formatSearchResults, paginateContent } from "../src/format.js";

describe("formatSearchResults", () => {
  it("includes budget omission notes and the basic fetch hint", () => {
    const text = formatSearchResults({
      provider: "tavily",
      requestedDepth: "thorough",
      servedDepth: "basic",
      notes: [],
      results: [
        {
          title: "Result 1",
          url: "https://example.com/1",
          snippet: "alpha ".repeat(80),
          content: "content ".repeat(1_000),
        },
        {
          title: "Result 2",
          url: "https://example.com/2",
          snippet: "beta ".repeat(80),
          content: "content ".repeat(1_000),
        },
        {
          title: "Result 3",
          url: "https://example.com/3",
          snippet: "gamma ".repeat(80),
          content: "content ".repeat(1_000),
        },
      ],
    });

    expect(text.length).toBeLessThanOrEqual(12_000);
    expect(text).toMatch(/degraded to basic/i);
    expect(text).toMatch(/use web_fetch/i);
  });
});

describe("paginateContent", () => {
  it("paginates on newline boundaries when practical", () => {
    const content = ["First paragraph", "", "Second paragraph", "", "Third paragraph"].join("\n");
    const chunk = paginateContent(content, 0, 25);

    expect(chunk.text).toContain("First paragraph");
    expect(chunk.hasMore).toBe(true);
    expect(chunk.nextOffset).toBeDefined();
  });

  it("returns an empty out-of-range chunk", () => {
    const chunk = paginateContent("short", 99, 12_000);
    const formatted = formatFetchContent("https://example.com", "jina", chunk);

    expect(chunk.returnedChars).toBe(0);
    expect(chunk.hasMore).toBe(false);
    expect(formatted).toMatch(/beyond the end of the document/i);
  });
});

describe("formatFetchContent", () => {
  it("includes continuation hints for later chunks", () => {
    const content = "Hello world\n\n".repeat(2_000);
    const chunk = paginateContent(content, 0, 1_200);
    const formatted = formatFetchContent("https://example.com/page", "jina", chunk);

    expect(formatted).toMatch(/Next chunk: web_fetch/);
  });
});
