import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

import { ensureMemoryRoots, pathIsInside } from "./storage.js";
import { formatIsoDate, parseMemoryFileSource } from "./parser.js";
import type {
  MemoryMoveRequest,
  MemoryMoveResult,
  MemoryInvalidationResult,
  MemoryRoots,
  MemoryScope,
  MemoryWritePlan,
  MemoryWriteRequest,
  MemoryWriteResult,
  ParsedEntry,
} from "./types.js";

export interface ManagedFs {
  lstat(filePath: string): Promise<{ isSymbolicLink(): boolean }>;
  mkdir(directory: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  realpath(filePath: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  stat(filePath: string): Promise<{ mtimeMs: number }>;
  unlink(filePath: string): Promise<void>;
  writeFile(filePath: string, content: string, encoding: BufferEncoding): Promise<void>;
}

const DEFAULT_SCOPE: MemoryScope = "project";
const MAX_BODY_LENGTH = 2_000;
const MEMORY_ID_PREFIX = "mem_";
const MEMORY_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KNOWN_SECRET_KEY_PATTERN = /(?:password|passwd|secret|api[_-]?key|token|access[_-]?key)/iu;

export async function writeMemoryEntry(
  roots: MemoryRoots,
  request: MemoryWriteRequest,
  options: {
    fsOps?: ManagedFs;
    now?: Date;
  } = {},
): Promise<MemoryWriteResult> {
  const fsOps = options.fsOps ?? createDefaultFs();
  const plan = planMemoryWrite(request);
  const scope = request.scope ?? DEFAULT_SCOPE;
  const updated = formatIsoDate(options.now ?? request.now ?? new Date());

  assertAllowedMemoryContent(request.content);
  if (plan.body.length > MAX_BODY_LENGTH) {
    throw new Error("Memory body exceeds 2,000 characters.");
  }

  await ensureMemoryRoots(roots);
  const topicsDir = await resolveManagedTopicsDir(roots, scope, fsOps);
  const filePath = path.join(topicsDir, plan.fileName);
  const entryId = generateMemoryId(options.now ?? request.now ?? new Date());
  const entryMarkdown = buildEntryMarkdown({
    id: entryId,
    heading: plan.heading,
    body: plan.body,
    status: "active",
    updated,
  });

  let createdTopic = false;
  await runQueuedWrite(filePath, async () => {
    const existingSource = await readOptionalFile(filePath, fsOps);
    createdTopic = existingSource === null;
    const nextSource =
      existingSource === null
        ? `# ${plan.title}\n\n${entryMarkdown}`
        : appendEntryToTopicFile(existingSource, entryMarkdown);

    await atomicWriteFile(filePath, nextSource, fsOps);
  });

  return {
    entryId,
    filePath,
    scope,
    heading: plan.heading,
    updated,
    createdTopic,
    topicFileName: plan.fileName,
  };
}

export async function moveMemoryEntry(
  roots: MemoryRoots,
  entry: ParsedEntry,
  request: MemoryMoveRequest,
  options: {
    fsOps?: ManagedFs;
  } = {},
): Promise<MemoryMoveResult> {
  const fsOps = options.fsOps ?? createDefaultFs();
  const targetTopic = request.targetTopic ?? path.basename(entry.filePath, ".md");
  const normalizedTargetTopic = normalizeTopic(targetTopic);
  const targetPlan = {
    fileName: `${slugifyTopic(normalizedTargetTopic)}.md`,
    title: deriveTopicTitle(normalizedTargetTopic),
  };

  await ensureMemoryRoots(roots);
  const targetTopicsDir = await resolveManagedTopicsDir(roots, request.targetScope, fsOps);
  const targetFilePath = path.join(targetTopicsDir, targetPlan.fileName);
  if (targetFilePath === entry.filePath) {
    throw new Error("Memory entry is already stored in that scope and topic.");
  }

  const moveTimestamp = request.now ?? new Date();
  let createdTopic = false;
  let syntheticIdBackfilled = false;
  let resolvedEntryId = entry.id;
  let resolvedHeading = entry.heading;
  let resolvedUpdated = entry.updated;

  await runQueuedWrites([entry.filePath, targetFilePath], async () => {
    const source = await fsOps.readFile(entry.filePath, "utf8");
    const sourceStats = await fsOps.stat(entry.filePath);
    const parsedSource = parseMemoryFileSource({
      filePath: entry.filePath,
      scope: entry.scope,
      source,
      fileMtimeMs: sourceStats.mtimeMs,
    });
    const currentEntry = parsedSource.entries.find((candidate) => candidate.id === entry.id);
    if (!currentEntry) {
      throw new Error(`Memory entry ${entry.id} no longer exists in ${entry.filePath}.`);
    }

    resolvedEntryId = currentEntry.syntheticId ? generateMemoryId(moveTimestamp) : currentEntry.id;
    syntheticIdBackfilled = currentEntry.syntheticId;
    resolvedHeading = currentEntry.heading;
    resolvedUpdated = currentEntry.updated;

    const targetSource = await readOptionalFile(targetFilePath, fsOps);
    createdTopic = targetSource === null;

    const movedEntry = patchMovedEntry(currentEntry.raw, {
      id: syntheticIdBackfilled ? resolvedEntryId : undefined,
      status: currentEntry.status,
      updated: currentEntry.updated,
    });
    const nextTargetSource =
      targetSource === null
        ? `# ${targetPlan.title}\n\n${normalizeStandaloneEntry(movedEntry)}`
        : appendEntryToTopicFile(targetSource, normalizeStandaloneEntry(movedEntry));
    const nextSource = removeEntryFromSource(source, currentEntry);

    await atomicWriteFile(targetFilePath, nextTargetSource, fsOps);

    try {
      if (parsedSource.entries.length === 1) {
        await fsOps.unlink(entry.filePath);
      } else {
        await atomicWriteFile(entry.filePath, nextSource, fsOps);
      }
    } catch (error) {
      await rollbackTargetWrite(targetFilePath, targetSource, fsOps);
      throw toError(error);
    }
  });

  return {
    entryId: resolvedEntryId,
    sourceFilePath: entry.filePath,
    sourceScope: entry.scope,
    targetFilePath,
    targetScope: request.targetScope,
    heading: resolvedHeading,
    updated: resolvedUpdated,
    createdTopic,
    targetTopicFileName: targetPlan.fileName,
    syntheticIdBackfilled,
  };
}

export async function invalidateMemoryEntry(
  roots: MemoryRoots,
  entry: ParsedEntry,
  options: {
    fsOps?: ManagedFs;
  } = {},
): Promise<MemoryInvalidationResult> {
  const fsOps = options.fsOps ?? createDefaultFs();
  const filePath = entry.filePath;
  const updated = entry.updated;
  let syntheticIdBackfilled = false;
  let resolvedEntryId = entry.id;

  await runQueuedWrite(filePath, async () => {
    const source = await fsOps.readFile(filePath, "utf8");
    const stats = await fsOps.stat(filePath);
    const parsed = parseMemoryFileSource({
      filePath,
      scope: entry.scope,
      source,
      fileMtimeMs: stats.mtimeMs,
    });
    const currentEntry = parsed.entries.find((candidate) => candidate.id === entry.id);

    if (!currentEntry) {
      throw new Error(`Memory entry ${entry.id} no longer exists in ${filePath}.`);
    }

    resolvedEntryId = currentEntry.syntheticId ? generateMemoryId(new Date()) : currentEntry.id;
    syntheticIdBackfilled = currentEntry.syntheticId;

    const rewrittenEntry = patchInvalidatedEntry(
      source.slice(currentEntry.rawStartOffset, currentEntry.rawEndOffset),
      {
        id: syntheticIdBackfilled ? resolvedEntryId : undefined,
        status: "invalid",
      },
    );
    const nextSource =
      source.slice(0, currentEntry.rawStartOffset) +
      rewrittenEntry +
      source.slice(currentEntry.rawEndOffset);

    await atomicWriteFile(filePath, nextSource, fsOps);
  });

  return {
    entryId: resolvedEntryId,
    filePath,
    scope: entry.scope,
    syntheticIdBackfilled,
    updated,
  };
}

export function planMemoryWrite(request: MemoryWriteRequest): MemoryWritePlan {
  const normalizedTopic = normalizeTopic(request.topic);
  const { heading, body } = extractEntryDraft(request.content);

  return {
    normalizedTopic,
    fileName: `${slugifyTopic(normalizedTopic)}.md`,
    title: deriveTopicTitle(normalizedTopic),
    heading,
    body,
  };
}

export function normalizeTopic(topic: string): string {
  return topic.normalize("NFC").trim();
}

export function slugifyTopic(topic: string): string {
  const slug = topic
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug || "topic";
}

export function deriveTopicTitle(topic: string): string {
  const collapsed = topic
    .replace(/[-_/]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (collapsed === "") return "Topic";
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

export function extractEntryDraft(content: string): { heading: string; body: string } {
  const trimmed = content.trim();
  if (trimmed === "") {
    throw new Error("Memory content cannot be empty.");
  }

  const lines = trimmed.split(/\r?\n/u);
  const headingLineIndex = lines.findIndex((line) => /^##(?:\s+|$)/u.test(line));

  if (headingLineIndex >= 0) {
    const headingLine = lines[headingLineIndex].replace(/^##\s*/u, "").trim();
    const body = lines
      .filter((_line, index) => index !== headingLineIndex)
      .join("\n")
      .trim();

    return {
      heading: headingLine || deriveHeadingFromSentence(trimmed).heading,
      body,
    };
  }

  return deriveHeadingFromSentence(trimmed);
}

export function buildEntryMarkdown(args: {
  id: string;
  heading: string;
  body: string;
  status: "active" | "invalid";
  updated: string;
}): string {
  const lines = [
    `## ${args.heading}`,
    `- ID: ${args.id}`,
    `- Status: ${args.status}`,
    `- Updated: ${args.updated}`,
  ];

  if (args.body.trim() === "") {
    return `${lines.join("\n")}\n\n`;
  }

  return `${lines.join("\n")}\n\n${args.body.trimEnd()}\n`;
}

export function assertAllowedMemoryContent(content: string): void {
  if (content.includes("-----BEGIN") || content.includes("-----END")) {
    throw new Error("Refusing to store obvious secrets in memory.");
  }

  for (const line of content.split(/\r?\n/u)) {
    if (
      /^\s*(?:export\s+)?[A-Za-z0-9_.-]*[A-Za-z0-9_.-]\s*[:=]\s*\S+/u.test(line) &&
      KNOWN_SECRET_KEY_PATTERN.test(line)
    ) {
      throw new Error("Refusing to store obvious secrets in memory.");
    }
  }
}

function createDefaultFs(): ManagedFs {
  return {
    lstat: fs.lstat,
    mkdir: async (directory, options) => {
      await fs.mkdir(directory, options);
    },
    readFile: fs.readFile,
    realpath: fs.realpath,
    rename: fs.rename,
    stat: fs.stat,
    unlink: fs.unlink,
    writeFile: fs.writeFile,
  };
}

async function resolveManagedTopicsDir(
  roots: MemoryRoots,
  scope: MemoryScope,
  fsOps: ManagedFs,
): Promise<string> {
  const configuredDirectory = roots.topicDirs[scope];
  await fsOps.mkdir(configuredDirectory, { recursive: true });
  const realDirectory = await fsOps.realpath(configuredDirectory);
  const realMemoryRoot = await fsOps.realpath(roots.memoryDir);

  if (!pathIsInside(realMemoryRoot, realDirectory)) {
    throw new Error(`Refusing to write outside the managed memory root: ${realDirectory}`);
  }

  return realDirectory;
}

async function readOptionalFile(filePath: string, fsOps: ManagedFs): Promise<string | null> {
  try {
    const stats = await fsOps.lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to write through a symbolic link: ${filePath}`);
    }
    return await fsOps.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw toError(error);
  }
}

async function atomicWriteFile(filePath: string, content: string, fsOps: ManagedFs): Promise<void> {
  const directory = path.dirname(filePath);
  const tempFilePath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );

  try {
    await fsOps.writeFile(tempFilePath, content, "utf8");
    await fsOps.rename(tempFilePath, filePath);
  } catch (error) {
    try {
      await fsOps.unlink(tempFilePath);
    } catch {
      // best effort cleanup
    }
    throw toError(error);
  }
}

async function runQueuedWrite(filePath: string, work: () => Promise<void>): Promise<void> {
  await withFileMutationQueue(filePath, work);
}

async function runQueuedWrites(filePaths: string[], work: () => Promise<void>): Promise<void> {
  const uniquePaths = [...new Set(filePaths)].sort((left, right) => left.localeCompare(right));
  let current = work;

  for (let index = uniquePaths.length - 1; index >= 0; index -= 1) {
    const filePath = uniquePaths[index];
    const next = current;
    current = () => runQueuedWrite(filePath, next);
  }

  await current();
}

function appendEntryToTopicFile(source: string, entryMarkdown: string): string {
  if (source === "") return entryMarkdown;
  if (source.endsWith("\n\n")) return `${source}${entryMarkdown}`;
  if (source.endsWith("\n")) return `${source}\n${entryMarkdown}`;
  return `${source}\n\n${entryMarkdown}`;
}

function patchMovedEntry(
  entryRaw: string,
  args: {
    id?: string;
    status: "active" | "invalid";
    updated: string;
  },
): string {
  let result = entryRaw;
  if (args.id !== undefined) {
    result = upsertMetadataLine(result, "ID", args.id);
  }

  result = upsertMetadataLine(result, "Status", args.status, {
    insertAfterKey: "ID",
  });

  return upsertMetadataLine(result, "Updated", args.updated, {
    insertAfterKey: "Status",
  });
}

function patchInvalidatedEntry(
  entryRaw: string,
  args: {
    id?: string;
    status: "active" | "invalid";
  },
): string {
  let result = entryRaw;
  if (args.id !== undefined) {
    result = upsertMetadataLine(result, "ID", args.id);
  }

  return upsertMetadataLine(result, "Status", args.status, {
    insertAfterKey: "ID",
  });
}

function upsertMetadataLine(
  entryRaw: string,
  key: string,
  value: string,
  options: {
    insertAfterKey?: string;
  } = {},
): string {
  const replacement = `- ${key}: ${value}`;
  const lineEnding = detectLineEnding(entryRaw);
  const existingLine = findMetadataLine(entryRaw, key);
  if (existingLine) {
    return (
      entryRaw.slice(0, existingLine.start) +
      `${replacement}${existingLine.lineEnding}` +
      entryRaw.slice(existingLine.end)
    );
  }

  const afterLine =
    options.insertAfterKey === undefined
      ? null
      : findMetadataLine(entryRaw, options.insertAfterKey);
  if (afterLine) {
    return (
      entryRaw.slice(0, afterLine.end) +
      `${replacement}${lineEnding}` +
      entryRaw.slice(afterLine.end)
    );
  }

  const firstMetadataLine = findFirstMetadataLine(entryRaw);
  if (firstMetadataLine) {
    return (
      entryRaw.slice(0, firstMetadataLine.start) +
      `${replacement}${lineEnding}` +
      entryRaw.slice(firstMetadataLine.start)
    );
  }

  const headingEndOffset = findHeadingLineEnd(entryRaw);
  return (
    entryRaw.slice(0, headingEndOffset) +
    `${replacement}${lineEnding}` +
    entryRaw.slice(headingEndOffset)
  );
}

function findMetadataLine(
  entryRaw: string,
  key: string,
): {
  start: number;
  end: number;
  lineEnding: string;
} | null {
  const pattern = new RegExp(`^- ${key}:[^\\r\\n]*(\\r\\n|\\n|\\r|$)`, "mu");
  const match = pattern.exec(entryRaw);
  if (match?.index === undefined) {
    return null;
  }

  return {
    start: match.index,
    end: match.index + match[0].length,
    lineEnding: match[1] ?? "",
  };
}

function findFirstMetadataLine(entryRaw: string): { start: number } | null {
  const match = /^- [^:\r\n]+:/mu.exec(entryRaw);
  if (match?.index === undefined) {
    return null;
  }

  return { start: match.index };
}

function findHeadingLineEnd(entryRaw: string): number {
  const headingMatch = /^##[^\r\n]*(?:\r\n|\n|\r|$)/u.exec(entryRaw);
  return headingMatch?.[0].length ?? 0;
}

function normalizeStandaloneEntry(entryRaw: string): string {
  return `${entryRaw.trimEnd()}\n`;
}

function removeEntryFromSource(source: string, entry: ParsedEntry): string {
  return source.slice(0, entry.rawStartOffset) + source.slice(entry.rawEndOffset);
}

async function rollbackTargetWrite(
  filePath: string,
  previousSource: string | null,
  fsOps: ManagedFs,
): Promise<void> {
  try {
    if (previousSource === null) {
      await fsOps.unlink(filePath);
      return;
    }

    await atomicWriteFile(filePath, previousSource, fsOps);
  } catch {
    // best effort rollback
  }
}

function detectLineEnding(value: string): string {
  const match = /\r\n|\n|\r/u.exec(value);
  return match?.[0] ?? "\n";
}

function deriveHeadingFromSentence(content: string): { heading: string; body: string } {
  const sentenceMatch = content.match(/^(.+?)([.!?](?:\s|$)|$)/su);
  const sentence = sentenceMatch?.[1]?.trim() ?? content.trim();
  const remainder = content.slice(sentenceMatch?.[0]?.length ?? content.length).trim();
  const collapsedHeading = sentence.replace(/\s+/gu, " ").trim();

  return {
    heading: collapsedHeading.slice(0, 120) || "Memory",
    body: remainder,
  };
}

function generateMemoryId(now: Date): string {
  const timestamp = now.getTime();
  let encodedTime = "";
  let remainingTime = timestamp;
  for (let index = 0; index < 10; index += 1) {
    encodedTime = MEMORY_ID_ALPHABET[remainingTime % 32] + encodedTime;
    remainingTime = Math.floor(remainingTime / 32);
  }

  const random = randomBytes(16);
  let encodedRandom = "";
  let bitBuffer = 0;
  let bitCount = 0;

  for (const byte of random) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5 && encodedRandom.length < 16) {
      bitCount -= 5;
      encodedRandom += MEMORY_ID_ALPHABET[(bitBuffer >>> bitCount) & 31];
    }
  }

  while (encodedRandom.length < 16) {
    encodedRandom += MEMORY_ID_ALPHABET[randomBytes(1)[0] % 32];
  }

  return `${MEMORY_ID_PREFIX}${encodedTime}${encodedRandom}`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
