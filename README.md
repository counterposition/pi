# Pi Monorepo

[Pi](https://github.com/badlogic/pi-coding-agent) is a minimal terminal coding agent. It ships four tools, four execution modes, and a philosophy: adapt Pi to your workflows, not the other way around. Users extend it with TypeScript extensions, skills, prompt templates, and shareable packages.

This repo builds the pieces that extend Pi and teach other coding agents about it.

## What's here

**[`skills/pi`](skills/pi/)** -- A skill that gives coding agents grounded knowledge of Pi's architecture, settings, and extension APIs. Pi's own system prompt already points it at its source documentation, but agents like Claude Code, OpenCode, and Codex CLI have no built-in awareness of Pi. This skill bridges that gap via the [Agent Skills](https://agentskills.io/home) standard. Also installable as a Pi package.

**[`packages/pi-web-search`](packages/pi-web-search/)** -- An extension that adds `web_search` and `web_fetch` tools. Three search backends (Brave, Tavily, Exa) behind a single interface with automatic provider ranking and fallback. Page fetching via Jina Reader.

**[`packages/skill-pi`](packages/skill-pi/)** -- The `pi` skill packaged for `npm`, so `pi install` can fetch it from the registry.

## Install

```bash
# the Pi skill (pick one)
npx skills add counterposition/pi --skill pi
pi install npm:@counterposition/skill-pi

# the web search extension
pi install npm:@counterposition/pi-web-search
```

---

## Contributing

Clone the repo. Pi loads `skills/pi` automatically through `.pi/settings.json` -- no install step needed.

If you use [mise](https://mise.jdx.dev), trust the repo config once to pin Node, pnpm, and CI linters:

```bash
mise trust && mise install
```

### Commands

```bash
pnpm install          # install dependencies
pnpm run check        # lint + format + typecheck + test + validate (the full gate)
pnpm run test         # vitest
pnpm run lint:fix     # oxlint autofix
pnpm run sync:skills  # copy canonical skills into packages/ before release
```

Package-scoped work:

```bash
pnpm --filter @counterposition/pi-web-search run check
pnpm --filter @counterposition/pi-web-search exec vitest run tests/providers.test.ts
```

### Repo structure

```text
skills/pi/              canonical skill source (loaded by Pi and Agent Skills)
packages/skill-pi/      npm package wrapping the pi skill
packages/pi-web-search/ web search extension (TypeScript, vitest tests)
scripts/                validators and sync utilities
docs/                   architecture, ADRs, contributor guides
.pi/settings.json       project-local Pi config
.agents/skills/pi       symlink for Agent Skills-compatible tools
```

### Docs

- [`docs/architecture.md`](docs/architecture.md) -- repo layout, package classes, and design rationale
- [`docs/adding-a-skill.md`](docs/adding-a-skill.md) -- how to add a new skill to this repo
- [`docs/adding-a-package.md`](docs/adding-a-package.md) -- how to add a new publishable package
- [`docs/publishing.md`](docs/publishing.md) -- Changesets workflow and release process
