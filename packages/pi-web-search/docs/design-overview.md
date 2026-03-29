# Pi Web Search Extension

## Purpose

`@counterposition/pi-web-search` exists to give the Pi coding agent a small, durable web capability surface that is easy for both humans and LLMs to use correctly.

The package adds two tools:

- `web_search` for finding relevant URLs and summaries
- `web_fetch` for reading the content of a specific URL

That split is intentional. Most agent web work reduces to one of two jobs:

- I need to discover sources.
- I already have a source and need to read it.

The extension exists because general coding and research workflows regularly need current external information, official documentation, release notes, issue threads, and pages that are not already present in the local repo. Pi needs a reliable way to search and read that material without turning provider-specific details into part of the agent's reasoning problem.

## Why This Exists

This extension was built to solve a few concrete problems:

- Pi needs access to current information that does not exist in the workspace.
- Agents do better with a very small tool surface than with a menu of overlapping web tools.
- Search providers differ a lot in capabilities, but the agent should not need to know provider brand names to use them well.
- Web content is untrusted and must be clearly separated from instructions.
- Reading long pages requires pagination and caching so follow-up reads are cheap and predictable.

The package therefore aims to provide a stable agent-facing interface while hiding provider selection, formatting, and error handling behind a simple contract.

## Design Rationale

### Two tools, not one

Searching and fetching have different inputs and different intent. A single polymorphic tool would force the agent to reason about an action selector before it can even form the request. Two clearly named tools keep the decision boundary obvious:

- Have a URL: use `web_fetch`
- Do not have a URL: use `web_search`

### Two tools, not many

The extension does not expose separate tools for keyword search, semantic search, provider-specific search, or provider-specific fetch. Those distinctions are implementation details. More tools would increase routing mistakes and prompt overhead without giving the agent a more meaningful capability model.

### Capability-driven behavior

The agent asks for outcomes, not vendors. It asks for a basic search, a thorough search, a recent search, a domain-constrained search, or a page fetch. Provider choice is handled internally based on configured keys and provider capabilities.

### Minimal public API, honest semantics

The public surface stays small, but the tool output tries to be explicit about what actually happened:

- whether a search was served as `basic` or `thorough`
- whether a `freshness` or `domains` filter was applied natively or approximately
- whether a thorough request had to degrade to basic
- which provider actually served the request

This is important because agents make better downstream decisions when the tool output is honest about uncertainty and fallbacks.

### Always-available page reading

`web_fetch` is kept available through Jina Reader even when no API key is configured. That gives Pi a baseline ability to read public pages without requiring the user to fully configure the package first.

### Dependency restraint

The package does not depend on provider SDKs. The providers are straightforward HTTP integrations, so direct `fetch` calls keep the runtime smaller and the package easier to maintain.

### Safety over convenience

Web content can contain prompt injection, malicious instructions, misleading claims, or dangerous URLs. The extension is built on the assumption that web content is data to inspect, not instructions to obey.

## Core Behavior

### `web_search`

`web_search` is for discovery. It returns normalized search results with titles, URLs, snippets, and metadata when available.

Important behaviors:

- Requires at least one configured search provider API key.
- Supports `depth: "basic" | "thorough"`.
- Supports optional `freshness` and `domains` constraints.
- Prefers providers that can actually honor the requested capabilities.
- Gracefully degrades a thorough request to basic when no content-capable provider is configured.
- Tries the next viable search provider when the current one fails transiently.

Current search providers:

- Brave
- Tavily
- Exa

At a high level:

- `basic` means fast search oriented around snippets and links.
- `thorough` means content-capable search when available.
- `freshness` biases selection toward providers that can reason about recency.
- `domains` biases selection toward providers that can constrain or approximate domain filtering.

### `web_fetch`

`web_fetch` is for reading a known page. It fetches through Jina Reader and returns normalized markdown content.

Important behaviors:

- Always registered.
- Uses Jina as the single fetch backend.
- Works without a Jina API key for some public pages, subject to rate limits and blocking.
- Supports `offset` and `max_chars` for pagination.
- Reuses a session-local page cache so later chunks do not refetch the same page.
- Returns provider and pagination details so the agent can continue reading deterministically.

