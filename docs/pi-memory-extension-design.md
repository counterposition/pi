# Pi Memory Extension Design

## Purpose

`@counterposition/pi-memory` gives the Pi coding agent durable memory across
sessions. Memories are Markdown files on disk, human-readable and
human-editable.

Pi's session history and compaction summaries preserve conversation context, but
they are not designed as a durable store of curated facts. AGENTS.md offers one
form of persistence — a user can write "tests require local Redis" there and
the agent will see it in every future session — but it is repo-committed
(public), loaded in full into every prompt (cost grows with size), per-repo
only, and has no lifecycle management.

The memory extension complements AGENTS.md with lower-friction writes
(conversational "remember this" rather than manual file editing), user-local
privacy, cross-project scope, on-demand retrieval that does not grow prompt
cost, and per-entry lifecycle tracking.

In v1, the extension gives the user a way to persist high-signal notes for the
agent and gives the agent a way to search for them. The design is shaped so
that later versions can add autonomous capture and richer retrieval without
changing the storage model.

The extension should borrow the strongest ideas from recent agent memory systems
without inheriting their common failure modes:

- stale memories that never get invalidated
- equal weighting of old and new notes
- repeated prompt-context bloat from loading everything
- summary drift where derived summaries silently replace source facts

## Why This Exists

Pi already preserves session history as append-only JSONL with tree navigation,
forks, and compaction summaries. That gives raw history and branch recovery,
but it does not give the agent a small, durable, queryable store of high-signal
facts that should remain easy to recover across later sessions.

Without that layer, project conventions, user preferences, debugging findings,
and architectural constraints are recoverable only indirectly: by rereading old
branches, leaning on compaction summaries, or rediscovering them from repo
state. That is slow, noisy, and unreliable — a problem that grows worse as
autonomous capture and pre-compaction flush are added in later versions.

V1 solves the narrower problem: the user knows something is important and wants
to tell the agent in a way that persists across sessions. The user writes;
the agent indexes and retrieves. This is a curated notebook with search, not
autonomous knowledge capture — but it establishes the storage model and
retrieval tools that later versions build on.

### Adoption risk of explicit-write-only v1

All three reference systems (Claude Code, Hermes, OpenClaw) converge on
agent-initiated writing as the primary capture path. V1 defers autonomous
capture entirely — the user must say "remember this" for every write. This
creates a bootstrap problem: a memory store that is empty most of the time does
not demonstrate its value, and users who rarely say "remember this" see no
benefit.

The v1 bet is that the storage model and retrieval tools are the hard parts,
and that writing automation is comparatively easy to layer on later. This is
defensible — the user who installs a memory extension is already invested in
curating memory — but the risk should be stated plainly:

- If v1 adoption is low because of write friction, the extension may not
  survive to v1.1.
- The path to autonomous capture (`/dream`, pre-compaction flush) depends on
  Pi exposing an extension LLM call API whose timeline is unknown and outside
  this project's control.

If v1 adoption proves insufficient, a lightweight fallback exists: the agent
can write directly via `memory_write` during conversation without LLM-backed
maintenance. This is weaker than `/dream` (no deduplication, no promotion, no
lineage tracking) but does not depend on any external API and could be explored
before the full maintenance implementation.

## Research Summary

As of 2026-03-30, the public docs for comparable systems support a few
conservative observations. This section is a snapshot of documented behavior,
not a claim that these systems are static or identical.

The most useful public reference points are:

- **Claude Code auto memory.** Current docs describe a machine-local
  per-project memory directory under `~/.claude/projects/<project>/memory/`,
  with a concise `MEMORY.md` entrypoint, optional topic files, `/memory`
  inspection, and a startup budget of the first 200 lines or 25 KB of
  `MEMORY.md`. The docs describe project path derivation from the git
  repository, with one section stating worktrees and subdirectories share a
  single memory directory, though a comparison table elsewhere says scope is
  "per working tree." The intended behavior appears to be repo-shared, but the
  docs are not fully consistent. Topic files are read on demand. Notably, auto
  memory is agent-authored — Claude writes and maintains these files
  autonomously, not in response to explicit user requests. This makes the
  current Claude Code model closer to what this design defers as opt-in
  autonomous capture than to the explicit-write-only v1 policy. Recent versions
  include an AutoDream background process for automatic memory maintenance
  (reorganizing topic files, removing stale entries, rebuilding `MEMORY.md`),
  triggered after roughly 24 hours and 5+ sessions. A manual `/dream` slash
  command is referenced in the UI and code but is not reliably available; a
  GitHub issue notes it as missing for some users.
  The public documentation presents memory as plain Markdown and
  human-editable; it does not describe typed memory categories. However, Claude
  Code's runtime system prompt defines four typed categories (`user`,
  `feedback`, `project`, `reference`) with YAML frontmatter in individual
  memory files — structure not reflected in the public docs.

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

- **OpenClaw memory.** Current docs describe workspace Markdown memory
  (OpenClaw is a messaging-platform personal assistant, not a coding agent,
  but its memory design is relevant as a reference) with a curated
  `MEMORY.md`, dated memory files, automatic pre-compaction flush,
  explicit `memory_search` and `memory_get` tools, and indexed search over
  those files. It is useful as a reference for mixed-mode recall: some memory
  is loaded early, but tool-driven retrieval and ranking do substantial work.
  Its default storage is user-local (`~/.openclaw/workspace`), reducing
  accidental-commit risk, though memory files are plain text on disk. The docs
  warn separately about credential exposure. Pi should still prefer private
  storage by default, but OpenClaw's default is closer to that model than the
  workspace-in-repo pattern this design warns against.

- **QMD.** The current README describes a local search engine for Markdown and
  code with keyword search, semantic search, reranking, direct document
  retrieval, and an MCP surface. It is a plausible future retrieval backend
  because it keeps files canonical and indexes rebuildable. It is not a memory
  lifecycle model: promotion, invalidation, and review policy would still
  belong to Pi.

