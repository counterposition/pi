# Pi Monorepo

Monorepo for Pi skills, Pi-installable packages, and shared release tooling.

## Install

Cloning this repo is enough to work on the canonical `pi` skill locally:

- Pi loads `./skills/pi` through `.pi/settings.json`.
- Other Agent Skills-compatible tools can load the same skill through `.agents/skills/pi`.
- Extension work in this repo should usually use `pi --extension`, not `pi install`.

If you use `mise`, trust the repo config once and install the pinned local toolchain:

```bash
mise trust
mise install
```

That provisions the repo's expected `node`, `pnpm`, `actionlint`, and `zizmor` versions.

### User installs

```bash
# skill via Agent Skills
npx skills add counterposition/pi --skill pi

# skill via Pi package
pi install npm:@counterposition/skill-pi

# extension via Pi package
pi install npm:@counterposition/pi-web-search
```

### Maintainer smoke tests

Use these when validating the local checkout or the publishable package layout before release:

```bash
# canonical skill from a local checkout
npx skills add /absolute/path/to/pi --skill pi --list

# packaged Pi installs from the monorepo root
pi install ./packages/skill-pi
pi install ./packages/pi-web-search
```

## Repository Layout

- `.pi/settings.json` - project-local Pi config that loads the canonical `pi` skill
- `.agents/skills/pi` - symlink to `skills/pi` for other agents
- `skills/` - canonical skill sources for `npx skills add`
- `packages/` - publishable npm packages for `pi install`
- `docs/` - architecture, ADRs, publishing, and contributor guides
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
