# Section-aware fetch for web_fetch

## Problem

`web_fetch` paginates by character offset: it returns chars `[offset, offset + max_chars]` from the cleaned markdown. If the agent needs information from the middle or end of a long page, it must make multiple sequential fetch calls — each dumping irrelevant content into the context window — before reaching the relevant section.

For a 40,000-char page where the relevant content starts at char 24,000, the agent needs 2 full fetch calls (24K chars of irrelevant content consumed) before reaching what it needs. This is the single largest structural inefficiency in the extension.

## Rationale

Web pages converted to markdown have natural structure: headings (`#`, `##`, `###`, etc.) that divide the content into named sections. An agent calling `web_fetch` after seeing search snippets or result titles typically knows _what_ section it needs. Letting it specify a heading or section name to start from would eliminate wasted pagination round-trips and their context cost.

## Current behavior

`web_fetch` parameters:

```typescript
url: string; // required
offset: number; // char offset, default 0
max_chars: number; // window size, default 12,000, max 20,000
```

`paginateContent` in `src/format.ts` slices `content[offset..offset+maxChars]` with boundary snapping to paragraph/line breaks.

## Proposed change

Add an optional `section` parameter to `web_fetch`:

```typescript
section: Type.Optional(
  Type.String({
    description:
      "Jump to the section with this heading text. " +
      "Matches the first markdown heading (#, ##, ###, etc.) whose text contains this string (case-insensitive). " +
      "The returned content starts from that heading. If no match is found, falls back to the given offset.",
  }),
),
```

### Behavior

1. When `section` is provided, scan the cleaned markdown for the first heading line whose text contains the `section` string (case-insensitive substring match).
2. If found, set the effective offset to the character position of that heading line, ignoring the `offset` parameter.
3. If not found, fall back to the `offset` parameter as today, and include a note in the output: `[Section "<section>" not found. Showing from offset <offset>.]`
4. From the resolved offset, apply `paginateContent` as usual with `max_chars`.

### Heading detection

A heading line is any line matching `/^#{1,6}\s+/`. Extract the text after the `#` markers and whitespace. Match if `headingText.toLowerCase().includes(section.toLowerCase())`.

This is intentionally simple — no parsing of markdown AST, no handling of HTML headings or underline-style headings. Jina Reader's markdown output uses `#`-style headings consistently.

### Parameter interaction

- `section` and `offset` are independent. When `section` matches, it overrides `offset`. When it doesn't match, `offset` is used as fallback.
- `max_chars` applies regardless of how the starting position was determined.
- The `nextOffset` in the response still uses character offsets, so subsequent pagination calls use `offset` as today.

### Output format change

When section match succeeds, the output header changes from:

```text
[Showing chars 0-11999 of 40000]
```

to:

```text
[Showing from section "Installation" — chars 24000-35999 of 40000]
```

### Tool description update

Update the `web_fetch` tool description to mention the section parameter:

```text
"Fetch a webpage and return its content as clean markdown. Use when you have a URL and need to read the full page. Use the section parameter to jump directly to a specific heading."
```

## Files to modify

- `extensions/web-search.ts`: Add `section` parameter to `web_fetch` schema. Pass it through to pagination logic. Update tool description.
- `src/format.ts`: Add a `findSectionOffset` function. Update `formatFetchContent` to include section info in the header when applicable.

## New function

```typescript
// src/format.ts
export function findSectionOffset(content: string, section: string): number | undefined {
  const needle = section.toLowerCase();
  const lines = content.split("\n");
  let charPos = 0;

  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.*)/);
    if (match && match[1].toLowerCase().includes(needle)) {
      return charPos;
    }
    charPos += line.length + 1; // +1 for the newline
  }

  return undefined;
}
```

## Tests to add

- `tests/format.test.ts`:
  - `findSectionOffset` returns correct offset for exact heading match
  - `findSectionOffset` returns correct offset for substring match (case-insensitive)
  - `findSectionOffset` returns undefined when no heading matches
  - `findSectionOffset` matches the first occurrence when multiple headings match
- `tests/extension.test.ts`:
  - `web_fetch` with `section` parameter jumps to the correct section
  - `web_fetch` with `section` that doesn't match falls back to `offset`
  - `web_fetch` with `section` and `offset` both provided — section wins when matched
  - Output includes section name in the header when matched
  - Output includes fallback note when section not found

## Estimated savings

Eliminates entire fetch round-trips. For a page where the agent would otherwise need 2-3 paginated calls to reach relevant content, this saves 12,000-24,000 chars of wasted context — far more than all the other concerns combined.

## Complexity note

This is the only proposed change that adds a new parameter to the tool schema. It increases the tool's surface area slightly but significantly reduces the expected number of tool calls and context consumption for the common case of "I know what section I need from this page."
