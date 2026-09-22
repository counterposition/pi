# Context-window efficiency audit for pi-web-search

## Background

Two coding agents (OpenCode with GPT-5.4, Pi with GPT-5.4) were independently given the
same prompt asking whether `@packages/pi-web-search/` is maximally efficient from the
calling agent's context window standpoint, whether it dumps results indiscriminately, and
whether it can be improved. Both reached the same high-level conclusion: the extension is
disciplined and bounded, but not maximally context-efficient. This document synthesizes
both analyses into a single handoff for an implementing agent.

### Scope

Everything below applies to the code in `packages/pi-web-search/` as of 2026-04-06.
No changes are proposed to Pi core or to the `skill-pi` package.

### Pi's tool-result contract (verified)

Pi's `ToolResultMessage` has two fields that matter here:

| Field     | Goes to LLM context? | Persisted in session? |
| --------- | :------------------: | :-------------------: |
| `content` |         Yes          |          Yes          |
| `details` |        **No**        |          Yes          |

Source: `pi-coding-agent/docs/session.md` line 271 explicitly says `details` is "not sent
to LLM". The extension already puts provider metadata and pagination state in `details`,
which is correct. The only material that reaches the model is whatever is in `content`.

---

## What the extension already does well

These are **not** problems. Preserve this behavior.

1. **Two-tool split** — `web_search` for discovery, `web_fetch` for reading. This prevents
   accidental large fetches during search.
2. **Bounded search output** — `SEARCH_OUTPUT_BUDGET = 12_000` chars (`format.ts:10`).
3. **Content excerpt cap** — `SEARCH_CONTENT_EXCERPT_LIMIT = 1_500` chars, applied to
   only the top 3 content-bearing results (`format.ts:11`, `format.ts:17-20`).
4. **Paginated fetch** — `web_fetch` defaults to 12k chars, hard-caps at 20k
   (`format.ts:12`, `format.ts:153`).
5. **Fetch cache** — LRU cache (20 entries, 5-min TTL) prevents duplicate network calls
   (`page-cache.ts:4-5`).
6. **Content/details separation** — Metadata goes in `details` (not sent to LLM), display
   text goes in `content` (`web-search.ts:116-142`, `web-search.ts:216-232`).
7. **Prompt injection guard** — System prompt warning injected via `before_agent_start`
   (`web-search.ts:15-22`).

---

## Concern 1: Config warnings leak into search output

### Problem

`resolveSearchProviders` in `config.ts:134` spreads `config.warnings` directly into the
resolution notes array:

```typescript
const notes: string[] = [...config.warnings];
```

These warnings include things like:

```text
Ignoring webSearch.apiKeys in project settings at /Users/me/c/pi/.pi/settings.json.
Store credentials only in the global Pi settings file or environment variables.
```

This text flows through `web-search.ts:114` → `formatSearchResults` → `collectSearchNotes`
→ `renderSearchDocument` and appears at the top of every search result block the agent
sees. It is operational noise aimed at the human user, not useful information for the
model.

### Files

- `src/config.ts:37-41` — warning is generated
- `src/config.ts:134` — warning is spread into resolution notes
- `extensions/web-search.ts:114` — resolution notes merged with provider notes
- `src/format.ts:203-204` — `collectSearchNotes` includes all notes
- `src/format.ts:249-253` — `renderSearchDocument` renders all notes into output

### Proposed fix

Separate config warnings from search notes. Config warnings should either:

- Go only into `details` (not sent to LLM)
- Be emitted once at extension load time via `ctx.ui.notify` instead of per-search
- Be filtered out of the notes array before it reaches `formatSearchResults`

The simplest change: in `resolveSearchProviders`, stop spreading `config.warnings` into
`notes`. Instead, have the extension's `execute` function put `config.warnings` into
`details.warnings`. The model never sees them; the TUI can still display them.

### Estimated impact

~50-200 tokens saved per search call when config warnings are present.

---

## Concern 2: Hard string-slice truncation can cut mid-result

### Problem

`formatSearchResults` in `format.ts:129-131` has a final fallback:

```typescript
if (text.length > SEARCH_OUTPUT_BUDGET) {
  return `${text.slice(0, SEARCH_OUTPUT_BUDGET - 3).trimEnd()}...`;
}
```

If the assembled output still exceeds 12k chars after the content-fitting loop, it is cut
at an arbitrary character position. This can truncate a result block mid-field — the agent
sees a result with a title but no URL, or a content excerpt that stops mid-sentence. That
is confusing and wastes the tokens spent on the partial result.

### How to reproduce

