# Pi Memory Extension Design

## Purpose

`@counterposition/pi-memory` gives the Pi coding agent durable memory across
sessions. Memories are Markdown files on disk, human-readable and
human-editable.

The extension should borrow the strongest ideas from recent agent memory systems
without inheriting their common failure modes:

- stale memories that never get invalidated
- equal weighting of old and new notes
- repeated prompt-context bloat from loading everything
- summary drift where derived summaries silently replace source facts

The result should be simple enough to ship as a small v1 and strong enough to
evolve into richer retrieval later.

## Why This Exists

Pi already preserves session history as append-only JSONL with tree navigation,
forks, and compaction summaries. That gives raw history and branch recovery,
but it does not give the agent a small, durable, queryable store of high-signal
facts that should remain easy to recover across later sessions.

Without that layer, project conventions, user preferences, debugging findings,
and architectural constraints are recoverable only indirectly: by rereading old
branches, leaning on compaction summaries, or rediscovering them from repo
state. That is slow, noisy, and unreliable for facts the agent should be able
to recall directly.

A durable memory system fills this narrower gap. It gives the agent a place to
write curated facts down and a way to find them again later without treating
full session history as memory. Public systems in this area expose recurring
tradeoffs, but their documented behavior varies enough that Pi should borrow
patterns conservatively rather than treat any single implementation as settled.

## Research Summary

As of 2026-03-30, the public docs for comparable systems support a few
conservative observations. This section is a snapshot of documented behavior,
not a claim that these systems are static or identical.

The most useful public reference points are:

- **Claude Code auto memory.** Current docs describe a machine-local
  per-project memory directory under `~/.claude/projects/<project>/memory/`,
  with a concise `MEMORY.md` entrypoint, optional topic files, `/memory`
  inspection, and a startup budget of the first 200 lines or 25 KB of
  `MEMORY.md`. Topic files are read on demand. The documented model is plain
  Markdown and human-editable; the docs do not present typed YAML memory
  categories or age-based reminders as core behavior.

- **Anthropic `memory_20250818` tool.** Current docs describe a beta memory
  tool with `view`, `create`, `str_replace`, `insert`, `delete`, and `rename`
  commands. The backend is implemented by the client and can be file-based,
  database-backed, cloud-backed, or encrypted. The useful signal for Pi is the
  generic CRUD-shaped interface and the explicit security guidance, not a
  complete memory lifecycle model.

- **Cline Memory Bank.** Current docs frame this as a documentation methodology
  implemented through custom instructions or `.clinerules`, not a built-in
  retrieval subsystem. Its canonical prompt explicitly says to read all
  memory-bank files at the start of every task. That makes the approach highly
  auditable, but if followed literally it also creates recurring context
  pressure and offers no first-class invalidation semantics for stale notes.

- **OpenClaw memory.** Current docs describe workspace Markdown memory with a
  curated `MEMORY.md`, dated memory files, automatic pre-compaction flush,
  explicit `memory_search` and `memory_get` tools, and indexed search over
  those files. It is useful as a reference for mixed-mode recall: some memory
  is loaded early, but tool-driven retrieval and ranking do substantial work.
  The workspace-first storage model still carries accidental-commit and privacy
  tradeoffs Pi should avoid by default.

- **QMD.** The current README describes a local search engine for Markdown and
  code with keyword search, semantic search, reranking, direct document
  retrieval, and an MCP surface. It is a plausible future retrieval backend
  because it keeps files canonical and indexes rebuildable. It is not a memory
  lifecycle model: promotion, invalidation, and review policy would still
  belong to Pi.

These references do not imply a single shared design. For Pi, the main lessons
are:

1. Keep Markdown as the source of truth. Treat indexes and summaries as derived
   artifacts that can be rebuilt.
2. Separate cheap append-only capture from curated durable memory when those
   notes have different lifecycles.
3. Budget injected memory aggressively. Load detail lazily.
4. Make recency matter for dated notes, but do not pretend recency alone solves
   staleness.
5. Add explicit invalidation rather than hoping the agent will infer which
   memories are stale.
6. Treat compaction and long-term memory as cooperating concerns, not the same
   mechanism.
7. Keep memory semantics separate from retrieval implementation so search can
   improve without changing the storage model.

## Design Goals