## Provider Model

The extension intentionally has asymmetric provider behavior:

- Search is multi-provider because provider capability differences matter a lot for research quality.
- Fetch is single-provider because the main agent need is reliable page reading with a stable interface, not fetch-provider choice.

This keeps the internal logic where it matters and removes it where it does not.

### Search provider preferences

Users can express preferred search providers in settings:

- `preferredBasicProvider`
- `preferredThoroughProvider`

Preferences are advisory, not absolute. If a preferred provider cannot serve the request, the extension falls back to normal capability-based resolution.

## Configuration Model

Configuration is intentionally split between secrets and preferences.

API keys can come from:

1. Environment variables
2. Global Pi settings in `$PI_CODING_AGENT_DIR/settings.json` or `~/.pi/agent/settings.json`

Project settings in `.pi/settings.json` may contain non-secret preferences, but project-local API keys are ignored and surfaced as warnings. This prevents shared repo settings from becoming a secret storage path.

Useful configuration values:

- `BRAVE_API_KEY`
- `TAVILY_API_KEY`
- `EXA_API_KEY`
- `JINA_API_KEY`

Useful non-secret settings:

- `preferredBasicProvider`
- `preferredThoroughProvider`

## Output Philosophy

The formatter is designed for agent use, not human web browsing.

Search output prioritizes:

- stable structure
- explicit URLs
- explicit snippets
- normalized source and date metadata when available
- notes when filters were degraded or approximated
- bounded total output size

Fetch output prioritizes:

- clean markdown
- deterministic pagination
- explicit character ranges
- a direct continuation hint for the next chunk

The goal is to make tool output easy for an agent to cite, compare, and continue from without extra reasoning about format.

## Safety Model

### Prompt injection

The extension adds a session warning that content returned by `web_search` and `web_fetch` is untrusted. The intended model is:

- web content is evidence
- user instructions remain authoritative
- tool output must not be treated as executable instructions

### URL validation

`web_fetch` validates user-supplied URLs before issuing a provider request. It only allows normal `http` and `https` targets and rejects obviously dangerous local or privileged destinations.

This is defense in depth, not a full SSRF proof. Fetching still happens on provider infrastructure rather than inside the local Pi runtime.

### Error handling

Provider errors are sanitized before being surfaced. The extension avoids exposing secrets, raw auth headers, or noisy upstream response bodies.

## First-Time Reader Guide

If you are learning the package for the first time, these files matter most:

- `extensions/web-search.ts`: tool registration and request flow
- `src/config.ts`: settings, API key resolution, and search-provider selection
- `src/providers/`: provider integrations
- `src/format.ts`: output shaping and pagination formatting
- `src/page-cache.ts`: session-local fetch cache
- `src/url-safety.ts`: URL validation guardrails
- `tests/`: the executable behavior contract

## What This Package Is Not

This package is not trying to be:

- a browser automation system
- a generic crawling framework
- a full document-ingestion pipeline
- a provider-neutral abstraction for every possible web vendor

It is a focused Pi extension that helps an agent search the web and read pages with predictable behavior.

## Practical Expectations

When using or extending this package, assume the following:

- Search quality depends on which provider keys are configured.
- `thorough` is best-effort and may degrade to `basic`.
- Domain and freshness constraints are surfaced honestly, including when approximated.
- `web_fetch` is good for reading pages, not for bypassing every anti-bot or JS-heavy site.
- Long reads should continue through pagination rather than by increasing output size indefinitely.

## Maintenance Guidance

If this package changes in the future, preserve these invariants unless there is a deliberate product decision to break them:

- Keep the agent-facing model centered on `web_search` and `web_fetch`.
- Keep provider brand names out of the tool interface.
- Keep tool output explicit about degradation, approximation, and provenance.
- Keep `web_fetch` pagination and cache behavior predictable.
- Keep web content treated as untrusted input.
- Keep secret handling conservative.

Those principles matter more than any specific provider ranking or implementation detail.
