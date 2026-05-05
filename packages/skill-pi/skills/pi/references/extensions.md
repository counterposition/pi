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
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
```

- Use `typebox` (1.x) for schemas. Legacy `@sinclair/typebox` is still aliased but `@sinclair/typebox/compiler` is not.
- Use `StringEnum` from `@mariozechner/pi-ai` for Google-compatible string enums.

## Quick Start

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

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
- `session_shutdown`
- `resources_discover`

`session_start` carries `event.reason` — `"startup" | "reload" | "new" | "resume" | "fork"` — and `event.previousSessionFile` for `"new"`/`"resume"`/`"fork"`. The old post-transition `session_switch` / `session_fork` events were removed; route all of those flows through `session_start`.

Useful agent events:

- `input`
- `before_agent_start` — receives `event.systemPromptOptions` (a `BuildSystemPromptOptions`) so handlers can inspect the structured inputs feeding the system prompt
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end` — return a replacement message to override usage/cost or rewrite the finalized assistant message
- `context`
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

`ctx` gives extensions access to:

- `ctx.ui` for interactive UI hooks
- `ctx.cwd`
- `ctx.session`
- `ctx.sessionManager`
- `ctx.modelRegistry`
- `ctx.hasUI`
- `ctx.isIdle()`
- `ctx.abort()`
- `ctx.getContextUsage()`
- `ctx.getSystemPrompt()`

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

Important rules:

1. Truncate large output.
2. Respect `signal.aborted`.
3. Throw on failure instead of returning fake success.
4. Use the file-mutation queue for write/edit style tools.
5. Put reconstructable state in `details`; it persists in session history.

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

ctx.ui.addAutocompleteProvider((query, ctx) => /* completions */);  // stack on top of slash/path provider

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

If you need auth for a specific model request, use:

```typescript
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
```

Pass `shouldStopAfterTurn` via the SDK to exit the agent loop gracefully after a completed turn. See `references/sdk.md` and `references/providers.md` for the full provider/model schema.

## Handy Patterns

- Permission gates via `tool_call`
- Prompt injection via `before_agent_start`
- Branch or compaction customization via `session_before_tree` / `session_before_compact`
- Provider payload inspection via `before_provider_request`
- Stateful tools via `details` plus `session_start` reconstruction
