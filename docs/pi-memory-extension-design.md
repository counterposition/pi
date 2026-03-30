# Pi Memory Extension Design

## Purpose

`@counterposition/pi-memory` gives the Pi coding agent durable memory across
sessions. Memories are Markdown files on disk, human-readable and
human-editable.

The extension should borrow the strongest ideas from recent agent memory systems
without inheriting their common failure modes:

- stale memories that never get invalidated
- equal weighting of old and new notes
- startup context bloat from loading everything
- summary drift where derived summaries silently replace source facts

The result should be simple enough to ship as a small v1 and strong enough to
evolve into richer retrieval later.

## Why This Exists

Pi sessions are ephemeral. When a session ends or compacts, everything the agent
learned vanishes unless it happens to be in the code or git history. That means
the agent re-discovers the same project conventions, user preferences, debugging
findings, and architectural constraints over and over.

A durable memory system solves this by giving the agent a place to write things
down and a way to find them again later. The problem is well-understood. The
interesting question is how to avoid the failure modes that plague existing
implementations.

## Research Summary

The most useful public reference points are:

- **Claude Code auto-memory.** Per-project memory stored under
  `~/.claude/projects/`. A concise `MEMORY.md` index loaded at session start,
  with topic files read on demand. Memories use YAML frontmatter with typed
  categories (user, feedback, project, reference). The index is hard-budgeted to
  200 lines. Staleness is acknowledged via system reminders that note each
  memory's age.

- **Anthropic SDK `memory_20250818`.** A first-party beta API tool with
  file-system semantics: view, create, str_replace, insert, delete, rename. This
  signals the direction Anthropic expects memory tooling to take — file-based
  CRUD, not database queries.

- **Cline Memory Bank.** A popular community proof that Markdown memory is
  usable and auditable. Also a clear example of over-retrieval and
  stale-equals-fresh behavior: the agent reads all files on every task, context
  fills with irrelevant history, and there is no mechanism to invalidate
  outdated notes.

- **OpenClaw.** Markdown files in the workspace as source of truth. Daily logs
  plus a curated `MEMORY.md`. Pre-compaction memory flush. Interesting for its
  separation of append-only capture from curated memory, though workspace
  storage creates accidental-commit risk.

- **QMD.** A local retrieval engine for Markdown and code with BM25, vector
  search, reranking, path context, and an SDK/MCP surface. Useful as a future
  retrieval backend because it keeps files canonical and makes indexes
  rebuildable. Not itself a memory system: it does not model invalidation,
  promotion, or per-entry lifecycle.

The clearest design lessons across all systems are:

1. Keep Markdown as the source of truth. Treat indexes and summaries as derived
   artifacts that can be rebuilt.
2. Separate cheap append-only capture from curated durable memory.
3. Budget startup memory aggressively. Load detail lazily.
4. Make recency matter for dated notes but do not decay evergreen reference
   files.
5. Add explicit invalidation rather than hoping the agent will figure out which
   memories are stale.
6. Treat compaction and long-term memory as cooperating concerns, not the same
   mechanism.
7. Keep memory semantics separate from retrieval implementation so search can
   improve without changing the storage model.

## Design Goals

- Memory persists across Pi sessions.
- Memory files are human-readable, editable, and easy to version if desired.
- The extension works with Pi's current extension API. No core changes.
- The default experience is private and low-risk.
- Retrieval quality can improve over time without requiring embeddings or an
  external service in v1.

## Non-Goals

- Perfect truth maintenance.
- A mandatory vector database or external service.
- A hidden binary format.
- Aggressive autonomous writing with no audit trail.
- Indexing session transcripts.

## Design Rationale

### Two tools, not three

Following the same reasoning as pi-web-search: the agent should face a small,
clear decision surface. Memory has two fundamental operations:

- **I want to find something I learned before.** Use `memory_search`.
- **I want to write something down for later.** Use `memory_write`.

A third tool like `memory_get` (targeted file read) is unnecessary because the
agent already has `read`. If `memory_search` returns a path and heading, the
agent can read the file directly. Adding a third tool increases prompt overhead
and routing mistakes without giving the agent a meaningfully different
capability.

