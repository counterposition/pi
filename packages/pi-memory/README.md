# Pi Memory

`@counterposition/pi-memory` is a
[Pi](https://github.com/earendil-works/pi) extension that gives the
agent a durable, human-readable memory store on disk.

V1 ships a private Markdown-backed store under Pi's resolved agent directory,
two scopes (`global` and `project`), entry-aware `memory_search`,
explicit-only `memory_write`, corrective `memory_move`, and `/memory`,
`/remember`, and `/forget`.

## V1 Scope

- Markdown files are canonical.
- Topic files live under `<agentDir>/memory/global/topics/` and
  `<agentDir>/memory/projects/<project-id>/topics/`.
- Search is deterministic lexical ranking over parsed entries, not embeddings
  or a database.
- Writes are explicit only and go through a managed write path.
- Scope/topic corrections go through `memory_move` so entries relocate instead
  of being duplicated.
- Invalid memories remain on disk with `Status: invalid` and are filtered from
  normal search.

## Non-Goals

- Autonomous memory capture
- `/dream` or any maintenance pass
- Semantic contradiction detection
- Workspace storage mode
- A required index, SQLite database, or vector store

## Install

```bash
pi install npm:@counterposition/pi-memory
```
