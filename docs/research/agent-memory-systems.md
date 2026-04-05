# Memory for AI Agents

Comparative notes on how leading agent implementations handle durable memory.
These notes informed the design decisions in [pi-memory-extension-design.md](../pi-memory-extension-design.md).

## Memory scoping

Not all agents are personal assistants.
Coding agents like Claude Code need memories too, but what's relevant in one codebase is usually noise in another.

The leading agents scope memory differently:

| Agent            | Scope                  | Location                                      |
| ---------------- | ---------------------- | --------------------------------------------- |
| **Claude Code**  | Per-project (git root) | `~/.claude/projects/<sanitized-path>/memory/` |
| **OpenClaw**     | Global workspace       | `~/.openclaw/workspace/`                      |
| **Hermes Agent** | Per-profile            | `~/.hermes/memories/`                          |

Claude Code deliberately scopes memory per-project.
OpenClaw, being more of a personal assistant, uses a single global workspace.
Hermes sits in the middle with profile-scoped storage.

For a Pi extension that supports both personal assistants and coding agents, the memory system needs to support multiple scopes: a global scope for user-level facts (preferences, identity) and a project scope for codebase-specific knowledge.

## Who writes memories?

### All three agents converge on in-band writing

In all three leading implementations, the **conversing agent itself** is the primary writer of memories.
The agent decides, during the conversation, that something is worth remembering and writes it to disk.

- **Claude Code**: The agent writes memories using standard file tools (`FileWrite`, `FileEdit`).
  There are no special memory tools — the agent just writes Markdown files to the memory directory.
  A background extraction process exists but only fires as a fallback when the main agent *didn't* write memories.
- **Hermes Agent**: The agent calls a dedicated `memory` tool with three actions: `add`, `replace`, `remove`.
  Mid-session writes persist to disk immediately but do not change the system prompt (preserving the prefix cache).
  They take effect in future sessions.
- **OpenClaw**: The agent writes to daily notes (`memory/YYYY-MM-DD.md`).
  A separate "dreaming" process runs on a schedule (e.g. daily at 3 AM) to *promote* daily notes to long-term memory (`MEMORY.md`), but dreaming never creates new memories — it only consolidates existing ones.

### Why not delegate writing to a separate agent?

It's tempting to externalize memory writing entirely.
Pi stores full conversation histories in append-only JSONL files (including thinking traces), so a post-session agent would have rich material to analyze.
The conversing agent would have fewer tools and less instruction overhead in its context window.

This is not a hypothetical — Claude Code actually built this.
Its background extraction system (`extractMemories.ts`) is exactly a separate agent that reads the session and writes memories.
But it's gated to only run when the main agent *didn't* write memories itself.
It's a fallback, not the primary path.

The reasons all three agents converge on in-band writing:

1. **Externalizing writes doesn't eliminate memory from the agent's context.**
   Even if a separate process handles writing, the conversing agent still needs to *read* memories.
   That means you still need context injection (a snapshot in the system prompt) or retrieval tools (`memory_search`, `memory_get`).
   The reading side is the bigger context cost.
   Removing write instructions saves maybe 20% of the memory-related prompt while keeping 80%.

2. **The conversing agent knows what *it* doesn't know.**
   When the agent encounters something surprising — a user correction, an unexpected environment detail — it has a first-person salience signal: "I wouldn't have known this from the codebase alone."
   A post-hoc transcript analyzer can only infer importance from text patterns.
   It doesn't know what was novel to the agent vs. obvious from context.

3. **Timeliness in long sessions.**
   If a user corrects the agent at turn 5 and the conversation runs for 80 more turns, an in-band write makes that correction available for retrieval within the same session (Claude Code and OpenClaw both support mid-session retrieval).
   A post-session analyzer can't help until the *next* session.

4. **Coordination cost scales with multiple assistants.**
   If you have N assistants, you need N memory-writer agents too — each must understand its corresponding assistant's persona, scope, and purpose to write relevant memories.
   This doubles the agent count and introduces synchronization problems (when does the writer run? what if sessions overlap?).

The pragmatic design is what Claude Code landed on: **in-band writing as primary, with out-of-band extraction as a safety net** for cases where the agent was too focused on the task to pause and write memories.

### When out-of-band writing might still win

For personal assistants with short, focused conversations (ask a question, get an answer, done), the timeliness issue disappears and the simpler architecture may be preferable.
The separation of concerns is genuinely cleaner.
But for coding agents where sessions routinely run long, in-band writing is hard to beat.

## How memories are retrieved

### Context injection (always-on)

All three agents inject some memory into the system prompt at session start:

- **Claude Code**: Injects a `MEMORY.md` index (capped at 200 lines / 25KB).
  This is an index of one-line pointers to topic files, not the memories themselves.
- **Hermes Agent**: Injects a frozen snapshot of the full `MEMORY.md` and `USER.md` contents.
  The snapshot never changes mid-session, which preserves the LLM's prefix cache.
  The agent sees a usage meter (e.g. `[67% — 1,474/2,200 chars]`).
- **OpenClaw**: Injects today's and yesterday's daily notes automatically.

### Deep retrieval (on-demand)

The three agents diverge significantly in how they handle retrieval beyond what's in the system prompt.

|                 | What's searched                              | Search method                          | What's returned                            |
| --------------- | -------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| **Claude Code** | Curated topic files (processed memories)     | Sonnet side-query picks relevant files | Memory file contents                       |
| **OpenClaw**    | All memory files (processed memories)        | Hybrid vector + BM25                   | Matching chunks with scores                |
| **Hermes**      | Raw session transcripts (past conversations) | SQLite FTS5 keyword search             | LLM-generated summaries (via Gemini Flash) |

