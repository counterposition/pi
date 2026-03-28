# Architecture

This repository separates canonical skill authoring from publishable Pi packages.

## Layout

- `.pi/settings.json` loads the canonical local skill for Pi when working inside this repo.
- `.agents/skills/pi` symlinks to `skills/pi` so other Agent Skills-compatible tools discover the same source.
- `skills/<name>/` holds the canonical source for each skill.
- `packages/skill-<name>/` ships one skill per npm package for `pi install` and local package smoke tests.
- `packages/<other-package>/` holds publishable Pi extensions and future libraries, plus their pre-publish package layouts.
- `scripts/` contains repo-level validation and sync utilities.

## Package Classes

### Canonical Skills

- Live in `skills/`.
- Must include `SKILL.md` and `README.md`.
- Are validated by `pnpm run validate:skills`.
- Stay compatible with `npx skills add <owner>/<repo> --skill <name>`.

### Pi-installable Packages

- Live in `packages/`.
- Publish independently through Changesets.
- Ship Pi-facing assets such as `skills/` or `extensions/`.
- Support maintainer validation via local-path installs like `pi install ./packages/...`.
- Must pass metadata validation and `pnpm pack` checks.

### JSR-worthy Libraries

- Also live in `packages/`.
- Only add `jsr.json` when the package is a real reusable TypeScript library.
- Do not use JSR for skill-only or Pi-extension-only packages.

## Current Inventory

- `skills/pi` - canonical Pi skill.
- `packages/skill-pi` - single-skill npm distribution for `pi install` and local package smoke tests.
- `packages/pi-web-search` - web search extension package and local package smoke-test target.
