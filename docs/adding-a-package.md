# Adding a Package

## Create the Package

1. Add a new directory under `packages/`.
2. Create `package.json` with `name`, `version`, `description`, `license`, `repository.directory`, `engines.node`, `publishConfig.access`, and `files`.
3. Add a Pi manifest under `pi` when you need explicit `extensions`, `skills`, `prompts`, or `themes` paths.

## TypeScript Packages

- Extend `../../tsconfig.base.json`.
- Reuse the root Oxlint and Oxfmt config.
- Add `lint`, `format`, `format:check`, `typecheck`, `test`, `check`, and `pack:check` scripts as needed.

## Validation

Run:

```bash
pnpm --filter <package-name> run check
pnpm --filter <package-name> run pack:check
pnpm run validate:packages
```

## Publishing Readiness

- Keep package contents narrow with `files`.
- Verify the package works from a tarball when practical.
- Add a changeset when the package changes in a publishable way.
