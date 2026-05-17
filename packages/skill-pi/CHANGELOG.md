# @counterposition/skill-pi

## 0.74.1

### Patch Changes

- Sync the Pi skill with Pi 0.74.1, including relaxed skill-name directory
  guidance and updated custom-provider notes for Together/OpenRouter thinking
  formats and context-overflow recovery.

## 0.74.0

### Minor Changes

- Update the Pi skill for Pi 0.74.0, including the official
  `@earendil-works/*` package scope and `earendil-works/pi` source repository.
- Refresh package guidance so Pi-provided libraries, including `typebox`, are
  declared as peer dependencies with `"*"` ranges.

## 0.73.0

### Minor Changes

- 8519110: # skill-pi

  Sync skill docs with the Pi 0.73.x coding agent and tighten the skill for token efficiency.

  - SDK `tools` is now a `string[]` name allowlist (Pi 0.68); document `noTools: "all" | "builtin"` and drop references to the removed `readTool`/`bashTool`/`codingTools`/`readOnlyTools` exports.
  - Document the new extension surface: `terminate: true` on tool results, `defineTool()`, `ctx.ui.setWorkingIndicator`/`setWorkingVisible`/`addAutocompleteProvider`/`getEditorComponent`, `before_agent_start.systemPromptOptions`, `after_provider_response`, `thinking_level_select`, `message_end` replacement, `session_shutdown.{reason,targetSessionFile}`, `ctx.fork(id, {position})` plus `/clone`, and `pi.unregisterProvider`.
  - Switch TypeBox guidance to `typebox` 1.x (legacy `@sinclair/typebox` still aliased).
  - Refresh the providers reference: remove Google Gemini CLI / Antigravity, add DeepSeek, Cloudflare AI Gateway / Workers AI, Moonshot, Fireworks, and Xiaomi MiMo (+ regional Token Plan variants); replace `compat.reasoningEffortMap` with model-level `thinkingLevelMap`; cover per-model `baseUrl` overrides and Azure Cognitive Services endpoints.
  - Settings: add `terminal.showTerminalProgress`/`imageWidthCells`, `retry.provider.*`, `warnings.anthropicExtraUsage`, `enableInstallTelemetry`, and the `PI_CODING_AGENT_SESSION_DIR`/`PI_OFFLINE`/`PI_TELEMETRY`/`PI_OAUTH_CALLBACK_HOST` env vars; absorb the CLI-flag cheatsheet so SKILL.md can stay routing-focused.
  - Trim SKILL.md from ~210 lines to ~70, dropping the redundant CLI dump, built-in tools table, and execution-modes table; condense niche compat-flag prose in the providers reference into a single pointer to upstream `models.md`.

## 0.65.1

### Patch Changes

- Track the latest stable Pi coding agent release and publish the synced Pi skill docs for Pi 0.65.x.

## 0.1.1

### Patch Changes

- Republish the package metadata update that adds the `pi-package` keyword so pi.dev can discover both npm packages.
