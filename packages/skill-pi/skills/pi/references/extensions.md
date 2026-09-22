# Extensions

Extensions are TypeScript modules that extend Pi's behavior. They run with the user's full permissions, so treat them like normal application code.

## Placement & Discovery

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | Global |
| `~/.pi/agent/extensions/*/index.ts` | Global |
| `.pi/extensions/*.ts` | Project |
| `.pi/extensions/*/index.ts` | Project |
| `settings.json` → `extensions` | Additional local paths |

Use `pi -e ./my-extension.ts` or `pi --extension ...` for quick tests. Put stable extensions in auto-discovered locations if you want `/reload` to pick them up.

## Common Imports

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
```

- Use `typebox` (1.x) for schemas. Pi 0.83.0 bundles TypeBox 1.3.7, which removed deprecated APIs (`Type.Base`, `Type.Awaited`, `Type.Promise`, `Type.AsyncIterator`, `Type.Iterator`, `Type.Options`, `Value.Mutate`) — migrate extension sources off those before typechecking against current Pi.
- Use `StringEnum` from `@earendil-works/pi-ai` for Google-compatible string enums.
- Pi 0.80.0 moved pi-ai's old global API (`getModel`, `getModels`, `stream`, `complete`, `registerApiProvider`, ...) off the pi-ai root entrypoint to `@earendil-works/pi-ai/compat`. Extensions keep working unchanged at runtime (the extension loader aliases the root to the compat superset), but extension sources that typecheck against pi-ai's published types must import those APIs from `@earendil-works/pi-ai/compat`. `StringEnum` and the type surface remain on the root. The compat entrypoint and loader alias will be removed in a future release.

## Quick Start

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("Extension loaded", "info");
  });

  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // For reusable tool definitions outside `pi.registerTool(...)`, use `defineTool({...})`
  // — it preserves parameter type inference and can be passed via `customTools` to the SDK.

  pi.registerCommand("hello", {
    description: "Say hello",
    async handler(args, ctx) {
      if (ctx.hasUI) ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

## Event Surface

Useful session events:

- `session_start`
- `session_before_switch`
- `session_before_fork`
- `session_before_compact`
- `session_compact`
- `session_before_tree`
- `session_tree`
- `session_info_changed` — observe session display-name changes
- `session_shutdown`
- `resources_discover`
- `project_trust` — user/global and CLI extensions only, fired before project resources load; return `{ trusted: "yes" | "no" | "undecided" }` (optionally `remember: true` to persist). The first yes/no decision wins and suppresses the built-in trust prompt.

`session_before_compact` and `session_compact` carry `reason` and `willRetry` (Pi 0.79.10) so handlers can distinguish manual `/compact`, threshold auto-compaction, and overflow-retry compaction. `session_compact_failed` (Pi 0.84.3) reports failed or aborted compactions with `reason`, `aborted`, `willRetry`, `fromExtension`, and `errorMessage`.

`session_start` carries `event.reason` — `"startup" | "reload" | "new" | "resume" | "fork"` — and `event.previousSessionFile` for `"new"`/`"resume"`/`"fork"`. The old post-transition `session_switch` / `session_fork` events were removed; route all of those flows through `session_start`.

Useful agent events:

- `input` — carries `event.streamingBehavior` (`"steer" | "followUp" | undefined`) so handlers can distinguish idle prompts, mid-stream steers, and queued follow-ups; return `{ action: "transform" | "handled" | "continue" }`
- `before_agent_start` — `event.systemPrompt` is read-only; mutate `event.systemPromptOptions` (sections, selected tools, guidelines) so Pi appends a transcript delta that survives resume/branching and keeps the cached prefix (Pi 0.86.0). Returning `{ systemPrompt }` replaces the whole prompt for that run and is sent as the provider's leading system prompt
- `agent_start`
- `agent_end` — one low-level run; Pi may still auto-retry, auto-compact and retry, or continue with queued follow-ups
- `agent_before_settle` (Pi 0.87.0) — the final actionable boundary before settlement (see below)
- `agent_settled` (Pi 0.80.4) — notification-only; fired when no retry/compaction/follow-up remains, for status integrations that need to know Pi will not continue automatically. Since Pi 0.87.0, runs requested from `agent_settled` handlers are deferred until every settled handler finishes (`ctx.isIdle()` stays true, no reentrant `agent_start`)
- `turn_start`
- `turn_end` — actionable since Pi 0.87.0; carries `turnIndex`, `message`, `toolResults`, and their session entry IDs
- `message_start`
- `message_update`
- `message_end` — return a replacement message to override usage/cost or rewrite the finalized assistant message
- `context` — transforms conversation messages; since Pi 0.87.0 handlers no longer see prompt/tool system messages, and Pi restores that state afterward (filtering or slicing messages is safe)
- `context_with_system` (Pi 0.87.0) — runs after `context` on the full transcript including system messages and is sent verbatim; use only when a request-local transform must own the whole transcript, and keep a system message at index 0
- `before_provider_headers` (Pi 0.80.4) — mutate `event.headers` in place after outgoing HTTP headers are assembled: set a key to a string to add/override, `null` to delete. Runs once per provider request; retries reuse the same headers
- `before_provider_request`
- `after_provider_response` — inspect the provider HTTP status and headers before stream consumption
- `model_select`
- `thinking_level_select` — observe interactive thinking-level changes
- `ui_prompt_start` / `ui_prompt_end` (Pi 0.84.4) — distinguish active agent work from time spent waiting on blocking `ctx.ui` prompts (`kind`: `select`/`confirm`/`input`/`editor`/`custom`)
- `cache_warming_decision` (Pi 0.86.0) — override an idle prompt-cache refresh with `{ action: "warm" }` or `{ action: "stop" }`; the last handler returning an action wins
- `user_bash` — user `!`/`!!` commands. Fails closed since Pi 0.86.0: return `undefined` to pass to the next handler (then local execution), `{ operations }` or `{ result }` to handle it; a throwing handler or invalid result aborts the command

`turn_end` and `agent_before_settle` are actionable boundaries (Pi 0.87.0). Handlers receive the proposed `event.entries`, `event.continue`, a `context` preview, and the run `outcome`, and may return `{ entries: [...event.entries, draft], continue: true }` to persist `custom`, `custom_message`, `context_edit`, or `compaction` entries in order and ensure exactly one next provider request without disturbing steering/follow-up queues. Guard the condition — an unconditional `continue: true` loops.

`pi.on()` returns an unsubscribe function (Pi 0.86.0); handlers added or removed during a dispatch apply from the next dispatch.

Useful tool events:

- `tool_execution_start`
- `tool_call`
- `tool_execution_update`
- `tool_result`
- `tool_execution_end`

Since Pi 0.86.0, tool-call `arguments` and result `details` must be JSON-compatible values (no `Date`, `Map`, class instances, `undefined` array slots); use `details: undefined` when there is nothing structured to keep. Tools registered without a parameter schema are rejected at registration.

Tool results may include `terminate: true` to end the current tool batch without an automatic follow-up LLM turn — useful for tools that produce a structured final answer (see `examples/extensions/structured-output.ts` in the Pi repo). Since Pi 0.84.1, blocked `tool_call` results may also return `terminate: true`; the agent stops early only when every finalized result in the batch is terminating. Tools that make nested LLM calls can return their combined `Usage` as `usage` on the tool result — Pi persists it and includes it in footer, `/session`, and RPC session totals (Pi 0.81.0), and `tool_result` handlers may inspect or replace that value.

`session_shutdown` events carry `event.reason` (`"quit" | "reload" | "new" | "resume" | "fork"`) and, where applicable, `event.targetSessionFile` so cleanup logic can distinguish teardown paths.

## Extension Context

`ctx` (`ExtensionContext`) gives extensions access to:

- `ctx.ui` for interactive UI hooks
- `ctx.mode` — `"tui" | "rpc" | "json" | "print"`; gate terminal-only features on `ctx.mode === "tui"`
- `ctx.cwd`
- `ctx.sessionManager` (read-only; `buildContextEntries()` returns active-branch entries with compaction applied, Pi 0.80.4)
- `ctx.modelRegistry` / `ctx.model` / `ctx.thinkingLevel` / `ctx.scopedModels` (Pi 0.83.0) — `ctx.modelRegistry` is the synchronous extension-facing facade; its `refresh()` became `Promise<void>` in Pi 0.80.8 (await it before synchronous registry reads). Since Pi 0.84.x it also exposes `getProvider(id)` (effective pi-ai provider) and `getProviderAuth(id)` (API key, headers, base URL, provider-scoped env — no loaded model required). `ctx.scopedModels` is the read-only session model scope resolved from `--models`/`enabledModels` (`{ model, thinkingLevel? }[]`, empty when unscoped); prefer it over enumerating `getAvailable()` for model pickers
- `ctx.modelRegistry.stream()` / `streamSimple()` / `complete()` (Pi 0.86.0) — nested model calls through configured providers with request-time auth; prefer `streamSimple()` for provider-neutral calls, pass `ctx.signal`, and report the combined `usage` on the tool result
- `ctx.hasUI` — `true` in TUI and RPC modes
- `ctx.signal` — the active agent abort signal (or `undefined` when idle); pass it to `fetch`/model calls for abort-aware nested work
- `ctx.isIdle()` / `ctx.hasPendingMessages()`
- `ctx.abort()` / `ctx.shutdown()`
- `ctx.getContextUsage()`
- `ctx.compact(options?)` — trigger compaction without awaiting completion
- `ctx.getSystemPrompt()`
- `ctx.isProjectTrusted()` — the effective project trust decision, including temporary `--approve`/`--no-approve` decisions

Use `CONFIG_DIR_NAME` (exported from `@earendil-works/pi-coding-agent`) instead of hardcoding `.pi` when building project config paths, e.g. `join(ctx.cwd, CONFIG_DIR_NAME, "my-extension.json")`.

Command handlers receive `ExtensionCommandContext`, which extends the above with session-control methods that would deadlock from event handlers: `ctx.getSystemPromptOptions()` (inspect the base system-prompt inputs), `ctx.waitForIdle()`, `ctx.newSession()`, `ctx.fork()`, `ctx.switchSession()`, `ctx.navigateTree()`, and `ctx.reload()`.

## Tool Registration

```typescript
pi.registerTool({
  name: "tool_name",
  label: "Tool Name",
  description: "What this tool does",
  parameters: Type.Object({
    arg1: Type.String({ description: "..." }),
  }),

  // Runs before schema validation. Useful for migrating old tool-call shapes.
  prepareArguments(rawArgs) {
    return rawArgs;
  },

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return {
      content: [{ type: "text", text: "result" }],
      details: { persisted: true },
    };
  },
});
```

Optional prompt metadata: add `promptSnippet` to give the tool a one-line entry in the system prompt's `Available tools` list, and `promptGuidelines: string[]` to append bullets to the `Guidelines` section while the tool is active. Guidelines are appended flat with no tool-name prefix, so each bullet must name its tool (write `"Use my_tool when..."`, not `"Use this tool when..."`). `pi.getAllTools()` exposes each tool's `promptGuidelines` for attribution.

Important rules:

1. Truncate large output.
2. Respect `signal.aborted`.
3. Throw on failure instead of returning fake success.
4. Use the file-mutation queue for write/edit style tools.
5. Put reconstructable state in `details`; it persists in session history.

## Dynamic Tool Loading

Pi 0.80.7 lets an extension register many tools while keeping only a small initial set active, then add more during execution — cache-friendly on models with native deferred loading. Lifecycle:

1. Register every tool with `pi.registerTool()` (all appear in `pi.getAllTools()`).
2. Keep a loader tool (e.g. `search_tools`) active; leave searchable tools inactive — e.g. on `session_start`, `pi.setActiveTools()` to the filtered set.
3. During loader execution, call `pi.setActiveTools([...pi.getActiveTools(), ...matches])`. The change must be purely additive; unknown names are ignored.
4. Pi records the added tools on that tool result and exposes their definitions before the next model response. Since Pi 0.86.0 prompt and tool changes are transcript-backed system messages, so they survive resume and branch navigation.

Native deferred loading preserves the cached prompt prefix on Anthropic Sonnet/Opus/Fable ≥ 4.5 (not Haiku), OpenAI `gpt-5.4`+, and Fireworks Messages models (Pi 0.86.0; name the loader `ToolSearch` or `tool_search`); Kimi K3 works via `compat.deferredToolsMode: "kimi"` (Pi 0.80.9). For verified custom models/proxies, enable `compat.supportsToolReferences: true` (`anthropic-messages`) or `compat.supportsToolSearch: true` (`openai-responses`/`openai-codex-responses`). All other models fall back to sending the full active tool list on the next request — activation still works, but may invalidate the provider's cached prefix. Non-additive changes (removals/replacements) always use the fallback.

Cache tips: keep the loader active for the whole session; add rather than replace. Activating a tool that has `promptSnippet`/`promptGuidelines` rebuilds the system prompt and can invalidate the prefix even with native support — lazily loaded tools should rely on their `description` alone.

## Constrained Tool Sampling

`ToolDefinition.constrainedSampling` (Pi 0.82.0) lets a tool prefer or require provider-side output constraints:

- `{ type: "json_schema", strict: "prefer" | "require" }` — strict JSON-schema constrained decoding of the tool's own TypeBox parameters
- `{ type: "grammar", variants: { openai_lark?: string, openai_regex?: string } }` — OpenAI Lark/regex grammar encodings
- Set `false` to explicitly disable for that tool

Model capability metadata gates what is actually sent: `compat.supportsStrictTools` / Anthropic built-ins enable strict JSON-schema tools, and `compat.supportsOpenAIGrammarTools` marks endpoints that accept Lark/regex grammar tools (enabled in generated metadata for GPT-5+ across OpenAI, Codex, Azure, GitHub Copilot, opencode, Cloudflare AI Gateway). Unsupported combinations fall back to normal function tools rather than failing. Since Pi 0.86.0, strict-prefer JSON-schema sampling is on by default for the built-in `read`, `bash`, `powershell`, `edit`, and `write` tools (no `PI_EXPERIMENTAL` needed); re-register a definition with `constrainedSampling: false` to opt out.

## Display Transformers

`pi.registerMarkdownTransformer(transformer)` (Pi 0.84.0) chains display-only Markdown transforms over user text, assistant text, and thinking blocks:

```typescript
pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
  if (isStreaming || messageType === "assistant-thinking") return markdown;
  return markdown.replaceAll("-->", "→");
});
```

Context carries `messageType` (`"user" | "assistant" | "assistant-thinking"`), `isStreaming`, and `availableWidth` (terminal columns). The hook runs for new messages, restored sessions, and terminal resizes, so keep it synchronous and cheap; a throwing transformer leaves prior output intact and Pi continues the chain. The session and model context are never modified — this is render-only.

## UI Methods

Check `ctx.hasUI` first. Non-interactive modes may not support UI.

```typescript
const choice = await ctx.ui.select("Pick one:", ["A", "B"]);
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");
const text = await ctx.ui.input("Name:", "default");
const edited = await ctx.ui.editor("Edit:", "prefilled text");

