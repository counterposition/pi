import { describe, expect, it } from "vitest";

import { formatFetchContent, formatSearchResults, paginateContent } from "../src/format.js";

describe("formatSearchResults", () => {
  it("renders compact filter notes without the Note prefix", () => {
    const text = formatSearchResults({
      provider: "brave",
      requestedDepth: "thorough",
      servedDepth: "basic",
      freshness: "week",
      domains: ["docs.python.org"],
      appliedFilters: {
        freshness: "native",
        domains: "query_rewrite",
      },
      notes: ["Provider: fallback"],
      results: [
        {
          title: "Result 1",
          url: "https://example.com/1",
          snippet: "alpha snippet",
        },
      ],
    });

    expect(text).toContain("Provider: fallback");
    expect(text).toContain("Freshness: week (native)");
    expect(text).toContain("Domains: docs.python.org (query rewrite)");
    expect(text).toContain("Depth: requested thorough, served basic (no content-capable provider)");
    expect(text).not.toContain("Note:");
  });

  it("omits snippets for thorough results that include content blocks", () => {
    const text = formatSearchResults({
      provider: "tavily",
      requestedDepth: "thorough",
      servedDepth: "thorough",
      notes: [],
      results: [
        {
          title: "Result 1",
          url: "https://example.com/1",
          snippet: "alpha snippet",
          content: "alpha content ".repeat(40),
        },
        {
          title: "Result 2",
          url: "https://example.com/2",
          snippet: "beta snippet",
        },
      ],
    });
    const firstBlock = text.slice(
      text.indexOf("### 1. Result 1"),
      text.indexOf("\n\n---\n\n### 2. Result 2"),
    );
    const secondBlock = text.slice(text.indexOf("### 2. Result 2"));

    expect(firstBlock).toContain("### 1. Result 1");
    expect(firstBlock).toContain("Content:");
    expect(firstBlock).not.toContain("Source:");
    expect(firstBlock).not.toContain("Snippet:");
    expect(secondBlock).toContain("### 2. Result 2");
    expect(secondBlock).toContain("Snippet:");
    expect(secondBlock).not.toContain("Source:");
    expect(secondBlock).not.toContain("Content:");
  });

  it("enforces budget and omits the basic fetch hint", () => {
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
    expect(text).toMatch(/Depth: requested thorough, served basic/i);
    expect(text).not.toContain("Use web_fetch on any URL above to read the full page content.");
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
