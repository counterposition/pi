# Pi Monorepo

Monorepo for Pi skills, Pi-installable packages, and shared release tooling.

## Install

Cloning this repo is enough to work on the canonical `pi` skill locally:

- Pi loads `./skills/pi` through `.pi/settings.json`.
- Other Agent Skills-compatible tools can load the same skill through `.agents/skills/pi`.

### Skills via `npx skills add`

```bash
npx skills add counterposition/pi --skill pi
```

Local smoke-test equivalent:

```bash
npx skills add /absolute/path/to/pi --skill pi --list
```

### Skills via `pi install`

```bash
pi install npm:@counterposition/skill-pi
pi install ./packages/skill-pi
```

### Extensions via `pi install`

```bash
pi install npm:@counterposition/pi-web-search
pi install ./packages/pi-web-search
```

## Repository Layout

- `.pi/settings.json` - project-local Pi config that loads the canonical `pi` skill
- `.agents/skills/pi` - symlink to `skills/pi` for other agents
- `skills/` - canonical skill sources for `npx skills add`
- `packages/` - publishable npm packages for `pi install`
- `docs/` - architecture, publishing, and contributor guides
- `scripts/` - repo validators and packaging helpers

## Available Packages

- `skills/pi` - canonical Pi skill source
- `packages/skill-pi` - npm package that ships only the `pi` skill
- `packages/pi-web-search` - Pi web search extension package

## Workspace Commands

```bash
pnpm install
pnpm run check
pnpm run pack:check
```

See `docs/architecture.md`, `docs/adding-a-skill.md`, `docs/adding-a-package.md`, and `docs/publishing.md` for the repo conventions.
