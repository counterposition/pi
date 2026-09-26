import { randomUUID } from "node:crypto";

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
  SearchCapability,
  SearchFreshness,
  SearchProvider,
  SearchProviderArgs,
  SearchResult,
} from "../types.js";

const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";
const PARALLEL_FREE_MCP_URL = "https://search.parallel.ai/mcp";

const KEYED_CAPABILITIES = new Set<SearchCapability>([
  "search",
  "content",
  "semantic",
  "freshness",
  "domainFilter",
  "resultDates",
]);

const FREE_CAPABILITIES = new Set<SearchCapability>([
  "search",
  "content",
  "semantic",
  "resultDates",
]);

const FRESHNESS_DAYS: Record<SearchFreshness, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

type ParallelSearchResponse = {
  results: unknown[];
};

type McpToolResult = {
  isError: boolean;
  structuredContent: unknown;
  text: string;
};

export function createParallelProvider(apiKey?: string): SearchProvider {
  const trimmedApiKey = apiKey?.trim();
  if (trimmedApiKey) {
    return {
      name: "parallel",
      capabilities: KEYED_CAPABILITIES,
      search: (args) => searchWithKey(args, trimmedApiKey),
    };
  }

  const sessionId = randomUUID();
  return {
    name: "parallel",
    capabilities: FREE_CAPABILITIES,
    search: (args) => searchFree(args, sessionId),
  };
}

export default createParallelProvider;

async function searchWithKey(
  args: SearchProviderArgs,
  apiKey: string,
): Promise<ProviderSearchResponse> {
  const sourcePolicy: Record<string, unknown> = {};
  if (args.domains?.length) {
    sourcePolicy.include_domains = args.domains;
  }
  if (args.freshness) {
    sourcePolicy.after_date = freshnessCutoff(args.freshness).toISOString().slice(0, 10);
  }

  const response = await fetchJson<ParallelSearchResponse>("parallel", PARALLEL_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      objective: args.query,
      search_queries: [args.query],
      mode: args.includeContent ? "advanced" : "fast",
      advanced_settings: {
        max_results: args.maxResults,
        ...(Object.keys(sourcePolicy).length > 0 ? { source_policy: sourcePolicy } : {}),
      },
    }),
    signal: args.signal,
    timeoutMs: args.includeContent ? TIMEOUTS.searchThoroughMs : TIMEOUTS.searchBasicMs,
    maxBytes: MAX_RESPONSE_BYTES.search,
    validate: validateSearchResponse,
  });

  return {
    results: normalizeResults(response.results, args),
    appliedFilters:
      args.freshness || args.domains?.length
        ? {
            freshness: args.freshness ? "native" : undefined,
            domains: args.domains?.length ? "native" : undefined,
          }
        : undefined,
  };
}

async function searchFree(
  args: SearchProviderArgs,
  sessionId: string,
): Promise<ProviderSearchResponse> {
  const objective = args.freshness
    ? `${args.query} (prefer sources published within the past ${args.freshness})`
    : args.query;
  const searchQueries = args.domains?.length
    ? args.domains.map((domain) => addSiteConstraint(args.query, domain))
    : [args.query];

  const toolResult = await fetchJson<McpToolResult>("parallel", PARALLEL_FREE_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: {
          objective,
          search_queries: searchQueries,
          session_id: sessionId,
        },
      },
    }),
    signal: args.signal,
    timeoutMs: args.includeContent ? TIMEOUTS.searchThoroughMs : TIMEOUTS.searchBasicMs,
    maxBytes: MAX_RESPONSE_BYTES.search,
    validate: validateMcpResponse,
  });

  if (toolResult.isError) {
    throw new ProviderError({
      provider: "parallel",
      message: `parallel request failed: ${toolResult.text || "tool error"}`,
      transient: true,
    });
  }

  const response = validateSearchResponse(toolResult.structuredContent);
  let results = normalizeResults(response.results, {
    ...args,
    maxResults: Number.MAX_SAFE_INTEGER,
  });

  if (args.domains?.length) {
    const domains = args.domains;
    results = results.filter((result) => matchesDomain(result.sourceDomain, domains));
  }
  if (args.freshness) {
    const cutoff = freshnessCutoff(args.freshness).getTime();
    results = results.filter(
      (result) => !result.publishedAt || new Date(result.publishedAt).getTime() >= cutoff,
    );
  }

  return {
    results: dedupeResultsByUrl(results, args.maxResults),
    appliedFilters:
      args.freshness || args.domains?.length
        ? {
            freshness: args.freshness ? "approximate" : undefined,
            domains: args.domains?.length ? "query_rewrite" : undefined,
          }
        : undefined,
  };
}

function validateMcpResponse(value: unknown): McpToolResult {
  if (!isPlainObject(value)) {
    throw new Error("Parallel returned unexpected response shape");
  }

  if (isPlainObject(value.error)) {
    const message = typeof value.error.message === "string" ? value.error.message : "unknown error";
    throw new Error(`Parallel returned an error: ${message}`);
  }

  const result = value.result;
  if (!isPlainObject(result)) {
    throw new Error("Parallel returned unexpected response shape");
  }

  const text = Array.isArray(result.content)
    ? result.content
        .map((entry) => (isPlainObject(entry) && typeof entry.text === "string" ? entry.text : ""))
        .join("\n")
        .trim()
    : "";

  return {
    isError: result.isError === true,
    structuredContent: result.structuredContent,
    text,
  };
}

function validateSearchResponse(value: unknown): ParallelSearchResponse {
  if (!isPlainObject(value) || !Array.isArray(value.results)) {
    throw new ProviderError({
      provider: "parallel",
      message: "Parallel returned unexpected response shape",
      transient: false,
    });
  }

  return { results: value.results };
}

function normalizeResults(
  results: unknown[],
  args: Pick<SearchProviderArgs, "includeContent" | "maxResults">,
): SearchResult[] {
  const normalized: SearchResult[] = [];

  for (const entry of results) {
    if (!isPlainObject(entry)) continue;

    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) continue;

    const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : url;
    const excerpts = Array.isArray(entry.excerpts)
      ? entry.excerpts.filter(
          (excerpt): excerpt is string => typeof excerpt === "string" && Boolean(excerpt.trim()),
        )
      : [];

    const searchResult: SearchResult = {
      title,
      url,
      snippet: truncateSnippet(excerpts[0] ?? "", 300),
    };

    const sourceDomain = hostnameFromUrl(url);
    if (sourceDomain) {
      searchResult.sourceDomain = sourceDomain;
    }

    const publishedAt = normalizeIsoDate(
      typeof entry.publish_date === "string" ? entry.publish_date : undefined,
    );
    if (publishedAt) {
      searchResult.publishedAt = publishedAt;
    }

    if (args.includeContent && excerpts.length > 0) {
      searchResult.content = excerpts.join("\n\n").trim();
    }

    normalized.push(searchResult);
    if (normalized.length >= args.maxResults) break;
  }

  return normalized;
}

function matchesDomain(hostname: string | undefined, domains: string[]): boolean {
  if (!hostname) return false;
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function freshnessCutoff(freshness: SearchFreshness): Date {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - FRESHNESS_DAYS[freshness]);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
