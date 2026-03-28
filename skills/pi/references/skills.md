# Skills

Skills are self-contained capability packages that Pi's agent loads on demand. They follow the [Agent Skills standard](https://github.com/anthropics/agent-skills).

## How Skills Work

1. At startup, Pi discovers all skills and loads their **name + description** into the system prompt as XML.
2. When the agent encounters a task matching a skill's description, it uses the `read` tool to load the full `SKILL.md`.
3. The skill body contains detailed instructions, and may reference additional files in subdirectories.

This progressive disclosure keeps the system prompt lean while making deep knowledge available when needed.

## Directory Structure

```text
my-skill/
├── SKILL.md                    # Required — frontmatter + instructions
├── scripts/                    # Optional — executable helper scripts
│   └── build.sh
├── references/                 # Optional — docs loaded into context as needed
│   └── api-reference.md
└── assets/                     # Optional — templates, icons, fonts
    └── template.html
```

## SKILL.md Format

```markdown
---
name: my-skill
description: "What this skill does and when to use it. Be specific about trigger phrases and contexts — Pi tends to under-trigger skills, so make descriptions slightly assertive."
license: MIT
compatibility: "Requires bash and node tools"
---

# My Skill

Instructions for the agent go here. Write in imperative form.
Use markdown formatting. Reference supporting files with relative paths.

## Step 1: Do the thing

Read `references/api-reference.md` for the full API spec, then...
```

## Frontmatter Fields

| Field | Required | Constraints | Notes |
|-------|----------|------------|-------|
| `name` | Yes | 1–64 chars, lowercase `[a-z0-9-]` | Should match directory name |
| `description` | Yes | Max 1024 chars | Primary trigger mechanism — include trigger phrases |
| `license` | No | String | License identifier |
| `compatibility` | No | String | Tool/dependency requirements |
| `allowed-tools` | No | List | Restrict which tools the skill can use |
| `disable-model-invocation` | No | Boolean | If true, agent cannot auto-invoke this skill |

## Discovery Locations

Skills are discovered from (in priority order — first wins on name collision):

1. `.pi/skills/` — project-local
2. `~/.pi/agent/skills/` — global
3. Installed packages (via `pi install`)
4. `settings.json` → `skills` array
5. `pi --skills <path>` CLI argument

Discovery respects `.gitignore`, `.ignore`, and `.fdignore` patterns.

## Invocation

- **Manual:** User types `/skill:my-skill` in the editor
- **Automatic:** Agent reads the skill when it matches the task (progressive disclosure)
- **Disable auto-invoke:** Set `disable-model-invocation: true` in frontmatter

## Writing Good Skills

### Descriptions

The description is the **primary trigger mechanism**. Make it assertive and specific:

**Bad:** `"A tool for working with Docker"`

**Good:** `"How to build, run, and debug Docker containers and docker-compose setups. Use this skill whenever the user mentions Docker, containers, docker-compose, Dockerfiles, container orchestration, or asks about building/deploying containerized applications."`

### Body Structure

- Keep SKILL.md under 500 lines. If approaching this limit, split detail into `references/` files with clear pointers.
- Write in imperative form: "Run the build script" not "You should run the build script."
- Explain **why** behind instructions so the model can adapt to edge cases.
- Include concrete examples with input/output pairs.
- For multi-domain skills, organize by variant in `references/` and let SKILL.md route to the right one.

### Reference Files

- Reference with relative paths: `Read references/aws.md for AWS-specific steps.`
- For files over 300 lines, include a table of contents at the top.
- The model reads these with the `read` tool — they don't go into the system prompt.

### Helper Scripts

Place in `scripts/`. The model can execute them via the `bash` tool. This avoids the model reinventing the wheel for deterministic operations.

## Validation

Pi validates skills at load time:

- Missing `description` → skill not loaded
- Name > 64 chars → warning
- Description > 1024 chars → warning
- Name-directory mismatch → warning
- Duplicate names → first discovered wins, warning issued
