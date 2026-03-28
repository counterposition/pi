export type SearchProviderName = "brave" | "serper" | "tavily" | "exa";

export type FetchProviderName = "jina" | "firecrawl";

export type ProviderName = SearchProviderName | FetchProviderName;

export type SearchDepth = "basic" | "thorough";

export type SearchCapability =
  | "search"
  | "content"
  | "semantic"
  | "freshness"
  | "domainFilter"
  | "resultDates";

export type SearchFreshness = "day" | "week" | "month" | "year";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceDomain?: string;
  publishedAt?: string;
  content?: string;
}

export interface AppliedFilters {
  freshness?: "native" | "approximate" | "not_applied";
  domains?: "native" | "query_rewrite" | "fanout_merge" | "not_applied";
}

export interface ProviderSearchResponse {
  results: SearchResult[];
  appliedFilters?: AppliedFilters;
  notes?: string[];
}

export interface SearchResponse extends ProviderSearchResponse {
  provider: SearchProviderName;
}

export interface FetchResponse {
  url: string;
  content: string;
  offset: number;
  returnedChars: number;
  totalChars: number;
  nextOffset?: number;
  hasMore: boolean;
  provider: FetchProviderName;
}

export interface SearchProviderArgs {
  query: string;
  maxResults: number;
  includeContent: boolean;
  freshness?: SearchFreshness;
  domains?: string[];
  signal: AbortSignal;
}

export interface SearchProvider {
  name: SearchProviderName;
  capabilities: ReadonlySet<SearchCapability>;
  search(args: SearchProviderArgs): Promise<ProviderSearchResponse>;
}

export interface FetchProvider {
  name: FetchProviderName;
  fetch(url: string, signal: AbortSignal): Promise<string>;
}

export interface WebSearchSettings {
  preferredBasicProvider?: SearchProviderName | null;
  preferredThoroughProvider?: SearchProviderName | null;
  preferredFetchProvider?: FetchProviderName | null;
}

export type ApiKeyEnvName =
  | "BRAVE_API_KEY"
  | "SERPER_API_KEY"
  | "TAVILY_API_KEY"
  | "EXA_API_KEY"
  | "JINA_API_KEY"
  | "FIRECRAWL_API_KEY";

export interface LoadedConfig {
  apiKeys: Partial<Record<ApiKeyEnvName, string>>;
  settings: WebSearchSettings;
  warnings: string[];
}

export interface InitializedProviders {
  search: Partial<Record<SearchProviderName, SearchProvider>>;
  fetch: Partial<Record<FetchProviderName, FetchProvider>>;
  hasAnySearchProvider: boolean;
}

export interface ResolvedSearchProviders {
  providers: SearchProvider[];
  servedDepth: SearchDepth;
  notes: string[];
}

export interface PaginatedContent {
  text: string;
  offset: number;
  returnedChars: number;
  totalChars: number;
  nextOffset?: number;
  hasMore: boolean;
}

export interface FormatSearchResultsArgs {
  results: SearchResult[];
  provider: SearchProviderName;
  requestedDepth: SearchDepth;
  servedDepth: SearchDepth;
  freshness?: SearchFreshness;
  domains?: string[];
  appliedFilters?: AppliedFilters;
  notes?: string[];
}

export interface PageCacheEntry {
  url: string;
  content: string;
  provider: FetchProviderName;
  fetchedAt: number;
}
