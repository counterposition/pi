import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  MemoryScope,
  MemorySourceKind,
  MemoryWarning,
  ParsedEntry,
  ParsedMemoryFile,
  ParsedMetadataPair,
} from "./types.js";

interface LineInfo {
  text: string;
  startOffset: number;
  endOffset: number;
}

const DATE_FILE_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/u;

export async function parseMemoryFile(
  filePath: string,
  scope: MemoryScope,
): Promise<ParsedMemoryFile> {
  const [buffer, stats] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);

  if (buffer.includes(0)) {
    return {
      filePath,
      scope,
      sourceKind: detectSourceKind(filePath),
      preamble: "",
      entries: [],
      warnings: [
        {
          code: "binary-file",
          message: `Skipping non-Markdown content in ${filePath}.`,
          filePath,
        },
      ],
      fileMtimeMs: stats.mtimeMs,
    };
  }

  return parseMemoryFileSource({
    filePath,
    scope,
    source: buffer.toString("utf8"),
    fileMtimeMs: stats.mtimeMs,
  });
}

export function parseMemoryFileSource(args: {
  filePath: string;
  scope: MemoryScope;
  source: string;
  fileMtimeMs: number;
}): ParsedMemoryFile {
  const lines = collectLines(args.source);
  const boundaries = findEntryBoundaries(lines);
  const preambleEndOffset =
    boundaries.length > 0 ? lines[boundaries[0]].startOffset : args.source.length;
  const preamble = args.source.slice(0, preambleEndOffset);
  const sourceKind = detectSourceKind(args.filePath);
  const warnings: MemoryWarning[] = [];
  const parsedEntries: ParsedEntry[] = [];

  for (let index = 0; index < boundaries.length; index += 1) {
    const startLineIndex = boundaries[index];
    const nextBoundaryLineIndex = boundaries[index + 1] ?? lines.length;
    const sectionStartOffset = lines[startLineIndex].startOffset;
    const sectionEndOffset =
      nextBoundaryLineIndex < lines.length
        ? lines[nextBoundaryLineIndex].startOffset
        : args.source.length;
    const headingLine = lines[startLineIndex];
    const heading = extractHeadingText(headingLine.text);
    const metadataPairs: ParsedMetadataPair[] = [];
    let scanLineIndex = startLineIndex + 1;
    let metadataStarted = false;

    while (scanLineIndex < nextBoundaryLineIndex) {
      const line = lines[scanLineIndex];
      const trimmed = line.text.trim();
      if (!metadataStarted && trimmed === "") {
        scanLineIndex += 1;
        continue;
      }

      const parsedMetadata = parseMetadataLine(line.text);
      if (parsedMetadata) {
        metadataStarted = true;
        metadataPairs.push(parsedMetadata);
        scanLineIndex += 1;
        continue;
      }

      if (metadataStarted && trimmed === "") {
        scanLineIndex += 1;
        continue;
      }

      break;
    }

    const bodyStartOffset =
      metadataStarted && scanLineIndex < lines.length
        ? lines[scanLineIndex].startOffset
        : metadataStarted
          ? sectionEndOffset
          : headingLine.endOffset;
    const body = args.source.slice(bodyStartOffset, sectionEndOffset);
    const metadata = Object.fromEntries(
      metadataPairs.map((pair) => [pair.normalizedKey, pair.value]),
    ) as Record<string, string>;
    const entryWarnings: MemoryWarning[] = [];
    const updated = resolveUpdatedValue({
      filePath: args.filePath,
      fileMtimeMs: args.fileMtimeMs,
      metadata,
      sourceKind,
      warnings: entryWarnings,
    });
    const status = resolveStatusValue(metadata, args.filePath, heading, entryWarnings);
    const id = resolveIdValue(args.filePath, heading, metadata, entryWarnings);

    parsedEntries.push({
      id,
      syntheticId: !("id" in metadata),
      scope: args.scope,
      sourceKind,
      filePath: args.filePath,
      heading,
      body,
      bodyText: body.trim(),
      status,
      updated,
      updatedAt: parseIsoDateToUtcMs(updated),
      metadata,
      metadataPairs,
      lineSpan: {
        start: startLineIndex + 1,
        end: nextBoundaryLineIndex,
      },
      raw: args.source.slice(sectionStartOffset, sectionEndOffset),
      rawStartOffset: sectionStartOffset,
      rawEndOffset: sectionEndOffset,
      afterHeadingOffset: headingLine.endOffset,
      bodyStartOffset,
      fileMtimeMs: args.fileMtimeMs,
    });

    warnings.push(...entryWarnings);
  }

  const dedupedEntries = dedupeWithinFile(parsedEntries, warnings, args.filePath);

  return {
    filePath: args.filePath,
    scope: args.scope,
    sourceKind,
    preamble,
    entries: dedupedEntries,
    warnings,
    fileMtimeMs: args.fileMtimeMs,
  };
}

