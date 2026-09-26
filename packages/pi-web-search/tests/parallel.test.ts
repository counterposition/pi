import { afterEach, describe, expect, it, vi } from "vitest";

import { createParallelProvider } from "../src/providers/parallel.js";
import { ProviderError } from "../src/provider-utils.js";

const SEARCH_RESPONSE = {
  search_id: "search_test",
  session_id: "session_test",
  results: [
    {
      url: "https://vitest.dev/guide/mocking",
      title: "Mocking | Vitest",
      publish_date: "2026-09-01",
      excerpts: [
        "Vitest provides utility functions to help you out.",
        "Use vi.mock to mock modules.",
      ],
    },
    {
      url: "https://example.com/vitest-mocking",
      title: null,
      publish_date: null,
      excerpts: ["An unrelated blog post."],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mcpResponse(structuredContent: unknown, isError = false): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: isError ? "rate limit exceeded" : "{}" }],
      structuredContent,
      isError,
    },
  });
}

function requestOf(fetchMock: ReturnType<typeof vi.spyOn>): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const [input, init] = (fetchMock.mock.calls[0] ?? []) as [string, RequestInit];
  return {
    url: input,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

describe("createParallelProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searches the free MCP endpoint without an API key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mcpResponse(SEARCH_RESPONSE));

    const provider = createParallelProvider();
    const response = await provider.search({
      query: "vitest mocking",
      maxResults: 5,
      includeContent: true,
      signal: new AbortController().signal,
    });

    const request = requestOf(fetchMock);
    expect(request.url).toBe("https://search.parallel.ai/mcp");
    expect(request.headers).not.toHaveProperty("x-api-key");
    expect(request.body).toMatchObject({
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: { objective: "vitest mocking", search_queries: ["vitest mocking"] },
      },
    });
    expect(response.results[0]).toMatchObject({
      title: "Mocking | Vitest",
      publishedAt: "2026-09-01T00:00:00.000Z",
      content: "Vitest provides utility functions to help you out.\n\nUse vi.mock to mock modules.",
    });
    expect(response.results[1]?.title).toBe("https://example.com/vitest-mocking");
  });

  it("rewrites domain filters into site queries and drops off-domain results", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mcpResponse(SEARCH_RESPONSE));

    const provider = createParallelProvider();
    const response = await provider.search({
      query: "vitest mocking",
      maxResults: 5,
      includeContent: false,
      domains: ["vitest.dev"],
      signal: new AbortController().signal,
    });

    const { params } = requestOf(fetchMock).body as {
      params: { arguments: { search_queries: string[] } };
    };
    expect(params.arguments.search_queries).toEqual(["vitest mocking site:vitest.dev"]);
    expect(response.results.map((result) => result.url)).toEqual([
      "https://vitest.dev/guide/mocking",
    ]);
    expect(response.results[0]?.content).toBeUndefined();
    expect(response.appliedFilters).toEqual({ domains: "query_rewrite" });
  });

  it("treats free-tier tool errors as transient", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mcpResponse(undefined, true));

    const provider = createParallelProvider();
    const error = await provider
      .search({
        query: "vitest mocking",
        maxResults: 5,
        includeContent: false,
        signal: new AbortController().signal,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).transient).toBe(true);
    expect((error as ProviderError).message).toMatch(/rate limit exceeded/);
  });

  it("uses the Search API with native filters when an API key is set", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(SEARCH_RESPONSE));

    const provider = createParallelProvider("parallel-test");
    const response = await provider.search({
      query: "vitest mocking",
      maxResults: 3,
      includeContent: true,
      freshness: "week",
      domains: ["vitest.dev"],
      signal: new AbortController().signal,
    });

    const request = requestOf(fetchMock);
    expect(request.url).toBe("https://api.parallel.ai/v1/search");
    expect(request.headers["x-api-key"]).toBe("parallel-test");
    expect(request.body).toMatchObject({
      mode: "advanced",
      advanced_settings: {
        max_results: 3,
        source_policy: {
          include_domains: ["vitest.dev"],
          after_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
      },
    });
    expect(provider.capabilities.has("domainFilter")).toBe(true);
    expect(response.appliedFilters).toEqual({ freshness: "native", domains: "native" });
  });
});
