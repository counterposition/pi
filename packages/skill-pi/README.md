# Skill Pi Package

Single-skill npm package for installing the `pi` skill with `pi install`.

Package versions track the Pi coding agent release that the bundled skill
documentation targets.

## Install

```bash
pi install npm:@counterposition/skill-pi
```

Maintainer smoke test from the monorepo root:

```bash
pi install ./packages/skill-pi
```

## Contents

- `skills/pi/` - packaged copy of the canonical Pi skill
- `../../skills/pi` - canonical source used for GitHub-based `npx skills add`

The packaged skill is synced from the canonical source with `pnpm run sync:skills`.