- **Hermes Agent.** Current source shows a dedicated `memory` tool with three
  actions (`add`, `replace`, `remove`) writing to two capped Markdown files:
  `MEMORY.md` (2,200 chars) and `USER.md` (1,375 chars). The memory snapshot is
  injected frozen into the system prompt at session start and never updated
  mid-session, preserving the LLM's prefix cache. Deep retrieval uses
  `session_search` over raw session transcripts via SQLite FTS5, with results
  summarized by a secondary LLM call (Gemini Flash). The dedicated tool acts as
  a validation gateway — security scanning, size enforcement, deduplication,
  atomic writes — but does not hard-prevent bypass via generic file tools;
  enforcement is behavioral. Hermes also supports pluggable external memory
  providers (Honcho, Holographic, RetainDB, Hindsight, and others), at most one
  active at a time, bridged via an `on_memory_write()` callback. A broader
  comparative analysis covering writing models, retrieval strategies, and file
  format differences across Claude Code, OpenClaw, and Hermes is in
  [docs/research/agent-memory-systems.md](research/agent-memory-systems.md).

Other systems worth noting include Cursor (path-scoped `.mdc` rules with glob
frontmatter, a four-tier rules system, and an evolving agent memory tool) and
Windsurf Cascade (autonomous memory generation that progressively learns project
patterns over extended use). Neither is analyzed in depth here, but Windsurf is
a well-documented example of the autonomous capture model this design defers
to a later version.

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
- Project/worktree scope is explicit rather than an accidental consequence of
  filesystem paths.
- Retrieval quality can improve over time without requiring embeddings or an
  external service in v1.

## Non-Goals

- Perfect truth maintenance.
- A mandatory vector database or external service.
- A hidden binary format.
- Autonomous durable writes in v1.
- Aggressive autonomous writing with no audit trail.
- Replacing Pi's session history, `/tree`, `/fork`, or compaction summaries.
- Indexing session transcripts.
- A general-purpose multi-agent memory substrate with agent-to-agent visibility
  rules or cross-agent coordination primitives.

## Design Rationale

### Two tools, not three

Following the same reasoning as pi-web-search: the agent should face a small,
clear decision surface. Memory has two fundamental operations:

- **I want to find something I learned before.** Use `memory_search`.
- **I want to write something down for later.** Use `memory_write`.

A dedicated `memory_get` is unnecessary because the built-in `read` tool
already serves this purpose. `memory_search` returns enough context to make the
common case efficient: a bounded excerpt, exact file path, heading, status/date
metadata, a stable entry ID, and the current line span for convenience. These
make `read` follow-ups straightforward for deeper inspection or surrounding file
context. Adding a third memory-specific tool increases prompt overhead and
routing mistakes without giving the agent a capability it does not already have.

### Two tools, not one

Search and write have different inputs, different intent, and different failure
modes. A single polymorphic `memory` tool with a `command` parameter would force
the agent to reason about an action selector before forming the request.

The Anthropic SDK's `memory_20250818` beta uses a single-tool multi-command
pattern (view, create, str_replace, insert, delete, rename). That design makes
sense for a general-purpose API primitive. An agent extension can afford a
narrower surface because it controls the storage model and can hide file
management behind better abstractions.

### Two scopes: global and project

Memory has two natural scopes with different lifecycles:

- **Global memory** holds cross-project user preferences and conventions:
  "always use `uv`, never `pip`", "I prefer terse responses", "I'm a senior
  engineer — skip beginner explanations." These follow the user everywhere and
  should not need to be re-taught per project.

- **Project memory** holds facts bound to a specific codebase or working
  directory: build conventions, debugging findings, architecture decisions.
  These are meaningless outside their project.

A third scope — agent-specific memory — is unnecessary because Pi's existing
project-scoping mechanism already covers it. A user who wants a specialized
agent (e.g. a QA reviewer or a scheduling secretary) can give that agent its
own folder. The folder becomes the agent's project, and project-scoped memory
becomes agent-scoped memory with no new concepts. Skills and configuration are
just files in that folder. The memory extension does not need to distinguish
"a codebase I'm working on" from "an agent's home directory."

This means cross-agent knowledge (user preferences that apply to all agents)
flows exclusively through the global layer. Without it, every specialized
agent independently learns the same preferences. The global layer is therefore
load-bearing, not optional.

Search merges both scopes, with project entries taking precedence on conflict.
Writes default to project scope (`memory_write` defaults `scope` to
`project`). The system prompt contract directs the agent to set
`scope: "global"` explicitly for personal preferences that apply across
projects.

Concurrent writes to global memory from multiple Pi sessions are a known v1
limitation. Atomic rename prevents partial writes but not lost appends when two
sessions write to the same topic file simultaneously. In practice this is
unlikely — explicit writes are rare and global writes rarer — but if it becomes
a real problem, file-level advisory locking or append-only entry files (one file
per entry) could address it.

### Private by default

OpenClaw stores memory in the workspace, which is simple but creates
accidental-commit risk. Pi should default to a user-local private store:

- Avoids leaking sensitive recollections into git.
- Matches Pi's existing user-local configuration model under Pi's resolved
  global agent directory.
- Keeps everything on disk as Markdown.

Here, "resolved global agent directory" means the same location Pi already uses
for global settings and extensions: `PI_CODING_AGENT_DIR` when set, otherwise
`~/.pi/agent/`.

A future `storageMode: "workspace"` option can place memory under `.pi/memory/`
for teams that want shared, versioned project memory inside a checkout.
Storage location and memory scope are separate concerns: private storage should
still default to repo-shared memory across worktrees, while workspace storage
would be intentionally checkout-local. Because Pi deep-merges project
`.pi/settings.json` over global settings, workspace storage must not be enabled
by repo-committed project config. If Pi adds that mode later, it should be a
user-level choice in global settings or another explicit user-local opt-in.

### Inbox and topics, not one flat directory

The core insight from studying existing systems is that recently captured notes
and stable durable facts have fundamentally different lifecycles.

