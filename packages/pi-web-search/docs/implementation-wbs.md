# Pi Web Search Extension — Work Breakdown Structure

This document converts [`implementation-plan.md`](/Users/me/c/pi-web-search/docs/implementation-plan.md) into an implementation-ready WBS for parallel execution. It is optimized for a fresh session with limited context and for coordination across multiple agents without merge churn.

## Goal

Build a Pi extension package that exposes exactly two tools:

- `web_search(query, depth?, max_results?, freshness?, domains?)`
- `web_fetch(url, offset?, max_chars?)`

The implementation must preserve the minimal two-tool API while supporting:

- Search providers: Brave, Serper, Tavily, Exa
- Fetch providers: Jina Reader, Firecrawl
- Config from env vars plus optional global/project Pi settings
- Safe URL validation for `web_fetch`
- Consistent formatter output
- Graceful provider selection, fallback, and degradation

## How To Use This WBS

Use this document as the execution contract for the next session.

- The integrator owns shared contracts, cross-cutting decisions, final merges, and verification.
- Worker agents should only edit files explicitly assigned to their work package.
- No provider worker should change shared types or formatter contracts after Phase 0 is frozen.
- If a worker discovers a contract gap, it should report it rather than redefining the interface locally.

## Execution Model

Run the work in four phases:

1. Contract freeze
2. Core implementation
3. Provider implementation in parallel
4. Integration and verification

Critical rule: do not start parallel provider work until the shared contracts in Phase 0 are committed or otherwise treated as frozen.

## Shared Contracts To Freeze First

These must be finalized before parallel implementation:

- `package.json`
- `src/types.ts`
- `src/config.ts` public exports and config shape
- `src/format.ts` function signatures and output contracts
- `src/page-cache.ts` public API
- `src/url-safety.ts` public API
- Shared helper names referenced by the extension entry point:
  - `loadConfig()`
  - `initProviders(config)`
  - `normalizeDomains(domains)`
  - `validateFetchUrl(url)`
  - `paginateContent(content, offset, maxChars)`
  - `isTransientProviderError(error)`
  - `readBoundedBody(response, maxBytes)`
  - `truncateSnippet(text, maxLen)`

## Repository Target Shape

The end state should match this structure:

```text
pi-web-search/
├── package.json
├── extensions/
│   └── web-search.ts
├── src/
│   ├── config.ts
│   ├── format.ts
│   ├── page-cache.ts
│   ├── types.ts
│   ├── url-safety.ts
│   └── providers/
│       ├── brave.ts
│       ├── exa.ts
│       ├── firecrawl.ts
│       ├── jina.ts
│       ├── serper.ts
│       └── tavily.ts
└── skills/
```

## Work Packages

Each work package below includes ownership, write scope, dependencies, deliverables, and acceptance criteria. The write scope should be treated as exclusive unless the integrator explicitly reassigns it.

### WP0: Contract Freeze And Scaffold

Owner: integrator

Write scope:

- `package.json`
- `extensions/web-search.ts` as a stub only if needed for compile wiring
- `src/types.ts`
- `src/config.ts`
- `src/format.ts`
- `src/page-cache.ts`
- `src/url-safety.ts`
- any shared utility file added to support the frozen contracts

Dependencies:

- none

Deliverables:

- package scaffold exists
- all shared interfaces and helper signatures are defined
- resolver logic shape is implemented or stubbed clearly enough for providers to target
- formatter contract is frozen
- URL validation API is frozen
- page cache API is frozen

Acceptance criteria:

- provider files can be implemented independently against `SearchProvider` and `FetchProvider`
- the extension entry point can import shared modules without unresolved API ambiguity
- no worker needs to edit another worker's provider file to proceed

Notes:

- Keep this package dependency-free except Pi peer dependencies unless a hard requirement emerges.
- If test scaffolding is added here, freeze the test style and filenames too.

### WP1: Search Provider A

Owner: worker A

Write scope:

- `src/providers/brave.ts`

Dependencies:

- WP0

Deliverables:

- Brave provider implementing `SearchProvider`
- native `freshness` handling
- result mapping to normalized `SearchResult`
- sanitized error handling
- response validation and malformed-item skipping

Acceptance criteria:

- basic search works without content extraction
- `publishedAt` and `sourceDomain` are mapped when available
- retryability classification is compatible with shared helper expectations

### WP2: Search Provider B

Owner: worker B

Write scope:

- `src/providers/serper.ts`

Dependencies:

- WP0

Deliverables:

- Serper provider implementing `SearchProvider`
- normalized search results
- sanitized error handling
- response validation and malformed-item skipping

Acceptance criteria:

- basic search works
- provider reports no unsupported capabilities beyond what the plan allows
- result mapping does not fabricate dates or domains

### WP3: Search Provider C

Owner: worker C

Write scope:

- `src/providers/tavily.ts`

Dependencies:

- WP0

Deliverables:

- Tavily provider implementing `SearchProvider`
- support for `includeContent`
- native or best-effort `freshness` handling
- native domain filtering when available
- normalized `appliedFilters`
- normalized `publishedAt` when available

Acceptance criteria:

- `depth: "basic"` omits extracted content upstream when possible
- `depth: "thorough"` returns normalized `content`
- `appliedFilters` accurately distinguishes native behavior from fallback behavior

### WP4: Search Provider D

Owner: worker D

Write scope:

- `src/providers/exa.ts`

Dependencies:

- WP0

Deliverables:

- Exa provider implementing `SearchProvider`
- support for `includeContent`
- native or best-effort `freshness` handling
- native domain filtering when available
- normalized `appliedFilters`
- normalized `publishedAt` when available

