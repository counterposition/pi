# Pi Web Search

Pi extension package that adds `web_search` and `web_fetch` tools.

## Install

```bash
pi install npm:@counterposition/pi-web-search
pi install ./packages/pi-web-search
```

## Configuration

Configure at least one search provider API key to enable `web_search`.

- `BRAVE_API_KEY`
- `SERPER_API_KEY`
- `TAVILY_API_KEY`
- `EXA_API_KEY`

Optional fetch providers:

- `JINA_API_KEY`
- `FIRECRAWL_API_KEY`

## Files

- `extensions/web-search.ts` - extension entrypoint loaded by Pi
- `src/` - runtime support modules used by the extension entrypoint
- `tests/` - package tests
