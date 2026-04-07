# Pi Web Search

A [Pi](https://github.com/badlogic/pi-coding-agent) extension that gives the agent two tools for working with the open web:

1. **`web_search`** for querying multiple search providers with automatic fallback.
2. **`web_fetch`** for reading pages as clean markdown.

The extension manages three search backends ([Brave](https://brave.com/search/api/), [Tavily](https://www.tavily.com/), [Exa](https://exa.ai/)) behind a single interface. It selects the best available provider for each request based on the capabilities the request needs, falls back on transient failures, and tells the agent when a result has been degraded. Page fetching is backed by [Jina Reader](https://jina.ai/reader/).

## Install

```bash
pi install npm:@counterposition/pi-web-search
```

## Tools

### `web_search`

Returns titles, URLs, snippets, and dates. Parameters:

| Parameter     | Description                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `query`       | Search query.                                                                                    |
| `depth`       | `basic` (default) returns snippets. `thorough` uses content-capable search and may include one inline excerpt. |
| `freshness`   | Optional recency filter: `day`, `week`, `month`, or `year`.                                      |
| `domains`     | Optional allowlist of bare hostnames to restrict results (max 10).                               |
| `max_results` | 1--20, default 5.                                                                                |

### `web_fetch`

Fetches a URL through Jina Reader and returns the page content as markdown. Long pages are paginated: use `offset` and `max_chars` to page through content in 8,000-character windows by default (up to 20,000 per call). Fetched pages are cached in an LRU cache (20 entries, 5-minute TTL) so repeated reads of the same URL within a session are free.

## Providers

Each search provider has different capabilities. The extension routes requests to the provider best suited for the job:

| Provider   | Capabilities                                               | Best for                                    |
| ---------- | ---------------------------------------------------------- | ------------------------------------------- |
| **Brave**  | search, freshness                                          | Fast basic queries; time-sensitive searches |
| **Tavily** | search, content, semantic, freshness, domain filter, dates | Thorough searches; domain-scoped research   |
| **Exa**    | search, content, semantic, freshness, domain filter, dates | Thorough searches; domain-scoped research   |
| **Jina**   | page fetch                                                 | Reading full pages as markdown              |

**How provider resolution works:** When a search comes in, the extension ranks available providers by how well they match the request. A `thorough` search needs the `content` capability, so Tavily and Exa are preferred. A `basic` search with a `freshness` filter prefers Brave. If the top-ranked provider fails transiently (network error, rate limit), the next provider in the ranking is tried. If no provider can serve the requested depth, a `thorough` search degrades to `basic` and the agent is told.

You can override the automatic ranking by setting a preferred provider per depth level (see [Settings](#settings) below).

## Configuration

### API keys

Set at least one search provider key. Keys can be set as environment variables or in the global Pi settings file (`~/.pi/agent/settings.json` under `webSearch.apiKeys`). Project-level API keys are intentionally ignored.

| Variable         | Provider                                                        | Required                                            |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `BRAVE_API_KEY`  | [Brave Search](https://api-dashboard.search.brave.com/app/keys) | For basic/fresh searches                            |
| `TAVILY_API_KEY` | [Tavily](https://app.tavily.com/home)                           | For thorough searches                               |
| `EXA_API_KEY`    | [Exa](https://dashboard.exa.ai/api-keys)                        | For thorough searches                               |
| `JINA_API_KEY`   | [Jina Reader](https://jina.ai/api-dashboard/key-manager)        | Optional (works without a key at lower rate limits) |

**Recommended minimum:** `BRAVE_API_KEY` plus either `TAVILY_API_KEY` or `EXA_API_KEY`. Brave covers basic and freshness-filtered searches. Tavily or Exa covers thorough searches that need content-capable discovery. With only one provider, thorough searches may silently degrade to basic.

### Settings

Optional overrides in `settings.json` (global or project-level) under `webSearch`:

```json
{
  "webSearch": {
    "preferredBasicProvider": "brave",
    "preferredThoroughProvider": "tavily"
  }
}
```

When set, the preferred provider is tried first for that depth level before falling back to the default ranking.

## Security

The extension takes two precautions around untrusted web content:

- **SSRF protection.** `web_fetch` validates URLs before fetching. Private and reserved IP ranges (RFC 1918, link-local, loopback), cloud metadata endpoints, and `.local`/`.internal` hostnames are all blocked. Only `http` and `https` schemes are allowed; embedded credentials are rejected.
- **Prompt injection mitigation.** The extension appends a system prompt instructing the agent to treat web content as untrusted data, not as instructions to follow.
