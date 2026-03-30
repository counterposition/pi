# AGENTS.md

This is a `pnpm` monorepo: packages under `packages/*`, canonical skills under `skills/*`, validators under `scripts/`.

- Package manager: `pnpm@10.33.0`  |  Node: `>=24`
- TypeScript: `NodeNext`, `strict`, `verbatimModuleSyntax`
- Test runner: `vitest`  |  Lint/format: `oxlint`, `oxfmt`, `markdownlint-cli2`
- Setup: `pnpm install` (or `mise trust && mise install`)

## Commands

From repo root:

- Full check: `pnpm run check`
- Lint: `pnpm run lint` / `pnpm run lint:fix`
- Format: `pnpm run format` / `pnpm run format:check`
- Typecheck: `pnpm run typecheck`
- Test: `pnpm run test`
- Sync skills: `pnpm run sync:skills`
- Validate: `pnpm run validate:skills`, `pnpm run validate:packages`, `pnpm run pack:check`

Package-scoped (the only code package with tests is `pi-web-search`):

```bash
# Pattern: pnpm --filter @counterposition/pi-web-search run <script>
# Available scripts: lint, format, format:check, typecheck, test, test:watch, check

# Single test file:
pnpm --filter @counterposition/pi-web-search exec vitest run tests/<file>.test.ts
# Single test by name:
pnpm --filter @counterposition/pi-web-search exec vitest run tests/<file>.test.ts -t "test name"
```

Skill-package checks: `pnpm --filter @counterposition/skill-pi run lint`, `format:check`, `pack:check`.

## Repository Expectations

- Canonical skills live under `skills/pi`; packaged copies sync to `packages/skill-pi/skills/pi`.
- Run `pnpm run sync:skills` after changing skill sources (before package validation).
- Validators enforce manifest correctness, `files` allowlists, README/LICENSE presence, and canonical/packaged skill sync.
- Extension packages must include `extensions/` in `files` and `src/` when shipping runtime source.

## Code Style

Follow existing code, not generic defaults. Key rules agents commonly violate:

- **Import `.js` suffixes required** in local TS imports (NodeNext + verbatimModuleSyntax).
- Use `import type` for type-only imports.
- Import order: Node built-ins → external packages → local modules (blank line between groups).
- No `any` — keep `strict`-safe. Use `satisfies` for constrained constants.
- Preserve existing nullability conventions (e.g. `preferredBasicProvider?: X | null`).
- Sparse comments — rely on naming and structure.

## Error Handling

- Normalize provider/network failures into `ProviderError`.
- Preserve abort behavior: rethrow if an `AbortSignal` caused the failure instead of wrapping as timeout.
- Distinguish transient vs permanent failures for fallback logic.
- Catch `unknown`, convert to `Error` before inspecting.

## Testing

- Test files go in `tests/` (globs also match `src/**/*.{test,spec}.ts`).
- Use `vi.mock`/`vi.hoisted` for module-level mock ordering.
- Reset process state (`cwd`, env vars, caches) in `beforeEach`/`afterEach`.
- Prefer focused behavior tests. Bug fix → smallest test proving the fix.

## Editing Guidance

- Minimal diffs matching current formatting.
- Do not introduce new formatters, linters, or test runners.
- Do not rewrite imports away from the `.js` suffix convention.
- If skill sources and packaged copies diverge, sync — don't edit both manually.
