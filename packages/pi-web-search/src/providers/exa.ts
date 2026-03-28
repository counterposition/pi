import {
  MAX_RESPONSE_BYTES,
  ProviderError,
  TIMEOUTS,
  fetchJson,
  hostnameFromUrl,
  normalizeIsoDate,
  truncateSnippet,
} from "../provider-utils.js";
import type {
  AppliedFilters,
  ProviderSearchResponse,
  SearchCapability,
  SearchFreshness,
  SearchProvider,
  SearchProviderArgs,
  SearchResult,
} from "../types.js";

const EXA_ENDPOINT = "https://api.exa.ai/search";

type ExaResult = {
  title?: unknown;
  url?: unknown;
  text?: unknown;
  highlights?: unknown;
  publishedDate?: unknown;
};

type ExaResponse = {
  results: unknown[];
};

const CAPABILITIES = new Set<SearchCapability>([
  "search",
  "content",
  "semantic",
  "freshness",
  "domainFilter",
  "resultDates",
]);

export function createExaProvider(apiKey: string): SearchProvider {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new ProviderError({
      provider: "exa",
      message: "Exa API key is not configured.",
      transient: false,
    });
  }

  return {
    name: "exa",
    capabilities: CAPABILITIES,
    async search(args: SearchProviderArgs): Promise<ProviderSearchResponse> {
      const requestBody = buildRequestBody(args);
      const response = await fetchJson<ExaResponse>("exa", EXA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": trimmedApiKey,
        },
        body: JSON.stringify(requestBody),
        signal: args.signal,
        timeoutMs: args.includeContent ? TIMEOUTS.searchThoroughMs : TIMEOUTS.searchBasicMs,
        maxBytes: MAX_RESPONSE_BYTES.search,
        validate: validateResponseShape,
      });

      const results = normalizeResults(response.results, args.includeContent, args.maxResults);
      const appliedFilters: AppliedFilters | undefined = {
        freshness: args.freshness ? "native" : undefined,
        domains: args.domains?.length ? "native" : undefined,
      };

      return {
        results,
        appliedFilters:
          appliedFilters.freshness || appliedFilters.domains ? appliedFilters : undefined,
        notes: buildNotes(args),
      };
    },
  };
}

export default createExaProvider;

function buildRequestBody(args: SearchProviderArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: args.query,
    numResults: args.maxResults,
    type: "auto",
  };

  if (args.domains?.length) {
    body.includeDomains = args.domains;
  }

  const startPublishedDate = freshnessToStartPublishedDate(args.freshness);
  if (startPublishedDate) {
    body.startPublishedDate = startPublishedDate;
  }

  if (args.includeContent) {
    body.contents = {
      text: {
        maxCharacters: 3_000,
      },
    };
  }

  return body;
}

function validateResponseShape(value: unknown): ExaResponse {
  if (!isPlainObject(value)) {
    throw new Error("Exa returned unexpected response shape");
  }

  const results = value.results;
  if (!Array.isArray(results)) {
    throw new Error("Exa returned unexpected response shape");
  }

  return { results };
}

function normalizeResults(
  results: unknown[],
  includeContent: boolean,
  maxResults: number,
): SearchResult[] {
  const normalized: SearchResult[] = [];

  for (const entry of results) {
    if (!isPlainObject(entry)) continue;

    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!title || !url) continue;

    const snippet = extractSnippet(entry);
    const searchResult: SearchResult = {
      title,
      url,
      snippet,
    };

    const sourceDomain = hostnameFromUrl(url);
    if (sourceDomain) {
      searchResult.sourceDomain = sourceDomain;
    }

    const publishedAt = normalizeIsoDate(
      typeof entry.publishedDate === "string" ? entry.publishedDate : undefined,
    );
    if (publishedAt) {
      searchResult.publishedAt = publishedAt;
    }

    if (includeContent) {
      const content = typeof entry.text === "string" ? entry.text.trim() : "";
      if (content) {
        searchResult.content = content;
      }
    }

    normalized.push(searchResult);
    if (normalized.length >= maxResults) break;
  }

  return normalized;
}

function extractSnippet(entry: ExaResult): string {
  if (typeof entry.text === "string" && entry.text.trim()) {
    return truncateSnippet(entry.text, 300);
  }

  if (Array.isArray(entry.highlights)) {
    for (const highlight of entry.highlights) {
      if (typeof highlight !== "string" || !highlight.trim()) continue;
      return truncateSnippet(highlight, 300);
    }
  }

  return "";
}

function buildNotes(args: SearchProviderArgs): string[] {
  const notes: string[] = [];

  if (args.freshness) {
    notes.push(`Exa applied freshness natively for "${args.freshness}" queries.`);
  }

  if (args.domains?.length) {
    notes.push(`Exa applied domain filtering natively for ${args.domains.join(", ")}.`);
  }

  if (args.includeContent) {
    notes.push("Exa returned extracted page content for this request.");
  }

  return notes;
}

function freshnessToStartPublishedDate(freshness: SearchFreshness | undefined): string | undefined {
  if (!freshness) return undefined;

  const now = new Date();
  const daysBack = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  }[freshness];

  now.setUTCDate(now.getUTCDate() - daysBack);
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
