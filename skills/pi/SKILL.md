---
name: pi
description: "Provides Pi-specific guidance for extensions, skills, `.pi/` config, `settings.json`, `models.json`, packages, providers, themes, SDK/RPC, sessions, and compaction in Pi, the coding agent. Use when the user mentions Pi or Pi-specific terms such as `.pi/`, `SKILL.md`, `createAgentSession()`, `thinkingLevel`, `session_before_compact`, `pi-ai`, `pi-tui`, `pi-agent-core`, or `pi-coding-agent`. Not for Raspberry Pi hardware, the math constant, or unrelated generic tooling."
license: GPLv3
compatibility: "Pi-specific guidance for agents that support Agent Skills"
---

# Pi Coding Agent

Pi is a minimal terminal coding harness. It ships four default tools (`read`, `write`, `edit`, `bash`) and four execution modes (interactive TUI, print, JSON/RPC, SDK). Features like sub-agents, plan mode, permission flows, and MCP are intentionally left to extensions and Pi packages.

Pi's philosophy: **adapt Pi to your workflows, not the other way around**. Users extend it via TypeScript extensions, skills, prompt templates, themes, and shareable Pi packages.

## Architecture at a Glance

The coding-agent stack centers on four core packages. The monorepo also includes adjacent packages such as `pi-web-ui`, `pi-mom`, and `pi-pods`.

| Package | npm | Purpose |
|---------|-----|---------|
| `pi-ai` | `@mariozechner/pi-ai` | Unified LLM API across 20+ providers |
| `pi-agent-core` | `@mariozechner/pi-agent-core` | Agent loop, tool execution, state management |
| `pi-tui` | `@mariozechner/pi-tui` | Terminal UI component library |
| `pi-coding-agent` | `@mariozechner/pi-coding-agent` | CLI, extensions, skills, sessions, settings |

**Source:** [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)

## File System Layout

```text
~/.pi/agent/                    # Global config directory (PI_CODING_AGENT_DIR overrides)
├── settings.json               # Global settings
├── auth.json                   # Credentials (0600 perms)
├── models.json                 # Custom provider/model definitions
├── keybindings.json            # Keyboard shortcuts
├── presets.json                # Named configurations (via preset extension)
├── extensions/                 # Global extensions (auto-discovered)
├── skills/                     # Global skills (auto-discovered)
├── prompts/                    # Global prompt templates (auto-discovered)
├── themes/                     # Custom themes
├── sessions/                   # JSONL session files
└── bin/                        # Tool binaries (fd, ripgrep)

<project>/
├── .pi/                        # Project-local config (overrides global)
│   ├── settings.json           # Project settings (merged over global)
│   ├── extensions/             # Project extensions (auto-discovered)
│   ├── skills/                 # Project skills
│   ├── prompts/                # Project prompt templates
│   ├── themes/                 # Project themes
│   └── agents/                 # Agent definitions (for subagent extension)
```

## Key Concepts

### Extensions

TypeScript modules that hook into Pi's lifecycle. They can register tools, intercept tool calls, add commands, build custom UIs, and persist state. Extensions have **full system access** — they run with the user's permissions.

Read `references/extensions.md` for the complete API, lifecycle events, tool registration, UI methods, and working examples.

### Skills

Markdown-based capability packages (`SKILL.md` with frontmatter). Pi loads skill names and descriptions into the system prompt; the full skill body is read on demand. Skills follow the Agent Skills standard.

Read `references/skills.md` for the authoring guide, frontmatter schema, and directory conventions.

### Settings

Hierarchical JSON configuration: project `.pi/settings.json` merges over global `~/.pi/agent/settings.json`. Controls model, thinking level, compaction, retry, shell, transport, and resource loading.

Read `references/settings.md` for every setting with its type, default, and effect.

### Packages

Bundles of extensions, skills, prompts, and themes distributed via npm, git, or local paths. Installed with `pi install`.

Read `references/packages.md` for the package structure, `pi` manifest field, installation, and publishing.

### Context Files & Prompt Templates

Pi loads `AGENTS.md` or `CLAUDE.md` from the global agent dir and from `cwd` up through parent directories. `.pi/SYSTEM.md` replaces the default system prompt, and `APPEND_SYSTEM.md` appends to it. Prompt templates in `prompts/` directories become slash commands.