The critical difference: Claude Code and OpenClaw search over **processed memories** — curated Markdown files that the agent or a promotion process has already distilled.
Hermes searches over **raw session transcripts** via a `session_search` tool.

This means Hermes' deep retrieval is noisier (full conversations rather than distilled knowledge) but never loses information (transcripts are complete).
Claude Code and OpenClaw trade completeness for signal quality.

### Hermes' MEMORY.md is not an index

Unlike Claude Code's `MEMORY.md` (which is an index pointing to topic files), Hermes' `MEMORY.md` **is** the memory — a small, curated digest capped at 2,200 characters.
When it fills up, the `memory` tool rejects new entries with an error and the agent must manually `replace` or `remove` existing entries to make room.
There is no automatic eviction or overflow mechanism.

This means Hermes' built-in memory is fundamentally a **working set** — a small scratchpad of the most important facts — rather than a growing knowledge base.
Long-term recall depends entirely on `session_search` over raw transcripts.

### Hermes external providers add richer retrieval

The built-in Hermes system is FTS5 only, but external memory providers add more sophisticated retrieval:

- **Holographic**: Hybrid search combining FTS5, Jaccard similarity, and HRR (Holographic Reduced Representations) vectors — all computed locally, no external embeddings API needed.
- **Honcho**: Semantic search via cloud API, with a `prefetch` mechanism that runs background retrieval after each turn and injects results into the next turn's context.
- **RetainDB**: Hybrid semantic + BM25 search via cloud API.
- **Hindsight**: Knowledge graph with entity resolution and graph traversal.

External providers also support a `prefetch(query)` lifecycle hook: after each user turn, the provider can start a background thread to retrieve relevant context, which is then injected into the next API call without the agent needing to explicitly search.

## Memory file format

All three use Markdown, but with different structures:

- **Claude Code**: YAML frontmatter with `name`, `description`, and `type` fields (four types: `user`, `feedback`, `project`, `reference`).
  Each memory is a separate `.md` file.
  `MEMORY.md` is an index of one-line pointers.
- **Hermes Agent**: Plain Markdown with entries separated by `§` delimiters.
  Two files total: `MEMORY.md` (agent notes, 2,200 char limit) and `USER.md` (user profile, 1,375 char limit).
  No metadata.
- **OpenClaw**: Plain Markdown daily notes.
  `MEMORY.md` is for evergreen facts (user-written, agent won't overwrite).
  Daily notes are append-only.

## Why Hermes uses a dedicated memory tool

Claude Code lets the agent write directly to Markdown files using generic file tools.
Hermes takes a different approach: a dedicated `memory` tool that the agent must call.
This isn't just for backend abstraction — there are three distinct reasons.

### The tool is a validation gateway

Before any memory write hits disk, the `memory` tool runs several checks that generic file tools cannot:

- **Security scanning** — blocks prompt injection patterns ("ignore previous instructions", "you are now"), exfiltration payloads (`curl` with `$TOKEN`), SSH backdoor attempts (`authorized_keys` writes), and invisible Unicode characters used for steganographic injection.
- **Size enforcement** — hard caps of 2,200 chars for memory and 1,375 chars for user profile.
  The agent gets usage feedback like `"67% — 1,474/2,200 chars"`.
- **Deduplication** — exact duplicate entries are silently rejected.
- **Atomic writes** — temp file + `os.replace()` with `fcntl.flock()` to prevent readers from seeing partial writes during concurrent access.

### The tool abstracts over pluggable backends

Hermes ships with 7 external memory providers (Honcho, Mem0, RetainDB, Holographic, Hindsight, ByteRover, OpenViking).
The built-in `memory` tool is intercepted in `run_agent.py` before the normal tool registry, and writes are bridged to whichever external provider is active via an `on_memory_write()` callback.
A single `memory(action="add", content="...")` call can persist to both the local Markdown file and a remote vector database simultaneously.

Each provider exposes its own tool schemas (e.g. Honcho has `honcho_profile`, `honcho_search`; RetainDB has `retaindb_remember`, `retaindb_forget`), but at most one external provider can be active at a time to prevent tool bloat.

### The tool does NOT hard-prevent bypass

This is the surprising part.
The `~/.hermes/memories/` directory is **not** on the file write deny list.
The agent could technically call `write_file` targeting `MEMORY.md` directly, skipping all validation.
Prevention is entirely behavioral — the tool schema tells the agent when and how to use it, and the system prompt injects memory as a read-only frozen snapshot.
There is no filesystem-level enforcement.

## Design choices for Pi

This presents two options for the Pi memory extension:

- **Hermes approach (soft enforcement)**: Trust the LLM to use the tool.
  Simpler, works well in practice because models follow tool schemas reliably.
- **Hard enforcement**: Put the memory directory on a deny list for file tools and make the memory tool the only way in.
  More robust against adversarial inputs or model mistakes, but more complex to implement.

## Curated memories vs transcript search

For a detailed analysis of whether to rely on searching full transcripts for long-term memory or curating Markdown summaries with an index, see the dedicated analysis (not included here).

The short answer: curated memories should be primary (better signal-to-noise, cheaper at query time, natural shared layer for multi-assistant), with transcript search as a fallback for completeness.

## Should multiple assistants share memories?

Hermes Agent enforces one external memory provider per assistant to prevent tool bloat.
There is no built-in mechanism in any of the three agents for assistants to share memories with each other.

If Pi supports multiple personal assistants that can communicate, the question of shared vs. private memory becomes a design decision:

- Each assistant should build memories from its own interactions (private by default).
- A shared layer for user-level facts (identity, preferences) could prevent redundant learning.
- Cross-assistant memory sharing would be a novel contribution — none of the three agents do this today.
