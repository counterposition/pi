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
- `TAVILY_API_KEY` - Tavily
- `EXA_API_KEY` - Exa

`web_fetch` is Jina-backed:

- `JINA_API_KEY` - Jina Reader (optional; also works without a key at lower limits)

**Recommended minimum:** Set both `BRAVE_API_KEY` and `EXA_API_KEY` (or `TAVILY_API_KEY`). Brave covers basic and freshness-filtered searches. Exa or Tavily covers thorough searches that return page content. With only one provider configured, thorough searches may silently degrade to basic results.

## Files

- `extensions/web-search.ts` - extension entrypoint loaded by Pi
- `src/` - runtime support modules used by the extension entrypoint
- `tests/` - package tests
