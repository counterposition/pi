# 0001: Keep Jina Reader Over Defuddle for Content Extraction

## Status

Rejected (Defuddle) — revisit after 2026-09-29

## Date

2026-03-29

## Context

The `web_fetch` tool uses Jina Reader (`r.jina.ai`) as its sole content extraction provider. Jina is a cloud service that accepts a URL and returns clean markdown: it handles HTTP fetching, JavaScript rendering, and content extraction in a single request.

[Defuddle](https://github.com/kepano/defuddle) is a local library by the creator of Obsidian that extracts main content from HTML and can output markdown. It runs entirely in-process with no external service dependency. We evaluated it as a potential replacement for Jina.

### Defuddle's strengths

- No external service dependency: no rate limits, no API key, no third-party outages.
- Privacy: page URLs and content never leave the machine.
- Predictable latency: only the target site fetch plus local parsing.
- Good markdown output with normalization of code blocks, footnotes, and math.

### Why we rejected it

1. **No JavaScript rendering.** Jina uses headless browsers server-side and can extract content from SPAs and JS-heavy pages. Defuddle operates on static HTML only. A plain `fetch()` plus Defuddle would return empty or skeletal content for a significant fraction of the modern web. Accepting this limitation or compensating with a headless browser (Playwright/Puppeteer) would be a much larger change.

2. **HTTP fetching becomes our responsibility.** Jina handles the full pipeline: HTTP request, redirects, timeouts, and content-type handling. Replacing it means owning that surface area directly. While `url-safety.ts` already blocks private IPs, there is additional complexity in robust HTTP fetching that Jina currently absorbs.

3. **New dependency chain.** Defuddle requires a DOM parser (linkedom, JSDOM, or happy-dom). The package currently has zero content-extraction dependencies; adding these is a meaningful increase in surface area.

4. **Maturity.** Defuddle's own README describes it as "very much a work in progress." Jina Reader is battle-tested across millions of pages. Content extraction quality on edge cases (paywalled sites, cookie banners, complex layouts) is better understood with Jina.

5. **Hybrid adds complexity.** A fallback architecture (try Defuddle first, fall back to Jina on thin results) would add complexity rather than remove it, which conflicts with the package's design goals.

## Decision

Keep Jina Reader as the sole fetch provider. Do not adopt Defuddle at this time.

## Consequences

- The `web_fetch` tool remains dependent on an external service for content extraction.
- No new dependencies are introduced.
- JavaScript-rendered pages continue to work without additional infrastructure.
- This decision should be revisited after September 2026 once Defuddle has matured further and the JS-rendering gap can be reassessed.
