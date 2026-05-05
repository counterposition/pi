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
  "autocompleteMaxVisible": 5,
  "showHardwareCursor": false
}
```

- `doubleEscapeAction`: `"tree"`, `"fork"`, or `"none"`
- `treeFilterMode`: `"default"`, `"no-tools"`, `"user-only"`, `"labeled-only"`, or `"all"`
- In `/tree`, `Shift+T` toggles timestamps on entry labels

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
    "maxDelayMs": 60000,
    "provider": {
      "timeoutMs": 0,
      "maxRetries": 0,
      "maxRetryDelayMs": 0
    }
  }
}
```

Notes:

- `retry.maxDelayMs = 0` disables the cap on server-requested retry delays.
- `retry.provider.*` (Pi 0.70.1) controls the underlying provider SDK's request timeout and retry/backoff — useful for slow local LLMs and flaky proxies. Pi forwards these into `streamSimple` request options when set.
- `branchSummary.skipPrompt` skips the confirmation step when navigating with `/tree`.

## Message Delivery

```json
{
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "transport": "sse"
}
```

- `steeringMode` and `followUpMode`: `"all"` or `"one-at-a-time"`
- `transport`: `"sse"`, `"websocket"`, or `"auto"`

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

- `npmCommand` is argv-style and is used for npm lookup/install operations, including git-package installs.
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
--fork <path|id>
--session-dir <dir>
--no-session                     ephemeral

# tools and resources
--tools <list>, -t               name allowlist (read,bash,edit,write,grep,find,ls,...)
--no-tools, -nt                  disable everything
--no-builtin-tools, -nbt         disable built-ins, keep extension/custom
-e, --extension <source>         repeatable; npm/git/path
--skill <path>                   repeatable
--prompt-template <path>         repeatable
--theme <path>                   repeatable
--no-extensions / --no-skills / --no-prompt-templates / --no-themes
--no-context-files, -nc          skip AGENTS.md / CLAUDE.md discovery

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
| `PI_TELEMETRY` | Force install telemetry on/off (`1`/`0`); does not gate update checks |
| `PI_CACHE_RETENTION` | Set to `long` for extended prompt-cache retention where supported |
| `PI_OAUTH_CALLBACK_HOST` | Bind the OAuth callback server to a custom interface |
| `PI_CODING_AGENT=true` | Set automatically at startup so subprocesses can detect Pi |
| `VISUAL`, `EDITOR` | External editor for `Ctrl+G` |
| Provider API key env vars | See `references/providers.md` |

## Practical Notes

- Project settings are good for shared package/resource configuration.
- Global settings are better for personal credentials, UI preferences, and model defaults.
- Nested objects are merged; project keys override the same global keys.
