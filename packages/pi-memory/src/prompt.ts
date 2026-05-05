import type { OrientationSummary } from "./types.js";

const MAX_LISTED_TOPICS = 5;

export const MEMORY_DECISION_CONTRACT = `Durable memory is available through memory_search, memory_write, and memory_move.

{{orientation_summary}}

Use memory_search only when the task may depend on facts from prior sessions
that are not present in the current conversation, repository state, or recent
tool output. Do not use memory_search for routine code inspection, facts that
can be verified directly from files, or ephemeral details about the current
turn. Prefer memory_search over raw file reads targeting the memory root; use
raw reads only after memory_search returns a specific path or entry to inspect.
Prefer at most one targeted memory_search unless the first result makes a
follow-up query necessary.

Treat memory as advisory. If memory conflicts with the current user message,
repository state, or fresh tool output, the current source wins. Verify cheap-
to-check details against the current repository before acting on a memory.

Use memory_write only when the user explicitly asks Pi to remember or persist
something. Clear examples include "remember this", "keep in mind that...",
"always use ...", "never do ...", or "/remember ...". Phrases like "good to
know" or agent-only judgments such as "this might be useful later" are not, by
themselves, write requests.

Use memory_move when an existing memory belongs in a different scope or topic.
Do not emulate a move by writing a duplicate copy and leaving the old one
behind.

When writing, persist only durable preferences, conventions, constraints, or
findings likely to matter in a future session. Do not write transient task
state, unresolved guesses, checkout-local branch or worktree quirks, summaries
of obvious file changes, or secrets.

When choosing a topic for memory_write, prefer an existing topic named in the
orientation summary. Create a new topic only when no existing topic fits. Use
scope "global" for personal preferences that apply across projects. Otherwise,
use the default project scope for repo-specific facts.`;

export function buildOrientationSummary(topicNames: string[]): OrientationSummary {
  const uniqueTopics = [...new Set(topicNames.filter((topic) => topic.trim() !== ""))].sort();
  if (uniqueTopics.length === 0) {
    return {
      totalTopics: 0,
      topicNames: [],
      text: "Memory: 0 topics. Use memory_search to find specific memories.",
    };
  }

  const listed = uniqueTopics.slice(0, MAX_LISTED_TOPICS);
  const overflow = uniqueTopics.length - listed.length;
  const suffix = overflow > 0 ? `, +${overflow} more` : "";

  return {
    totalTopics: uniqueTopics.length,
    topicNames: uniqueTopics,
    text: `Memory: ${uniqueTopics.length} topic${uniqueTopics.length === 1 ? "" : "s"} (${listed.join(", ")}${suffix}). Use memory_search to find specific memories.`,
  };
}

export function buildInjectedPrompt(summary: OrientationSummary): string {
  return MEMORY_DECISION_CONTRACT.replace("{{orientation_summary}}", summary.text);
}
