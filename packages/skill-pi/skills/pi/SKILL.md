---
name: pi
description: "Provides Pi-specific guidance for extensions, skills, `.pi/` config, `settings.json`, `models.json`, `mcp.json`, MCP servers, codemode, packages, providers, themes, SDK/RPC, sessions, and compaction in Pi, the coding agent. Use when the user mentions Pi or Pi-specific terms such as `.pi/`, `SKILL.md`, `createAgentSession()`, `thinkingLevel`, `session_before_compact`, `ctx.executeTool`, `pi-ai`, `pi-tui`, `pi-agent-core`, or `pi-coding-agent`. Not for Raspberry Pi hardware, the math constant, or unrelated generic tooling."
license: GPLv3
compatibility: "Pi-specific guidance for agents that support Agent Skills"
---

# Pi Coding Agent

Pi is a minimal terminal coding harness. Default tools: `read`, `bash`, `edit`, `write`; `grep`, `find`, `ls`, and the Windows `powershell` tool are opt-in via the `defaultTools` setting or `--tools`. Built-in extensions (Pi 0.99.0) add MCP servers, the `codemode` tool (model-written JavaScript that calls other tools), and `tool_search`. `codemode` and `tool_search` start inactive: enable them with `defaultTools`/`--tools`, or let MCP activate them when a server needs them. Modes: interactive (`pi`), print (`pi -p`), JSON (`--mode json`), RPC (`--mode rpc`), or embedded (`createAgentSession()`). Sub-agents, plan mode, and permission flows are intentionally left to extensions and Pi packages. Skill synced with Pi 0.99.1.

Pi's philosophy: **adapt Pi to your workflows, not the other way around**.

## Architecture

Core packages on npm (source: [github.com/earendil-works/pi](https://github.com/earendil-works/pi)):

| Package | Purpose |
|---------|---------|
| `@earendil-works/pi-ai` | Unified LLM API across 20+ providers |
| `@earendil-works/pi-agent-core` | Agent runtime with tool execution and state |
| `@earendil-works/pi-tui` | Terminal UI components |
| `@earendil-works/pi-coding-agent` | CLI, extensions, skills, sessions, settings (also exports `./client` for remote sessions and `./rpc-entry`) |
| `@earendil-works/pi-codemode` | QuickJS sandbox that runs model-written JavaScript against injected tools (Pi 0.99.0) |
| `@earendil-works/pi-mcp` | Standalone MCP client: stdio and streamable HTTP, OAuth (Pi 0.99.0) |
| `@earendil-works/pi-client` / `@earendil-works/pi-protocol` | Experimental remote-session client and wire protocol (Pi 0.84.0) |
| `@earendil-works/pi-telemetry` | Vendor-neutral telemetry contracts (Pi 0.84.0) |

## File System Layout

```text
~/.pi/agent/                    # Global config dir (PI_CODING_AGENT_DIR overrides)
├── settings.json               # Global settings
├── auth.json                   # Credentials (0600 perms)
├── models.json                 # Custom provider/model definitions
├── mcp.json                    # MCP servers (mcp-auth.json holds their OAuth tokens)
├── keybindings.json            # Keyboard shortcuts
├── extensions/                 # Auto-discovered
├── skills/                     # Auto-discovered
├── prompts/                    # Auto-discovered
├── themes/                     # Custom themes
└── sessions/                   # JSONL session files

<project>/
└── .pi/                        # Project-local config (overrides global)
    ├── settings.json
    ├── mcp.json                # Project MCP servers (read only once trusted)
    ├── extensions/
    ├── skills/
    ├── prompts/
    ├── themes/
    └── agents/                 # Agent definitions (subagent extension)
```

## Key Concepts

- **Extensions** — TypeScript modules with full system access. Hook into Pi's lifecycle to register tools, intercept calls, add commands, build UI. → `references/extensions.md`
- **Skills** — Markdown capability packages (`SKILL.md` + frontmatter) following the Agent Skills standard. Pi loads names + descriptions into the system prompt; bodies load on demand. → `references/skills.md`
- **MCP & codemode** — Built-in MCP client configured by `mcp.json` or `pi.registerMcpServer()`; server tools default to `codemode` exposure, reachable from `codemode` scripts rather than declared to the model. Codemode scripts get a tool's `structuredContent` when it declares `outputSchema`, and their nested calls still reach `tool_call` gates. → `references/mcp.md` and `references/codemode.md`
- **Settings** — Hierarchical JSON: project `.pi/settings.json` merges over global `~/.pi/agent/settings.json`. → `references/settings.md`
- **Packages** — Bundles of extensions/skills/prompts/themes via npm, git, or local paths. Installed with `pi install`. → `references/packages.md`
- **Project trust** — Pi 0.79+ asks before loading project-local settings, resources, and packages; decisions persist in `~/.pi/agent/trust.json`. `--approve`/`--no-approve` override per run; `defaultProjectTrust` sets the non-interactive fallback. → `references/settings.md`
- **Context files & prompt templates** — Pi loads `AGENTS.md` / `CLAUDE.md` from the agent dir and from `cwd` up through ancestors. Per-directory `AGENTS.override.md` (Pi 0.84.0) replaces same-directory context files while others layer normally. `.pi/SYSTEM.md` replaces the system prompt; `APPEND_SYSTEM.md` appends. Prompt templates in `prompts/` become slash commands. → `references/settings.md`
- **SDK** — Programmatic embedding via `createAgentSession()`; `createAgentSessionRuntime()` for session replacement. → `references/sdk.md`
- **Custom providers & models** — `models.json` or extension `pi.registerProvider()` (config form or complete pi-ai providers) for any OpenAI-/Anthropic-/Google-compatible or custom LLM endpoint. → `references/providers.md`
- **Sessions & compaction** — Append-only JSONL with a tree structure; branch with `/tree`, `/fork`, `/clone`, compact with `/compact`. Auto-compaction triggers when `contextTokens > contextWindow - reserveTokens`. Extensions intercept via `session_before_compact`. Since Pi 0.87.0 `SessionManager` is canonical for model context: append-only `context_edit` entries omit or replace messages in future requests without rewriting history. → `references/extensions.md` and `references/sdk.md`

## How to Use This Skill

| Task | Reference |
|------|-----------|
| Writing an extension (tools, commands, events, UI) | `references/extensions.md` |
| Connecting MCP servers (`mcp.json`, `pi mcp`, exposure) | `references/mcp.md` |
| Codemode scripts, tool exposure, nested tool calls, permission gates for them | `references/codemode.md` |
| Creating a skill | `references/skills.md` |
| Configuring Pi (settings, env vars, CLI flags) | `references/settings.md` |
| Building a shareable package | `references/packages.md` |
| Embedding Pi programmatically | `references/sdk.md` |
| Adding LLM providers or models, classifiers, image models, virtual models | `references/providers.md` |
| Looking for a recipe or pattern | `references/patterns.md` (compilable examples in `examples/`) |

For exact CLI flags run `pi --help` or read the relevant reference. Resource flags (`--no-extensions`, `--no-skills`, `--no-context-files`, `--no-builtin-tools`, etc.) are documented in `references/settings.md`; `--no-extensions` also disables the built-in extensions, and `-e builtin:<name>` loads one back.
