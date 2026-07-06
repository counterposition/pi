# Settings

Pi uses JSON settings files with project settings overriding global settings:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/settings.json` | Global |
| `.pi/settings.json` | Project |

Edit JSON directly or use `/settings` for common interactive options.

## Model & Thinking

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "hideThinkingBlock": false,
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

- Thinking levels: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`
- `hideThinkingBlock` hides visible thinking output in the UI

## UI & Display

```json
{
  "theme": "dark",
  "quietStartup": false,
  "collapseChangelog": false,
  "doubleEscapeAction": "tree",
  "treeFilterMode": "default",
  "editorPaddingX": 0,
  "outputPad": 1,
  "autocompleteMaxVisible": 5,
  "showHardwareCursor": false,
  "externalEditor": "code --wait"
}
```

- `doubleEscapeAction`: `"tree"`, `"fork"`, or `"none"`
- `treeFilterMode`: `"default"`, `"no-tools"`, `"user-only"`, `"labeled-only"`, or `"all"`
- In `/tree`, `Shift+T` toggles timestamps on entry labels
- `theme` also accepts `"light-name/dark-name"` (Pi 0.79.7) to switch themes automatically with the terminal color scheme; `/` is reserved in theme names for this. On first run Pi detects the terminal background and defaults to `dark` or `light`.
- `outputPad` (Pi 0.80.3, `0` or `1`) sets horizontal padding for user messages, assistant messages, and thinking blocks.
- `externalEditor` (Pi 0.80.3) sets the `Ctrl+G` external editor command and takes precedence over `$VISUAL`/`$EDITOR`.

