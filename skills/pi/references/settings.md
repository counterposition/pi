# Settings

Pi uses hierarchical JSON configuration. Project settings (`.pi/settings.json`) merge over global settings (`~/.pi/agent/settings.json`). Nested objects are deep-merged; project values override global for the same key.

Edit settings directly or use `/settings` in interactive mode.

## Complete Settings Reference

### Model & Thinking

```json
{
  "provider": "anthropic",           // Default provider name
  "model": "claude-sonnet-4-20250514", // Default model ID
  "thinkingLevel": "medium",         // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
  "thinkingLevelBudget": null,       // Custom token budget per thinking level (overrides defaults)
  "modelCyclePatterns": ["claude-*", "gpt-4o"]  // Glob patterns for Ctrl+P model cycling
}
```

### Compaction

```json
{
  "compaction": {
    "enabled": true,                 // Enable auto-compaction
    "reserveTokens": 16384,          // Tokens to reserve for new responses
    "keepRecentTokens": 20000        // Recent tokens to keep uncompacted
  }
}
```

### Branch Summary

```json
{
  "branchSummary": {
    "enabled": true,                 // Summarize when switching branches via /tree
    "maxTokens": 4096,              // Max tokens for summary
    "skipPrompt": false              // Skip confirmation prompt
  }
}
```

### Retry

```json
{
  "retry": {
    "maxRetries": 3,                 // Max automatic retries on transient errors
    "initialDelayMs": 2000,          // First retry delay
    "maxDelayMs": 60000              // Max delay (exponential backoff)
  }
}
```

### Message Delivery

```json
{
  "steeringMode": "all",            // "all" | "one-at-a-time" — how steer messages are delivered
  "followUpMode": "all",            // "all" | "one-at-a-time" — how follow-up messages are delivered
  "transport": "auto"               // "sse" | "websocket" | "auto"
}
```

### Terminal & Images

```json
{
  "terminal": {
    "showImages": true,              // Display images in terminal
    "maxImageWidth": 2000,           // Max image dimensions for resizing
    "maxImageHeight": 2000
  },
  "image": {
    "autoResize": true               // Auto-resize large images before sending to LLM
  }
}
```

### Shell

```json
{
  "shellPath": "/bin/bash",          // Custom shell path (Windows: "C:\\...\\bash.exe")
  "shellCommandPrefix": "",          // Prefix prepended to every bash command
  "npmCommand": "npm"                // npm, pnpm, yarn, bun
}
```

### UI

```json
{
  "theme": "dark",                   // "dark" | "light" | custom theme name
  "showStartupBanner": true,         // Show banner on startup
  "editorPadding": 1,               // Lines of padding in editor
  "showAutoComplete": true,          // Show autocomplete suggestions
  "cursorStyle": "block"            // "block" | "underline" | "bar"
}
```

### Sessions

```json
{
  "sessionDir": null                 // Custom session storage path (default: ~/.pi/agent/sessions/)
}
```

### Resources

Load extensions, skills, prompts, and themes from paths or packages:

```json
{
  "extensions": [
    "~/.pi/agent/extensions/my-ext.ts",
    "npm:@foo/pi-extensions"
  ],
  "skills": [
    ".pi/skills/my-skill",
    "npm:@foo/pi-skills"
  ],
  "prompts": [
    "~/.pi/agent/prompts/"
  ],
  "themes": [
    "npm:@foo/pi-themes"
  ],
  "customPackages": [
    "npm:@foo/pi-package@1.0.0",
    "git:github.com/user/repo",
    "./local/path"
  ]
}
```

### Resource Pattern Matching

Resources support include/exclude patterns:

```json
{
  "skills": [
    "npm:@foo/pi-skills",      // Include all skills from package
    "!secret-skill",            // Exclude by name
    "+override-skill",          // Force-include (overrides exclusions)
    "-unwanted-skill"           // Force-exclude (overrides inclusions)
  ]
}
```

## Environment Variables

| Variable | Effect |
|----------|--------|
| `PI_CODING_AGENT_DIR` | Override global config directory (default: `~/.pi/agent/`) |
| `PI_OFFLINE` | Disable package updates and tool downloads |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| Additional provider env vars | See `references/providers.md` |

## Editing Tips

- Use `/settings` in interactive mode for a guided editor
- Project settings are committed to version control (`.pi/settings.json`) for team sharing
- Global settings (`~/.pi/agent/settings.json`) are personal
- Settings reload on next agent start — no restart needed for most changes
