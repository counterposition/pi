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
    "maxDelayMs": 60000
  }
}
```

Notes:

- `retry.maxDelayMs = 0` disables the cap on server-requested retry delays.
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
    "clearOnShrink": false
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

## Environment Variables

| Variable | Effect |
|----------|--------|
| `PI_CODING_AGENT_DIR` | Override the global agent directory |
| `PI_PACKAGE_DIR` | Override package storage directory |
| `PI_SKIP_VERSION_CHECK` | Skip startup version checks |
| `PI_CACHE_RETENTION` | Use extended prompt-cache retention where supported |
| `VISUAL`, `EDITOR` | External editor for `Ctrl+G` |
| Provider API key env vars | See `references/providers.md` |

## Practical Notes

- Project settings are good for shared package/resource configuration.
- Global settings are better for personal credentials, UI preferences, and model defaults.
- Nested objects are merged; project keys override the same global keys.
