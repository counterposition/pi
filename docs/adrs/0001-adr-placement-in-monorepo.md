# 0001: ADR Placement in the Monorepo

## Status

Accepted

## Date

2026-03-29

## Context

This repository is a monorepo with a growing set of independently evolving packages under `packages/`.

Architectural decisions will happen at different scopes:

- Some decisions affect the repository as a whole.
- Some decisions affect only one package.

Keeping all ADRs in one flat top-level directory would mix unrelated package decisions with monorepo-wide decisions and make ownership less clear as the repository grows.

## Decision

Use the plural directory name `adrs/` for consistency with the rest of the repository.

Store ADRs according to the scope of the decision:

- Monorepo-wide ADRs go in `docs/adrs/`.
- Package-specific ADRs go in `packages/<name>/docs/adrs/`.

An ADR is monorepo-wide when it affects multiple packages or repo infrastructure, such as workspace layout, shared tooling, contributor workflow, publishing strategy, or cross-package standards.

An ADR is package-specific when it primarily affects one package's architecture, dependencies, runtime behavior, or operational trade-offs.

## Consequences

- Package maintainers can find decisions next to the package docs and code they govern.
- Repo-wide decisions remain easy to discover from a single root location.
- The repository avoids a root ADR directory that becomes a mixed log of unrelated package decisions.
- Shared discoverability is preserved by keeping monorepo ADRs in `docs/adrs/` and referencing package ADR locations in contributor documentation.
