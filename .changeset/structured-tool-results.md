---
"@counterposition/pi-web-search": minor
---

# pi-web-search

Return structured results to codemode scripts. `web_search` and `web_fetch`
declare output schemas, so a script gets the search results (with provider,
depth, applied filters, and notes) or the page chunk (with `nextOffset` and
`hasMore`) as an object instead of text. The model still sees the same text,
and failures still reject in scripts. Both tools are grouped in a `web`
namespace and annotated as read-only and open-world. Pi before 0.99 ignores
the new fields.
