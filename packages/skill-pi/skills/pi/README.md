# Pi Skill

Reference skill for the Pi coding agent.

- Use when working on Pi extensions, skills, settings, packages, SDK usage, providers, sessions, or compaction.
- Good trigger terms: `.pi/`, `SKILL.md`, `models.json`, `pi-ai`, `pi-tui`, `pi-agent-core`, `pi-coding-agent`.
- Not for Raspberry Pi hardware or the math constant.

## Install

```bash
# multi-skill repo
npx skills add counterposition/pi --skill pi

# local checkout
npx skills add /absolute/path/to/pi --skill pi

# pi install from npm
pi install npm:@counterposition/skill-pi

# pi install from local package
pi install ./packages/skill-pi
```

## Covers

- Pi architecture and package layout
- Skill authoring and discovery
- Extensions, tools, and UI hooks
- Settings, models, providers, and packages
- Sessions, forks, and compaction

## Files

- `SKILL.md` - trigger description and routing
- `LICENSE.md` - bundled GPLv3 license text
- `references/` - task-specific Pi docs
- `evals/evals.json` - example eval cases
