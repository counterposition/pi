import {
  fetchJson,
  hostnameFromUrl,
  MAX_RESPONSE_BYTES,
  normalizeIsoDate,
  ProviderError,
  TIMEOUTS,
  truncateSnippet,
} from "../provider-utils.js";
import type {
  AppliedFilters,
  ProviderSearchResponse,
  SearchCapability,
  SearchProvider,
  SearchProviderArgs,
  SearchResult,
} from "../types.js";

type TavilySearchDepth = "basic" | "advanced";
type TavilyTopic = "general" | "news" | "finance";
type TavilyTimeRange = "day" | "week" | "month" | "year";

type TavilyRequestBody = {
  query: string;
  topic: TavilyTopic;
  search_depth: TavilySearchDepth;
  max_results: number;
  include_answer: false;
  include_raw_content: false | "markdown";
  time_range?: TavilyTimeRange;
  include_domains?: string[];
};

type TavilyResponse = {
  results?: unknown;
  answer?: unknown;
};

const TAVILY_CAPABILITIES = new Set<SearchCapability>([
  "search",
  "content",
  "semantic",
  "freshness",
  "domainFilter",
  "resultDates",
]);

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export function createTavilyProvider(apiKey: string): SearchProvider {
  const trimmedKey = apiKey.trim();

  return {
    name: "tavily",
    capabilities: TAVILY_CAPABILITIES,
    async search(args: SearchProviderArgs): Promise<ProviderSearchResponse> {
      const requestBody = buildRequestBody(args);
      const response = await fetchJson<TavilyResponse>("tavily", TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${trimmedKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: args.signal,
        timeoutMs: args.includeContent ? TIMEOUTS.searchThoroughMs : TIMEOUTS.searchBasicMs,
        maxBytes: MAX_RESPONSE_BYTES.search,
        validate: validateTavilyResponse,
      });

      const results = normalizeResults(response.results, args.includeContent);
      const appliedFilters = buildAppliedFilters(args);
      const notes = buildNotes(args, results);

      return {
        results,
        appliedFilters,
        notes,
      };
    },
  };
}

function buildRequestBody(args: SearchProviderArgs): TavilyRequestBody {
  const body: TavilyRequestBody = {
    query: args.query,
    topic: chooseTopic(args.query, args.freshness),
    search_depth: args.includeContent ? "advanced" : "basic",
    max_results: clampMaxResults(args.maxResults),
    include_answer: false,
    include_raw_content: args.includeContent ? "markdown" : false,
  };

  if (args.freshness) {
    body.time_range = args.freshness;
  }

  if (args.domains && args.domains.length > 0) {
    body.include_domains = args.domains;
  }

  return body;
}

function buildAppliedFilters(args: SearchProviderArgs): AppliedFilters | undefined {
  const applied: AppliedFilters = {};

  if (args.freshness) {
    applied.freshness = "native";
  }

  if (args.domains && args.domains.length > 0) {
    applied.domains = "native";
  }

  return Object.keys(applied).length > 0 ? applied : undefined;
}

function buildNotes(args: SearchProviderArgs, results: SearchResult[]): string[] | undefined {
  const notes: string[] = [];

  if (args.includeContent) {
    notes.push("Tavily returned content-enriched search results.");
  }

  if (args.freshness && !results.some((result) => result.publishedAt)) {
    notes.push("Tavily did not return publish dates for all results.");
  }

  return notes.length > 0 ? notes : undefined;
}

function chooseTopic(query: string, freshness?: string): TavilyTopic {
  if (freshness && looksNewsLike(query)) {
    return "news";
  }

  return "general";
}

function looksNewsLike(query: string): boolean {
  return /\b(latest|news|breaking|release|released|update|updated|today|yesterday|cve|vulnerability)\b/i.test(
    query,
  );
}

function clampMaxResults(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function validateTavilyResponse(value: unknown): TavilyResponse {
  if (!isPlainObject(value)) {
    throw new Error("Tavily returned unexpected response shape.");
  }

  const results = value.results;
  if (results !== undefined && !Array.isArray(results)) {
    throw new Error("Tavily returned unexpected response shape.");
  }

  return {
    results,
    answer: value.answer,
  };
}

function normalizeResults(results: unknown, includeContent: boolean): SearchResult[] {
  if (!Array.isArray(results)) return [];

  const normalized: SearchResult[] = [];

  for (const item of results) {
    const result = normalizeResult(item, includeContent);
    if (result) normalized.push(result);
  }

  return normalized;
}

function normalizeResult(item: unknown, includeContent: boolean): SearchResult | undefined {
  if (!isPlainObject(item)) return undefined;

  const title = typeof item.title === "string" ? item.title.trim() : "";
  const url = typeof item.url === "string" ? item.url.trim() : "";
  if (!title || !url) return undefined;

  const sourceDomain = hostnameFromUrl(url);

  const snippetSource =
    typeof item.content === "string" && item.content.trim()
      ? item.content
      : typeof item.raw_content === "string" && item.raw_content.trim()
        ? item.raw_content
        : "";

  const result: SearchResult = {
    title,
    url,
    snippet: truncateSnippet(snippetSource, 320) || "[No snippet available]",
  };

  if (sourceDomain) {
    result.sourceDomain = sourceDomain;
  }

  if (typeof item.published_date === "string") {
    const publishedAt = normalizeIsoDate(item.published_date);
    if (publishedAt) {
      result.publishedAt = publishedAt;
    }
  }

  if (includeContent && typeof item.raw_content === "string" && item.raw_content.trim()) {
    result.content = item.raw_content.trim();
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createTavilyConfigError(message: string): ProviderError {
  return new ProviderError({
    provider: "tavily",
    message,
    transient: false,
  });
}