export function mergeParsedEntries(entries: ParsedEntry[]): {
  entries: ParsedEntry[];
  warnings: MemoryWarning[];
} {
  const winnerById = new Map<string, ParsedEntry>();
  const warnings: MemoryWarning[] = [];

  for (const entry of entries) {
    const existing = winnerById.get(entry.id);
    if (!existing) {
      winnerById.set(entry.id, entry);
      continue;
    }

    if (
      entry.fileMtimeMs > existing.fileMtimeMs ||
      (entry.fileMtimeMs === existing.fileMtimeMs &&
        entry.filePath.localeCompare(existing.filePath) > 0)
    ) {
      winnerById.set(entry.id, entry);
      warnings.push({
        code: "duplicate-id-across-files",
        message: `Duplicate entry ID ${entry.id} appears in multiple files; keeping ${entry.filePath}.`,
        filePath: entry.filePath,
        entryId: entry.id,
      });
      continue;
    }

    warnings.push({
      code: "duplicate-id-across-files",
      message: `Duplicate entry ID ${entry.id} appears in multiple files; keeping ${existing.filePath}.`,
      filePath: existing.filePath,
      entryId: entry.id,
    });
  }

  return {
    entries: [...winnerById.values()],
    warnings,
  };
}

export function formatIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function parseIsoDateToUtcMs(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return 0;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    Number.isNaN(timestamp) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return 0;
  }

  return timestamp;
}

function collectLines(source: string): LineInfo[] {
  const lines: LineInfo[] = [];

  for (const match of source.matchAll(/.*(?:\r\n|\n|\r|$)/gu)) {
    const raw = match[0];
    if (raw === "") continue;
    const startOffset = match.index ?? 0;
    const endOffset = startOffset + raw.length;
    const text = raw.replace(/(?:\r\n|\n|\r)$/u, "");
    lines.push({ text, startOffset, endOffset });
  }

  return lines;
}

function findEntryBoundaries(lines: LineInfo[]): number[] {
  const boundaries: number[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmedStart = line.text.trimStart();

    if (!inFence && /^##(?:\s+|$)/u.test(line.text)) {
      boundaries.push(index);
    }

    if (trimmedStart.startsWith("```")) {
      inFence = !inFence;
    }
  }

  return boundaries;
}

function extractHeadingText(line: string): string {
  return line.replace(/^##\s*/u, "").trim();
}

function parseMetadataLine(line: string): ParsedMetadataPair | null {
  if (!line.startsWith("- ")) return null;

  const body = line.slice(2);
  const separatorIndex = body.indexOf(": ");
  if (separatorIndex <= 0) return null;

  const key = body.slice(0, separatorIndex).trim();
  if (key === "") return null;

  return {
    key,
    normalizedKey: key.toLowerCase(),
    value: body.slice(separatorIndex + 2).trim(),
  };
}

function resolveUpdatedValue(args: {
  filePath: string;
  fileMtimeMs: number;
  metadata: Readonly<Record<string, string>>;
  sourceKind: MemorySourceKind;
  warnings: MemoryWarning[];
}): string {
  const metadataUpdated = args.metadata.updated;
  if (metadataUpdated) {
    const parsed = parseIsoDateToUtcMs(metadataUpdated);
    if (parsed > 0) return metadataUpdated;
  }

  if (args.sourceKind === "inbox" && DATE_FILE_NAME_PATTERN.test(path.basename(args.filePath))) {
    return path.basename(args.filePath, ".md");
  }

  const fallback = formatIsoDate(new Date(args.fileMtimeMs));
  args.warnings.push({
    code: "missing-updated",
    message: `Missing or invalid Updated metadata in ${args.filePath}; defaulting to ${fallback}.`,
    filePath: args.filePath,
  });
  return fallback;
}

function resolveStatusValue(
  metadata: Readonly<Record<string, string>>,
  filePath: string,
  heading: string,
  warnings: MemoryWarning[],
): "active" | "invalid" {
  const status = metadata.status?.toLowerCase();
  if (status === "active" || status === "invalid") {
    return status;
  }

  warnings.push({
    code: "missing-status",
    message: `Missing or invalid Status metadata for "${heading}" in ${filePath}; defaulting to active.`,
    filePath,
  });
  return "active";
}

function resolveIdValue(
  filePath: string,
  heading: string,
  metadata: Readonly<Record<string, string>>,
  warnings: MemoryWarning[],
): string {
  const id = metadata.id?.trim();
  if (id) return id;

  const normalizedPath = filePath.normalize("NFC").replace(/\\/g, "/");
  const syntheticId = `synthetic_${createHash("sha256")
    .update(`${normalizedPath}\n${heading.normalize("NFC")}`)
    .digest("hex")
    .slice(0, 24)}`;

  warnings.push({
    code: "missing-id",
    message: `Missing ID metadata for "${heading}" in ${filePath}; using synthetic ID ${syntheticId}.`,
    filePath,
    entryId: syntheticId,
  });

  return syntheticId;
}

function detectSourceKind(filePath: string): MemorySourceKind {
  return /(?:^|[/\\])inbox(?:[/\\])/u.test(filePath) ? "inbox" : "topic";
}

function dedupeWithinFile(
  entries: ParsedEntry[],
  warnings: MemoryWarning[],
  filePath: string,
): ParsedEntry[] {
  const lastIndexById = new Map<string, number>();

  for (let index = 0; index < entries.length; index += 1) {
    lastIndexById.set(entries[index].id, index);
  }

  const duplicateIds = new Set<string>();
  const filtered = entries.filter((entry, index) => {
    const keep = lastIndexById.get(entry.id) === index;
    if (!keep) duplicateIds.add(entry.id);
    return keep;
  });

  for (const duplicateId of duplicateIds) {
    warnings.push({
      code: "duplicate-id-in-file",
      message: `Duplicate entry ID ${duplicateId} in ${filePath}; keeping the last entry.`,
      filePath,
      entryId: duplicateId,
    });
  }

  return filtered;
}