Acceptance criteria:

- basic and thorough modes both work against the shared contract
- provider capability flags match actual behavior
- malformed results are skipped safely

### WP5: Fetch Providers

Owner: worker E

Write scope:

- `src/providers/jina.ts`
- `src/providers/firecrawl.ts`

Dependencies:

- WP0

Deliverables:

- Jina provider implementing `FetchProvider`
- Firecrawl provider implementing `FetchProvider`
- sanitized error handling
- bounded body reading compatibility with shared helpers

Acceptance criteria:

- Jina works as the default public-page fetch path
- Firecrawl works when configured and viable
- neither provider bypasses shared URL safety validation

### WP6: Extension Integration

Owner: integrator

Write scope:

- `extensions/web-search.ts`

Dependencies:

- WP0
- at least one working search provider
- WP5 for fetch integration

Deliverables:

- tool registration for `web_search` and `web_fetch`
- `before_agent_start` prompt-injection warning
- provider resolution wiring
- transient fallback behavior
- graceful degradation from thorough to basic
- details payloads and user-facing formatted output

Acceptance criteria:

- tool schemas match the implementation plan
- runtime behavior uses only shared APIs and provider interfaces
- fetch pagination and cache flow are correctly wired

### WP7: Test And Verification Harness

Owner: integrator or dedicated worker if available

Write scope:

- test files only
- optionally `package.json` scripts if not already frozen in WP0

Dependencies:

- WP0 for test targets
- WP1 through WP6 incrementally as code lands

Deliverables:

- automated tests for resolver behavior
- formatter budget tests
- URL safety tests
- cache tests
- provider parser tests
- fetch failover tests

Acceptance criteria:

- core acceptance criteria from the implementation plan are executable locally
- tests clearly separate unit behavior from any manual/provider-keyed validation

## Dependency Graph

```text
WP0
├── WP1
├── WP2
├── WP3
├── WP4
├── WP5
└── WP7 (test scaffolding can begin after contracts freeze)

WP1 ─┐
WP2 ─┼──> WP6
WP3 ─┤
WP4 ─┤
WP5 ─┘

WP6 ───> WP7 final integration coverage
```

## Recommended Parallelization Plan

This is the concrete orchestration plan for a multi-agent implementation run.

### Phase 0

One integrator agent:

- create scaffold
- freeze shared contracts
- leave provider implementation slots ready

Exit gate:

- all shared modules compile or are close enough that provider workers can target stable imports and interfaces

### Phase 1

Run these in parallel:

- worker A on Brave
- worker B on Serper
- worker C on Tavily
- worker D on Exa
- worker E on Jina and Firecrawl

In parallel with them, the integrator can:

- finish the extension entry point around the frozen contracts
- prepare tests for formatter, resolver, URL safety, and cache

Exit gate:

- provider files are merged or ready to merge with no shared-file conflicts outside agreed contracts

### Phase 2

Integrator only:

- integrate all providers
- resolve any contract mismatches centrally
- complete end-to-end wiring

### Phase 3

Integrator plus optional verification worker:

- run automated tests
- perform manual validation passes listed in the implementation plan
- tighten output formatting, notes, and error messages

## Suggested Agent Prompts

These are starter prompts for the next session if parallel agents are used.

### Integrator

Implement WP0 and WP6 from `docs/implementation-wbs.md`. Freeze shared contracts first, then wire `extensions/web-search.ts` against those contracts. Do not implement provider internals that belong to worker-owned files. If a provider contract gap appears, fix it in the shared layer and document the change.

### Worker A

Implement WP1 from `docs/implementation-wbs.md`. You own only `src/providers/brave.ts`. Follow the contracts in `src/types.ts`, `src/config.ts`, and related shared helpers. Do not edit shared files unless explicitly reassigned.

### Worker B

Implement WP2 from `docs/implementation-wbs.md`. You own only `src/providers/serper.ts`. Follow the frozen contracts and report contract mismatches instead of redefining interfaces locally.

### Worker C

Implement WP3 from `docs/implementation-wbs.md`. You own only `src/providers/tavily.ts`. Respect the shared `includeContent`, `freshness`, `domains`, and `appliedFilters` contracts.

### Worker D

Implement WP4 from `docs/implementation-wbs.md`. You own only `src/providers/exa.ts`. Match capability flags to actual provider behavior and normalize results to the shared types.

### Worker E

Implement WP5 from `docs/implementation-wbs.md`. You own only `src/providers/jina.ts` and `src/providers/firecrawl.ts`. Use the shared fetch contract and do not bypass shared URL validation.

## Merge Rules

- Integrator merges provider work only after confirming imports and contracts still match WP0.
- Provider workers must not reformat unrelated files.
- If two workers need the same shared helper changed, the integrator should make that change once centrally.
- Keep write sets disjoint to avoid reconciliation overhead.

## Definition Of Done

The implementation is done when all of the following are true:

- both tools are registered and callable
- provider selection and graceful degradation behave per spec
- formatter output matches the documented budget and note behavior
- URL validation blocks dangerous targets before provider calls
- fetch pagination uses the session-local cache
- errors are sanitized
- automated tests cover the core branches
- manual validation checklist from the implementation plan has been exercised where automation is insufficient

## Recommended File For The Next Session To Start With

Start from this file and then open the source plan only as needed:

- [`docs/implementation-wbs.md`](/Users/me/c/pi-web-search/docs/implementation-wbs.md)

Use [`docs/implementation-plan.md`](/Users/me/c/pi-web-search/docs/implementation-plan.md) as the specification of behavior, not as the task tracker.