A note captured mid-session ("tests require redis to be running locally") might
be valuable or might be transient noise. Routing it directly into curated memory
pollutes the durable store. Routing it into a dated inbox file is cheap, safe,
and lets a later maintenance pass (deferred past v1) decide whether the note
has earned promotion.

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

Any future index files (`MEMORY.md`) or monthly rollups are navigation aids.
They are not authoritative facts. Source notes stay on disk and remain linkable.
If a summary contradicts a source note, the source note wins.

## Storage Model

Default private location:

```text
<agentDir>/memory/
├── global/                    # cross-project user preferences
│   ├── inbox/
│   │   └── ...
│   └── topics/
│       ├── preferences.md     # "always use uv", "prefer terse responses"
│       └── ...
└── projects/<project-id>/     # project-scoped facts
    ├── inbox/
    │   ├── 2026-03-29.md      # append-only daily capture
    │   └── ...
    └── topics/
        ├── build.md           # curated durable memory by topic
        ├── testing.md
        └── ...
```

Global and project memory roots share the same internal structure: `inbox/`
and `topics/`, with the same entry format and metadata.
The only difference is scope. Global memory has no project identity
derivation; it is a single store per user.

`<agentDir>` is Pi's resolved global agent directory: `PI_CODING_AGENT_DIR`
when set, otherwise `~/.pi/agent/`. The memory extension should resolve this
the same way other Pi components already resolve global settings paths, rather
than hardcoding a home-directory path internally.

### Project identity and worktree policy

Project identity is a product decision, not an implementation side effect.

The default v1 policy should be:

- Inside a git repo, all subdirectories and all worktrees that share the same
  underlying repository share one project memory root.
- Outside a git repo, the working directory realpath defines the project.
- The extension derives a canonical identity anchor first, then derives
  `project-id` from that anchor with a fixed normalization and hashing rule.

The important distinction is between repo identity and checkout path. A
worktree path describes where one checkout lives on disk, not the durable
project the memory is about. Most memories in scope here are repo-level facts:
workflow conventions, user preferences for this repo, architectural decisions,
and debugging findings that should survive branch changes. Keying by worktree
path would fragment recall and duplicate maintenance for the same underlying
project.

The implementation anchor should therefore be shared repo identity, not raw
worktree location. In git terms, use the shared repository identity (`git
common dir` or equivalent), not the per-worktree root path.

In v1, the derivation should be:

1. Resolve the canonical identity anchor.
   Inside git, use the repository's shared git common dir and resolve it to an
   absolute realpath. Outside git, use the current working directory resolved
   to an absolute realpath.
2. Normalize the anchor string before hashing.
   Normalize Unicode to NFC, convert path separators to `/`, remove any
   trailing `/` except for a filesystem root, and lowercase the normalized
   string on Windows so equivalent paths hash the same way.
3. Derive a collision-resistant `project-id`.
   Use `<slug>-<hash>`, where `<slug>` is a slugified readable prefix and
   `<hash>` is the first 20 lowercase hex characters of the SHA-256 digest of
   the normalized anchor.

The readable prefix is for operators, not identity. For git repos it should be
derived from the directory that owns the shared git common dir, so all
worktrees of the same repository keep the same prefix. Outside git it should be
derived from the canonical directory basename. If slugification produces an
empty string, use `project`.

This does create a real tradeoff: careless writes could leak branch-local
assumptions across worktrees. The right response in v1 is not accidental
path-based isolation. It is repo-shared memory plus a stricter write policy:
v1 should persist only explicit user-directed memories. If later experience
justifies opt-in autonomous capture, it should be limited to facts expected to
remain valid across worktrees. If Pi later needs isolation for long-lived
branch-specific work, it should add an explicit worktree-local overlay on top
of the repo store rather than changing the base identity model.

### Orientation Summary (No `MEMORY.md` in v1)

The `before_agent_start` hook needs a one-line orientation summary — topic
count (~30 tokens) — to give the agent a signal that relevant memory exists
without loading memory content. This summary is derived at runtime from
filesystem state: glob topic files and format the line. No maintained index
file is needed.

A persistent `MEMORY.md` index becomes useful when the corpus grows large enough
to need a human-browsable table of contents or when `/dream` maintenance needs a
starting point for reorganization. Both are post-v1 concerns. When introduced,
`MEMORY.md` should be a derived artifact maintained by `/dream`, not by the
write path — the topic files remain canonical.

### `inbox/YYYY-MM-DD.md`

Daily inbox files are append-oriented capture. They hold fresh notes that have not
yet earned promotion into topic memory. They are not transcripts; they are a
filtered capture of memory candidates.

Format:

```markdown
# 2026-03-29

## 14:32 — Tests require local Redis

- ID: mem_01JW2YCP4J4P7D9M9YQX4G8P4H
- Status: active
- Context: discovered while debugging integration test failures

The flaky integration test in `packages/api/tests/cache.test.ts` only passes
when Redis is running locally. The CI environment handles this automatically,
but local development requires `docker compose up redis` first.

## 16:10 — User prefers pnpm over npm

- ID: mem_01JW2Z7E36P4WQ5Q1K0T8N2M6A
- Status: active

Always use `pnpm`, not `npm`, for package management in this repo.
```

Characteristics:

- Cheap to write. Append body text within the day; later maintenance may update
  metadata such as `Status`.
- Naturally date-scoped for recency ranking.
- Each entry gets a stable `ID`, so later promotion or invalidation can target
  the exact note rather than a fragile heading/path combination.
- Not injected into the prompt by default. Found via search or maintenance.
- Safe to summarize and archive later.

The inbox exists as scaffolding for future autonomous capture. V1 creates the
directory structure (it costs nothing and avoids a storage migration later) but
does not implement inbox writes, inbox-aware search ranking, or age-based
deprioritization. All v1 writes go to topic files. When autonomous capture
arrives (v1.2), it writes to the inbox; `/dream` maintenance (v1.1) adds the
promotion path from inbox to topics.

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
- ID: mem_01JW2ZZB7N6K4Q2R1P8D5H3C9F
- Status: active
- Updated: 2026-03-29

