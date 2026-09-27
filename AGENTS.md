# AGENTS.md

## Repository Expectations

- Canonical skills live under `skills/pi`; packaged copies sync to `packages/skill-pi/skills/pi`.
- Run `pnpm run sync:skills` after changing skill sources (before package validation).

## Code Style

Follow existing code, not generic defaults. Key rules agents commonly violate:

- **Import `.js` suffixes required** in local TS imports (NodeNext + verbatimModuleSyntax).
- Import order: Node built-ins → external packages → local modules (blank line between groups).
- No `any` — keep `strict`-safe. Use `satisfies` for constrained constants.
- Preserve existing nullability conventions (e.g. `preferredBasicProvider?: X | null`).
- Sparse comments — rely on naming and structure.

## Error Handling

- Preserve abort behavior: rethrow if an `AbortSignal` caused the failure instead of wrapping as timeout.
- Catch `unknown`, convert to `Error` before inspecting.

## Testing

- Prefer focused behavior tests. Bug fix → smallest test proving the fix.

## Editing Guidance

- Minimal diffs matching current formatting.
- Do not introduce new formatters, linters, or test runners.
- If skill sources and packaged copies diverge, sync — don't edit both manually.
