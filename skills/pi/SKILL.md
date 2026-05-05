---
name: pi
description: "Provides Pi-specific guidance for extensions, skills, `.pi/` config, `settings.json`, `models.json`, packages, providers, themes, SDK/RPC, sessions, and compaction in Pi, the coding agent. Use when the user mentions Pi or Pi-specific terms such as `.pi/`, `SKILL.md`, `createAgentSession()`, `thinkingLevel`, `session_before_compact`, `pi-ai`, `pi-tui`, `pi-agent-core`, or `pi-coding-agent`. Not for Raspberry Pi hardware, the math constant, or unrelated generic tooling."
license: GPLv3
compatibility: "Pi-specific guidance for agents that support Agent Skills"
---

# Pi Coding Agent

Pi is a minimal terminal coding harness. Default tools: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`. Modes: interactive (`pi`), print (`pi -p`), JSON (`--mode json`), RPC (`--mode rpc`), or embedded (`createAgentSession()`). Sub-agents, plan mode, permission flows, and MCP are intentionally left to extensions and Pi packages.

Pi's philosophy: **adapt Pi to your workflows, not the other way around**.

## Architecture

Four core packages on npm (source: [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)):

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-ai` | Unified LLM API across 20+ providers |
| `@mariozechner/pi-agent-core` | Agent loop, tool execution, state |
| `@mariozechner/pi-tui` | Terminal UI components |
| `@mariozechner/pi-coding-agent` | CLI, extensions, skills, sessions, settings |

## File System Layout

```text
~/.pi/agent/                    # Global config dir (PI_CODING_AGENT_DIR overrides)
├── settings.json               # Global settings
├── auth.json                   # Credentials (0600 perms)
├── models.json                 # Custom provider/model definitions
├── keybindings.json            # Keyboard shortcuts
├── extensions/                 # Auto-discovered
├── skills/                     # Auto-discovered
├── prompts/                    # Auto-discovered
├── themes/                     # Custom themes
└── sessions/                   # JSONL session files

<project>/
└── .pi/                        # Project-local config (overrides global)
    ├── settings.json
    ├── extensions/
    ├── skills/
    ├── prompts/
    ├── themes/
    └── agents/                 # Agent definitions (subagent extension)
```

## Key Concepts

- **Extensions** — TypeScript modules with full system access. Hook into Pi's lifecycle to register tools, intercept calls, add commands, build UI. → `references/extensions.md`
- **Skills** — Markdown capability packages (`SKILL.md` + frontmatter) following the Agent Skills standard. Pi loads names + descriptions into the system prompt; bodies load on demand. → `references/skills.md`
- **Settings** — Hierarchical JSON: project `.pi/settings.json` merges over global `~/.pi/agent/settings.json`. → `references/settings.md`
- **Packages** — Bundles of extensions/skills/prompts/themes via npm, git, or local paths. Installed with `pi install`. → `references/packages.md`
- **Context files & prompt templates** — Pi loads `AGENTS.md` / `CLAUDE.md` from the agent dir and from `cwd` up through ancestors. `.pi/SYSTEM.md` replaces the system prompt; `APPEND_SYSTEM.md` appends. Prompt templates in `prompts/` become slash commands. → `references/settings.md`
- **SDK** — Programmatic embedding via `createAgentSession()`; `createAgentSessionRuntime()` for session replacement. → `references/sdk.md`
- **Custom providers & models** — `models.json` or extension `pi.registerProvider()` for any OpenAI-/Anthropic-/Google-compatible or custom LLM endpoint. → `references/providers.md`
- **Sessions & compaction** — Append-only JSONL with a tree structure; branch with `/tree`, `/fork`, `/clone`, compact with `/compact`. Auto-compaction triggers when `contextTokens > contextWindow - reserveTokens`. Extensions intercept via `session_before_compact`. → `references/extensions.md` and `references/sdk.md`

## How to Use This Skill

| Task | Reference |
|------|-----------|
| Writing an extension (tools, commands, events, UI) | `references/extensions.md` |
| Creating a skill | `references/skills.md` |
| Configuring Pi (settings, env vars, CLI flags) | `references/settings.md` |
| Building a shareable package | `references/packages.md` |
| Embedding Pi programmatically | `references/sdk.md` |
| Adding LLM providers or models | `references/providers.md` |
| Looking for a recipe or pattern | `references/patterns.md` |

For exact CLI flags run `pi --help` or read the relevant reference. Resource flags (`--no-extensions`, `--no-skills`, `--no-context-files`, `--no-builtin-tools`, etc.) are documented in `references/settings.md`.