Read `references/settings.md` for discovery rules and config keys, and `references/packages.md` for how prompts/themes ship in packages.

### SDK

Programmatic embedding via `createAgentSession()`. Gives full control over models, tools, extensions, sessions, and event streaming.

Read `references/sdk.md` for factory options, event types, and usage patterns.

### Custom Providers & Models

Add any OpenAI-compatible, Anthropic, Google, or custom LLM endpoint via `models.json` or extension-based `registerProvider()`.

Read `references/providers.md` for provider configuration, auth methods, and the model schema.

### Common Patterns

Practical recipes for permission gates, presets, sub-agents, git checkpoints, custom compaction, TUI components, and more.

Read `references/patterns.md` for copy-paste-ready examples.

## Sessions & Compaction

Sessions are append-only JSONL files with a tree structure (entries linked by `id`/`parentId`). This allows branching without modifying history. Key operations:

- **`/tree`** — Navigate the session tree, jump to any point
- **`Shift+T` in `/tree`** — Toggle timestamps on tree entry labels
- **`/compact`** — Manually trigger context compaction
- **`/fork`** — Branch from a specific point
- **Auto-compaction** — Triggers when `contextTokens > contextWindow - reserveTokens`

Compaction walks backward from the newest message, keeping `keepRecentTokens` (default 20,000) of recent conversation, and summarizes everything older. Extensions can intercept compaction via `session_before_compact`.

## Built-in Tools

| Tool | Description |
|------|-------------|
| `read` | Read files (with offset/limit support, images, PDFs) |
| `write` | Create or overwrite files |
| `edit` | Line-based file editing with diffs |
| `bash` | Execute shell commands with streaming output |
| `grep` | Search file contents by pattern |
| `find` | Find files by glob pattern |
| `ls` | List directory contents |

**Common tool sets:** `codingTools()` = `[read, bash, edit, write]`, `readOnlyTools()` = `[read, grep, find, ls]`. When you provide a custom `cwd` and explicit tools in the SDK, use `createCodingTools(cwd)` / `createReadOnlyTools(cwd)` so path resolution stays correct.

## Execution Modes

| Mode | Start with | Use case |
|------|-----------|----------|
| Interactive | `pi` | Full TUI with editor, streaming, keybindings |
| Print | `pi -p "prompt"` | Single-shot text output |
| JSON | `pi --mode json "prompt"` | Newline-delimited event stream |
| RPC | `pi --mode rpc` | JSON-RPC over stdin/stdout for IDE integration |
| SDK | `createAgentSession()` | Embed in Node.js applications |

## Quick Reference: CLI Flags

```text
pi [options] [@files...] [messages...]

# package commands
install <source> [-l]
remove <source> [-l]
uninstall <source> [-l]
update [source]
list
config

# modes and output
-p, --print
--mode json|rpc
--export <in> [out]

# model selection
--provider <name>
--model <pattern>
--api-key <key>
--thinking <level>
--models <patterns>
--list-models [search]

# sessions
-c, --continue
-r, --resume
--session <path|id>
--fork <path|id>
--session-dir <dir>
--no-session

# tools and resources
--tools <list>
--no-tools
-e, --extension <source>
--skill <path>
--prompt-template <path>
--theme <path>
--no-extensions
--no-skills
--no-prompt-templates
--no-themes

# prompts and misc
--system-prompt <text>
--append-system-prompt <text>
--verbose
```

## How to Use This Skill

When working with Pi, read the appropriate reference file for the task at hand:

| Task | Reference |
|------|-----------|
| Writing an extension (tools, commands, events, UI) | `references/extensions.md` |
| Creating a skill (SKILL.md authoring) | `references/skills.md` |
| Configuring Pi (settings.json options) | `references/settings.md` |
| Context files, prompt templates, themes, and resource discovery | `references/settings.md` and `references/packages.md` |
| Building a shareable package | `references/packages.md` |
| Embedding Pi programmatically | `references/sdk.md` |
| Adding LLM providers or models | `references/providers.md` |
| Looking for a recipe or pattern | `references/patterns.md` |
