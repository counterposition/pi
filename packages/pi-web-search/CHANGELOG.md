# Changelog

## 0.6.0

### Minor Changes

- Add Parallel as a search provider. `web_search` now works with no API keys:
  without `PARALLEL_API_KEY` it uses Parallel's free, rate-limited MCP
  endpoint, where freshness and domain filters are approximated. With a key it
  uses the Search API with native filters. Parallel is ranked last, so
  configured providers still win; a thorough search with only a Brave key now
  goes to Parallel instead of degrading to basic.

## 0.5.5

### Patch Changes

- Inject the untrusted-web-content guidance as a `web_content` system prompt
  section instead of returning a full `systemPrompt` replacement from
  `before_agent_start`. Since Pi 0.86.0 section changes are recorded as
  transcript deltas, so the guidance survives resume and branch navigation
  and keeps the cached prompt prefix; it still renders when a custom
  `SYSTEM.md` replaces the default prompt.

## 0.5.4

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.87 line so
  typecheck and tests run against the Pi release users actually run (0.87.1).
  Runtime is unchanged — the extension still declares the Pi core libraries as
  `"*"` peer dependencies, and none of the Pi 0.84.3–0.87.1 breaking changes
  touch its tools or `before_agent_start` hook.

## 0.5.3

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.84 line so
  typecheck and tests run against the Pi release users actually run (0.84.2).
  Runtime is unchanged — the extension still declares the Pi core libraries as
  `"*"` peer dependencies, and its only pi-ai import (`StringEnum`) remains on
  the root entrypoint after the 0.80.0 move of the old global API to
  `@earendil-works/pi-ai/compat`; typebox moves to ^1.3.16 to match Pi 0.83's
  bundled TypeBox.

## 0.5.2

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.80 line so
  typecheck and tests run against the Pi release users actually run (0.80.3).
  Runtime is unchanged — the extension still declares the Pi core libraries as
  `"*"` peer dependencies and only imports `StringEnum`, which remains on the
  pi-ai root entrypoint after the 0.80.0 move of the old global API to
  `@earendil-works/pi-ai/compat`.

## 0.5.1

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.78 line so
  typecheck and tests run against the Pi release users actually run. Runtime is
  unchanged — the extension still declares the Pi core libraries as `"*"` peer
  dependencies and uses only stable extension APIs.

## 0.5.0

### Minor Changes

- Update Pi peer dependencies and extension imports to the official
  `@earendil-works/*` package scope for Pi 0.74.
- Treat `typebox` as a Pi-provided peer dependency for extension schemas.

## 0.4.1

### Patch Changes

- dde2a16: # pi-web-search

  Fix the web-content prompt-injection guard so the extension returns the updated
  `before_agent_start` system prompt instead of mutating the event object. Pi reads
  system-prompt changes from the handler's return value, so the previous mutation
  of `event.systemPrompt` did not reach the active prompt.

## 0.4.0

### Minor Changes

- c7f645a: # pi-web-search minor release

  Improve `web_search` result formatting to use less context while preserving key filters, provider notes, and one high-value inline content excerpt for thorough searches.

## 0.3.0

### Minor Changes

- a86b338: # pi-web-search

  Fix Brave web search handling when successful responses omit a `web` block, and constrain Brave requests to web results so the adapter receives the response shape it expects.

## Unreleased

### Changed

- Remove Firecrawl support from `pi-web-search` and keep `web_fetch` on the Jina backend only.
- Remove the `FIRECRAWL_API_KEY` configuration path.
- Remove the `preferredFetchProvider` setting.

## 0.2.2

### README

- Expand the README with clearer tool behavior, provider selection and fallback details, configuration guidance, and security notes.

## 0.2.1

### Metadata

- Add the `pi-extension` keyword so `pi.dev/packages` can classify the package as an extension directly from npm metadata.

## 0.1.2

### Documentation

- Update the README configuration section to explicitly name the supported search and fetch providers so the npm package docs are clearer for both humans and AI agents.

## 0.1.1

### Patch Changes

- Republish the package metadata update that adds the `pi-package` keyword so pi.dev can discover both npm packages.

This package uses Changesets for release notes and versioning.
