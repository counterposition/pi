export interface JevAction {
  tool: string;
  input: unknown;
  description?: string;
}

export interface EarlierAction {
  tool: string;
  /** The call's arguments as JSON, shortened. */
  input: string;
}

export interface JevState {
  user_messages: string[];
  /**
   * The agent's own earlier calls that ran and succeeded, as context for what the work is.
   * Arguments are as the model sent them, before any `prepareArguments` rewrite, so no
   * question treats them as evidence that something is safe to lose.
   */
  earlier_actions: EarlierAction[];
  action: JevAction;
  cwd: string;
  environment: string[];
}

export const EARLIER_ACTIONS = 8;
const EARLIER_INPUT_CHARS = 400;

/**
 * The last few tool calls before `toolCallId` on the branch, oldest first. Arguments
 * only: assistant prose and tool output are where injected instructions live.
 */
export function earlierActions(
  branch: readonly BranchEntry[],
  toolCallId: string | undefined,
): EarlierAction[] {
  // Only calls that ran and succeeded: a denied, failed, or still-pending call changed nothing.
  // A reused id cannot say which call a result belongs to, so it counts as neither.
  const results = new Map<unknown, Record<string, unknown>[]>();
  const callCounts = new Map<unknown, number>();
  for (const entry of branch) {
    const message: unknown = entry.message;
    if (entry.type !== "message" || !isRecord(message)) continue;
    if (message.role === "toolResult") {
      results.set(message.toolCallId, [...(results.get(message.toolCallId) ?? []), message]);
    } else if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content as unknown[]) {
        if (isRecord(part) && part.type === "toolCall") {
          callCounts.set(part.id, (callCounts.get(part.id) ?? 0) + 1);
        }
      }
    }
  }
  const succeeded = (id: unknown, name: unknown) => {
    const found = results.get(id);
    if (found?.length !== 1 || callCounts.get(id) !== 1) return false;
    const [result] = found as [Record<string, unknown>];
    return result.isError !== true && result.toolName === name;
  };
  const calls: EarlierAction[] = [];
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as unknown[]) {
      if (!isRecord(part) || part.type !== "toolCall") continue;
      if (part.id === toolCallId) return calls.slice(-EARLIER_ACTIONS);
      if (!succeeded(part.id, part.name)) continue;
      const input = JSON.stringify(part.arguments ?? {});
      calls.push({ tool: String(part.name), input: capText(input, EARLIER_INPUT_CHARS) });
    }
  }
  return calls.slice(-EARLIER_ACTIONS);
}

/** The subset of a session entry that state building reads; raw JSONL parses to it too. */
export interface BranchEntry {
  type: string;
  message?: { role?: unknown; content?: unknown };
}

/** The subset of the permission system's ask details that state building reads. */
export interface AskDetails {
  toolCallId?: string;
  toolName?: string;
  command?: string;
  target?: string;
  forwarding?: unknown;
  payload?: { request?: { invokedToolName?: string | null } };
}

export interface ToolDescription {
  name: string;
  description?: string;
}

/**
 * User text beyond these budgets never reaches Jev, so it cannot rule out a limit set
 * there; such calls go to a human (about 3% of pooled calls, mostly a few huge sessions).
 * Each message keeps both ends within this many characters.
 */
export const MAX_USER_MESSAGE_CHARS = 16_000;
/** User messages are kept newest first until this many characters. */
export const MAX_USER_CHARS = 64_000;
/** Actions larger than this skip Jev and go to a human: truncating could hide the risky part. */
export const MAX_ACTION_CHARS = 16_000;

const BUILT_IN_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean)
    .join("\n");
}

const SKILL_OPEN = /^<skill name="([^"\n]+)" location="[^\n]*">\n/;
const SKILL_CLOSE = "\n</skill>";

/**
 * Pi stores `/skill:name args` as the skill file's text followed by the args. The
 * file is repository text, not the human's words, so only the args remain. Pi does
 * not escape either part, so an expansion with more than one closing tag cannot
 * be split safely; it is reduced to its name and marked untrusted.
 */
export function stripSkillBlock(text: string): { text: string; trusted: boolean } {
  if (!text.startsWith("<skill ")) return { text, trusted: true };
  const open = SKILL_OPEN.exec(text);
  // Pi loads skills with odd names or paths too; an opening it cannot parse is still a skill.
  if (!open) return { text: "[skill]", trusted: false };
  const close = text.indexOf(SKILL_CLOSE);
  if (close === -1 || close !== text.lastIndexOf(SKILL_CLOSE)) {
    return { text: `[skill ${open[1]}]`, trusted: false };
  }
  const rest = text.slice(close + SKILL_CLOSE.length);
  if (rest && !rest.startsWith("\n\n")) return { text: `[skill ${open[1]}]`, trusted: false };
  const args = rest.trim();
  return { text: args ? `[skill ${open[1]}] ${args}` : `[skill ${open[1]}]`, trusted: true };
}

export interface UserContext {
  messages: string[];
  /** False when a message was cut, dropped, or could not be read safely: a restriction may be missing. */
  complete: boolean;
}