### Two tools, not one

Search and write have different inputs, different intent, and different failure
modes. A single polymorphic `memory` tool with a `command` parameter would force
the agent to reason about an action selector before forming the request.

The Anthropic SDK's `memory_20250818` beta uses a single-tool multi-command
pattern (view, create, str_replace, insert, delete, rename). That design makes
sense for a general-purpose API primitive. An agent extension can afford a
narrower surface because it controls the storage model and can hide file
management behind better abstractions.

### Private by default

OpenClaw stores memory in the workspace, which is simple but creates
accidental-commit risk. Pi should default to a user-local private store:

- Avoids leaking sensitive recollections into git.
- Matches Pi's existing user-local configuration model under `~/.pi/agent/`.
- Keeps everything on disk as Markdown.

A future `storageMode: "workspace"` option can place memory under `.pi/memory/`
for teams that want shared, versioned project memory.

### Inbox and topics, not one flat directory

The core insight from studying existing systems is that recently captured notes
and stable durable facts have fundamentally different lifecycles.

A note captured mid-session ("tests require redis to be running locally") might
be valuable or might be transient noise. Routing it directly into curated memory
pollutes the durable store. Routing it into a dated inbox file is cheap, safe,
and lets a later maintenance pass decide whether the note has earned promotion.

Topic files hold facts that have proven durable: standing preferences, workflow
conventions, architecture decisions, debugging findings worth preserving. They
are the memory the agent should trust.

This separation also makes staleness tractable. Inbox notes decay with age by
default. Topic file entries carry explicit status and do not decay.

### Files are canonical, indexes are disposable

Markdown files are the source of truth. Any future index — lexical, embedding,
or otherwise — must be rebuildable from the Markdown corpus. If an index is
lost or corrupted, rebuilding it from source files must restore full
functionality.

This means the v1 design does not need an index at all. The memory corpus will
be small enough for direct file operations. An index becomes valuable later when
the corpus grows, and the design should not preclude one, but it should not
require one either.

QMD fits this rule well: it can be a local, rebuildable retrieval layer later
without becoming the source of truth. If adopted, it should remain an internal
backend behind `memory_search`, not a user-facing part of the storage model.

### Derived summaries never replace source memories

`MEMORY.md` and any future monthly rollups are navigation aids. They are not
authoritative facts. Source notes stay on disk and remain linkable. If a summary
contradicts a source note, the source note wins.

## Storage Model

Default location:

```text
~/.pi/agent/memory/projects/<project-id>/
├── MEMORY.md              # concise index loaded at session start
├── inbox/
│   ├── 2026-03-29.md      # append-only daily capture
│   └── ...
└── topics/
    ├── build.md            # curated durable memory by topic
    ├── testing.md
    ├── preferences.md
    └── ...
```

### Project identity

Project memory is keyed by the git root realpath when available, falling back to
the working directory realpath outside a repo. The project ID is a
deterministic slug derived from this path, similar to how Claude Code encodes
project paths in its directory names.

### `MEMORY.md`

The startup entrypoint. It stays concise and contains:

- Links to topic files with one-line descriptions.
- A short "recently changed" section for orientation.
- Nothing else.

Borrowing Claude Code's budgeted load pattern: load the first 200 lines, keep
the rest available via on-demand reads.

`MEMORY.md` is a derived artifact. It should be rebuildable from the topic files
and recent inbox state. The extension maintains it, but the topic files are
canonical.

### `inbox/YYYY-MM-DD.md`

Daily inbox files are append-only capture. They hold fresh notes that have not
yet earned promotion into topic memory.

Format:

```markdown
# 2026-03-29

## 14:32 — Tests require local Redis

- Source: assistant
- Context: discovered while debugging integration test failures

The flaky integration test in `packages/api/tests/cache.test.ts` only passes
when Redis is running locally. The CI environment handles this automatically,
but local development requires `docker compose up redis` first.

## 16:10 — User prefers pnpm over npm

- Source: user

Always use `pnpm`, not `npm`, for package management in this repo.
```

Characteristics:

- Cheap to write. Append-only within the day.
- Naturally date-scoped for recency ranking.
- Not loaded at startup. Found via search or maintenance.
- Safe to summarize and archive later.

### `topics/*.md`

Topic files hold durable memory. Each file covers a coherent subject and
contains entries with lightweight metadata.

Format:

```markdown
---
description: Build system conventions and tooling preferences
---

# Build

## Use pnpm, not npm
- Status: active
- Source: user
- Updated: 2026-03-29

Always use `pnpm` for package management. The repo uses pnpm workspaces and
the lockfile is `pnpm-lock.yaml`.

## Tests require local Redis
- Status: active
- Source: assistant
- Updated: 2026-03-29
- Promoted-from: inbox/2026-03-29.md

Integration tests in `packages/api/tests/` need a local Redis instance.
Run `docker compose up redis` before `pnpm test`.

## Use npm for installs
- Status: superseded
- Superseded-by: "Use pnpm, not npm"
- Updated: 2026-03-29

Historical note retained for traceability.
```

This is intentionally simple: Markdown headings for entry boundaries, short
metadata bullets, and free-form content. No custom IDs, no formal schema, no
YAML frontmatter per entry. The structure gives the extension enough to support
status filtering and staleness tracking while remaining comfortable to read and
edit by hand.

Entry metadata fields:

- `Status`: `active | superseded | invalid` (required)
- `Source`: `user | assistant` (required)
- `Updated`: date (required)
- `Superseded-by`: reference to the replacing entry (when superseded)
- `Promoted-from`: inbox source (when promoted from inbox)
- `Review-after`: date (optional, for time-sensitive facts)

Two details matter:

1. `Status` is first-class so stale memories are a data problem, not only a
   retrieval problem.
2. `Review-after` lets the system surface candidates for review without
   silently deleting history.

### Retrieval is entry-based, not file-based

The files above are organized for humans. Retrieval should operate on parsed
memory entries:

- One topic entry = one heading section in `topics/*.md`.
- One inbox entry = one timestamped heading section in `inbox/YYYY-MM-DD.md`.

Each parsed entry carries the data retrieval actually needs: file path,
heading, body, status, dates, and whether it came from a topic file or the
inbox.

This distinction matters even if the v1 implementation uses simple file
operations. It matters even more for future indexed backends such as QMD,
because they index documents and chunks, not Pi's memory-state semantics. Pi
therefore needs its own entry parser either way.

## Retrieval Model

### v1: direct file search

The initial retrieval engine should be straightforward: glob for memory files,
parse them into entries, use direct lexical matching over headings and bodies,
and rank with simple heuristics. Grep can still be used internally to shortlist
candidate files, but the retrieval unit returned to the agent is an entry, not
a whole file.

Why not require an index in v1:

- Pi already has glob and grep as core capabilities. The extension can use
  `pi.exec` to shortlist and inspect its own Markdown files.
- The memory corpus in early usage will be small — dozens of files, not
  thousands.
- A rebuildable index can be added later behind the same tool interface without
  changing the user-facing model.

### Why not require QMD in v1

QMD is attractive, but making it a default dependency in v1 is the wrong trade:

- The default corpus is small enough that direct entry-aware search is simpler.
- QMD adds index management, native dependencies, and optional local model
  downloads that are disproportionate for a private memory store.
- QMD does not understand `Status`, `Review-after`, promotion, or inbox recency
  on its own.
- Pi would still need its own entry parser and memory-policy layer, so QMD does
  not simplify the core design.

### Search behavior

`memory_search` should:

1. Search parsed topic entries and recent inbox entries, with `MEMORY.md` as an
   orientation aid.
2. Use heading boundaries as entry boundaries, not fixed character windows.
3. Exclude entries with `Status: invalid` by default.
4. Down-rank entries with `Status: superseded` unless the query asks for
   history.
5. Prefer recent inbox notes over old ones.
6. Return results with file path, heading, status, and date.

### Future: indexed retrieval via QMD or equivalent

When the corpus grows large enough to make direct grep slow, add a rebuildable
index behind the same `memory_search` interface:

- Index a derived entry corpus, not raw topic files. Each indexed document
  should correspond to one parsed memory entry.