ctx.ui.notify("Done", "info");

ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingIndicator({ frames: ["⣷", "⣯", "⣟", "⡿"], intervalMs: 80 });
ctx.ui.setWorkingVisible(false);                                  // hide the built-in loader row
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
ctx.ui.setFooter((tui, theme) => new Text(theme.fg("dim", "Custom footer"), 0, 0));
ctx.ui.setTitle("pi - custom");

ctx.ui.setEditorText("prefilled text");
const current = ctx.ui.getEditorText();
ctx.ui.pasteToEditor("extra text");
ctx.ui.setHiddenThinkingLabel("…");
const editorFactory = ctx.ui.getEditorComponent();                 // wrap the active editor factory

ctx.ui.setToolsExpanded(true);

ctx.ui.addAutocompleteProvider((current) => ({    // stack on top of slash/path provider
  triggerCharacters: ["#"],                       // optional natural triggers (Pi 0.79.1)
  async getSuggestions(lines, cursorLine, cursorCol, options) { /* ... or delegate to current */ },
  applyCompletion(...args) { return current.applyCompletion(...args); },
}));

const result = await ctx.ui.custom((tui, theme, keybindings, done) => {
  return new Text("Press Enter", 0, 0);
}, { overlay: true });
```

## Commands, Shortcuts, Flags

```typescript
pi.registerCommand("name", {
  description: "Run a command",
  async handler(args, ctx) {
    await ctx.waitForIdle();
    ctx.reload();
  },
});