Create a `formatSearchResults` call with 10+ results where several have long snippets
(300+ chars each) and the first 3 have long content. The content-fitting loop in
lines 39-97 will trim or skip content excerpts, but the base result blocks (title + URL +
snippet for all results) can still exceed 12k.

### Files

- `src/format.ts:129-131` — the hard slice

### Proposed fix

Replace the hard slice with result-count reduction. After the content-fitting loop, if
the output still exceeds budget:

1. Remove the last result block entirely.
2. Re-render.
3. Repeat until within budget or only 1 result remains.
4. Append a note: `[N results omitted to fit output budget. Refine your query or use
web_fetch on specific URLs.]`
5. Only as a last resort (single result still too long), truncate that result's snippet
   at a sentence boundary.

Never slice the assembled document as a raw string.

### Estimated impact

Zero token savings on average (this is a quality fix, not a size reduction). Prevents
wasted tokens on partial/confusing results.

---

## Concern 3: `thorough` search inlines too much content

### Problem

When `depth=thorough`, the formatter tries to inline extracted page content for up to 3
results (`format.ts:17-20`), each capped at 1,500 chars (`format.ts:40`). A fully loaded
thorough search can spend ~4,500 chars (roughly 1,100-1,500 tokens) just on inline
content excerpts, on top of the base result blocks.

The agent often only needs:

- Ranked URLs with 1-line summaries
- An indication of which result is most promising to `web_fetch`

Inlining content conflates search (discovery) with reading (consumption), which is exactly
what the two-tool design was meant to separate.

### Files

- `src/format.ts:17-20` — top 3 content candidates selected
- `src/format.ts:39-97` — content-fitting loop
- `src/format.ts:11` — `SEARCH_CONTENT_EXCERPT_LIMIT = 1_500`

### Proposed fix

**Option A (conservative):** Reduce content candidates from 3 to 1. Only the top result
gets an inline excerpt. The omission note already tells the agent to `web_fetch` for more.

**Option B (aggressive):** Remove inline content from search entirely. `thorough` becomes
"use a content-capable provider to get better snippets and metadata" rather than "inline
extracted page content." The agent uses `web_fetch` for any content it actually needs.

**Option C (adaptive):** Add a `compact` option to `web_search` (or rename `thorough` to
have sub-modes). `compact` returns title + URL + 1-sentence snippet only, no inline
content.

Option A is the simplest and most immediately impactful.

### Estimated impact

Option A: ~800-1,500 tokens saved per thorough search call.
Option B: ~1,100-1,500 tokens saved per thorough search call.

---

## Concern 4: Snippet and content excerpt can be redundant

### Problem

When a result has both a snippet and an inline content excerpt, the snippet is often a
substring of the content. The agent sees substantially the same text twice.

`renderBaseResultBlock` in `format.ts:219-237` has an `omitSnippet` option that is
already used — when a result has content in `contentMap`, the snippet is omitted
(`format.ts:27`). So this is **partially addressed** in the current code.

However, if the content-fitting loop skips a result's content (because it didn't fit in
budget), the snippet is still shown for that result. The agent sees snippets for results
whose content was omitted, which is correct behavior. No change needed here.

### Files

- `src/format.ts:25-28` — `renderResultBlocks` passes `omitSnippet` based on contentMap
- `src/format.ts:219-237` — `renderBaseResultBlock` with `omitSnippet` option

### Verdict

Already handled correctly. No action needed.

---

## Concern 5: Section-aware fetch (already documented)

There is an existing concern file at `concerns/05-section-aware-fetch.md` that proposes
adding an optional `section` parameter to `web_fetch` so the agent can jump to a heading
by name instead of paging through character offsets. This is the single largest structural
efficiency improvement for fetch-heavy workflows.

**Do not duplicate this work.** Refer to `concerns/05-section-aware-fetch.md` for the
full proposal.

### Estimated impact (from existing doc)

Eliminates 12,000-24,000 chars of wasted context for multi-page reads.

---

## Concern 6: Default fetch chunk size is large

### Problem

`web_fetch` defaults to 12,000 chars per chunk (`format.ts:12`,
`web-search.ts:186`). For many agent workflows — checking a function signature, reading
a config example, finding a version number — the agent needs only a small portion of the
page. A 12k default means the agent often gets 10k+ chars of irrelevant surrounding text.

The max of 20k is fine as a ceiling (`format.ts:153`), but the default determines what
the agent gets when it doesn't think to specify `max_chars`.

### Files

- `src/format.ts:12` — `FETCH_DEFAULT_MAX_CHARS = 12_000`
- `extensions/web-search.ts:173-178` — `max_chars` parameter definition
- `extensions/web-search.ts:186` — `params.max_chars ?? 12_000`
- `src/format.ts:153` — `Math.min(maxChars, 20_000)` ceiling

