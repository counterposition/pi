import { MAX_CACHE_CHARS_PER_PAGE } from "./provider-utils.js";
import type { FetchProviderName, PageCacheEntry } from "./types.js";

const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_CAPACITY = 20;

export class PageCache {
  readonly ttlMs: number;
  readonly capacity: number;
  readonly maxCharsPerPage: number;
  readonly entries = new Map<string, PageCacheEntry>();

  constructor(args?: { ttlMs?: number; capacity?: number; maxCharsPerPage?: number }) {
    this.ttlMs = args?.ttlMs ?? DEFAULT_TTL_MS;
    this.capacity = args?.capacity ?? DEFAULT_CAPACITY;
    this.maxCharsPerPage = args?.maxCharsPerPage ?? MAX_CACHE_CHARS_PER_PAGE;
  }

  get(url: string): PageCacheEntry | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;

    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.entries.delete(url);
      return undefined;
    }

    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry;
  }

  set(url: string, content: string, provider: FetchProviderName): void {
    if (content.length > this.maxCharsPerPage) return;

    const entry: PageCacheEntry = {
      url,
      content,
      provider,
      fetchedAt: Date.now(),
    };

    if (this.entries.has(url)) this.entries.delete(url);
    this.entries.set(url, entry);

    while (this.entries.size > this.capacity) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const pageCache = new PageCache();