- Memory persists across Pi sessions.
- High-signal facts remain easy to recover across sessions and after compaction.
- Memory files are human-readable, editable, and easy to version if desired.
- The extension works with Pi's current extension API. No core changes.
- The extension complements Pi's session history rather than replacing it.
- The default experience is private and low-risk.
- Retrieval quality can improve over time without requiring embeddings or an
  external service in v1.

## Non-Goals

- Perfect truth maintenance.
- A mandatory vector database or external service.
- A hidden binary format.
- Aggressive autonomous writing with no audit trail.
- Replacing Pi's session history, `/tree`, `/fork`, or compaction summaries.
- Indexing session transcripts.

## Design Rationale

### Two tools, not three

Following the same reasoning as pi-web-search: the agent should face a small,
clear decision surface. Memory has two fundamental operations:

- **I want to find something I learned before.** Use `memory_search`.
- **I want to write something down for later.** Use `memory_write`.

A third tool like `memory_get` (targeted file read) is unnecessary, but only if
`memory_search` returns enough context to make the common case efficient: a
bounded excerpt, exact file path, heading, status/date metadata, and a stable
entry locator such as a line span or derived entry reference. Then `read`
remains available for deeper inspection or surrounding file context. Adding a
third tool increases prompt overhead and routing mistakes without giving the
agent a meaningfully different capability.

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
├── MEMORY.md              # concise derived index for navigation and maintenance
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
deterministic slug derived from this path.

### `MEMORY.md`

The top-level orientation file. In Pi, it should not be treated as recurring
prompt payload because the documented prompt hook, `before_agent_start`, runs
before LLM calls. `MEMORY.md` therefore stays concise and contains:

- Links to topic files with one-line descriptions.
- A short "recently changed" section for orientation.
- Nothing else.

Borrow Claude Code's idea of a concise index, but adapt it to Pi's prompt
model: keep `MEMORY.md` on disk as a lightweight navigation artifact and read
it only on demand. It should be cheap for the extension, the user, or a future
UI to inspect directly, but it should not be preloaded into every model call.

`MEMORY.md` is a derived artifact. It should be rebuildable from the topic files
and recent inbox state. The extension maintains it, but the topic files are
canonical.

### `inbox/YYYY-MM-DD.md`

Daily inbox files are append-only capture. They hold fresh notes that have not
yet earned promotion into topic memory. They are not transcripts; they are a
filtered capture of memory candidates.

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
- Not injected into the prompt by default. Found via search or maintenance.
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

No custom IDs in the on-disk format does not mean "no precise identity at
runtime." The parser can derive an internal `entryRef` and line span for each
entry so tool results and maintenance actions can target one memory entry
precisely without making the Markdown format noisier.

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

1. Search parsed topic entries and recent inbox entries.
2. Use heading boundaries as entry boundaries, not fixed character windows.
3. Exclude entries with `Status: invalid` by default.
4. Down-rank entries with `Status: superseded` unless the query asks for
   history.
5. Prefer recent inbox notes over old ones.
6. Return results with exact file path, heading, status, dates, a bounded
   excerpt, and a stable entry locator such as a line span or derived
   `entryRef`.
7. Provide enough inline context that the agent can usually judge relevance
   without an immediate follow-up `read`.

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
- The user-facing tool should not change when the retrieval backend changes,
  including the use of bounded excerpts and stable entry locators in results.

## Write Model

The extension needs a tighter write policy than most memory-bank-style systems.
The system prompt should steer when the model chooses to write, but the managed
memory root must also be protected in code.

### Managed memory boundary

`memory_write` is the only model-facing write tool for managed memory. Other
mutations such as `/remember`, `/forget`, inbox promotion, invalidation, and
maintenance should reuse the same internal mutation pipeline rather than
writing files ad hoc.

The extension should block direct agent mutations targeting the managed memory
root via generic `write`, `edit`, or obvious `bash` commands in `tool_call`.
Generic reads remain allowed. This keeps memory auditable and schema-aware even
though the files themselves stay human-readable.

All managed mutations should:

1. Normalize the requested path and resolve realpaths before writing.
2. Reject path traversal or symlink escapes outside the managed memory root.
3. Filter obvious secrets and other disallowed content before persisting.
4. Participate in Pi's file mutation queue.

