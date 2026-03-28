import type { FetchProvider } from "../types.js";
import { MAX_RESPONSE_BYTES, ProviderError, TIMEOUTS, fetchJson } from "../provider-utils.js";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

export function createFirecrawlProvider(apiKey?: string | null): FetchProvider {
  return {
    name: "firecrawl",
    async fetch(url: string, signal: AbortSignal): Promise<string> {
      if (!apiKey?.trim()) {
        throw new ProviderError({
          provider: "firecrawl",
          message: "firecrawl is not configured. Set FIRECRAWL_API_KEY to enable this provider.",
          transient: false,
        });
      }

      const payload = {
        url,
        formats: ["markdown"],
      };

      const result = await fetchJson("firecrawl", FIRECRAWL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(payload),
        signal,
        timeoutMs: TIMEOUTS.fetchMs,
        maxBytes: MAX_RESPONSE_BYTES.fetch,
        validate: validateFirecrawlResponse,
      });

      return result;
    },
  };
}

function validateFirecrawlResponse(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new Error("Firecrawl returned unexpected response shape.");
  }

  const data = value.data;
  if (!isPlainObject(data)) {
    throw new Error("Firecrawl returned unexpected response shape.");
  }

  const markdown = data.markdown;
  if (typeof markdown === "string" && markdown.trim()) {
    return markdown.trim();
  }

  const content = data.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  throw new Error("Firecrawl returned unexpected response shape.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