## Compaction, Branch Summary, Retry

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "branchSummary": {
    "reserveTokens": 16384,
    "skipPrompt": false
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "timeoutMs": 3600000,
      "maxRetries": 0,
      "maxRetryDelayMs": 60000
    }
  }
}
```

Notes:

- `retry.maxRetries` (default `3`) and `retry.baseDelayMs` (default `2000`) govern Pi's own agent-level retry with exponential backoff.
- `retry.provider.*` controls the underlying provider SDK's request timeout and retry/backoff — useful for slow local LLMs and flaky proxies. `retry.provider.timeoutMs` sets the SDK request timeout; `retry.provider.maxRetries` defaults to `0` (keep it there unless you need SDK-level retries, since raising it can let provider retries swallow usage-limit errors before Pi handles them).
- `retry.provider.maxRetryDelayMs` (default `60000`) caps how long a server-requested retry delay can be before the request fails immediately with an informative error; set to `0` to disable the cap. The old top-level `retry.maxDelayMs` was renamed to this and is auto-migrated.
- `branchSummary.skipPrompt` skips the confirmation step when navigating with `/tree`.

## Message Delivery

```json
{
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "transport": "auto",
  "httpIdleTimeoutMs": 300000,
  "websocketConnectTimeoutMs": 15000,
  "httpProxy": "http://127.0.0.1:7890"
}
```

- `steeringMode` and `followUpMode`: `"all"` or `"one-at-a-time"`
- `transport` (default `"auto"`): `"sse"`, `"websocket"`, `"websocket-cached"`, or `"auto"` — the preferred transport for providers that support several
- `httpIdleTimeoutMs` (default `300000`) is the HTTP header/body idle timeout, also applied as the default SDK request timeout for providers that support it (e.g. OpenAI Codex WebSocket waits, llama.cpp). Set to `0` to disable.
- `websocketConnectTimeoutMs` (default `15000`) bounds the WebSocket connect/open handshake. Set to `0` to disable.
- `httpProxy` (Pi 0.79.5, global settings only) is applied as `HTTP_PROXY` and `HTTPS_PROXY` for Pi-managed HTTP clients.

## Terminal, Images, and Shell

```json
{
  "terminal": {
    "showImages": true,
    "clearOnShrink": false,
    "showTerminalProgress": false,
    "imageWidthCells": 60
  },
  "images": {
    "autoResize": true,
    "blockImages": false
  },
  "shellPath": "/bin/bash",
  "shellCommandPrefix": "",
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

- `npmCommand` is argv-style and is used for npm lookup/install operations, including git-package installs. User-scoped npm packages install under `~/.pi/agent/npm/`; project-scoped npm packages install under `.pi/npm/`.
- `terminal.showTerminalProgress` (default `false` since Pi 0.70.0) toggles OSC 9;4 progress reporting in supporting terminals (iTerm2, WezTerm, Windows Terminal, Kitty).
- `terminal.imageWidthCells` (Pi 0.68.1) caps inline tool-output image width in terminal cells.

## Warnings & Telemetry

```json
{
  "warnings": { "anthropicExtraUsage": true },
  "enableInstallTelemetry": true
}
```

`enableInstallTelemetry` sends an anonymous version ping to `pi.dev` once per local changelog advance (interactive mode only). `PI_OFFLINE=1` or `PI_TELEMETRY=0` disable it.

## Sessions, Model Cycling, Markdown

```json
{
  "sessionDir": ".pi/sessions",
  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"],
  "markdown": {
    "codeBlockIndent": " "
  }
}
```

When multiple sources specify a session directory, `--session-dir` takes precedence over `sessionDir` in settings. Pi 0.65.0 removed the old `session_directory` extension/settings hook.

## Project Trust

Since Pi 0.79.0, project-local settings, resources, and packages (`.pi/` settings/extensions/skills/prompts/themes, project packages) only load after the project is trusted. `AGENTS.md` / `CLAUDE.md` context files load regardless of trust. Trust is a loading gate, not a sandbox.

```json
{
  "defaultProjectTrust": "ask"
}
```

- Interactive mode prompts on first use; `/trust` saves a decision (written to `~/.pi/agent/trust.json`; restart Pi to apply).
- `--approve`/`-a` and `--no-approve`/`-na` override trust for one run, including for `pi install` and other package commands. `pi update` never prompts.
- Non-interactive modes (`-p`, `--mode json`, `--mode rpc`) never prompt. Without a saved decision they follow `defaultProjectTrust` (global setting only): `"ask"` (default) and `"never"` skip project resources; `"always"` trusts them.
- Extensions can decide or defer trust via the `project_trust` event and inspect the outcome with `ctx.isProjectTrusted()` — see `references/extensions.md`.

## Resources

These settings control what Pi loads from disk or packages:

```json
{
  "packages": [
    "npm:@foo/pi-tools",
    {
      "source": "git:github.com/user/repo@v1",
      "skills": ["brave-search"],
      "extensions": []
    }
  ],
  "extensions": ["./extensions/my-ext.ts"],
  "skills": ["./skills", "../.claude/skills"],
  "prompts": ["./prompts"],
  "themes": ["./themes"],
  "enableSkillCommands": true
}
```

Notes:

- Paths in `~/.pi/agent/settings.json` resolve relative to `~/.pi/agent`.
- Paths in `.pi/settings.json` resolve relative to `.pi`.
- `packages` loads npm/git/local Pi packages.
- `extensions`, `skills`, `prompts`, and `themes` are for local files/directories.
- `enableSkillCommands` controls `/skill:name` registration.

## Include / Exclude Patterns

Arrays support filtering:

```json
{
  "skills": [
    "./skills",
    "!legacy-skill",
    "+must-load-skill",
    "-blocked-skill"
  ]
}
```

- `!pattern` excludes glob matches
- `+path` force-includes an exact path
- `-path` force-excludes an exact path

## CLI Flags

Run `pi --help` for the authoritative list. Most commonly:

```text
pi [options] [@files...] [messages...]

# package commands: install/remove/uninstall/update/list/config (all support -l for project scope)

# modes
-p, --print                      single-shot text output
--mode json|rpc                  newline-delimited events / JSON-RPC over stdio
--export <in> [out]              export a session to HTML

# model
--provider <name>                e.g. anthropic, openai, google
--model <pattern>                supports provider/id and optional :<thinking>
--api-key <key>
--thinking off|minimal|low|medium|high|xhigh
--models <patterns>              Ctrl+P cycling allowlist
--list-models [search]

# sessions
-c, --continue                   continue most recent session
-r, --resume                     browse and select
--session <path|id>
--session-id <id>                use an exact project-local session id, creating it if missing
--fork <path|id>
--session-dir <dir>
-n, --name <name>                set the session display name at startup
--no-session                     ephemeral

# tools and resources
--tools <list>, -t               name allowlist (read,bash,edit,write,grep,find,ls,...)
--exclude-tools <list>, -xt      disable specific built-in/extension/custom tools, keep the rest
--no-tools, -nt                  disable everything
--no-builtin-tools, -nbt         disable built-ins, keep extension/custom
-e, --extension <source>         repeatable; npm/git/path
--skill <path>                   repeatable
--prompt-template <path>         repeatable
--theme <path>                   repeatable
--no-extensions / --no-skills / --no-prompt-templates / --no-themes
--no-context-files, -nc          skip AGENTS.md / CLAUDE.md discovery

# trust and network
-a, --approve                    trust project-local files for this run
-na, --no-approve                ignore project-local files for this run
--offline                        disable startup network operations (same as PI_OFFLINE=1)

# prompts and misc
--system-prompt <text>           replace default
--append-system-prompt <text>    repeatable; appended with double newlines
--verbose
```

## Environment Variables

| Variable | Effect |
|----------|--------|
| `PI_CODING_AGENT_DIR` | Override the global agent directory |
| `PI_CODING_AGENT_SESSION_DIR` | Override session storage; `--session-dir` still wins |
| `PI_PACKAGE_DIR` | Override package storage directory |
| `PI_SKIP_VERSION_CHECK` | Skip the `pi.dev` latest-version request at startup |
| `PI_OFFLINE` | Disable all startup network operations (update checks, telemetry) |
| `PI_TELEMETRY` | Override install/update telemetry and provider attribution headers (`1`/`0`); does not gate update checks |
| `PI_CACHE_RETENTION` | Set to `long` for extended prompt-cache retention where supported |
| `PI_OAUTH_CALLBACK_HOST` | Bind the OAuth callback server to a custom interface |
| `PI_CODING_AGENT=true` | Set automatically at startup so subprocesses can detect Pi |
| `VISUAL`, `EDITOR` | External editor for `Ctrl+G` (the `externalEditor` setting takes precedence) |
| Provider API key env vars | See `references/providers.md` |

## Practical Notes

- Project settings are good for shared package/resource configuration.
- Global settings are better for personal credentials, UI preferences, and model defaults.
- Nested objects are merged; project keys override the same global keys.
