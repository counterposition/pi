import { truncateSnippet, normalizeIsoDate } from "./provider-utils.js";
import type {
  AppliedFilters,
  FetchProviderName,
  FormatSearchResultsArgs,
  PaginatedContent,
  SearchResult,
} from "./types.js";

const SEARCH_OUTPUT_BUDGET = 12_000;
const SEARCH_CONTENT_EXCERPT_LIMIT = 1_500;
const FETCH_DEFAULT_MAX_CHARS = 12_000;
const MIN_CONTENT_BLOCK_CHARS = 200;

export function formatSearchResults(args: FormatSearchResultsArgs): string {
  const notes = collectSearchNotes(args);
  const topContentCandidates = args.results
    .slice(0, 3)
    .map((result, index) => ({ index, content: result.content?.trim() }))
    .filter((entry): entry is { index: number; content: string } => Boolean(entry.content));

  const contentMap = new Map<number, string>();
  let omittedCount = 0;

  const renderResultBlocks = (contentMap: Map<number, string>): string[] =>
    args.results.map((result, index) =>
      renderBaseResultBlock(result, index + 1, { omitSnippet: contentMap.has(index) }),
    );

  let text = renderSearchDocument({
    provider: args.provider,
    servedDepth: args.servedDepth,
    notes,
    resultBlocks: renderResultBlocks(contentMap),
    contentMap,
    basicHint: args.servedDepth === "basic",
    omissionNote: undefined,
  });

  for (const candidate of topContentCandidates) {
    const baseExcerpt = truncateSnippet(candidate.content, SEARCH_CONTENT_EXCERPT_LIMIT);
    const tentativeMap = new Map(contentMap);
    tentativeMap.set(candidate.index, baseExcerpt);
    const tentativeBlocks = renderResultBlocks(tentativeMap);

    const tentativeText = renderSearchDocument({
      provider: args.provider,
      servedDepth: args.servedDepth,
      notes,
      resultBlocks: tentativeBlocks,
      contentMap: tentativeMap,
      basicHint: args.servedDepth === "basic",
      omissionNote: undefined,
    });

    if (tentativeText.length <= SEARCH_OUTPUT_BUDGET) {
      contentMap.set(candidate.index, baseExcerpt);
      text = tentativeText;
      continue;
    }

    const blockOverhead = `\nContent:\n\n`.length;
    const remaining = SEARCH_OUTPUT_BUDGET - text.length - blockOverhead;
    if (remaining < MIN_CONTENT_BLOCK_CHARS) {
      omittedCount += 1;
      continue;
    }

    const trimmedExcerpt = truncateSnippet(candidate.content, remaining);
    if (trimmedExcerpt.length < MIN_CONTENT_BLOCK_CHARS) {
      omittedCount += 1;
      continue;
    }

    contentMap.set(candidate.index, trimmedExcerpt);
    const updatedBlocks = renderResultBlocks(contentMap);
    text = renderSearchDocument({
      provider: args.provider,
      servedDepth: args.servedDepth,
      notes,
      resultBlocks: updatedBlocks,
      contentMap,
      basicHint: args.servedDepth === "basic",
      omissionNote: undefined,
    });

    if (text.length > SEARCH_OUTPUT_BUDGET) {
      contentMap.delete(candidate.index);
      omittedCount += 1;
      const revertedBlocks = renderResultBlocks(contentMap);
      text = renderSearchDocument({
        provider: args.provider,
        servedDepth: args.servedDepth,
        notes,
        resultBlocks: revertedBlocks,
        contentMap,
        basicHint: args.servedDepth === "basic",
        omissionNote: undefined,
      });
    }
  }

  omittedCount += topContentCandidates.length - contentMap.size - omittedCount;

  const omissionUrl = topContentCandidates
    .map((candidate) => args.results[candidate.index]?.url)
    .find((url) => Boolean(url));
  const omissionNote =
    omittedCount > 0 && omissionUrl
      ? `[Full extracted content omitted for ${omittedCount} result${omittedCount === 1 ? "" : "s"} due to output budget. Use web_fetch on ${omissionUrl} to read more.]`
      : undefined;

  text = renderSearchDocument({
    provider: args.provider,
    servedDepth: args.servedDepth,
    notes,
    resultBlocks: renderResultBlocks(contentMap),
    contentMap,
    basicHint: args.servedDepth === "basic",
    omissionNote,
  });

  if (text.length > SEARCH_OUTPUT_BUDGET && omissionNote) {
    text = renderSearchDocument({
      provider: args.provider,
      servedDepth: args.servedDepth,
      notes,
      resultBlocks: renderResultBlocks(contentMap),
      contentMap,
      basicHint: false,
      omissionNote,
    });
  }

  if (text.length > SEARCH_OUTPUT_BUDGET) {
    return `${text.slice(0, SEARCH_OUTPUT_BUDGET - 3).trimEnd()}...`;
  }

  return text;
}

export function paginateContent(
  content: string,
  offset: number,
  maxChars = FETCH_DEFAULT_MAX_CHARS,
): PaginatedContent {
  const totalChars = content.length;

  if (offset >= totalChars) {
    return {
      text: "",
      offset,
      returnedChars: 0,
      totalChars,
      hasMore: false,
    };
  }

  const safeMaxChars = Math.max(1, Math.min(maxChars, 20_000));
  const desiredEnd = Math.min(offset + safeMaxChars, totalChars);
  const boundary = findSliceBoundary(content, offset, desiredEnd);
  const end = boundary > offset ? boundary : desiredEnd;
  const text = content.slice(offset, end).trim();
  const nextOffset = end < totalChars ? end : undefined;

  return {
    text,
    offset,
    returnedChars: text.length,
    totalChars,
    nextOffset,
    hasMore: end < totalChars,
  };
}

