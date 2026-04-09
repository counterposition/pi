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

## Legacy npm guidance

- ID: mem_01JW2ZZB7N6K4Q2R1P8D5H3C9G
- Status: invalid
- Updated: 2026-03-10

This old note said to use npm, but it is invalid.

## Local services requirement

- Status: active
- Updated: 2026-04-04

Integration tests require local Redis before running `pnpm test`.
