# Pi Skill

Pi's own system prompt already points it at its source documentation. But when you use a different coding agent — Claude Code, OpenCode, Codex CLI, or an IDE agent like Cursor or Windsurf — to work on Pi extensions, skills, packages, or configuration, that agent has no built-in knowledge of Pi's architecture. It will hallucinate APIs, invent settings, and confidently describe extension hooks that don't exist.

This skill gives any coding agent grounded knowledge of Pi via the [Agent Skills](https://agentskills.io/home) standard. It injects task-specific reference documentation into context so the agent reasons from facts — about extensions, settings, providers, sessions, and the SDK — rather than from plausible fictions.

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

| Path | Purpose |
|---|---|
| `SKILL.md` | Trigger rules and routing description |
| `references/` | Task-specific Pi reference documents |
| `evals/evals.json` | Example evaluation cases |
| `LICENSE.md` | GPLv3 license text |