Always use `pnpm` for package management. The repo uses pnpm workspaces and
the lockfile is `pnpm-lock.yaml`.

## Tests require local Redis
- ID: mem_01JW30BK6K3R6N3Y0F2A1M8Q9D
- Status: active
- Updated: 2026-03-29

Integration tests in `packages/api/tests/` need a local Redis instance.
Run `docker compose up redis` before `pnpm test`.
```

This is still intentionally simple: Markdown headings define entry boundaries,
metadata stays as short bullet lists, and the body stays free-form. The one
extra field that earns its keep is a stable `ID` per entry. That ID is the
durable selector for mutations (and future lineage); headings and line spans
remain navigation aids, not long-lived identity.

V1 entry metadata fields:

- `ID`: a `mem_` prefix followed by a ULID (26 characters of Crockford
  Base32) — stable opaque selector unique across all scopes (required).
  Example: `mem_01JW2YCP4J4P7D9M9YQX4G8P4H`. ULIDs are practically globally
  unique, so collisions are not a real concern, but `/forget` and future
  lineage operations may need to resolve IDs across both global and project
  memory.
- `Status`: `active | invalid` (required)
- `Updated`: date (required for topic entries)

The following fields are reserved for forward compatibility but not populated
or interpreted until maintenance and autonomous capture exist:

- `Source`: `user | assistant`
- `Superseded-by`: entry ID of the replacing entry
- `Promoted-from`: entry ID of the source inbox entry
- `Review-after`: date (for time-sensitive facts)

The parser should ignore unknown metadata fields so hand-added fields do not
break anything. New metadata fields added in future versions have no effect on
entries that predate them; the parser treats missing fields as unset.

`Status` is first-class so stale memories are a data problem, not only a
retrieval problem. In v1, entries are either `active` or `invalid` (set by
`/forget`). The remaining statuses (`promoted`, `superseded`) depend on
maintenance and supersession workflows that do not exist yet.

The parser can still derive an internal `entryRef` and current line span for
each entry at runtime, but those are secondary locators built on top of the
stable `ID`. They are useful for immediate `read` follow-ups, not as the
canonical identity used by lineage or mutation workflows.

### Retrieval is entry-based, not file-based

The files above are organized for humans. Retrieval should operate on parsed
memory entries:

- One topic entry = one heading section in `topics/*.md`.
- One inbox entry (post-v1) = one timestamped heading section in
  `inbox/YYYY-MM-DD.md`.

In v1, retrieval covers topic entries only. The inbox directory exists but
contains no entries until autonomous capture is enabled (v1.2).

Each parsed entry carries the data retrieval actually needs: stable `ID`, file
path, heading, body, status, and dates.

This distinction matters even if the v1 implementation uses simple file
operations. It matters even more for future indexed backends such as QMD,
because they index documents and chunks, not Pi's memory-state semantics. Pi
therefore needs its own entry parser either way.

### Entry parser specification

The entry parser sits between raw Markdown and every operation — search, write,
`/forget`, maintenance. The rules below define what the parser must handle.

**Entry boundaries.** A level-2 heading (`##`) that is not inside a fenced code
block starts a new entry. The entry extends to the next such heading or the end
of the file. Headings at other levels inside the entry body are part of that
entry's content, not new entry boundaries. Headings inside fenced code blocks
(between `` ``` `` fences) must not be treated as boundaries.

**File preamble.** Text before the first `##` heading — including any YAML
frontmatter delimited by `---` and the level-1 topic title — is file-level
metadata, not an entry. The parser should preserve it on write but not return it
as a search result.

**Metadata region.** Zero or more consecutive lines starting with `- `
immediately after the heading line (blank lines between the heading and the
first metadata line are allowed). The metadata region ends at the first
non-blank line that does not start with `- `. A line matching `- ` that does
not contain `: ` (colon followed by a space) is treated as body content, not
metadata — this terminates the metadata region.

**Key-value parsing.** Each metadata line is parsed as `- Key: Value` where the
key is the text before the first `: ` and the value is the trimmed remainder of
the line. Both key and value are trimmed of leading/trailing whitespace.
`- Status:active` (no space after colon) does not parse as metadata.

**Body.** Everything after the metadata region until the next entry boundary.

**Robustness rules:**

- Missing `ID`: the parser assigns a synthetic ID derived from the file path and
  heading text, logs a warning, and includes the entry in results. Mutations
  targeting the entry by this synthetic ID should backfill a proper ULID-based
  `ID` on write.
- Missing `Status`: the parser defaults to `active` and logs a warning.
- Missing `Updated`: acceptable for inbox entries (the date is in the filename);
  for topic entries, the parser defaults to the file's last-modified date and
  logs a warning.
- Unknown metadata fields: ignored (already stated in the metadata section, but
  restated here for completeness).
- Duplicate IDs within a file: the parser keeps only the last entry with that ID
  and logs a warning.
- Duplicate IDs across files: the parser prefers the entry from the more
  recently modified file.
- Empty entries (heading with no metadata or body): valid — the parser returns
  them with an empty body.

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

1. Search both global and project memory, merging results into a single ranked
   list. When entries from both scopes match, project entries take precedence
   on conflict (e.g. a project-scoped "use npm" supersedes a global "use pnpm").
2. In v1, search parsed topic entries only. When inbox writes exist (post-v1),
   also search recent inbox entries, ranked below topic entries and
   deprioritized by age.
3. Use heading boundaries as entry boundaries, not fixed character windows.
4. Exclude entries with `Status: invalid` by default. When `promoted` and
   `superseded` statuses exist (post-v1), exclude `promoted` and down-rank
   `superseded` unless the query asks for history.
5. Return at most `max_results` entries (default 10). Results are ranked and
   truncated, not exhaustive. The caller can override the limit but the
   default should be low enough that a broad query does not flood the context.
6. Return results with stable `ID`, exact file path, heading, status, dates, a
   bounded excerpt (up to 300 characters of body text per entry), the current
   line span for convenience, and the scope (global or project). Dates should
   include a human-readable relative age (e.g. "2026-03-29 (3 days ago)") so
   that staleness is immediately visible in the result. An entry updated 90
   days ago should read "(3 months ago)." This is trivial to compute and makes
   the agent naturally more skeptical of old entries without any prompt-side
   cost.
7. Provide enough inline context that the agent can usually judge relevance
   without an immediate follow-up `read`.

### Matching semantics (v1)

V1 uses lexical matching with the following baseline rules:

1. **Case-insensitive.** All comparisons are case-folded.
2. **Word splitting.** The query string is split into words on whitespace and
   punctuation boundaries. Each word is matched independently.
3. **Word-boundary matching.** A query word matches if it appears at a word
   boundary in the target text — not as an arbitrary substring. "pnpm" matches
   "use pnpm" but not "xpnpmx". Standard word-boundary rules apply (transition
   between alphanumeric and non-alphanumeric characters).
4. **All-words requirement.** An entry matches only if every query word matches
   somewhere in the entry (heading or body). This is an AND, not an OR.
5. **Heading bonus.** Entries where one or more query words match in the heading
   are ranked above entries where all matches are body-only.
6. **Recency tiebreaker.** Among entries with the same heading/body match
   profile, more recently updated entries rank higher.
7. **Scoring.** The ranking function combines: (a) number of query words
   matching in the heading, (b) number of query words matching in the body,
   and (c) recency. The exact weights are an implementation detail, but heading
   matches should dominate over body-only matches, and recency should break
   ties rather than override relevance.

This means a user who writes "remember: always use pnpm" and later searches
"package manager" will get no results — "pnpm" and "package manager" share no
lexical overlap. This is a known limitation of v1 lexical search. The design
accepts it: the user can search "pnpm" and find the entry. QMD-backed semantic
search (post-v1) addresses the vocabulary mismatch problem.

### Future: indexed retrieval via QMD or equivalent

When the corpus grows large enough to make direct grep slow, add a rebuildable
index behind the same `memory_search` interface:

- Index a derived entry corpus, not raw topic files. Each indexed document
  should correspond to one parsed memory entry and be keyed by that entry's
  stable `ID`.
- QMD is a strong candidate backend because it already provides local BM25,
  vector search, reranking, path context, and an embeddable SDK.
- Pi must continue to enforce `Status` and history requests itself before or
  after backend retrieval. When inbox entries exist (post-v1), inbox recency
  ranking is also Pi's responsibility.
- Optional hybrid lexical + semantic retrieval can arrive later without
  changing the user-facing model.
- The user-facing tool should not change when the retrieval backend changes,
  including the use of bounded excerpts, stable entry IDs, and current line
  spans in results.

## Write Model

The extension needs a tighter write policy than most memory-bank-style systems.
In v1, that means durable writes are explicit only: the user asks Pi to
remember or persist something, and the extension routes that request through the
managed write path. The system prompt should reinforce that policy, and the
extension should make the managed write path the preferred path in code. With
Pi's current extension surface, that boundary is best-effort rather than a full
protected-path sandbox.

### Best-effort managed memory boundary

`memory_write` should be the primary model-facing write tool for managed
memory. `/remember` is agent-mediated and routes through `memory_write`. Other
extension-owned mutations such as `/forget`, invalidation, inbox promotion
(deferred), and maintenance (deferred) should reuse the same internal write
path rather than writing files ad hoc.

That write path should resolve and operate on stable entry IDs. Query-driven
flows such as `/forget <query>` or duplicate merging may use search to find
candidates, but the final write must target concrete IDs rather than headings,
paths, or stale line spans.

The extension should intercept direct agent mutations targeting the managed
memory root via `write` and `edit` in `tool_call` — these are reliable because
the hook receives `event.toolName` and `event.input.file_path`, so path-
matching is straightforward. Generic reads remain allowed. Bash command
interception is not included in v1: regex-matching shell strings is inherently
fragile (variable indirection, heredocs, scripting-language one-liners, and
symlinks all defeat it), and the real defense against accidental bash writes is
the system prompt contract directing the agent to use `memory_write`. If real-
world usage shows agents frequently bypassing via bash, targeted interception
can be added then.

This boundary is policy-backed and best-effort, not a complete sandbox. The
system prompt tells the agent to use `memory_write`; the `tool_call` hook
catches common accidents via `write` and `edit`; but if the agent writes to the
memory root through other means, the extension will re-parse on next access
rather than crash.

All managed-path mutations should:

1. Normalize the requested path and resolve realpaths before writing.
2. Reject path traversal or symlink escapes outside the managed memory root.
3. Filter obvious secrets and other disallowed content before persisting.
4. Use atomic filesystem operations (write to a temp file in the same
   directory, then rename) for concurrent-process safety — no partial reads
   by concurrent Pi sessions. This is not a crash-durability guarantee
   (`rename(2)` without `fsync` on the parent directory is not guaranteed to
   persist after a system crash), but data loss on crash is acceptable for a
   memory extension since the user can re-state the memory.

Manual human edits outside the model tool loop remain allowed, and unmanaged
mutations may still happen outside the managed write path. On the next access,
the extension should re-parse the corpus from the canonical topic and inbox
files.

### Explicit writes

In v1, `memory_write` is for explicit user-directed persistence only. When the
user says a variant of "remember this", "always do X", "never do Y", or "keep
in mind that...", the extension should write a durable memory. All v1 writes
go to topic files. The `topic` parameter is required; `memory_write` creates
the topic file on demand if it does not already exist.

The model should not treat "this seems useful later" as sufficient reason to
persist memory on its own in v1. If the user did not ask to remember
something, leave it in session history and ordinary tool traces.

Because v1 memory is repo-shared across worktrees, requests that are clearly
checkout-local should not be persisted as ordinary durable memory. The
extension should ask the user to restate them as repo-wide guidance or leave
them in session history until Pi grows an explicit local scope.

### Corrections in v1

V1 handles stale memories conservatively: it does not populate lineage fields
or interpret replacement relationships. If the user decides an old memory is
wrong, the agent resolves it by ID through `memory_search` and `/forget`
confirms the match before marking it `invalid`. Even a single match requires
user confirmation, since the query might have matched the wrong entry. If the
corrected fact should also be kept, the agent creates a new `memory_write`
entry separately.

This keeps the v1 write surface aligned with the minimal metadata schema:
`memory_write` stays create-only, `/forget` handles the only built-in mutation,
and the reserved lineage fields remain unused until maintenance and autonomous
capture exist. Future versions can add explicit supersession once
`superseded`, `Superseded-by`, and related workflows are active.

### Entry size limit

`memory_write` rejects entries whose body text exceeds 2,000 characters with a
clear error message. The heading and metadata do not count toward this limit.
This prevents a single write from creating an outsized entry that dominates
search excerpts and consumes disproportionate context. Entries approaching this
limit should be split into multiple entries or summarized before writing. The
limit applies to the managed write path; hand-edited files are not rejected by
the parser but oversized entries are truncated in search excerpts.

### Heading extraction from `content`

Each `memory_write` call creates exactly one entry. The first level-2 heading
(for example, `## Use pnpm, not npm`) in `content` becomes the entry heading;
subsequent headings in the same `content` are part of the entry body. If
`content` contains no level-2 heading, the extension derives a heading from the
first sentence. The heading is the primary human-readable label and the text
`memory_search` matches against; the body is everything after it.

### Future: opt-in autonomous capture

Implicit capture is out of scope for v1. The extension should not write memory
just because the agent judges a fact useful, and it should not flush new notes
to memory automatically before compaction. That keeps the first release aligned
with its low-risk claim and makes repo-shared memory across worktrees easier to
trust.

If later usage data justifies autonomous capture, it should be added as a
user-level opt-in with conservative defaults:

1. Capture into the inbox only, never directly into topic files.
2. Limit capture to facts expected to remain valid across worktrees.
3. Skip facts that are cheap to recover from repository files, scripts, CI
   config, or ordinary inspection.
4. Emit a clear report of what was written so users can audit the result.

Examples of plausible future inbox capture candidates:

- "integration tests time out unless local services are started first, and the
  failure message does not make that dependency obvious"
- "after schema changes, deleting the user's stale local cache is the reliable
  fix; rerunning the command alone keeps failing"
- "maintainers expect rollback notes alongside risky migrations, even though
  the repo does not encode that convention"

Examples that should still stay out of memory:

- "edited three files" (transient, obvious from git)
- "the current task is to rename a variable" (ephemeral)
- "assistant thinks the bug is probably in auth" (unresolved guess)
- "the repo uses changesets for versioning publishable packages" (cheap to
  recover from repo files)
- "this workaround only applies on the current migration worktree" (checkout-
  local)
- contents of `.env` files or credentials (secrets)

## Compaction Cooperation

Compaction is the most important integration point. When Pi compacts a long
conversation, older detail is reduced to a summary in the active context. Pi
still preserves append-only session history and branch structure, but those are
history/navigation features, not a durable memory layer. If the memory
extension does not write before compaction, some useful details may become
harder to recover later. V1 should accept that tradeoff rather than introduce
automatic durable writes into a repo-scoped store.

In v1:

1. Compaction summaries remain session artifacts, not memory artifacts.
2. The extension does not attach a pre-compaction memory flush to
   `session_before_compact`.
3. If the user wants something preserved beyond the current session, Pi should
   persist it only through an explicit write path such as `memory_write` or
   `/remember`.

A later opt-in autonomous capture mode could experiment with bounded
`session_before_compact` scanning, but that should be deferred until real usage
shows it improves recall more than it adds noise.

## Maintenance ("Dreaming") — Deferred Past v1

Dreaming is an optional maintenance pass that runs outside the critical path of
normal conversation and performs bounded memory hygiene. It is **deferred past
v1** because the Pi extension API does not currently expose a supported
mechanism for extensions to make LLM calls. The reference surface
(`pi.registerTool`, `pi.registerProvider`,
`ctx.modelRegistry.getApiKeyAndHeaders`, `pi.exec`) provides tool registration,
provider routing, auth credentials, and shell execution — but no `pi.chat()` or
`pi.complete()` for extension-initiated model calls.

An extension could technically make direct provider API calls using
`ctx.modelRegistry.getApiKeyAndHeaders()` and an HTTP client, as the Custom
Compaction pattern in Pi's reference docs implies. This is rejected for v1
because it requires building an undocumented, fragile LLM client inside the
extension — model selection, error handling, and provider compatibility would
all be extension-local guesswork rather than supported API.

Without a supported model-call primitive, `/dream` cannot perform the reasoning
needed for non-trivial promotion, contradiction detection, or semantic
deduplication.

This section documents the intended future shape so that implementation can
begin once Pi exposes the necessary API.

### What dreaming would do

- Promote durable inbox notes into topic files and mark the source inbox
  entries as `promoted`.
- Mark contradictions or stale notes for review.
- Generate or refresh a `MEMORY.md` index to reflect current topic file state.
- Merge duplicate entries within topic files while preserving lineage by ID.
- Flag entries past their `Review-after` date.

### What dreaming would not do

- Invent new facts.
- Rewrite large parts of memory without traceability.
- Delete source notes (only change status).
- Run so often that users lose predictability.

### Triggers (future)

- **Manual:** `/dream` command.
- Automatic triggers such as `session_shutdown` or pre-compaction scanning,
  contingent on Pi documenting a stable model-selection and lifecycle contract
  for extension-launched maintenance work.

### Guardrails (future)

- Hard token budget for the LLM call.
- Write at most N memory mutations per run.
- Emit a maintenance report listing which entry IDs changed and why.
- Prefer append, promote, and supersede over destructive edits.

### Cost (future)

Dreaming requires an LLM call. The extension should use a cost-effective model
for maintenance but should not guess which model that is. It should require an
explicit user-level `dreamModel` configuration and fail fast with a clear
configuration error when it is missing, rather than implicitly reusing the
session's current model. Project settings must not choose the maintenance model
or enable automatic dreaming.

## System Prompt Contract

The `before_agent_start` hook injects a concise memory contract into the system
prompt. Pi documents this hook as "Before LLM call," so anything inserted here
must be treated as recurring prompt cost, not as a once-per-session cost. The
contract carries two things:

1. **A one-line orientation summary** derived from filesystem state — topic
   count (~30 tokens). The extension globs topic files to produce this; no
   index file is read. This gives the agent enough signal to decide whether
   `memory_search` is worth calling without loading memory content. Example:
   `Memory: 3 topics (build, testing, preferences). Use memory_search to find
   specific memories.` The orientation summary should be computed once at
   `session_start` and cached in memory, not recomputed from the filesystem on
   every `before_agent_start` call. The cache is invalidated when
   `memory_write` modifies topic files.
2. **The decision policy** — when to search, when to write, and how to weigh
   memory against current sources.

The decision policy tells the agent:

1. That durable memory is available via `memory_search` and `memory_write`.
2. To use `memory_search` only when the task may depend on facts from prior
   sessions that are not present in the current conversation, repository state,
   or recent tool results.
3. Not to use `memory_search` for routine code inspection, facts that can be
   verified directly from files, or ephemeral details about the current turn.
   When querying memory, to prefer `memory_search` over raw file tools
   (`grep`, `glob`, `read`) targeting the memory root — `memory_search`
   enforces status filtering, scope merging, and ranking that raw reads
   bypass. Raw reads are fine for follow-up inspection of a specific file
   after `memory_search` returns a path.
4. To prefer at most one targeted `memory_search` unless the first result makes
   a follow-up query necessary.
5. To treat memory as advisory: if memory conflicts with the current user
   message, repository state, or fresh tool output, the current source wins.
   Before acting on a memory, verify it against the current repository state
   when verification is cheap (e.g. check that a referenced tool, command, or
   configuration still exists). Do not treat a memory as authoritative if it
   contradicts what the agent observes in the current codebase.
6. To use `memory_write` only when the user explicitly asks Pi to remember or
   persist something.
7. When writing explicitly, to persist only durable preferences, conventions,
   constraints, or findings likely to matter in a future session.
8. Not to write transient task state, unresolved guesses, checkout-local
   branch/worktree quirks, summaries of obvious file changes, or secrets.
9. To prefer existing topics from the orientation summary when choosing a
   `topic` for `memory_write`. Create a new topic only when no existing one
   fits.
10. For personal preferences that apply across projects, to set
    `scope: "global"`. For project-specific facts, use the default `project`
    scope.

The system prompt should carry the memory policy and a minimal orientation
summary, not memory contents. The one-line summary derived from filesystem state
is the only memory-adjacent content in the recurring prompt; it is a signal
about what exists, not the content itself. Pi should not assume any session-start-only
injection model or recurrent memory-content injection without core support. The
prompt is guidance, not the sole enforcement mechanism for managed-memory
writes.

## Pi Extension Architecture

### Hooks

| Hook | Purpose |
|------|---------|
| `session_start` | Resolve the repo-scoped project ID and memory root. Ensure directory structure exists. Compute and cache the orientation summary from filesystem state. |
| `before_agent_start` | Inject the cached orientation summary and the memory decision contract into the system prompt. |
| `tool_call` | Best-effort interception of generic mutations targeting the managed memory root while allowing reads. |

`session_shutdown` and `session_before_compact` remain plausible later hooks
for user-opt-in maintenance or autonomous capture, but v1 should not attach
model-backed maintenance or new durable writes to either lifecycle event. This
is reinforced by the current lack of an extension LLM call API (see
Maintenance section).

### Tools

| Tool | Purpose |
|------|---------|
| `memory_search` | Query durable memory. Parameters: `query` (required — natural-language or keyword search string), `scope` (optional — `global`, `project`, or `all`; defaults to `all`; controls whether to search global memory, project memory, or both), `max_results` (optional — positive integer; defaults to 10; caps the number of returned entries). Returns ranked entry results with IDs, bounded excerpts (up to 300 characters of body), current line spans, paths, headings, status, dates with relative age, and scope. |
| `memory_write` | Create an explicit user-directed memory note through the managed write path. Parameters: `content` (required — the first level-2 heading becomes the entry heading; if absent, the extension derives one from the first sentence), `topic` (required — routes to topic file; the file is created on demand if it does not exist), `scope` (optional — `global` or `project`; defaults to `project`). |

### Commands

| Command | Purpose |
|---------|---------|
| `/memory` | Show memory status: file count, last modified, storage location, and scope policy. |
| `/remember <text>` | Agent-mediated shortcut for explicit durable write. The command injects a prompt directing the agent to persist `<text>` via `memory_write`. The agent decides `topic` and `scope`. |
| `/forget <query>` | Resolve matching memories to entry IDs, then mark those entries as invalid. If the query matches multiple entries, `/forget` presents the matches and asks the user to confirm which entries to invalidate. A single match is also confirmed before invalidation. In non-interactive mode, it reports the matching entry IDs without invalidating any. |

## Prompt Behavior

Pi does not currently expose a documented session-only prompt hook. The design
should therefore treat prompt injection as a recurring cost and keep it minimal.
Instead:

1. At `before_agent_start`, inject the cached orientation summary and the
   narrow memory decision contract. The orientation summary is a single line
   (~30 tokens) computed at `session_start` and invalidated on `memory_write`,
   telling the agent what topics exist without loading memory content.
2. Leave topic files on disk for on-demand use.
3. Use `memory_search` only when the task appears to require prior-session
   facts.
4. If `memory_search` returns a relevant excerpt, entry ID, and current line
   span, let the agent use `read` for deeper inspection only when needed.

This directly avoids the failure mode in the literal Cline Memory Bank custom
instructions: reading all memory files into context at the start of every task
regardless of relevance. It also reduces the risk of overusing memory just
because the prompt made memory salient, while keeping durable recall separate
from session replay.

## Staleness and Invalidation

This is the area where most current designs are weakest.

### Rules

- In v1, contradictory memories are handled through explicit invalidation, not
  lineage. `/forget` marks the stale entry `invalid`, and any corrected fact is
  written as a separate new entry through `memory_write`.
- `invalid` entries remain on disk for traceability but are excluded from
  default search results.
- When maintenance exists (post-v1), promoted inbox source entries remain on
  disk, marked `promoted`, and linked from the topic entry via
  `Promoted-from`.
- When full lineage exists (post-v1), `superseded` entries remain on disk for
  traceability and link to their replacements via `Superseded-by`.
- Entries with `Review-after` dates surface in maintenance reports (post-v1)
  when past due.
- When inbox writes exist (post-v1), inbox notes are naturally deprioritized
  by age in search results.

### Why both status and recency matter

Recency alone cannot invalidate a wrong evergreen fact. When inbox entries exist
(post-v1), status alone cannot keep months of dated inbox notes from crowding
search results. The extension needs both dimensions.

## Settings

```json
{
  "memory": {
    "enabled": true
  }
}
```

This block belongs in user-level settings only. In v1, the extension should
ignore `memory` keys in project `.pi/settings.json` entirely instead of trying
to deep-merge them. That keeps two boundaries hard:

- Enablement is a user choice, not a repo choice.
- Storage/privacy decisions are user choices, not repo choices.

The storage root should follow Pi's resolved global agent directory rather than
assume a literal `~/.pi/agent` path. A custom `PI_CODING_AGENT_DIR` should
move memory with the rest of the user's Pi state.

V1 should not expose settings for implicit capture or pre-compaction flushing,
because both behaviors are deferred entirely.

In v1, scope stays fixed instead of configurable: private memory is repo-shared
across worktrees for git repos and directory-scoped outside git. If Pi later
adds worktree-local memory or workspace storage, those should be explicit
user-level features rather than silent consequences of project config.

When maintenance is eventually implemented, `dreamModel` and related settings
would be added to the `maintenance` key. Those settings should have no implicit
fallback — if unset, the maintenance command should report that it is not
configured rather than silently using the session's current model. Automatic
maintenance triggers, model cost, and maintenance behavior remain user choices,
not repo choices.

If later experience justifies project-level memory settings, they should be
restricted to non-sensitive behavioral hints only. They should never control
enablement, storage root, storage mode, maintenance triggers, or maintenance
model selection.

## Recommended v1 Scope

Ship the smallest version that has the right shape:

1. Private Markdown-backed storage under `<resolved-agent-dir>/memory/` with
   two scopes: `global/` for cross-project user preferences and
   `projects/<project-id>/` keyed by a collision-resistant project identity
   derived from repo identity rather than worktree path.
2. `inbox/` + `topics/` directory structure in both scopes. V1 writes only to
   `topics/`; `inbox/` is created as scaffolding for future autonomous capture.
   Stable per-entry IDs with the minimal v1 metadata schema (`ID`, `Status`,
   and `Updated` for topic entries). Orientation summary derived at runtime
   from filesystem state — no `MEMORY.md` index in v1.
3. Narrow recurrent system prompt contract with no memory-content preload.
4. `memory_search` and create-only `memory_write` tools.
5. Direct entry-aware file search, no index.
6. Managed memory boundary with an explicit-write-only policy.
7. `/memory`, `/remember`, `/forget` commands.
8. User-level settings only; ignore project `memory` config in v1.
9. No maintenance. Pi's extension API does not currently expose an LLM call
   mechanism, so `/dream` is deferred until that API exists.

Do not require in v1:

- SQLite or any index.
- QMD or any other external retrieval runtime.
- Embeddings.
- `/dream` or any maintenance pass (blocked on Pi extension LLM call API).
- Automatic dreaming on shutdown.
- Monthly summaries or archival.
- Workspace storage mode.
- Worktree-local memory overlays.

## Evolution Path

### v1.1

- `/dream` manual maintenance command, contingent on Pi exposing an extension
  LLM call API (e.g. `pi.chat()` or equivalent). Includes `dreamModel`, the
  full metadata schema (`Source`, `Superseded-by`, `Promoted-from`,
  `Review-after`), and inbox-to-topic promotion plus lineage-aware
  maintenance.
- If Pi later documents a stable maintenance model-selection and shutdown
  lifecycle contract, optional automatic maintenance triggers such as session
  shutdown (opt-in, user-level only).
- `Review-after` and expiration surfacing in maintenance reports.
- User-enabled workspace storage mode for shared team memory.

### v1.2

- Optional user-enabled autonomous inbox capture, including bounded
  `session_before_compact` scanning, disabled by default.
- Optional QMD-backed rebuildable index over derived memory entries for larger
  corpora.
- Duplicate suppression and reranking.
- Inbox archival and monthly summary generation.
- Optional explicit worktree-local overlay layered on top of repo-shared
  memory, if real usage shows repo-shared scope is insufficient for long-lived
  branch work.

### v2

- Optional hybrid lexical + semantic retrieval via QMD or an equivalent local
  backend.
- Richer inspection UI for memory lineage.

## Open Questions

1. If Pi later adds opt-in autonomous capture, how aggressive should it be
   before users find the memory store noisy? This probably needs tuning based
   on real usage rather than guessing in the design phase.

2. Should promotion from inbox to topics happen only during `/dream`
   maintenance (post-v1), or also automatically when a note is recalled
   multiple times by `memory_search`? Recall-driven promotion is appealing but
   adds bookkeeping complexity.

3. If Pi later adds an extension LLM call API and automatic maintenance
   triggers, what should the contract be for selecting a maintenance model and
   handling model-backed work during shutdown or other lifecycle events? This
   should follow documented Pi APIs rather than extension-local guesswork.

4. The folder-per-agent pattern means "project" now covers both codebases and
   agent home directories. Should the extension surface this distinction in
   `/memory` status or maintenance reports, or is the abstraction better left
   invisible?
