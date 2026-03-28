import {
  addSiteConstraint,
  dedupeResultsByUrl,
  fetchJson,
  hostnameFromUrl,
  MAX_RESPONSE_BYTES,
  ProviderError,
  TIMEOUTS,
  toProviderError,
  truncateSnippet,
} from "../provider-utils.js";
import type {
  AppliedFilters,
  ProviderSearchResponse,
  SearchProvider,
  SearchProviderArgs,
  SearchResult,
} from "../types.js";

const SERPER_SEARCH_URL = "https://google.serper.dev/search";
const SERPER_PROVIDER_NAME: SearchProvider["name"] = "serper";

export function createSerperProvider(apiKey: string): SearchProvider {
  if (!apiKey.trim()) {
    throw new Error("Serper API key is required.");
  }

  return {
    name: SERPER_PROVIDER_NAME,
    capabilities: new Set(["search"]),
    async search(args: SearchProviderArgs): Promise<ProviderSearchResponse> {
      try {
        const domains = args.domains?.filter(Boolean) ?? [];
        const response =
          domains.length > 1
            ? await searchAcrossDomains(apiKey, args, domains)
            : await searchSingleQuery(apiKey, args, domains[0]);

        return response;
      } catch (error) {
        throw toProviderError(SERPER_PROVIDER_NAME, error, args.signal);
      }
    },
  };
}

export default createSerperProvider;

async function searchSingleQuery(
  apiKey: string,
  args: SearchProviderArgs,
  domain?: string,
): Promise<ProviderSearchResponse> {
  const query = domain ? addSiteConstraint(args.query, domain) : args.query;
  const request = await fetchJson<SerperResponse>(SERPER_PROVIDER_NAME, SERPER_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      q: query,
      num: args.maxResults,
    }),
    signal: args.signal,
    timeoutMs: TIMEOUTS.searchBasicMs,
    maxBytes: MAX_RESPONSE_BYTES.search,
    validate: validateSerperResponse,
  });

  const results = mapSerperResults(request.organic, args.maxResults);
  const appliedFilters: AppliedFilters = {};

  if (args.freshness) {
    appliedFilters.freshness = "not_applied";
  }

  if (domain) {
    appliedFilters.domains = "query_rewrite";
  }

  return {
    results,
    appliedFilters: Object.keys(appliedFilters).length > 0 ? appliedFilters : undefined,
  };
}

async function searchAcrossDomains(
  apiKey: string,
  args: SearchProviderArgs,
  domains: string[],
): Promise<ProviderSearchResponse> {
  const perDomainResults: SearchResult[] = [];
  const notes: string[] = [];

  for (const domain of domains) {
    const response = await searchSingleQuery(apiKey, args, domain);
    perDomainResults.push(...response.results);
    if (response.notes?.length) notes.push(...response.notes);
  }

  const results = dedupeResultsByUrl(perDomainResults, args.maxResults);
  const appliedFilters: AppliedFilters = {
    domains: "fanout_merge",
  };

  if (args.freshness) {
    appliedFilters.freshness = "not_applied";
  }

  notes.push(
    `Domain filter was approximated by running one query per domain for ${domains.join(", ")}.`,
  );

  return {
    results,
    appliedFilters,
    notes: notes.length > 0 ? [...new Set(notes)] : undefined,
  };
}

function mapSerperResults(results: unknown[] | undefined, maxResults: number): SearchResult[] {
  if (!Array.isArray(results)) return [];

  const mapped: SearchResult[] = [];

  for (const item of results) {
    const parsed = parseSerperResult(item);
    if (!parsed) continue;
    mapped.push(parsed);
    if (mapped.length >= maxResults) break;
  }

  return mapped;
}

function parseSerperResult(item: unknown): SearchResult | undefined {
  if (!isPlainObject(item)) return undefined;

  const title = readString(item.title);
  const url = readString(item.link) ?? readString(item.url);
  if (!title || !url) return undefined;

  const snippet = truncateSnippet(
    readString(item.snippet) ?? readString(item.description) ?? "",
    300,
  );

  const sourceDomain = hostnameFromUrl(url);

  return {
    title,
    url,
    snippet,
    ...(sourceDomain ? { sourceDomain } : {}),
  };
}

function validateSerperResponse(value: unknown): SerperResponse {
  if (!isPlainObject(value)) {
    throw new ProviderError({
      provider: SERPER_PROVIDER_NAME,
      message: "Serper returned unexpected response shape.",
      transient: false,
      cause: value,
    });
  }

  if (!("organic" in value) || !Array.isArray(value.organic)) {
    throw new ProviderError({
      provider: SERPER_PROVIDER_NAME,
      message: "Serper returned unexpected response shape.",
      transient: false,
      cause: value,
    });
  }

  return {
    organic: value.organic,
  };
}

type SerperResponse = {
  organic: unknown[];
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