### Proposed fix

Reduce the default from 12,000 to 6,000–8,000 chars. The agent can always pass a larger
`max_chars` when it knows it needs more.

This is a one-line change in `web-search.ts:186` and the corresponding constant in
`format.ts:12`.

### Estimated impact

~1,000-1,500 tokens saved per fetch call (on average, when the agent uses the default).

---

## Concern 7: Budgets are character-based, not token-based

### Problem

All size limits in the extension are in characters:

| Constant                       | Value   | File                | Line |
| ------------------------------ | ------- | ------------------- | ---- |
| `SEARCH_OUTPUT_BUDGET`         | 12,000  | `src/format.ts`     | 10   |
| `SEARCH_CONTENT_EXCERPT_LIMIT` | 1,500   | `src/format.ts`     | 11   |
| `FETCH_DEFAULT_MAX_CHARS`      | 12,000  | `src/format.ts`     | 12   |
| `MIN_CONTENT_BLOCK_CHARS`      | 200     | `src/format.ts`     | 13   |
| `MAX_CACHE_CHARS_PER_PAGE`     | 250,000 | `provider-utils.ts` | 14   |

Context windows are measured in tokens. The ratio of characters to tokens varies by
content — code is denser than prose, non-ASCII text is much denser. A 12k-char budget
can be anywhere from ~2,000 to ~4,000 tokens depending on content.

### Proposed fix

This is a **lower-priority** improvement. The character-based approach is simple, fast,
and predictable. Switching to token-based budgeting adds complexity:

- Need a tokenizer (or fast approximation)
- Different models have different tokenizers
- Pi doesn't currently expose the model's tokenizer to extensions

**If implemented:** Use a rough heuristic (e.g., `chars / 4` for English prose, `chars / 3`
for code-heavy content) rather than an actual tokenizer. Set budgets in token-equivalents
and convert. This preserves simplicity while being more context-aware.

**Alternatively:** Just reduce the character budgets (concerns 3 and 6 above). Smaller
character budgets achieve most of the same benefit without tokenizer complexity.

### Estimated impact

Depends on the new budget values. The character budget reductions in concerns 3 and 6
are the practical version of this concern.

---

## Implementation priority

Ranked by (impact on context efficiency) \* (simplicity of change):

| Priority | Concern | Summary                                             | Complexity |
| -------- | ------- | --------------------------------------------------- | ---------: |
| 1        | 2       | Replace hard string-slice with block-aware pruning  |     Medium |
| 2        | 3       | Reduce inline content in thorough search (Option A) |       Easy |
| 3        | 6       | Reduce default fetch chunk to 6-8k                  |    Trivial |
| 4        | 1       | Stop leaking config warnings into search output     |       Easy |
| 5        | 5       | Section-aware fetch (see existing concern)          |     Medium |
| 6        | 7       | Token-based budgeting                               |       Hard |

Concerns 2, 3, and 6 can be implemented independently and in any order. Concern 1 is
also independent. Concern 5 has its own spec. Concern 7 is optional if 3 and 6 are done.

---

## Test files to update

Any changes to formatting or budgets will require updating assertions in:

- `tests/format.test.ts` — Tests for `formatSearchResults`, `paginateContent`,
  `formatFetchContent`
- `tests/extension.test.ts` — Integration tests for the full tool execute path

Run `pnpm test` from `packages/pi-web-search/` after changes.

---

## Files referenced in this document

| File                                 | What it does                                                    |
| ------------------------------------ | --------------------------------------------------------------- |
| `extensions/web-search.ts`           | Extension entry point; tool registration; content/details split |
| `src/format.ts`                      | Output formatting; budgets; truncation; note rendering          |
| `src/config.ts`                      | Config loading; warning generation; provider resolution         |
| `src/types.ts`                       | Type definitions for search/fetch contracts                     |
| `src/providers/brave.ts`             | Brave search provider                                           |
| `src/providers/tavily.ts`            | Tavily search provider                                          |
| `src/providers/exa.ts`               | Exa search provider                                             |
| `src/providers/jina.ts`              | Jina fetch provider                                             |
| `src/page-cache.ts`                  | LRU page cache                                                  |
| `src/provider-utils.ts`              | Shared provider utilities; timeouts; response limits            |
| `tests/format.test.ts`               | Format function tests                                           |
| `tests/extension.test.ts`            | Extension integration tests                                     |
| `concerns/05-section-aware-fetch.md` | Existing concern for section-aware pagination                   |
