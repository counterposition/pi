import { afterEach, describe, expect, it, vi } from "vitest";

import { createBraveProvider } from "../src/providers/brave.js";
import { ProviderError } from "../src/provider-utils.js";

describe("createBraveProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests only web results from Brave", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "search",
          web: { type: "search", results: [] },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const provider = createBraveProvider("brave-test");

    await provider.search({
      query: "gemini 3.1 flash lite",
      maxResults: 5,
      includeContent: false,
      signal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledOnce();

    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBeTypeOf("string");

    const url = new URL(input as string);
    expect(url.searchParams.get("result_filter")).toBe("web");
  });

  it("treats responses without a web block as empty results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "search",
          query: { original: "docs" },
          mixed: { type: "mixed", main: [] },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const provider = createBraveProvider("brave-test");
    const response = await provider.search({
      query: "docs",
      maxResults: 5,
      includeContent: false,
      signal: new AbortController().signal,
    });

    expect(response.results).toEqual([]);
  });

  it("rejects malformed web results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "search",
          web: { type: "search", results: {} },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const provider = createBraveProvider("brave-test");

    await expect(
      provider.search({
        query: "docs",
        maxResults: 5,
        includeContent: false,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      message: "Brave returned unexpected response shape.",
      transient: false,
    } satisfies Partial<ProviderError>);
  });
});
