# Skills

Skills are self-contained capability packages that Pi loads on demand. Pi follows the [Agent Skills specification](https://agentskills.io/specification) and stays fairly lenient, warning on many violations instead of hard-failing.

## How Skills Work

1. At startup, Pi scans skill locations and extracts each skill's name and description.
2. The system prompt includes those skills in XML form.
3. When a task matches, the agent uses `read` to load the full `SKILL.md`.
4. The skill body can route to `references/`, `scripts/`, or `assets/` files via relative paths.

This is progressive disclosure: descriptions stay in prompt context, full instructions are loaded only when needed.

## Locations

Pi discovers skills from:

- Global:
  - `~/.pi/agent/skills/`
  - `~/.agents/skills/`
- Project:
  - `.pi/skills/`
  - `.agents/skills/` in `cwd` and ancestor directories
- Packages:
  - `skills/` directories or `pi.skills` entries in `package.json`
- Settings:
  - `skills` array in `settings.json`
- CLI:
  - `--skill <path>` (repeatable, still additive even with `--no-skills`)

Discovery rules:

- Root `.md` files in `.pi/skills/` and `~/.pi/agent/skills/` are loaded as standalone skills.
- Directories containing `SKILL.md` are discovered recursively in all skill locations.
- Root `.md` files in `.agents/skills/` locations are ignored.

## Skill Commands

Every skill can register as `/skill:name` when `enableSkillCommands` is enabled:

```text
/skill:my-skill
/skill:my-skill extra arguments
```

Arguments after the command are appended to the skill body as `User: ...`.

## Directory Structure

```text
my-skill/
├── SKILL.md
├── scripts/
│   └── process.sh
├── references/
│   └── api.md
└── assets/
    └── template.json
```

## SKILL.md Format

```markdown
---
name: my-skill
description: "What this skill does and when to use it. Be specific."
license: MIT
compatibility: "Requires bash"
---

# My Skill

## Setup

Run `npm install` in this directory before first use.

## Usage

Read `references/api.md` for the full details.
```

## Frontmatter

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | 1-64 chars, lowercase letters/numbers/hyphens, must match parent dir |
| `description` | Yes | Max 1024 chars; primary trigger text |
| `license` | No | License name or bundled reference |
| `compatibility` | No | Environment requirements |
| `metadata` | No | Arbitrary key-value mapping |
| `allowed-tools` | No | Experimental, space-delimited list of pre-approved tools |
| `disable-model-invocation` | No | Hides skill from system prompt; user must use `/skill:name` |

## Writing Good Skills

- Make the description specific and assertive. It is the main trigger.
- Keep `SKILL.md` focused and move bulk detail into `references/`.
- Use imperative instructions and explain why when it changes the workflow.
- Use relative links/paths so the agent can open supporting files reliably.
- Put deterministic helper logic in `scripts/` instead of asking the model to recreate it.

## Using Skills from Other Harnesses

To reuse Claude Code or Codex skill directories, add them to settings:

```json
{
  "skills": ["~/.claude/skills", "~/.codex/skills"]
}
```

## Validation

Pi warns on most issues but still loads the skill when possible:

- Name and parent-directory mismatch
- Name too long or invalid
- Description too long
- Duplicate names, where first discovered wins

One hard failure remains: a skill without `description` is not loaded.
