import { describe, expect, it, vi } from "vitest";

import { PageCache } from "../src/page-cache.js";

describe("PageCache", () => {
  it("expires entries by ttl", () => {
    vi.useFakeTimers();

    const cache = new PageCache({ ttlMs: 1_000 });
    cache.set("https://example.com", "hello", "jina");

    vi.advanceTimersByTime(1_001);

    expect(cache.get("https://example.com")).toBeUndefined();
    vi.useRealTimers();
  });

  it("evicts the least recently used entry", () => {
    const cache = new PageCache({ capacity: 2 });
    cache.set("https://a.test", "a", "jina");
    cache.set("https://b.test", "b", "jina");
    cache.get("https://a.test");
    cache.set("https://c.test", "c", "jina");

    expect(cache.get("https://a.test")?.content).toBe("a");
    expect(cache.get("https://b.test")).toBeUndefined();
    expect(cache.get("https://c.test")?.content).toBe("c");
  });

  it("skips caching oversized pages", () => {
    const cache = new PageCache({ maxCharsPerPage: 5 });
    cache.set("https://example.com", "123456", "jina");
    expect(cache.get("https://example.com")).toBeUndefined();
  });
});