export function userContext(branch: readonly BranchEntry[]): UserContext {
  const texts: { text: string; trusted: boolean }[] = [];
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    // Jev reads only text; an instruction that exists only in an image is not seen
    // (a documented residual risk, like commands built at run time).
    const stripped = stripSkillBlock(textOf(entry.message.content).trim());
    if (stripped.text) texts.push(stripped);
  }
  let complete = texts.every((t) => t.trusted);
  const capped = texts.map(({ text }) => {
    if (text.length <= MAX_USER_MESSAGE_CHARS) return text;
    complete = false;
    const half = Math.floor(MAX_USER_MESSAGE_CHARS / 2);
    return `${text.slice(0, half)}…[truncated]…${text.slice(-half)}`;
  });
  // The first message usually states the task and its limits, so it is always kept;
  // the rest are kept newest first while they fit.
  const [first, ...rest] = capped;
  if (first === undefined) return { messages: [], complete };
  const kept: string[] = [];
  let budget = MAX_USER_CHARS - first.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    const text = rest[i] as string;
    if (text.length > budget) {
      complete = false;
      break;
    }
    budget -= text.length;
    kept.unshift(text);
  }
  if (kept.length < rest.length) kept.unshift("…[earlier messages omitted]…");
  return { messages: [first, ...kept], complete };
}

export type Unresolved = "forwarded" | "ambiguous" | "mismatch" | "unverified";

/**
 * A call as Pi's `tool_call` event carried it: arguments after `prepareArguments`
 * and validation. The input is the live object the gate evaluates and the tool
 * receives, so reading it at authorize time sees every earlier handler's edits.
 */
export interface PreparedCall {
  toolName: string;
  input: Record<string, unknown>;
}

function namesMatch(name: string, details: AskDetails): boolean {
  return name === details.toolName || name === details.payload?.request?.invokedToolName;
}

export function describeAction(action: JevAction, tools: readonly ToolDescription[]): JevAction {
  if (BUILT_IN_TOOLS.has(action.tool)) return action;
  const description = tools.find((t) => t.name === action.tool)?.description;
  return description ? { ...action, description: capText(description, 1000) } : action;
}

export interface BuildStateInput {
  branch: readonly BranchEntry[];
  details: AskDetails;
  /** The captured call for `details.toolCallId`; "duplicate" when two calls shared the id. */
  prepared: PreparedCall | "duplicate" | undefined;
  tools: readonly ToolDescription[];
  cwd: string;
  environment: readonly string[];
}

export type Resolution =
  | { ok: true; state: JevState; intentTrusted: boolean }
  | { ok: false; why: Unresolved };

/**
 * The input Jev should judge: the prepared call and nothing else. The transcript
 * is not what runs, and no field of the ask carries the complete input.
 */
function resolveAction(
  branch: readonly BranchEntry[],
  details: AskDetails,
  prepared: BuildStateInput["prepared"],
): { tool: string; input: unknown } | Unresolved {
  if (prepared === "duplicate") return "ambiguous";
  if (!prepared) return "unverified";
  // Pi appends the assistant message before preparing its calls, so the branch shows
  // every call sharing this id. A capture can only be trusted when exactly one exists:
  // otherwise it may belong to another call, whatever order extensions loaded in.
  const call = callsWithId(branch, details.toolCallId);
  if (call.length !== 1) return call.length === 0 ? "unverified" : "ambiguous";
  if (!namesMatch(prepared.toolName, details) || call[0] !== prepared.toolName) return "mismatch";
  return { tool: prepared.toolName, input: prepared.input };
}

/** Names of the transcript's tool calls with this id. */
export function callsWithId(
  branch: readonly BranchEntry[],
  toolCallId: string | undefined,
): string[] {
  if (!toolCallId) return [];
  const names: string[] = [];
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as unknown[]) {
      if (isRecord(part) && part.type === "toolCall" && part.id === toolCallId) {
        names.push(String(part.name));
      }
    }
  }
  return names;
}

/**
 * Builds Jev's state for an ask, or says why it cannot be trusted to describe the
 * call that will run. Asks forwarded from a subagent are not on this branch.
 */
export function resolveState({
  branch,
  details,
  prepared,
  tools,
  cwd,
  environment,
}: BuildStateInput): Resolution {
  if (details.forwarding) return { ok: false, why: "forwarded" };
  const action = resolveAction(branch, details, prepared);
  if (typeof action === "string") return { ok: false, why: action };
  const user = userContext(branch);
  return {
    ok: true,
    intentTrusted: user.complete,
    state: {
      user_messages: user.messages,
      earlier_actions: earlierActions(branch, details.toolCallId),
      action: describeAction(action, tools),
      cwd,
      environment: [...environment],
    },
  };
}

export function isOversized(state: JevState): boolean {
  return JSON.stringify(state.action.input).length > MAX_ACTION_CHARS;
}

function capText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parses `git remote -v` into credential-free `host/path` names. */
export function parseRemotes(output: string): string[] {
  const remotes = new Set<string>();
  for (const line of output.split("\n")) {
    const url = line.split(/\s+/)[1];
    const name = url ? remoteName(url) : undefined;
    if (name) remotes.add(name);
  }
  return [...remotes];
}

export function remotesEnvironment(remotes: readonly string[]): string[] {
  if (remotes.length === 0) return [];
  return [
    `This repository's own git remotes are trusted destinations; pushing this repository's code to them is not exfiltration: ${remotes.join(", ")}`,
  ];
}

function remoteName(url: string): string | undefined {
  if (url.includes("://")) {
    try {
      const parsed = new URL(url);
      return parsed.hostname ? tidy(`${parsed.hostname}${parsed.pathname}`) : undefined;
    } catch {
      return undefined;
    }
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
  return scp ? tidy(`${scp[1]}/${scp[2]}`) : undefined;
}

function tidy(name: string): string {
  return name.replace(/\.git$/, "").replace(/\/+$/, "");
}
