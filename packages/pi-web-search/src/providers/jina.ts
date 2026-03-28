import type { FetchProvider } from "../types.js";
import {
  MAX_RESPONSE_BYTES,
  ProviderError,
  TIMEOUTS,
  buildRequestSignal,
  createHttpError,
  readBoundedBody,
  toProviderError,
} from "../provider-utils.js";

const JINA_ENDPOINT = "https://r.jina.ai/";

export function createJinaProvider(apiKey?: string | null): FetchProvider {
  return {
    name: "jina",
    async fetch(url: string, signal: AbortSignal): Promise<string> {
      const targetUrl = `${JINA_ENDPOINT}${url}`;
      const headers = buildHeaders(apiKey, "application/json");

      try {
        const jsonContent = await fetchJinaContent(targetUrl, headers, signal, true);
        if (jsonContent) return jsonContent;
      } catch (error) {
        if (!shouldFallbackToText(error)) {
          throw toProviderError("jina", error, signal);
        }
      }

      try {
        const textContent = await fetchJinaContent(
          targetUrl,
          buildHeaders(apiKey, "text/plain"),
          signal,
          false,
        );
        if (textContent) return textContent;
        throw new ProviderError({
          provider: "jina",
          message: "jina returned an empty response.",
          transient: false,
        });
      } catch (error) {
        throw toProviderError("jina", error, signal);
      }
    },
  };
}

async function fetchJinaContent(
  targetUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  preferJson: boolean,
): Promise<string | undefined> {
  const response = await fetch(targetUrl, {
    method: "GET",
    headers,
    signal: buildRequestSignal(signal, TIMEOUTS.fetchMs),
  });

  if (!response.ok) {
    throw createHttpError("jina", response, response.statusText || "request failed");
  }

  const body = await readBoundedBody(response, MAX_RESPONSE_BYTES.fetch);

  if (preferJson) {
    const parsed = safeParseJson(body);
    if (parsed) {
      const content = extractJinaJsonContent(parsed);
      if (content) return content;
    }

    return undefined;
  }

  return normalizePageContent(body);
}

function buildHeaders(apiKey: string | null | undefined, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-Retain-Images": "none",
  };

  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  return headers;
}

function extractJinaJsonContent(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const data = value.data;
  if (!isPlainObject(data)) return undefined;

  const content = data.content;
  if (typeof content === "string" && content.trim()) {
    return normalizePageContent(content);
  }

  const markdown = data.markdown;
  if (typeof markdown === "string" && markdown.trim()) {
    return normalizePageContent(markdown);
  }

  return undefined;
}

function normalizePageContent(value: string): string | undefined {
  const text = value.replaceAll(/\r\n/g, "\n").trim();
  return text.length > 0 ? text : undefined;
}

function safeParseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function shouldFallbackToText(error: unknown): boolean {
  return error instanceof ProviderError && (error.status === 406 || error.status === 415);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
