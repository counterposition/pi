import { beforeEach, describe, expect, it, vi } from "vitest";

import { pageCache } from "../src/page-cache.js";
import { ProviderError } from "../src/provider-utils.js";
import type { FetchProvider, SearchProvider } from "../src/types.js";

const state = vi.hoisted(() => ({
  config: {
    apiKeys: {},
    settings: {
      preferredBasicProvider: null,
      preferredThoroughProvider: null,
      preferredFetchProvider: null,
    },
    warnings: [],
  },
  providers: {
    search: {},
    fetch: {},
    hasAnySearchProvider: false,
  } as {
    search: Record<string, SearchProvider>;
    fetch: Record<string, FetchProvider>;
    hasAnySearchProvider: boolean;
  },
  normalizeDomains: vi.fn((domains?: string[]) => domains),
  resolveSearchProviders: vi.fn(),
  resolveFetchProvider: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  Type: {
    Object: (value: unknown) => value,
    String: (value?: unknown) => value ?? {},
    Optional: (value: unknown) => value,
    Array: (value: unknown, options?: unknown) => ({ value, options }),
    Number: (value?: unknown) => value ?? {},
  },
  StringEnum: (values: string[], options?: unknown) => ({ values, options }),
}));

vi.mock("../src/config.js", () => ({
  loadConfig: () => state.config,
  normalizeDomains: (...args: Parameters<typeof state.normalizeDomains>) =>
    state.normalizeDomains(...args),
  resolveSearchProviders: (...args: Parameters<typeof state.resolveSearchProviders>) =>
    state.resolveSearchProviders(...args),
  resolveFetchProvider: (...args: Parameters<typeof state.resolveFetchProvider>) =>
    state.resolveFetchProvider(...args),
}));

vi.mock("../src/providers/index.js", () => ({
  initProviders: () => state.providers,
}));

import webSearchExtension from "../extensions/web-search.js";

describe("web-search extension", () => {
  beforeEach(() => {
    pageCache.clear();
    state.normalizeDomains.mockReset();
    state.normalizeDomains.mockImplementation((domains?: string[]) => domains);
    state.resolveSearchProviders.mockReset();
    state.resolveFetchProvider.mockReset();
    state.config.warnings = [];
    state.providers = {
      search: {},
      fetch: {},
      hasAnySearchProvider: false,
    };
  });

  it("falls through to the next search provider on transient failure", async () => {
    const failingProvider = makeSearchProvider("brave", async () => {
      throw new ProviderError({
        provider: "brave",
        message: "brave request failed: 429 Too Many Requests",
        transient: true,
        status: 429,
      });
    });
    const succeedingProvider = makeSearchProvider("tavily", async () => ({
      results: [
        {
          title: "Docs",
          url: "https://example.com/docs",
          snippet: "Result snippet",
          sourceDomain: "example.com",
        },
      ],
      appliedFilters: {
        freshness: "native",
      },
    }));

    state.providers = {
      search: {
        brave: failingProvider,
        tavily: succeedingProvider,
      },
      fetch: {
        jina: makeFetchProvider("jina", async () => "unused"),
      },
      hasAnySearchProvider: true,
    };
    state.resolveSearchProviders.mockReturnValue({
      providers: [failingProvider, succeedingProvider],
      servedDepth: "basic",
      notes: [],
    });

    const tools = registerTools();
    const onUpdate = vi.fn();
    const result = await tools.web_search.execute(
      "tool-1",
      { query: "docs query" },
      new AbortController().signal,
      onUpdate,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        {
          type: "text",
          text: "Searching via brave...",
        },
      ],
      details: undefined,
    });
    expect(result.details.provider).toBe("tavily");
    expect(result.details.resultCount).toBe(1);
  });

  it("falls through to the next fetch provider on transient failure and then serves cached pagination", async () => {
    const jina = makeFetchProvider("jina", async () => {
      throw new ProviderError({
        provider: "jina",
        message: "jina request failed: 503 Service Unavailable",
        transient: true,
        status: 503,
      });
    });
    const firecrawl = makeFetchProvider("firecrawl", async () => "A".repeat(13_000));

    state.providers = {
      search: {},
      fetch: { jina, firecrawl },
      hasAnySearchProvider: false,
    };
    state.resolveFetchProvider.mockReturnValue(jina);

    const tools = registerTools();
    const first = await tools.web_fetch.execute(
      "tool-2",
      { url: "https://example.com/page", max_chars: 12_000 },
      new AbortController().signal,
    );

    expect(first.details.provider).toBe("firecrawl");
    expect(first.details.hasMore).toBe(true);

    const second = await tools.web_fetch.execute(
      "tool-3",
      {
        url: "https://example.com/page",
        offset: first.details.nextOffset,
        max_chars: 12_000,
      },
      new AbortController().signal,
    );

    expect(second.details.provider).toBe("firecrawl");
    expect(second.details.offset).toBe(first.details.nextOffset);
  });

  it("does not fall through on non-transient fetch errors", async () => {
    const jina = makeFetchProvider("jina", async () => {
      throw new ProviderError({
        provider: "jina",
        message: "jina request failed: 403 Forbidden",
        transient: false,
        status: 403,
      });
    });
    const firecrawl = makeFetchProvider("firecrawl", async () => "should not run");

    state.providers = {
      search: {},
      fetch: { jina, firecrawl },
      hasAnySearchProvider: false,
    };
    state.resolveFetchProvider.mockReturnValue(jina);

    const tools = registerTools();

    await expect(
      tools.web_fetch.execute(
        "tool-4",
        { url: "https://example.com/page" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/403 Forbidden/);
  });
});

function registerTools(): Record<string, any> {
  const tools = new Map<string, any>();

  webSearchExtension({
    on: vi.fn(),
    registerTool: vi.fn((tool: { name: string }) => {
      tools.set(tool.name, tool);
    }),
  } as any);

  return Object.fromEntries(tools.entries());
}

function makeSearchProvider(
  name: SearchProvider["name"],
  search: SearchProvider["search"],
): SearchProvider {
  return {
    name,
    capabilities: new Set(["search"]),
    search,
  };
}

function makeFetchProvider(
  name: FetchProvider["name"],
  fetchImpl: FetchProvider["fetch"],
): FetchProvider {
  return {
    name,
    fetch: fetchImpl,
  };
}
