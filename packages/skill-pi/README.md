# Pi Skill

> Knowing others is intelligence; knowing yourself is true wisdom.
>
> — Lao Tzu, _Tao Te Ching_

A coding agent that cannot reason about its own architecture will invent APIs that don't exist, hallucinate configuration formats, and give confident wrong answers about its own internals. The failure mode is subtle: the answers _sound_ right, because the agent knows how systems like it tend to work. But Pi is specific, and the details matter.

This skill gives Pi self-knowledge. It injects task-specific reference documentation into context so that Pi reasons from grounded facts — about its extensions, settings, providers, sessions, and SDK — rather than from plausible fictions.

Without this skill, Pi guesses about itself. With it, Pi _knows_.

## Install

```bash
# as a skill
npx skills add counterposition/pi --skill pi

# as a Pi package
pi install npm:@counterposition/skill-pi
```

### Maintainer Paths

```bash
# from a local checkout
npx skills add /absolute/path/to/pi --skill pi

# packaged install from monorepo root
pi install ./packages/skill-pi
```

If you develop inside this repo, Pi already loads the skill via `.pi/settings.json`.

## What this covers

Pi's architecture and package layout. Skill authoring, discovery, and routing. Extensions, tools, and UI hooks. Settings, models, providers, and packages. Sessions, forks, and compaction. The SDK and RPC interface.

The reference material lives in `references/` as task-specific documents — not a single monolith, but pieces sized for injection into a conversation when relevant.

## Files

| Path               | Purpose                               |
| ------------------ | ------------------------------------- |
| `SKILL.md`         | Trigger rules and routing description |
| `references/`      | Task-specific Pi reference documents  |
| `evals/evals.json` | Example evaluation cases              |
| `LICENSE.md`       | GPLv3 license text                    |
