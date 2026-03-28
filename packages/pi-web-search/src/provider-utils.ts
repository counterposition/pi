import type { FetchProviderName, ProviderName, SearchResult } from "./types.js";

export const TIMEOUTS = {
  searchBasicMs: 10_000,
  searchThoroughMs: 30_000,
  fetchMs: 30_000,
} as const;

export const MAX_RESPONSE_BYTES = {
  search: 2 * 1024 * 1024,
  fetch: 10 * 1024 * 1024,
} as const;

export const MAX_CACHE_CHARS_PER_PAGE = 250_000;

const TRANSIENT_STATUSES = new Set([408, 429]);

type RequestHeaders = Record<string, string>;

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly transient: boolean;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly code?: string;

  constructor(args: {
    provider: ProviderName;
    message: string;
    transient: boolean;
    status?: number;
    retryAfterSeconds?: number;
    code?: string;
    cause?: unknown;
  }) {
    super(args.message, args.cause ? { cause: args.cause } : undefined);
    this.name = "ProviderError";
    this.provider = args.provider;
    this.transient = args.transient;
    this.status = args.status;
    this.retryAfterSeconds = args.retryAfterSeconds;
    this.code = args.code;
  }
}

export function buildRequestSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

export function classifyStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status) || status >= 500;
}

export function createHttpError(
  provider: ProviderName,
  response: Response,
  summary: string,
): ProviderError {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : undefined;
  const message = `${provider} request failed: ${response.status} ${summary}`.trim();

  return new ProviderError({
    provider,
    message,
    transient: classifyStatus(response.status),
    status: response.status,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
  });
}

export async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`Response exceeded size limit of ${maxBytes} bytes.`);
    }

    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function fetchJson<T>(
  provider: ProviderName,
  url: string,
  options: {
    method?: string;
    headers?: RequestHeaders;
    body?: string;
    signal: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
    validate: (value: unknown) => T;
  },
): Promise<T> {
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: buildRequestSignal(options.signal, options.timeoutMs),
    });

    if (!response.ok) {
      throw createHttpError(provider, response, response.statusText || "request failed");
    }

    const body = await readBoundedBody(response, options.maxBytes);

    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch (error) {
      throw new ProviderError({
        provider,
        message: `${provider} returned invalid JSON.`,
        transient: false,
        cause: error,
      });
    }

    try {
      return options.validate(parsed);
    } catch (error) {
      throw new ProviderError({
        provider,
        message:
          error instanceof Error && error.message
            ? error.message
            : `${provider} returned unexpected response shape.`,
        transient: false,
        cause: error,
      });
    }
  } catch (error) {
    throw toProviderError(provider, error, options.signal);
  }
}

export async function fetchText(
  provider: FetchProviderName,
  url: string,
  options: {
    method?: string;
    headers?: RequestHeaders;
    body?: string;
    signal: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<string> {
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: buildRequestSignal(options.signal, options.timeoutMs),
    });

    if (!response.ok) {
      throw createHttpError(provider, response, response.statusText || "request failed");
    }

    return await readBoundedBody(response, options.maxBytes);
  } catch (error) {
    throw toProviderError(provider, error, options.signal);
  }
}

export function toProviderError(
  provider: ProviderName,
  error: unknown,
  signal?: AbortSignal,
): Error {
  if (error instanceof ProviderError) return error;

  if (isAbortError(error)) {
    if (signal?.aborted) {
      return error instanceof Error ? error : new Error("Request aborted.");
    }

    return new ProviderError({
      provider,
      message: `${provider} request timed out.`,
      transient: true,
      code: "TIMEOUT",
      cause: error,
    });
  }

  return new ProviderError({
    provider,
    message:
      error instanceof Error && error.message
        ? `${provider} request failed: ${error.message}`
        : `${provider} request failed.`,
    transient: true,
    cause: error,
  });
}

export function isTransientProviderError(error: unknown): boolean {
  return error instanceof ProviderError ? error.transient : false;
}

export function truncateSnippet(text: string, maxLen: number): string {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;

  const slice = normalized.slice(0, maxLen + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cutoff = lastSpace >= Math.floor(maxLen * 0.6) ? lastSpace : maxLen;
  return `${normalized.slice(0, cutoff).trimEnd()}...`;
}

export function normalizeIsoDate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function hostnameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function dedupeResultsByUrl(results: SearchResult[], maxResults: number): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const key = result.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
    if (deduped.length >= maxResults) break;
  }

  return deduped;
}

export function addSiteConstraint(query: string, domain: string): string {
  return `${query} site:${domain}`;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