pi.registerShortcut("ctrl+x", {
  description: "Do something quickly",
  handler: async (ctx) => {},
});

pi.registerFlag("my-flag", {
  description: "Enable something",
  handler: (value) => {},
});
```

## Persistence & Process Hooks

Store extension state with custom session entries:

```typescript
pi.appendEntry("my-extension-state", { key: "value" });
```

Custom entries never participate in LLM context. Since Pi 0.80.4 they can also render in the interactive transcript via `pi.registerEntryRenderer(customType, renderer)` — the TUI-only counterpart to `pi.registerMessageRenderer()` (whose custom messages DO enter LLM context via `pi.sendMessage()`):

```typescript
pi.registerEntryRenderer("status-card", (entry, { expanded }, theme) => {
  return new Text(theme.fg("accent", JSON.stringify(entry.data)));
});
pi.appendEntry("status-card", { title: "Indexed files", count: 17 });
```

Use lifecycle hooks to restore it:

```typescript
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch().reverse()) {
    if (entry.type === "custom" && entry.name === "my-extension-state") {
      break;
    }
  }
});
```

## Provider Integration

Extensions can register or override providers:

```typescript
pi.registerProvider("my-provider", {
  name: "My Provider",                       // optional friendly label for /login
  baseUrl: "https://api.example.com",
  api: "openai-completions",
  apiKey: "MY_PROVIDER_KEY",
  models: [
    {
      id: "my-model",
      name: "My Model",
      contextWindow: 128000,
      maxTokens: 4096,
      baseUrl: "https://us-east.api.example.com", // per-model override
      thinkingLevelMap: { off: null, minimal: "low", medium: "medium", high: "high", xhigh: "high" },
    },
  ],
});