- QMD is a strong candidate backend because it already provides local BM25,
  vector search, reranking, path context, and an embeddable SDK.
- Pi must continue to enforce `Status`, history requests, and inbox recency
  itself before or after backend retrieval.
- Optional hybrid lexical + semantic retrieval can arrive later without
  changing the user-facing model.
- The user-facing tool should not change when the retrieval backend changes.

## Write Model

The extension needs a tighter write policy than most memory-bank-style systems.
The policy lives in the system prompt contract, not in code-level enforcement.

### Explicit writes

When the user says a variant of "remember this", "always do X", "never do Y",
or "keep in mind that...", the extension should write a durable memory. Explicit
user requests go directly to a topic file when they express a standing
preference or convention, and to the inbox otherwise.

### Implicit writes

The extension may write memory automatically when the agent judges that a fact
is:

1. Likely useful in a future session.
2. Not obvious from repository state alone (code, git history, config files).
3. At least moderately confident.

Good implicit writes:

- "tests require `pnpm dev:services` before `pnpm test`"
- "the flaky integration test passes only when Redis is local"
- "the repo uses changesets for versioning publishable packages"

Bad implicit writes:

- "edited three files" (transient, obvious from git)
- "the current task is to rename a variable" (ephemeral)
- "assistant thinks the bug is probably in auth" (unresolved guess)
- contents of `.env` files or credentials (secrets)

### Capture before promote

Automatic writes should usually land in the daily inbox first. Promotion into a
topic file happens later during maintenance, when a note proves durable. This
reduces the risk of polluting curated memory with transient observations.

## Compaction Cooperation

Compaction is the most important integration point. When Pi compacts a long
conversation, everything the agent learned in that conversation is about to be
reduced to a summary. If the memory extension does not act before compaction,
durable learnings are lost.

The extension hooks `session_before_compact` to perform a pre-compaction flush:

1. Scan the conversation for facts worth remembering.
2. Write them to the daily inbox.
3. Optionally refresh `MEMORY.md` if the inbox added something important.

The flush should be bounded — a fixed token budget for the scan, a maximum
number of notes written — to avoid making compaction itself expensive.

Compaction summaries are session artifacts, not memory artifacts. The extension
should not treat a compaction summary as canonical memory.

## Maintenance ("Dreaming")

Dreaming is an optional maintenance pass that runs outside the critical path of
normal conversation and performs bounded memory hygiene.

### What dreaming does

- Promote durable inbox notes into topic files.
- Mark contradictions or stale notes for review.
- Refresh `MEMORY.md` to reflect current topic file state.
- Merge duplicate entries within topic files.
- Flag entries past their `Review-after` date.

### What dreaming does not do

- Invent new facts.
- Rewrite large parts of memory without traceability.
- Delete source notes (only change status).
- Run so often that users lose predictability.

### Triggers

- **Manual:** `/dream` command.
- **Opportunistic:** after `session_shutdown` when the agent is idle, if
  enabled.

### Guardrails

- Hard token budget for the LLM call.
- Write at most N memory mutations per run.
- Emit a maintenance report listing what changed and why.
- Prefer append, promote, and supersede over destructive edits.

### Cost

Dreaming requires an LLM call. The extension should use a cost-effective model
for maintenance (configurable, defaulting to a fast/cheap option). The user
should be able to disable automatic dreaming entirely.

## System Prompt Contract

The `before_agent_start` hook injects a memory contract into the system prompt.
This contract tells the agent:

1. That durable memory is available and how to use the two tools.
2. When to write memories (the write policy above, in concise form).
3. When not to write memories.
4. That `MEMORY.md` has been loaded and what it contains.
5. That topic files and inbox notes are available via `memory_search`.

The contract also includes the current contents of `MEMORY.md` (up to the
startup budget), so the agent has orientation context without needing to make a
tool call.

This is how Claude Code's memory works — the system prompt carries the full
behavioral policy, not just a tool description. The tool descriptions alone are
not enough to produce good memory behavior.

## Pi Extension Architecture

### Hooks