export function formatFetchContent(
  url: string,
  provider: FetchProviderName,
  chunk: PaginatedContent,
): string {
  const header = `## Content from ${url} (via ${providerLabel(provider)})`;

  if (chunk.offset >= chunk.totalChars) {
    return [
      header,
      "",
      `[Offset ${chunk.offset} is beyond the end of the document. Total content length: ${chunk.totalChars} characters.]`,
    ].join("\n");
  }

  const lines = [
    header,
    "",
    `[Showing chars ${chunk.offset}-${chunk.offset + chunk.returnedChars - 1} of ${chunk.totalChars}]`,
    "",
    chunk.text,
  ];

  if (chunk.hasMore && chunk.nextOffset !== undefined) {
    lines.push(
      "",
      `[More content available. Next chunk: web_fetch(url="${url}", offset=${chunk.nextOffset})]`,
    );
  }

  return lines.join("\n");
}

function collectSearchNotes(args: FormatSearchResultsArgs): string[] {
  const notes = [...(args.notes ?? [])];

  const freshnessNote = formatFreshnessNote(args.freshness, args.appliedFilters);
  if (freshnessNote) notes.push(freshnessNote);

  const domainNote = formatDomainNote(args.domains, args.appliedFilters);
  if (domainNote) notes.push(domainNote);

  if (args.requestedDepth !== args.servedDepth) {
    notes.push(`Depth: requested ${args.requestedDepth}, served ${args.servedDepth} (no content-capable provider)`);
  }

  return [...new Set(notes)];
}

function renderBaseResultBlock(
  result: SearchResult,
  rank: number,
  options?: { omitSnippet?: boolean },
): string {
  const lines = [`### ${rank}. ${result.title}`, `URL: ${result.url}`];

  const normalizedDate = normalizeIsoDate(result.publishedAt);
  if (normalizedDate) {
    lines.push(`Published: ${normalizedDate.slice(0, 10)}`);
  }

  if (options?.omitSnippet) {
    return lines.join("\n");
  }

  lines.push(`Snippet: ${truncateSnippet(result.snippet || "", 320) || "[No snippet available]"}`);
  return lines.join("\n");
}

function renderSearchDocument(args: {
  provider: string;
  servedDepth: string;
  notes: string[];
  resultBlocks: string[];
  contentMap: Map<number, string>;
  basicHint: boolean;
  omissionNote?: string;
}): string {
  const lines = [`## Search Results (via ${providerLabel(args.provider)}, ${args.servedDepth})`];

  if (args.notes.length > 0) {
    lines.push("");
    for (const note of args.notes) {
      lines.push(note);
    }
  }

  const renderedBlocks = args.resultBlocks.map((block, index) => {
    const content = args.contentMap.get(index);
    if (!content) return block;
    return `${block}\n\nContent:\n${content}`;
  });

  if (renderedBlocks.length > 0) {
    lines.push("", renderedBlocks.join("\n\n---\n\n"));
  } else {
    lines.push("", "[No results returned.]");
  }

  if (args.omissionNote) {
    lines.push("", args.omissionNote);
  }

  if (args.basicHint) {
    lines.push("", "_Use web_fetch on any URL above to read the full page content._");
  }

  return lines.join("\n");
}

function formatFreshnessNote(
  freshness: FormatSearchResultsArgs["freshness"],
  appliedFilters?: AppliedFilters,
): string | undefined {
  if (!freshness) return undefined;

  switch (appliedFilters?.freshness) {
    case "native":
      return `Freshness: ${freshness} (native)`;
    case "approximate":
      return `Freshness: ${freshness} (approximate)`;
    default:
      return `Freshness: ${freshness} (requested)`;
  }
}

function formatDomainNote(
  domains: string[] | undefined,
  appliedFilters?: AppliedFilters,
): string | undefined {
  if (!domains || domains.length === 0) return undefined;

  switch (appliedFilters?.domains) {
    case "native":
      return `Domains: ${domains.join(", ")} (native)`;
    case "query_rewrite":
      return `Domains: ${domains.join(", ")} (query rewrite)`;
    case "fanout_merge":
      return `Domains: ${domains.join(", ")} (fanout merge)`;
    default:
      return `Domains: ${domains.join(", ")} (requested)`;
  }
}

function findSliceBoundary(content: string, start: number, end: number): number {
  if (end >= content.length) return end;

  const minimumBoundary = start + Math.floor((end - start) * 0.6);
  const paragraphBoundary = content.lastIndexOf("\n\n", end);
  if (paragraphBoundary >= minimumBoundary) return paragraphBoundary;

  const lineBoundary = content.lastIndexOf("\n", end);
  if (lineBoundary >= minimumBoundary) return lineBoundary;

  return end;
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "brave":
      return "Brave";
    case "tavily":
      return "Tavily";
    case "exa":
      return "Exa";
    case "jina":
      return "Jina Reader";
    default:
      return provider;
  }
}