Manual human edits outside the model tool loop remain allowed. On the next
access, the extension should re-parse the corpus and refresh derived artifacts
such as `MEMORY.md` as needed.

### Explicit writes

When the user says a variant of "remember this", "always do X", "never do Y",
or "keep in mind that...", the extension should write a durable memory. Explicit
user requests go directly to a topic file when they express a standing
preference or convention, and to the inbox otherwise.

### Implicit writes

The extension may write memory automatically when the agent judges that a fact
is:

1. Likely useful in a future session.
2. Not obvious from repository state alone and not efficient to recover later
   from session history (code, git history, config files, or old branches).
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
conversation, older detail is reduced to a summary in the active context. Pi
still preserves append-only session history and branch structure, but those are
history/navigation features, not a durable memory layer. If the memory
extension does not act before compaction, durable learnings become harder to
recover in later sessions and easier to miss entirely.

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

The `before_agent_start` hook injects a concise memory contract into the system
prompt. Pi documents this hook as "Before LLM call," so anything inserted here
must be treated as recurring prompt cost, not as a once-per-session cost. The
contract should therefore carry only the decision policy, not project-specific
memory content.

The contract tells the agent:

1. That durable memory is available via `memory_search` and `memory_write`.
2. To use `memory_search` only when the task may depend on facts from prior
   sessions that are not present in the current conversation, repository state,
   or recent tool results.
3. Not to use `memory_search` for routine code inspection, facts that can be
   verified directly from files, or ephemeral details about the current turn.
4. To prefer at most one targeted `memory_search` unless the first result makes
   a follow-up query necessary.
5. To treat memory as advisory: if memory conflicts with the current user
   message, repository state, or fresh tool output, the current source wins.
6. To use `memory_write` only for durable preferences, conventions,
   constraints, or findings likely to matter in a future session.
7. Not to write transient task state, unresolved guesses, summaries of obvious
   file changes, or secrets.

The system prompt should carry the memory policy, not the memory contents. Pi
should not assume any session-start-only injection model or recurrent
memory-content injection without core support. The prompt is guidance, not the
sole enforcement mechanism for managed-memory writes.

## Pi Extension Architecture

### Hooks

| Hook | Purpose |
|------|---------|
| `session_start` | Resolve project ID and memory root. Ensure directory structure exists. |
| `before_agent_start` | Inject the narrow memory decision contract into the system prompt. |
| `session_before_compact` | Pre-compaction flush of durable learnings to inbox. |
| `session_shutdown` | Optionally trigger light maintenance. |
| `tool_call` | Block generic mutations targeting the managed memory root while allowing reads. |

### Tools

| Tool | Purpose |
|------|---------|
| `memory_search` | Query durable memory. Returns ranked entry results with excerpts, locators, paths, headings, status, and dates. |
| `memory_write` | Store a memory note through the managed mutation pipeline. Parameters: `content`, `topic` (optional — routes to topic file; omit for inbox). |

### Commands

| Command | Purpose |
|---------|---------|
| `/memory` | Show memory status: file count, last modified, storage location. |
| `/remember <text>` | Shortcut for explicit durable write. |
| `/forget <query>` | Mark matching memories as invalid. |
| `/dream` | Run maintenance on demand. |

## Prompt Behavior

Pi does not currently expose a documented session-only prompt hook. The design
should therefore treat prompt injection as a recurring cost and keep it minimal.
Instead:

1. At `before_agent_start`, inject only the narrow memory decision contract.
2. Leave `MEMORY.md`, topic files, and inbox notes on disk for on-demand use.
3. Use `memory_search` only when the task appears to require prior-session
   facts.
4. If `memory_search` returns a relevant excerpt and entry locator, let the
   agent use `read` for deeper inspection only when needed.

This directly avoids the failure mode in the literal Cline Memory Bank custom
instructions: reading all memory files into context at the start of every task
regardless of relevance. It also reduces the risk of overusing memory just
because the prompt made memory salient, while keeping durable recall separate
from session replay.

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
3. Narrow recurrent system prompt contract with no memory-content preload.
4. `memory_search` and `memory_write` tools.
5. Direct entry-aware file search, no index.
6. Managed memory boundary with conservative policy for explicit and implicit
   memories.
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
