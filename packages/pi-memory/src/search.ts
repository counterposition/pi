import type {
  MemorySearchRequest,
  MemorySearchResponse,
  MemorySearchResult,
  MemoryWarning,
  ParsedEntry,
} from "./types.js";

interface RankedMatch {
  entry: ParsedEntry;
  headingMatches: number;
  bodyMatches: number;
}

const DEFAULT_MAX_RESULTS = 10;
const EXCERPT_MAX_CHARS = 300;
const WORD_CHAR_CLASS = "[\\p{L}\\p{N}]";

export function searchEntries(
  entries: ParsedEntry[],
  request: MemorySearchRequest,
  now = new Date(),
): MemorySearchResponse {
  const queryWords = tokenizeQuery(request.query);
  if (queryWords.length === 0) {
    return { results: [], warnings: [] };
  }

  const rankedMatches: RankedMatch[] = [];
  const warnings: MemoryWarning[] = [];

  for (const entry of entries) {
    if (entry.status === "invalid") continue;
    if (request.scope && request.scope !== "all" && entry.scope !== request.scope) continue;

    const headingMatches = countWordMatches(entry.heading, queryWords);
    const bodyMatches = countWordMatches(
      entry.bodyText,
      queryWords,
      queryWords.filter((word) => !matchesWord(entry.heading, word)),
    );
    const totalMatches = headingMatches + bodyMatches;

    if (totalMatches !== queryWords.length) continue;

    rankedMatches.push({
      entry,
      headingMatches,
      bodyMatches,
    });
  }

  rankedMatches.sort((left, right) => compareMatches(left, right));

  const maxResults = request.maxResults ?? DEFAULT_MAX_RESULTS;
  const results = rankedMatches
    .slice(0, maxResults)
    .map((match) => toSearchResult(match.entry, queryWords, now));

  return { results, warnings };
}

export function formatSearchResultsText(results: MemorySearchResult[]): string {
  if (results.length === 0) return "No matching memories.";

  return results
    .map(
      (result, index) =>
        `${index + 1}. [${result.scope}] ${result.heading}\n` +
        `ID: ${result.id}\n` +
        `Updated: ${result.updatedLabel}\n` +
        `Lines: ${result.lineSpan.start}-${result.lineSpan.end}\n` +
        `Path: ${result.filePath}\n` +
        `Excerpt: ${result.excerpt || "(empty)"}`,
    )
    .join("\n\n");
}

export function formatRelativeAge(updatedAt: number, now = new Date()): string {
  if (updatedAt <= 0) return "unknown age";

  const dayMs = 86_400_000;
  const deltaDays = Math.max(
    0,
    Math.floor(
      (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - updatedAt) / dayMs,
    ),
  );

  if (deltaDays === 0) return "today";
  if (deltaDays === 1) return "1 day ago";
  if (deltaDays < 30) return `${deltaDays} days ago`;

  const months = Math.floor(deltaDays / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function tokenizeQuery(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
}

export function entryToSearchResult(entry: ParsedEntry, now = new Date()): MemorySearchResult {
  return toSearchResult(entry, [], now);
}

function compareMatches(left: RankedMatch, right: RankedMatch): number {
  if (left.headingMatches !== right.headingMatches) {
    return right.headingMatches - left.headingMatches;
  }

  if (left.bodyMatches !== right.bodyMatches) {
    return right.bodyMatches - left.bodyMatches;
  }

  if (left.entry.scope !== right.entry.scope) {
    return left.entry.scope === "project" ? -1 : 1;
  }

  if (left.entry.updatedAt !== right.entry.updatedAt) {
    return right.entry.updatedAt - left.entry.updatedAt;
  }

  if (left.entry.filePath !== right.entry.filePath) {
    return left.entry.filePath.localeCompare(right.entry.filePath);
  }

  return left.entry.lineSpan.start - right.entry.lineSpan.start;
}

function toSearchResult(entry: ParsedEntry, queryWords: string[], now: Date): MemorySearchResult {
  const relativeAge = formatRelativeAge(entry.updatedAt, now);
  return {
    id: entry.id,
    syntheticId: entry.syntheticId,
    scope: entry.scope,
    filePath: entry.filePath,
    heading: entry.heading,
    status: entry.status,
    updated: entry.updated,
    relativeAge,
    updatedLabel: `${entry.updated} (${relativeAge})`,
    excerpt: buildExcerpt(entry.bodyText, queryWords),
    lineSpan: entry.lineSpan,
  };
}

function buildExcerpt(bodyText: string, queryWords: string[]): string {
  const collapsed = bodyText.replace(/\s+/gu, " ").trim();
  if (collapsed === "") return "";

  let matchIndex = Number.POSITIVE_INFINITY;
  for (const word of queryWords) {
    const match = buildWordRegex(word).exec(collapsed);
    if (match?.index !== undefined) {
      matchIndex = Math.min(matchIndex, match.index);
    }
  }

  const start = Number.isFinite(matchIndex) ? Math.max(0, matchIndex - 60) : 0;
  const end = Math.min(collapsed.length, start + EXCERPT_MAX_CHARS);
  const excerpt = collapsed.slice(start, end).trim();
  const prefix = start > 0 ? "..." : "";
  const suffix = end < collapsed.length ? "..." : "";

  return `${prefix}${excerpt}${suffix}`;
}

function countWordMatches(text: string, queryWords: string[], words = queryWords): number {
  let count = 0;
  for (const word of words) {
    if (matchesWord(text, word)) count += 1;
  }
  return count;
}

function matchesWord(text: string, word: string): boolean {
  return buildWordRegex(word).test(text);
}

function buildWordRegex(word: string): RegExp {
  return new RegExp(`(?<!${WORD_CHAR_CLASS})${escapeRegExp(word)}(?!${WORD_CHAR_CLASS})`, "iu");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
