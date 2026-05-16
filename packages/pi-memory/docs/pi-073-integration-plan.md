# Pi 0.73 Integration Plan

## Purpose

This plan captures the next steps for bringing `@counterposition/pi-memory` in
line with the current Pi coding agent extension API. The core v1 design remains
sound: Markdown is canonical, writes are explicit, memory is searchable on
demand, and no autonomous capture or `/dream` maintenance ships in v1. The work
below is about making that design robust on Pi 0.73.x.

## 1. Patch the `before_agent_start` Breakage

`extensions/memory.ts` currently mutates `event.systemPrompt`. Current Pi
applies system-prompt changes only when a handler returns `{ systemPrompt }`.

Next steps:

- Change the handler to return the merged prompt instead of mutating the event.
- Preserve the existing base prompt and append the memory contract exactly once.
- Rewrite the extension tests so they assert the returned value, matching the
  `pi-web-search` regression-test style.
- Keep a regression test proving the orientation summary and decision contract
  are actually present in the returned prompt.

## 2. Audit Command Output Behavior

`/memory`, `/remember`, and `/forget` currently return strings from command
handlers. Current Pi command handlers do not reliably surface return values to
the user.

Next steps:

- Verify actual behavior against Pi 0.73.x for interactive and non-interactive
  modes.
- If return values are ignored, move command output to explicit UI/custom
  message mechanisms.
- Preserve `/remember` as a direct managed-write shortcut; do not reintroduce a
  model-mediated command flow.
- Keep `/forget` conservative: interactive invalidation requires confirmation,
  while non-interactive mode should report matches without mutating memory.

## 3. Tighten Type Coverage

`src/pi-ambient.d.ts` currently hides API drift with broad `any` types. That let
the prompt-injection bug pass typecheck.

Next steps:

- Prefer typechecking against the real `@earendil-works/pi-coding-agent@0.74.x`
  declarations in dev/test.
- If an ambient shim remains necessary, narrow it to the exact current
  event/result shapes used by this package.
- Update imports toward the documented `typebox` package for schemas while
  keeping `StringEnum` from `@earendil-works/pi-ai`.
- Add type-level coverage for `BeforeAgentStartEventResult` so return-vs-mutate
  mistakes are harder to reintroduce.

## 4. Use Pi's File Mutation Queue

Pi executes sibling tool calls in parallel by default. `pi-memory` has its own
per-file queue, but it does not coordinate with Pi's built-in file mutation
queue or other extension tools.

Next steps:

- Replace or wrap the local queue in `src/write-path.ts` with Pi's exported
  `withFileMutationQueue()`.
- Keep the current path validation, symlink checks, secret filtering, and
  atomic temp-file-and-rename behavior.
- Add or adjust concurrency tests so two memory writes targeting the same topic
  cannot lose updates.
- If practical, add a test that simulates an external file mutation targeting
  the same path and verifies queue participation.

## 5. Fix Deterministic Test Failures

The current test suite is timezone-sensitive: one relative-age assertion expects
`8 days ago` but can compute `7 days ago` in America/Toronto.

Next steps:

- Fix relative-age tests by passing explicit `now` values or freezing a local
  date boundary consistently.
- Avoid assertions that depend on the machine timezone unless timezone behavior
  is the behavior under test.
- Re-run:

```bash
pnpm --filter @counterposition/pi-memory run typecheck
pnpm --filter @counterposition/pi-memory run test
```

## 6. Add Low-Risk v1 Polish

Pi now supports tool-level `promptSnippet` and `promptGuidelines`. These can
carry static memory guidance through Pi's native tool prompt surface.

Next steps:

- Add concise `promptSnippet` values for `memory_search`, `memory_write`, and
  `memory_move`.
- Add carefully worded `promptGuidelines` that name each tool explicitly.
- Keep dynamic orientation in `before_agent_start`; do not inject memory
  contents into the system prompt.
- Consider `session_compact` only as a state-reset hook. Do not attach automatic
  memory writes to compaction in v1.

## 7. Update the Design Notes

The v1 design doc says `/dream` is blocked because extensions lack a supported
LLM-call path. That is no longer strictly accurate: current Pi examples show
extension-launched model calls through `@earendil-works/pi-ai` and
`ctx.modelRegistry`.

Next steps:

- Update the `/dream` section to say the feature remains deferred for product
  risk, write-safety, and configuration reasons, not because it is impossible.
- Preserve the requirement that any future `/dream` is explicit, opt-in,
  model-configured, bounded, and provenance-preserving.
- Add a short Pi 0.73 integration note covering:
  - return-based `before_agent_start` prompt updates
  - command output behavior
  - parallel tool execution and file mutation queues
  - TypeBox 1.x schema imports

## Recommended Order

1. Fix `before_agent_start` and its tests.
2. Fix command output behavior if current Pi ignores handler return values.
3. Tighten type coverage so API drift is visible.
4. Move writes onto Pi's file mutation queue.
5. Fix timezone-sensitive tests.
6. Add tool prompt metadata.
7. Update design documentation.
