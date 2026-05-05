import { CustomMessageComponent } from "@mariozechner/pi-coding-agent";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionCommandContext,
  MessageRenderer,
  ToolCallEvent,
  ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

import {
  formatForgetCandidate,
  formatForgetCandidates,
  formatMemoryStatus,
} from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { resolveProjectIdentity } from "../src/identity.js";
import { mergeParsedEntries, parseMemoryFile } from "../src/parser.js";
import { buildInjectedPrompt, buildOrientationSummary } from "../src/prompt.js";
import { entryToSearchResult, formatSearchResultsText, searchEntries } from "../src/search.js";
import {
  ensureMemoryRoots,
  getMemoryStatusSummary,
  getTopicNames,
  isManagedToolPath,
  listTopicFiles,
  resolveMemoryRoots,
} from "../src/storage.js";
import {
  extractEntryDraft,
  invalidateMemoryEntry,
  moveMemoryEntry,
  writeMemoryEntry,
} from "../src/write-path.js";
import type {
  MemoryConfig,
  MemoryRoots,
  MemoryScope,
  MemorySearchResult,
  OrientationSummary,
  ParsedEntry,
  ProjectIdentity,
} from "../src/types.js";

interface RuntimeState {
  cwd: string;
  config: MemoryConfig;
  identity: ProjectIdentity;
  roots: MemoryRoots;
  orientation: OrientationSummary;
}

type MemoryCommandUi = Partial<
  Pick<ExtensionCommandContext["ui"], "confirm" | "editor" | "input" | "notify" | "select">
>;

interface MemoryCommandContext {
  cwd: string;
  hasUI?: boolean;
  ui?: MemoryCommandUi;
}

const MEMORY_PROMPT_PREFIX =
  "Durable memory is available through memory_search, memory_write, and memory_move.";
const MEMORY_COMMAND_MESSAGE_TYPE = "pi-memory-command";
const MEMORY_COMMAND_MESSAGE_LABEL = "Memory";

interface MemoryCommandDetails {
  command: string;
}

type ResolvedCommandText =
  | { kind: "value"; text: string }
  | { kind: "missing" }
  | { kind: "cancelled" };

