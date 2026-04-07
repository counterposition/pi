import {
  addSiteConstraint,
  dedupeResultsByUrl,
  fetchJson,
  hostnameFromUrl,
  MAX_RESPONSE_BYTES,
  normalizeIsoDate,
  ProviderError,
  TIMEOUTS,
  truncateSnippet,
} from "../provider-utils.js";
import type {
  ProviderSearchResponse,
  SearchProvider,
  SearchProviderArgs,
  SearchResult,
} from "../types.js";
import { normalizeDomains } from "../config.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_BRAVE_RESULTS = 20;

type BraveResult = {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  snippet?: unknown;
  publishedDate?: unknown;
  publishedAt?: unknown;
  date?: unknown;
  age?: unknown;
};

function freshnessToBrave(value: SearchProviderArgs["freshness"]): string | undefined {
  switch (value) {
    case "day":
      return "pd";
    case "week":
      return "pw";
    case "month":
      return "pm";
    case "year":
      return "py";
    default:
      return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResults(payload: unknown): SearchResult[] {
  if (!isObject(payload)) {
    throw new ProviderError({
      provider: "brave",
      message: "Brave returned unexpected response shape.",
      transient: false,
    });
  }

  if (payload.web == null) {
    return [];
  }

  if (!isObject(payload.web) || !Array.isArray(payload.web.results)) {
    throw new ProviderError({
      provider: "brave",
      message: "Brave returned unexpected response shape.",
      transient: false,
    });
  }

  const results: SearchResult[] = [];
  for (const raw of payload.web.results as BraveResult[]) {
    const parsed = parseResult(raw);
    if (parsed) results.push(parsed);
  }
  return results;
}

function parseResult(raw: BraveResult): SearchResult | undefined {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!title || !url) return undefined;

  const sourceDomain = hostnameFromUrl(url);

  const publishedAt = normalizeIsoDate(
    firstString(raw.publishedDate, raw.publishedAt, raw.date, raw.age),
  );

  return {
    title,
    url,
    snippet: truncateSnippet(firstString(raw.description, raw.snippet) ?? "", 500),
    sourceDomain,
    publishedAt,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function buildUrl(args: {
  query: string;
  maxResults: number;
  freshness?: SearchProviderArgs["freshness"];
  domain?: string;
}): string {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", args.domain ? addSiteConstraint(args.query, args.domain) : args.query);
  url.searchParams.set("count", String(Math.min(Math.max(args.maxResults, 1), MAX_BRAVE_RESULTS)));
  url.searchParams.set("result_filter", "web");

  const freshness = freshnessToBrave(args.freshness);
  if (freshness) {
    url.searchParams.set("freshness", freshness);
  }

  return url.toString();
}

async function searchOnce(args: {
  query: string;
  maxResults: number;
  freshness?: SearchProviderArgs["freshness"];
  domain?: string;
  signal: AbortSignal;
  apiKey: string;
}): Promise<ProviderSearchResponse> {
  const url = buildUrl(args);
  const results = await fetchJson<SearchResult[]>("brave", url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": args.apiKey,
    },
    signal: args.signal,
    timeoutMs: TIMEOUTS.searchBasicMs,
    maxBytes: MAX_RESPONSE_BYTES.search,
    validate: parseResults,
  });

  return {
    results,
  };
}

async function searchForDomains(args: {
  query: string;
  maxResults: number;
  freshness?: SearchProviderArgs["freshness"];
  domains: string[];
  signal: AbortSignal;
  apiKey: string;
}): Promise<ProviderSearchResponse> {
  if (args.domains.length === 1) {
    const response = await searchOnce({
      query: args.query,
      maxResults: args.maxResults,
      freshness: args.freshness,
      domain: args.domains[0],
      signal: args.signal,
      apiKey: args.apiKey,
    });

    return {
      ...response,
      appliedFilters: {
        freshness: args.freshness ? "native" : undefined,
        domains: "query_rewrite",
      },
    };
  }

  const settled = await Promise.allSettled(
    args.domains.map((domain) =>
      searchOnce({
        query: args.query,
        maxResults: args.maxResults,
        freshness: args.freshness,
        domain,
        signal: args.signal,
        apiKey: args.apiKey,
      }).then((response) => ({ domain, response })),
    ),
  );

  const results: SearchResult[] = [];
  const notes: string[] = [];
  const failures: Error[] = [];

  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      results.push(...entry.value.response.results);
      continue;
    }

    const error = entry.reason instanceof Error ? entry.reason : new Error(String(entry.reason));
    if (isAbortError(error)) {
      throw error;
    }
    failures.push(error);
  }

  if (results.length === 0) {
    throw (
      failures[0] ??
      new ProviderError({
        provider: "brave",
        message: "Brave request failed.",
        transient: true,
      })
    );
  }

  if (failures.length > 0) {
    notes.push(
      `Domains: ${args.domains.join(", ")} (fanout merge, partial — some queries failed)`,
    );
  }

  return {
    results: dedupeResultsByUrl(results, args.maxResults),
    appliedFilters: {
      freshness: args.freshness ? "native" : undefined,
      domains: "fanout_merge",
    },
    notes: notes.length > 0 ? notes : undefined,
  };
}

export function createBraveProvider(apiKey: string): SearchProvider {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new ProviderError({
      provider: "brave",
      message: "Brave API key is not configured.",
      transient: false,
    });
  }

  return {
    name: "brave",
    capabilities: new Set(["search", "freshness"]),
    async search(args: SearchProviderArgs): Promise<ProviderSearchResponse> {
      const domains = normalizeDomains(args.domains);
      try {
        if (domains && domains.length > 0) {
          return await searchForDomains({
            query: args.query,
            maxResults: args.maxResults,
            freshness: args.freshness,
            domains,
            signal: args.signal,
            apiKey: trimmedApiKey,
          });
        }

        const response = await searchOnce({
          query: args.query,
          maxResults: args.maxResults,
          freshness: args.freshness,
          signal: args.signal,
          apiKey: trimmedApiKey,
        });

        return {
          results: dedupeResultsByUrl(response.results, args.maxResults),
          appliedFilters: args.freshness ? { freshness: "native" } : undefined,
        };
      } catch (error) {
        if (isAbortError(error) || args.signal.aborted) {
          throw error;
        }
        if (error instanceof ProviderError) throw error;
        throw new ProviderError({
          provider: "brave",
          message:
            error instanceof Error && error.message ? error.message : "Brave request failed.",
          transient: false,
          cause: error,
        });
      }
    },
  };
}

export default createBraveProvider;

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
