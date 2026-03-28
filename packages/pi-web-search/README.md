# Pi Web Search

Pi extension package that adds `web_search` and `web_fetch` tools.

## Install

```bash
pi install npm:@counterposition/pi-web-search
```

Maintainer smoke test from the monorepo root:

```bash
pi install ./packages/pi-web-search
```

## Configuration

Configure at least one search provider API key to enable `web_search`.

Supported search providers:

- `BRAVE_API_KEY` - Brave Search
- `SERPER_API_KEY` - Serper (Google Search API)
- `TAVILY_API_KEY` - Tavily
- `EXA_API_KEY` - Exa

Supported fetch providers for `web_fetch`:

- `JINA_API_KEY` - Jina Reader (optional; also works without a key at lower limits)
- `FIRECRAWL_API_KEY` - Firecrawl

## Files

- `extensions/web-search.ts` - extension entrypoint loaded by Pi
- `src/` - runtime support modules used by the extension entrypoint
- `tests/` - package tests