export default function (pi: ExtensionAPI) {
  let runtime: RuntimeState | null = null;

  pi.registerMessageRenderer<MemoryCommandDetails>(
    MEMORY_COMMAND_MESSAGE_TYPE,
    renderMemoryCommandMessage,
  );

  pi.on("session_start", async (_event, ctx) => {
    runtime = await initializeRuntime(ctx.cwd);
  });

  pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
    const currentRuntime = await ensureRuntime(ctx.cwd);
    if (!currentRuntime.config.enabled) return;

    return {
      systemPrompt: mergeSystemPrompt(
        event.systemPrompt,
        buildInjectedPrompt(currentRuntime.orientation),
      ),
    } satisfies BeforeAgentStartEventResult;
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | void> => {
    const currentRuntime = await ensureRuntime(ctx.cwd);
    if (!currentRuntime.config.enabled) return;
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const filePath = extractToolPath(event.input);
    if (!filePath) return;

    if (isManagedToolPath(filePath, ctx.cwd, currentRuntime.roots)) {
      return {
        block: true,
        reason:
          "Direct write/edit calls into the managed memory store are blocked. Use memory_write instead.",
      };
    }
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search durable memory across global and project scopes. Returns ranked entry results with IDs, paths, line spans, dates, and excerpts.",
    promptSnippet:
      "memory_search: search explicit durable Markdown memory on demand; returns IDs, scopes, dates, paths, and excerpts.",
    promptGuidelines: [
      "`memory_search`: Search memory only when prior-session durable facts may matter and the current conversation or repository cannot answer directly.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language or keyword query." }),
      scope: Type.Optional(
        StringEnum(["global", "project", "all"] as const, {
          default: "all",
          description: "Which memory scope to search. Defaults to all.",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          default: 10,
          minimum: 1,
          maximum: 50,
          description: "Maximum number of matching memories to return. Defaults to 10.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const currentRuntime = await ensureRuntime(resolveRuntimeCwd(ctx, runtime));
      ensureEnabled(currentRuntime);

      const loaded = await loadEntries(currentRuntime.roots, params.scope ?? "all");
      const response = searchEntries(loaded.entries, {
        query: params.query,
        scope: params.scope ?? "all",
        maxResults: params.max_results ?? 10,
      });

      return {
        content: [
          {
            type: "text",
            text: formatSearchResultsText(response.results),
          },
        ],
        details: {
          warnings: [...currentRuntime.config.warnings, ...loaded.warnings, ...response.warnings],
          results: response.results,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_write",
    label: "Memory Write",
    description:
      "Persist an explicit durable memory note into a topic file. Use only when the user explicitly asks to remember or persist something.",
    promptSnippet:
      "memory_write: store an explicit durable memory note in a managed global or project topic file.",
    promptGuidelines: [
      "`memory_write`: Use only for explicit user requests to remember durable preferences, conventions, constraints, or findings; never store secrets or transient task state.",
    ],
    parameters: Type.Object({
      content: Type.String({
        description:
          "Memory content. The first level-2 heading becomes the entry heading; otherwise the heading is derived from the first sentence.",
      }),
      topic: Type.String({
        description: "Logical topic name, not a file path.",
      }),
      scope: Type.Optional(
        StringEnum(["global", "project"] as const, {
          default: "project",
          description: "Memory scope. Defaults to project.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const currentRuntime = await ensureRuntime(resolveRuntimeCwd(ctx, runtime));
      ensureEnabled(currentRuntime);

      const result = await writeMemoryEntry(currentRuntime.roots, {
        content: params.content,
        topic: params.topic,
        scope: params.scope ?? "project",
      });
      runtime = await refreshOrientation(currentRuntime);

      return {
        content: [
          {
            type: "text",
            text: `Stored memory ${result.entryId} in ${result.scope} scope at ${result.filePath}.`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "memory_move",
    label: "Memory Move",
    description:
      "Move an existing memory entry into a different scope or topic without leaving a duplicate behind.",
    promptSnippet:
      "memory_move: relocate an existing memory entry by ID while preserving the managed memory record.",
    promptGuidelines: [
      "`memory_move`: Use when an existing memory belongs in a different scope or topic; do not copy it with `memory_write` and leave the old entry behind.",
    ],
    parameters: Type.Object({
      entry_id: Type.String({
        description: "Existing memory entry ID to move.",
      }),
      scope: StringEnum(["global", "project"] as const, {
        description: "Destination memory scope.",
      }),
      topic: Type.Optional(
        Type.String({
          description: "Optional destination topic. Defaults to the current topic name.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const currentRuntime = await ensureRuntime(resolveRuntimeCwd(ctx, runtime));
      ensureEnabled(currentRuntime);

      const loaded = await loadEntries(currentRuntime.roots, "all");
      const entry = requireEntry(loaded.entries, params.entry_id);
      const result = await moveMemoryEntry(currentRuntime.roots, entry, {
        targetScope: params.scope,
        targetTopic: params.topic,
      });
      runtime = await refreshOrientation(currentRuntime);

      return {
        content: [
          {
            type: "text",
            text:
              `Moved memory ${result.entryId} from ${result.sourceScope} to ` +
              `${result.targetScope} scope at ${result.targetFilePath}.`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerCommand("memory", {
    description: "Show memory status and storage locations.",
    async handler(_args, ctx) {
      const resolvedContext = ctx as MemoryCommandContext;
      const currentRuntime = await ensureRuntime(resolvedContext.cwd);
      if (!currentRuntime.config.enabled) {
        emitCommandOutput(pi, "memory", "Memory is disabled in global Pi settings.");
        return;
      }

      const status = await getMemoryStatusSummary(currentRuntime.roots);
      emitCommandOutput(
        pi,
        "memory",
        formatMemoryStatus({
          status,
          orientation: currentRuntime.orientation,
          identity: currentRuntime.identity,
          warnings: currentRuntime.config.warnings,
        }),
      );
    },
  });

  pi.registerCommand("remember", {
    description: "Persist an explicit durable memory note.",
    async handler(args, ctx) {
      const resolvedContext = ctx as MemoryCommandContext;
      const currentRuntime = await ensureRuntime(resolvedContext.cwd);
      ensureEnabled(currentRuntime);

      const resolvedContent = await resolveRememberContent(args, resolvedContext);
      if (resolvedContent.kind === "missing") {
        emitCommandOutput(pi, "remember", "Usage: /remember <text>");
        return;
      }
      if (resolvedContent.kind === "cancelled") {
        emitCommandOutput(pi, "remember", "Cancelled.");
        return;
      }

      const destination = await resolveRememberDestination(
        resolvedContent.text,
        currentRuntime,
        resolvedContext,
      );
      if (destination === null) {
        emitCommandOutput(pi, "remember", "Cancelled.");
        return;
      }

      const result = await writeMemoryEntry(currentRuntime.roots, {
        content: resolvedContent.text,
        topic: destination.topic,
        scope: destination.scope,
      });
      runtime = await refreshOrientation(currentRuntime);

      const message =
        `Stored memory ${result.entryId} in ${result.scope} scope ` +
        `under topic "${destination.topic}" at ${result.filePath}.`;
      resolvedContext.ui?.notify?.(message, "info");
      emitCommandOutput(pi, "remember", message);
    },
  });

  pi.registerCommand("forget", {
    description: "Find matching memories and mark one as invalid.",
    async handler(args, ctx) {
      const resolvedContext = ctx as MemoryCommandContext;
      const currentRuntime = await ensureRuntime(resolvedContext.cwd);
      ensureEnabled(currentRuntime);

      const resolvedQuery = await resolveForgetQuery(args, resolvedContext);
      if (resolvedQuery.kind === "missing") {
        emitCommandOutput(pi, "forget", "Usage: /forget <query>");
        return;
      }
      if (resolvedQuery.kind === "cancelled") {
        emitCommandOutput(pi, "forget", "Cancelled.");
        return;
      }

      const loaded = await loadEntries(currentRuntime.roots, "all");
      const results = findForgetCandidates(loaded.entries, resolvedQuery.text);

      if (results.length === 0) {
        emitCommandOutput(pi, "forget", "No matching memories.");
        return;
      }

      if (!resolvedContext.hasUI || !resolvedContext.ui) {
        emitCommandOutput(pi, "forget", formatForgetCandidates(results));
        return;
      }

      if (results.length === 1) {
        const target = results[0];
        const confirmed = await resolvedContext.ui.confirm?.(
          "Forget memory?",
          formatForgetCandidate(target),
        );
        if (!confirmed) {
          emitCommandOutput(pi, "forget", "Cancelled.");
          return;
        }

        const entry = requireEntry(loaded.entries, target.id);
        const result = await invalidateMemoryEntry(currentRuntime.roots, entry);
        const message = `Invalidated ${result.entryId}.`;
        resolvedContext.ui.notify?.(message, "info");
        emitCommandOutput(pi, "forget", message);
        return;
      }

      const options = results.map(
        (result, index) => `${index + 1}. [${result.scope}] ${result.heading} (${result.id})`,
      );
      const selection = await resolvedContext.ui.select?.("Select a memory to invalidate:", [
        ...options,
        "Cancel",
      ]);
      if (!selection || selection === "Cancel") {
        emitCommandOutput(pi, "forget", "Cancelled.");
        return;
      }

      const selectedIndex = options.indexOf(selection);
      if (selectedIndex < 0) {
        emitCommandOutput(pi, "forget", "Cancelled.");
        return;
      }

      const target = results[selectedIndex];
      const confirmed = await resolvedContext.ui.confirm?.(
        "Forget memory?",
        formatForgetCandidate(target),
      );
      if (!confirmed) {
        emitCommandOutput(pi, "forget", "Cancelled.");
        return;
      }

      const entry = requireEntry(loaded.entries, target.id);
      const result = await invalidateMemoryEntry(currentRuntime.roots, entry);
      const message = `Invalidated ${result.entryId}.`;
      resolvedContext.ui.notify?.(message, "info");
      emitCommandOutput(pi, "forget", message);
    },
  });

  async function initializeRuntime(cwd: string): Promise<RuntimeState> {
    const config = loadConfig(cwd);
    const identity = resolveProjectIdentity(cwd);
    const roots = resolveMemoryRoots(config.agentDir, identity);
    if (config.enabled) {
      await ensureMemoryRoots(roots);
    }

    const orientation = config.enabled
      ? buildOrientationSummary(await getTopicNames(roots, "all"))
      : buildOrientationSummary([]);

    return {
      cwd,
      config,
      identity,
      roots,
      orientation,
    };
  }

  async function ensureRuntime(cwd: string): Promise<RuntimeState> {
    if (runtime && runtime.cwd === cwd) return runtime;
    runtime = await initializeRuntime(cwd);
    return runtime;
  }

  async function refreshOrientation(currentRuntime: RuntimeState): Promise<RuntimeState> {
    return {
      ...currentRuntime,
      orientation: buildOrientationSummary(await getTopicNames(currentRuntime.roots, "all")),
    };
  }
}

async function loadEntries(
  roots: MemoryRoots,
  scope: "all" | "global" | "project",
): Promise<{ entries: ParsedEntry[]; warnings: string[] }> {
  const files = await listTopicFiles(roots, scope);
  const parsedFiles = await Promise.all(
    files.map(({ filePath, scope: fileScope }) => parseMemoryFile(filePath, fileScope)),
  );
  const merged = mergeParsedEntries(parsedFiles.flatMap((parsedFile) => parsedFile.entries));

  return {
    entries: merged.entries,
    warnings: [...parsedFiles.flatMap((parsedFile) => parsedFile.warnings), ...merged.warnings].map(
      (warning) => warning.message,
    ),
  };
}

function extractToolPath(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;

  const record = input as Record<string, unknown>;
  const candidate = record.file_path ?? record.path;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : null;
}

function getCwd(ctx: unknown): string {
  if (typeof ctx === "object" && ctx !== null && "cwd" in ctx && typeof ctx.cwd === "string") {
    return ctx.cwd;
  }

  return process.cwd();
}

function resolveRuntimeCwd(ctx: unknown, runtime: RuntimeState | null): string {
  if (ctx !== undefined) {
    return getCwd(ctx);
  }

  return runtime?.cwd ?? process.cwd();
}

function ensureEnabled(runtime: RuntimeState): void {
  if (!runtime.config.enabled) {
    throw new Error("Memory is disabled in global Pi settings.");
  }
}

function mergeSystemPrompt(basePrompt: string, injectedPrompt: string): string {
  if (basePrompt.includes(MEMORY_PROMPT_PREFIX)) {
    return basePrompt;
  }

  if (basePrompt.trim() === "") {
    return injectedPrompt;
  }

  return `${basePrompt.trimEnd()}\n\n${injectedPrompt}`;
}

const renderMemoryCommandMessage: MessageRenderer<MemoryCommandDetails> = (message) =>
  new CustomMessageComponent({
    ...message,
    customType: MEMORY_COMMAND_MESSAGE_LABEL,
  });

function emitCommandOutput(pi: ExtensionAPI, command: string, message: string): void {
  pi.sendMessage({
    customType: MEMORY_COMMAND_MESSAGE_TYPE,
    content: message,
    display: true,
    details: {
      command,
    },
  });
}

function requireEntry(entries: ParsedEntry[], entryId: string): ParsedEntry {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    throw new Error(`Memory entry ${entryId} no longer exists.`);
  }
  return entry;
}

function findForgetCandidates(entries: ParsedEntry[], query: string): MemorySearchResult[] {
  const trimmed = query.trim();
  const directMatch = entries.find((entry) => entry.id.toLowerCase() === trimmed.toLowerCase());
  if (directMatch) {
    return [entryToSearchResult(directMatch)];
  }

  return searchEntries(entries, {
    query: trimmed,
    scope: "all",
    maxResults: Number.MAX_SAFE_INTEGER,
  }).results;
}

async function resolveForgetQuery(
  args: string,
  ctx: MemoryCommandContext,
): Promise<ResolvedCommandText> {
  const trimmed = args.trim();
  if (trimmed !== "") {
    return { kind: "value", text: trimmed };
  }

  if (!ctx.hasUI || !ctx.ui?.input) {
    return { kind: "missing" };
  }

  const input = await ctx.ui.input("What should Pi forget?", "");
  if (input === undefined) {
    return { kind: "cancelled" };
  }

  const query = input.trim();
  if (query === "") {
    return { kind: "missing" };
  }

  return { kind: "value", text: query };
}

async function resolveRememberContent(
  args: string,
  ctx: MemoryCommandContext,
): Promise<ResolvedCommandText> {
  const trimmed = args.trim();
  if (trimmed !== "") return { kind: "value", text: trimmed };

  if (!ctx.hasUI || !ctx.ui) {
    return { kind: "missing" };
  }

  const editorResult = await ctx.ui.editor?.("What should Pi remember?", "");
  const candidate = editorResult?.trim();
  if (candidate) return { kind: "value", text: candidate };

  if (!ctx.ui.input) {
    return { kind: "missing" };
  }

  const inputResult = await ctx.ui.input("What should Pi remember?", "");
  if (inputResult === undefined) {
    return { kind: "cancelled" };
  }

  const fallback = inputResult?.trim();
  if (fallback) {
    return { kind: "value", text: fallback };
  }

  return { kind: "missing" };
}

async function resolveRememberDestination(
  content: string,
  runtime: RuntimeState,
  ctx: MemoryCommandContext,
): Promise<{ scope: MemoryScope; topic: string } | null> {
  const inferredScope: MemoryScope = "project";
  const projectTopics = await getTopicNames(runtime.roots, inferredScope);
  const knownTopics = [...new Set([...projectTopics, ...runtime.orientation.topicNames])];
  const rankedTopics = rankRememberTopics(content, knownTopics);
  const fallbackTopic = deriveFallbackTopic(content);
  const suggestedTopic = inferRememberTopic(rankedTopics) ?? fallbackTopic;

  if (!ctx.hasUI || !ctx.ui) {
    return { scope: inferredScope, topic: suggestedTopic };
  }

  if (!shouldOfferExistingTopicPicker(rankedTopics)) {
    const createdTopic = await promptForNewTopicName(ctx, suggestedTopic);
    if (createdTopic === null) {
      return ctx.ui.input ? null : { scope: inferredScope, topic: suggestedTopic };
    }
    return { scope: inferredScope, topic: createdTopic };
  }

  const options = [
    ...rankedTopics.slice(0, 3).map((candidate) => `Use topic: ${candidate.topic}`),
    "New topic...",
    "Cancel",
  ];
  const select = ctx.ui.select;
  if (!select) {
    return { scope: inferredScope, topic: suggestedTopic };
  }

  while (true) {
    const selection = await select("Where should Pi file this memory?", options);
    if (!selection || selection === "Cancel") {
      return null;
    }

    if (selection === "New topic...") {
      const createdTopic = await promptForNewTopicName(ctx, fallbackTopic);
      if (createdTopic === null) {
        continue;
      }
      return { scope: inferredScope, topic: createdTopic };
    }

    return { scope: inferredScope, topic: selection.replace(/^Use topic:\s*/u, "") };
  }
}

function inferRememberTopic(rankedTopics: Array<{ topic: string; score: number }>): string | null {
  const [bestCandidate] = rankedTopics;
  return bestCandidate?.topic ?? null;
}

function rankRememberTopics(
  content: string,
  topicNames: string[],
): Array<{ topic: string; score: number }> {
  const draft = extractEntryDraft(content);
  const normalizedContent = normalizeTopicText(`${draft.heading}\n${draft.body}`);
  const contentTokens = collectTopicTokens(normalizedContent);

  return [...new Set(topicNames)]
    .map((topic) => {
      const topicText = normalizeTopicText(topic);
      const topicTokens = collectTopicTokens(topicText);
      let score = 0;

      if (normalizedContent.includes(topicText)) {
        score += 6;
      }

      for (const token of topicTokens) {
        if (contentTokens.has(token)) {
          score += 3;
        }
      }

      return { topic, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.topic.localeCompare(right.topic));
}

function deriveFallbackTopic(content: string): string {
  const heading = extractEntryDraft(content).heading;
  const normalizedHeading = normalizeTopicText(heading);
  const tokens = [...collectTopicTokens(normalizedHeading)];

  if (tokens.some((token) => ["goal", "goals", "roadmap", "vision", "milestone"].includes(token))) {
    return "goals";
  }

  if (
    tokens.some((token) =>
      ["prefer", "default", "style", "tone", "always", "never", "response"].includes(token),
    )
  ) {
    return "preferences";
  }

  if (tokens.length === 0) {
    return "general";
  }

  return tokens.slice(0, 3).join(" ");
}

function shouldOfferExistingTopicPicker(
  rankedTopics: Array<{ topic: string; score: number }>,
): boolean {
  const [bestCandidate, secondCandidate] = rankedTopics;
  if (!bestCandidate || bestCandidate.score < MIN_EXISTING_TOPIC_SCORE) {
    return false;
  }
  if (!secondCandidate) {
    return true;
  }

  return bestCandidate.score - secondCandidate.score >= MIN_EXISTING_TOPIC_MARGIN;
}

async function promptForNewTopicName(
  ctx: MemoryCommandContext,
  suggestedTopic: string,
): Promise<string | null> {
  const trimmedSuggestion = suggestedTopic.trim();
  if (!ctx.ui?.input) {
    return trimmedSuggestion || null;
  }

  const input = await ctx.ui.input("Topic name:", trimmedSuggestion);
  const trimmedInput = input?.trim();
  return trimmedInput ? trimmedInput : null;
}

function collectTopicTokens(value: string): Set<string> {
  const tokens = new Set<string>();

  for (const segment of value.split(/[^a-z0-9]+/u)) {
    const token = stemTopicToken(segment);
    if (token === "" || REMEMBER_TOPIC_STOPWORDS.has(token)) continue;
    tokens.add(token);
  }

  return tokens;
}

function normalizeTopicText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

function stemTopicToken(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.length < 3) return "";

  for (const suffix of ["ences", "ence", "ments", "ment", "ations", "ation", "ings", "ing"]) {
    if (normalized.endsWith(suffix) && normalized.length - suffix.length >= 4) {
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }

  for (const suffix of ["ers", "er", "ed", "es", "s"]) {
    if (normalized.endsWith(suffix) && normalized.length - suffix.length >= 4) {
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }

  return normalized;
}

const REMEMBER_TOPIC_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "for",
  "from",
  "into",
  "its",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "those",
  "use",
  "with",
]);

const MIN_EXISTING_TOPIC_MARGIN = 3;
const MIN_EXISTING_TOPIC_SCORE = 6;
