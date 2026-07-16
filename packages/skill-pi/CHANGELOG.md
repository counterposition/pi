# @counterposition/skill-pi

## 0.80.9

### Minor Changes

- Sync the Pi skill with Pi 0.80.9, covering changes across 0.80.4–0.80.9.
  - SDK (breaking in Pi 0.80.8): rewrite `references/sdk.md` around `ModelRuntime`, which
    replaces the removed `AuthStorage`/`ModelRegistry` SDK surface and the
    `authStorage`/`modelRegistry` options on `createAgentSession()`. Document
    `ModelRuntime.create()` (custom paths, injected pi-ai `CredentialStore`),
    auth resolution priority, `getAuth()`, `checkAuth()`, `readStoredCredential()`,
    the `resolveCliModel`/`resolveModelScopeWithDiagnostics` helpers, named
    `InlineExtension` factories, and the `agent_settled` session/RPC event with
    `willRetry` on `agent_end`.
  - Extensions: document dynamic tool loading (Pi 0.80.7) — additive
    `pi.setActiveTools()` during execution, native deferred loading on Anthropic
    and OpenAI Responses models, Kimi `deferredToolsMode` (Pi 0.80.9), compat
    flags, and cache guidance. Add the `agent_settled` and
    `before_provider_headers` hooks, `pi.registerEntryRenderer()` for TUI-only
    custom entries, provider `refreshModels(context)` discovery, the async
    `ModelRegistry.refresh()`, and `sessionManager.buildContextEntries()`.
  - Providers: xAI subscription login and Radius gateway (Pi 0.80.8), Bedrock
    `/login` API key (Pi 0.80.7), `/login <provider>` autocomplete, live model
    catalog refresh via `/model`, `pi update --models`, and `models-store.json`.
  - models.json: replace the removed `compat.sendSessionIdHeader` with
    `compat.sessionAffinityFormat` (breaking in Pi 0.80.7), add request-wide
    input pricing `cost.tiers` (Pi 0.80.6), `max` in `thinkingLevelMap` with
    hole semantics, and expanded `modelOverrides` (extension-registered models,
    `thinkingLevelMap`).
  - Settings: the `max` thinking level (Pi 0.80.6) across settings and CLI,
    `showCacheMissNotices` (Pi 0.80.4), and `~` expansion for `shellPath`.
  - Packages: `pi update --models`, `pi config -l` with Tab scope switching
    (Pi 0.80.4), and `autoload: false` project-entry delta semantics.

## 0.80.3

### Minor Changes

- Sync the Pi skill with Pi 0.80.3, covering changes across 0.79–0.80.
  - Project trust (Pi 0.79.0): document the trust gate for project-local settings, resources,
    and packages — `/trust`, `trust.json`, `--approve`/`-a` and `--no-approve`/`-na`, the
    `defaultProjectTrust` fallback for non-interactive modes, the `project_trust` extension
    event, and `ctx.isProjectTrusted()`. Note trust gating in the skills and packages
    references and add a project-trust concept bullet to `SKILL.md`.
  - Packages: bare `pi update` now updates Pi only (Pi 0.79.7); document `pi update --all`,
    exact-version updates, and pinned git-ref reconciliation semantics.
  - Settings: add `httpProxy`, `outputPad`, and `externalEditor` (overrides
    `$VISUAL`/`$EDITOR`), plus the `"light-name/dark-name"` automatic theme syntax.
  - Extensions: add `session_info_changed`, `reason`/`willRetry` on
    `session_before_compact`/`session_compact`, autocomplete `triggerCharacters`,
    `CONFIG_DIR_NAME`, and a note on the pi-ai root → `@earendil-works/pi-ai/compat`
    global-API move (Pi 0.80.0).
  - SDK: replace removed root `getModel` with `getBuiltinModel` from
    `@earendil-works/pi-ai/providers/all`, document the compat entrypoint and the removed
    `/base` entrypoints, new public exports (edit diff helpers, RPC extension UI types,
    package asset path helpers), RPC `get_entries`/`get_tree`, the `rpc-entry` subpath,
    and post-compaction token estimates.
  - Providers: correct `auth.json` key resolution (`$ENV_VAR` interpolation; bare uppercase
    names are literals since Pi 0.79.4), document per-credential `env` overrides (Pi 0.79.5),
    optional `models.json` `apiKey` (Pi 0.80.0), the `chat-template` thinking format with
    `chatTemplateKwargs` (Pi 0.79.9), and Microsoft Foundry endpoint URLs for Azure.

## 0.78.1

### Minor Changes

- Sync the Pi skill with Pi 0.78.1, covering changes across 0.76–0.78.
  - Settings: document `--name`/`-n` and `--session-id` for sessions, `--exclude-tools`/`-xt`
    for selective tool disablement, and the `httpIdleTimeoutMs`/`websocketConnectTimeoutMs`
    network timeouts plus the new `transport: "websocket-cached"` option.
  - Correct the retry schema: `retry.maxDelayMs` was renamed to `retry.provider.maxRetryDelayMs`
    (default `60000`); refresh the provider-retry guidance and defaults.
  - Extensions: fix the `ExtensionContext` surface (remove the nonexistent `ctx.session`; add
    `ctx.mode`, `ctx.signal`, `ctx.hasPendingMessages()`, `ctx.shutdown()`, `ctx.compact()`, and
    the command-only `ctx.getSystemPromptOptions()`); note `input` event `streamingBehavior` and
    custom-tool `promptSnippet`/`promptGuidelines` metadata.
  - Providers: add Ant Ling, NVIDIA NIM, and ZAI Coding Plan (China); note the headless
    device-code login option for OpenAI Codex.
  - SDK: bump example model IDs to `claude-opus-4-8`.

## 0.75.0

### Minor Changes

- Sync the Pi skill with Pi 0.75.0, including the new user-scoped npm package
  install location under `~/.pi/agent/npm/`.

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