// Override-only: re-route an existing built-in provider through a proxy
pi.registerProvider("anthropic", { baseUrl: "https://proxy.example.com" });

pi.unregisterProvider("my-provider");
```

Dynamic providers can implement `refreshModels(context)` (Pi 0.80.8) for model discovery: Pi calls it during catalog refresh (`/model`, `pi update --models`) and publishes the returned list; its models replace extension-provided `models`. Since Pi 0.84.0 the context is read-snapshot + generation-checked publication: read `context.stored` (the persisted provider snapshot) instead of `context.store`, and persist through `context.publish({ update?, persist? })` — `persist` omitted leaves storage unchanged, a `ModelsStoreEntry` writes it, `persist: null` deletes it. Config-form callbacks that only return models remain unchanged.

Since Pi 0.81.0, extensions can also register a complete pi-ai `Provider` via `pi.registerProvider(createProvider({...}))` — native auth (`login`/`resolve`), `getModels`, `refreshModels`, `filterModels`, and custom streaming. The registered provider becomes the composition base; `models.json` overrides still apply above it. Prefer this when you need real authentication or stream behavior rather than just a model list. The legacy config form (`name`, `baseUrl`, `apiKey`, `models`, `oauth`, `streamSimple`) remains supported. OAuth `refreshToken(credentials, signal)` callbacks must accept and honor the abort signal since Pi 0.84.0.

If you need auth for a specific model request, use:

```typescript
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
```

(Still supported for extensions in Pi 0.80.8+; SDK code should use `ModelRuntime.getAuth()` — see `references/sdk.md`. `ProviderHeaders` values are `string | null` since Pi 0.84.0, where `null` is a delete marker: handle `null` when inspecting, pass through unchanged when forwarding to pi-ai streams.)

Custom `streamSimple` implementations receive a normalized `TranscriptContext` since Pi 0.86.0 — see `references/providers.md`. See `references/sdk.md` and `references/providers.md` for the full provider/model schema.

## Handy Patterns

- Permission gates via `tool_call`
- Prompt injection via `before_agent_start` (`systemPromptOptions.sections`)
- Model-context pruning via `context`, or durable omission via `context_edit` entries from `turn_end`/`agent_before_settle`
- Branch or compaction customization via `session_before_tree` / `session_before_compact`
- Provider payload inspection via `before_provider_request`
- Stateful tools via `details` plus `session_start` reconstruction
