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

- Use `typebox` (1.x) for schemas.
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

`session_before_compact` and `session_compact` carry `reason` and `willRetry` (Pi 0.79.10) so handlers can distinguish manual `/compact`, threshold auto-compaction, and overflow-retry compaction.

`session_start` carries `event.reason` — `"startup" | "reload" | "new" | "resume" | "fork"` — and `event.previousSessionFile` for `"new"`/`"resume"`/`"fork"`. The old post-transition `session_switch` / `session_fork` events were removed; route all of those flows through `session_start`.

Useful agent events:

- `input` — carries `event.streamingBehavior` (`"steer" | "followUp" | undefined`) so handlers can distinguish idle prompts, mid-stream steers, and queued follow-ups; return `{ action: "transform" | "handled" | "continue" }`
- `before_agent_start` — receives `event.systemPromptOptions` (a `BuildSystemPromptOptions`) so handlers can inspect the structured inputs feeding the system prompt
- `agent_start`
- `agent_end` — one low-level run; Pi may still auto-retry, auto-compact and retry, or continue with queued follow-ups
- `agent_settled` (Pi 0.80.4) — fired when no retry/compaction/follow-up remains; use for status integrations that need to know Pi will not continue automatically (`ctx.isIdle()` is true here unless another extension started a new run)
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end` — return a replacement message to override usage/cost or rewrite the finalized assistant message
- `context`
- `before_provider_headers` (Pi 0.80.4) — mutate `event.headers` in place after outgoing HTTP headers are assembled: set a key to a string to add/override, `null` to delete. Runs once per provider request; retries reuse the same headers
- `before_provider_request`
- `after_provider_response` — inspect the provider HTTP status and headers before stream consumption
- `model_select`
- `thinking_level_select` — observe interactive thinking-level changes

Useful tool events:

- `tool_execution_start`
- `tool_call`
- `tool_execution_update`
- `tool_result`
- `tool_execution_end`

Tool results may include `terminate: true` to end the current tool batch without an automatic follow-up LLM turn — useful for tools that produce a structured final answer (see `examples/extensions/structured-output.ts` in the Pi repo).

`session_shutdown` events carry `event.reason` (`"quit" | "reload" | "new" | "resume" | "fork"`) and, where applicable, `event.targetSessionFile` so cleanup logic can distinguish teardown paths.

## Extension Context

`ctx` (`ExtensionContext`) gives extensions access to:

- `ctx.ui` for interactive UI hooks
- `ctx.mode` — `"tui" | "rpc" | "json" | "print"`; gate terminal-only features on `ctx.mode === "tui"`
- `ctx.cwd`
- `ctx.sessionManager` (read-only; `buildContextEntries()` returns active-branch entries with compaction applied, Pi 0.80.4)
- `ctx.modelRegistry` / `ctx.model` — `ctx.modelRegistry` is the synchronous extension-facing facade; its `refresh()` became `Promise<void>` in Pi 0.80.8 (await it before synchronous registry reads)
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
4. Pi records the added tools on that tool result and exposes their definitions before the next model response.

Native deferred loading preserves the cached prompt prefix on Anthropic Sonnet/Opus/Fable ≥ 4.5 (not Haiku) and OpenAI `gpt-5.4`+; Kimi K3 works via `compat.deferredToolsMode: "kimi"` (Pi 0.80.9). For verified custom models/proxies, enable `compat.supportsToolReferences: true` (`anthropic-messages`) or `compat.supportsToolSearch: true` (`openai-responses`/`openai-codex-responses`). All other models fall back to sending the full active tool list on the next request — activation still works, but may invalidate the provider's cached prefix. Non-additive changes (removals/replacements) always use the fallback.

Cache tips: keep the loader active for the whole session; add rather than replace. Activating a tool that has `promptSnippet`/`promptGuidelines` rebuilds the system prompt and can invalidate the prefix even with native support — lazily loaded tools should rely on their `description` alone.

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

Dynamic providers can implement `refreshModels(context)` (Pi 0.80.8) for model discovery: Pi calls it during catalog refresh (`/model`, `pi update --models`) and publishes the returned list; its models replace extension-provided `models`. Persist results through the scoped `context.store` only when they should survive restarts — live servers like llama.cpp can ignore it.

If you need auth for a specific model request, use:

```typescript
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
```

(Still supported for extensions in Pi 0.80.8+; SDK code should use `ModelRuntime.getAuth()` — see `references/sdk.md`.)

Pass `shouldStopAfterTurn` via the SDK to exit the agent loop gracefully after a completed turn. See `references/sdk.md` and `references/providers.md` for the full provider/model schema.

## Handy Patterns

- Permission gates via `tool_call`
- Prompt injection via `before_agent_start`
- Branch or compaction customization via `session_before_tree` / `session_before_compact`
- Provider payload inspection via `before_provider_request`
- Stateful tools via `details` plus `session_start` reconstruction