| Hook | Purpose |
|------|---------|
| `session_start` | Resolve project ID and memory root. Ensure directory structure exists. |
| `before_agent_start` | Inject memory contract and `MEMORY.md` excerpt into system prompt. |
| `session_before_compact` | Pre-compaction flush of durable learnings to inbox. |
| `session_shutdown` | Optionally trigger light maintenance. |

### Tools

| Tool | Purpose |
|------|---------|
| `memory_search` | Query durable memory. Returns ranked results with paths, headings, status, and dates. |
| `memory_write` | Store a memory note. Parameters: `content`, `topic` (optional — routes to topic file; omit for inbox). |

### Commands

| Command | Purpose |
|---------|---------|
| `/memory` | Show memory status: file count, last modified, storage location. |
| `/remember <text>` | Shortcut for explicit durable write. |
| `/forget <query>` | Mark matching memories as invalid. |
| `/dream` | Run maintenance on demand. |

## Startup Behavior

At session start, the agent should not ingest the full memory corpus. Instead:

1. Load a bounded portion of `MEMORY.md` (200 lines or 25 KB, whichever is
   smaller).
2. Inject the memory contract into the system prompt.
3. Leave topic files and inbox notes for on-demand retrieval via
   `memory_search`.

This directly addresses the largest failure mode in Cline-style memory banks:
loading everything into context on every session regardless of relevance.

## Staleness and Invalidation

This is the area where most current designs are weakest.

### Rules

- New contradictory information should supersede the old entry, not simply add
  another active note alongside it.
- `superseded` and `invalid` entries remain on disk for traceability but are
  excluded from default search results.
- Entries with `Review-after` dates appear in the maintenance report when past
  due.
- Inbox notes are naturally deprioritized by age in search results.

### Why both status and recency matter

Recency alone cannot invalidate a wrong evergreen fact. Status alone cannot keep
months of dated inbox notes from crowding search results. The extension needs
both dimensions.

## Settings

```json
{
  "memory": {
    "enabled": true,
    "storageMode": "private",
    "startupBudget": {
      "maxLines": 200,
      "maxBytes": 25000
    },
    "maintenance": {
      "dreamOnShutdown": false,
      "dreamModel": null
    }
  }
}
```

Minimal surface. `dreamModel` defaults to null (use the session's current
model). Teams that want cheaper maintenance can point it at a fast model.

## Recommended v1 Scope

Ship the smallest version that has the right shape:

1. Private Markdown-backed storage under `~/.pi/agent/memory/projects/`.
2. `MEMORY.md` + `inbox/` + `topics/`.
3. Bounded startup load from `MEMORY.md`.
4. `memory_search` and `memory_write` tools.
5. Direct entry-aware file search, no index.
6. System prompt contract with full write policy.
7. Pre-compaction flush via `session_before_compact`.
8. Manual `/dream` command for maintenance.
9. `/memory`, `/remember`, `/forget` commands.

Do not require in v1:

- SQLite or any index.
- QMD or any other external retrieval runtime.
- Embeddings.
- Automatic dreaming on shutdown.
- Monthly summaries or archival.
- Workspace storage mode.

## Evolution Path

### v1.1

- Automatic dreaming on session shutdown (opt-in).
- `Review-after` and expiration surfacing in maintenance reports.
- Workspace storage mode for shared team memory.

### v1.2

- Optional QMD-backed rebuildable index over derived memory entries for larger
  corpora.
- Duplicate suppression and reranking.
- Inbox archival and monthly summary generation.

### v2

- Optional hybrid lexical + semantic retrieval via QMD or an equivalent local
  backend.
- Per-subagent memory scopes.
- Richer inspection UI for memory lineage.

## Open Questions

1. How aggressive should implicit writes be before users find the memory store
   noisy? This probably needs tuning based on real usage rather than guessing
   in the design phase.

2. Should promotion from inbox to topics happen only during `/dream`
   maintenance, or also automatically when a note is recalled multiple times
   by `memory_search`? Recall-driven promotion is appealing but adds
   bookkeeping complexity.

3. What is the right default `dreamModel`? Using the session model is simple
   but potentially expensive. Using a fixed cheap model is economical but may
   produce lower-quality maintenance. The setting exists to let users decide,
   but the default matters.
