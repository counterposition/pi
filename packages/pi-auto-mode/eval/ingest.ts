import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

import { migrateSessionEntries, parseSessionEntries } from "@earendil-works/pi-coding-agent";

import { earlierActions, remotesEnvironment, userContext } from "../src/state.js";
import type { BranchEntry, JevState } from "../src/state.js";
import { writeJsonl } from "./jsonl.js";
import { HF_DIR, ITEMS_FILE } from "./paths.js";

export type ToolClass = "bash" | "custom" | "mcp";

export interface EvalItem {
  id: string;
  dataset: string;
  session: string;
  toolClass: ToolClass;
  state: JevState;
  /** False when a user message was cut; the link then ignores `requested`. */
  intentTrusted: boolean;
}

const OWN_SESSIONS = join(homedir(), ".pi", "agent", "sessions");
/** Tools the base policy allows outright; the link never sees them unless a path rule asks. */
const POLICY_ALLOWED = new Set(["read", "grep", "find", "ls", "write", "edit"]);
/** Traces carry no remote names, so every item gets the same generic trusted-remote entry. */
export const EVAL_ENVIRONMENT = remotesEnvironment([
  "origin (this repository's configured remote)",
]);

export function hashId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

export function toolClass(tool: string): ToolClass | undefined {
  if (tool === "bash") return "bash";
  if (POLICY_ALLOWED.has(tool)) return undefined;
  return tool === "mcp" ? "mcp" : "custom";
}

/** Extracts every call from one session file that the base policy sends to the link. */
export function extractItems(text: string, dataset: string, file: string): EvalItem[] {
  const entries = parseSessionEntries(text);
  migrateSessionEntries(entries);
  const header = entries.find((e) => e.type === "session") as
    | { id?: string; cwd?: string }
    | undefined;
  const cwd = header?.cwd ?? "/workspace";
  // Mirrored uploads of one session share its header id, so it keys both dedup and the split.
  const session = header?.id ?? file;

  const byId = new Map<string, { parentId?: string | null } & BranchEntry>();
  for (const entry of entries) {
    const e = entry as { id?: string; parentId?: string | null } & BranchEntry;
    if (e.id) byId.set(e.id, e);
  }

  const items: EvalItem[] = [];
  for (const [id, entry] of byId) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    const calls = content.filter(
      (c: unknown): c is { id: string; name: string; arguments?: unknown } =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: unknown }).type === "toolCall" &&
        typeof (c as { name?: unknown }).name === "string",
    );
    if (calls.length === 0) continue;

    let user: ReturnType<typeof userContext> | undefined;
    let branch: BranchEntry[] | undefined;
    for (const call of calls) {
      const cls = toolClass(call.name);
      if (!cls) continue;
      const input = call.arguments ?? {};
      if (cls === "bash" && (input as { command?: unknown }).command === "git status") continue;
      branch ??= branchTo(byId, id);
      user ??= userContext(branch);
      items.push({
        id: hashId(session, call.id ?? "", JSON.stringify(input)),
        dataset,
        session,
        toolClass: cls,
        intentTrusted: user.complete,
        state: {
          user_messages: user.messages,
          earlier_actions: earlierActions(branch, call.id),
          action: { tool: call.name, input },
          cwd,
          environment: [...EVAL_ENVIRONMENT],
        },
      });
    }
  }
  return items;
}

function branchTo(
  byId: Map<string, { parentId?: string | null } & BranchEntry>,
  leaf: string,
): BranchEntry[] {
  const branch: BranchEntry[] = [];
  const seen = new Set<string>();
  for (let id: string | null | undefined = leaf; id && !seen.has(id); ) {
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) break;
    branch.push(entry);
    id = entry.parentId;
  }
  return branch.reverse();
}

async function listJsonl(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string) => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".jsonl")) found.push(path);
    }
  };
  await walk(dir);
  return found.sort();
}

export async function ingest(): Promise<void> {
  const sources = [
    ...(await listJsonl(OWN_SESSIONS)).map((path) => ({
      path,
      dataset: "own",
      session: relative(OWN_SESSIONS, path),
    })),
    ...(await listJsonl(HF_DIR)).map((path) => ({
      path,
      dataset: basename(path).split("__").slice(0, 2).join("/"),
      session: basename(path),
    })),
  ];
  const items: EvalItem[] = [];
  const seen = new Set<string>();
  let failed = 0;
  for (const source of sources) {
    try {
      const content = await readFile(source.path, "utf8");
      for (const item of extractItems(content, source.dataset, source.session)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    } catch {
      failed++;
    }
  }
  await writeJsonl(ITEMS_FILE, items);
  const counts = { bash: 0, custom: 0, mcp: 0 };
  for (const item of items) counts[item.toolClass]++;
  console.log(
    `${sources.length} sessions (${failed} unreadable) -> ${items.length} items ${JSON.stringify(counts)}`,
  );
}
