# Skill Pi Package

Single-skill npm package for installing the `pi` skill with `pi install`.

## Install

```bash
pi install npm:@counterposition/skill-pi
pi install ./packages/skill-pi
```

## Contents

- `skills/pi/` - packaged copy of the canonical Pi skill
- `../../skills/pi` - canonical source used for GitHub-based `npx skills add`

The packaged skill is synced from the canonical source with `pnpm run sync:skills`.
