# Extensions

Extensions are TypeScript modules that customize Pi's behavior. They have **full system permissions** — they can read/write files, run commands, make network requests, and access anything the user can.

## Placement & Discovery

| Location | Scope | Auto-discovered |
|----------|-------|-----------------|
| `~/.pi/agent/extensions/*.ts` | Global (all projects) | Yes |
| `.pi/extensions/*.ts` | Project-local | Yes |
| `settings.json` → `extensions` | Configured | Yes |
| `pi -e ./path.ts` | CLI one-off | No |

Subdirectories with an `index.ts` or a `package.json` containing a `"pi"` field are also discovered. Reload with `/reload`.

## Basic Structure

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Subscribe to lifecycle events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  // Register a tool the LLM can call
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { name } = params as { name: string };
      return {
        content: [{ type: "text", text: `Hello, ${name}!` }],
        details: { greeted: name },
      };
    },
  });

  // Register a slash command
  pi.registerCommand("mycommand", {
    description: "Do something",
    async handler(args, ctx) {
      ctx.ui.notify(`You said: ${args}`, "info");
    },
  });
}
```

**Import note:** Use `Type` from `@mariozechner/pi-ai` (re-exports TypeBox) and `StringEnum` from the same package for string enums (required for Google API compatibility — do not use `Type.Union` with `Type.Literal` for string enums).

## Lifecycle Events

### Session Events

| Event | When | Payload |
|-------|------|---------|
| `session_start` | Session begins | `{ sessionId }` |
| `session_switch` | User switches session | `{ sessionId }` |
| `session_fork` | Session forked | `{ entryId }` |
| `session_before_fork` | Before fork executes | `{ entryId }` |
| `session_shutdown` | Session closing | `{}` |
| `session_tree` | After `/tree` navigation | `{ entryId }` |
| `session_before_tree` | Before `/tree` navigation | `{ entryId, messages }` |
| `session_before_compact` | Before compaction | `{ messages, settings, ... }` |
| `session_compact` | After compaction | `{ summary }` |
| `resources_discover` | Resource discovery phase | `{ extensions, skills, prompts, themes }` |

### Agent Events

| Event | When | Payload |
|-------|------|---------|
| `before_agent_start` | Before LLM call (modify system prompt) | `{ systemPrompt }` |
| `agent_start` | Agent begins processing | `{}` |
| `agent_end` | Agent finishes | `{}` |
| `turn_start` | New LLM turn begins | `{}` |
| `turn_end` | LLM turn finishes | `{}` |

### Tool Events

| Event | When | Payload |
|-------|------|---------|
| `tool_call` | Before tool executes | `{ toolName, input }` — return `{ block, reason }` to prevent |
| `tool_result` | After tool executes | `{ toolName, result }` |
| `tool_execution_start` | Tool execution begins | `{ toolCallId, toolName }` |
| `tool_execution_end` | Tool execution ends | `{ toolCallId, toolName }` |

### Other Events

| Event | When | Payload |
|-------|------|---------|
| `input` | User submits input | `{ text }` — return modified text or `{ block }` |
| `model_select` | Model selector opened | `{ models }` — return filtered list |

## Event Handler Signature

```typescript
pi.on("event_name", async (event, ctx) => {
  // event: event-specific payload
  // ctx: ExtensionContext
});
```

### ExtensionContext

```typescript
interface ExtensionContext {
  ui: ExtensionUIContext;      // UI interaction methods
  cwd: string;                 // Working directory
  session: AgentSession;       // Session access
  sessionManager: SessionManager; // JSONL session persistence
  modelRegistry: ModelRegistry;   // Available models
  hasUI: boolean;              // Whether interactive mode is available
  isIdle(): boolean;           // Whether the agent is idle
  abort(): void;               // Stop current generation
  getContextUsage(): ContextUsage; // Token usage info
  getSystemPrompt(): string;   // Current system prompt
}
```

## Tool Registration

```typescript
pi.registerTool({
  name: "tool_name",           // Unique identifier
  label: "Tool Name",          // Display name
  description: "What this tool does",  // Shown to LLM
  parameters: Type.Object({    // TypeBox schema
    arg1: Type.String({ description: "..." }),
    arg2: Type.Optional(Type.Number()),
  }),

  // Execute the tool (called by LLM)
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // params: parsed and validated parameters
    // signal: AbortSignal for cancellation — check signal?.aborted
    // onUpdate: callback for streaming partial results
    // ctx: ExtensionContext

    return {
      content: [{ type: "text", text: "result" }],
      details: { anyMetadata: true },  // Stored in session, available on branch restore
    };
  },

  // Optional: custom TUI rendering for tool calls
  renderCall(args, theme, context) {
    return new Text(theme.fg("accent", `tool ${args.arg1}`), 0, 0);
  },

  // Optional: custom TUI rendering for tool results
  renderResult(result, { expanded }, theme, context) {
    return new Text(result.content[0].text, 0, 0);
  },
});
```

**Critical rules for tools:**

1. **Truncate output** — Default limits are 50KB or 2000 lines. Use `truncateHead()` or `truncateTail()` from the tools module.
2. **Handle cancellation** — Check `signal?.aborted` in long-running operations.
3. **Throw on error** — Throwing signals failure to the LLM. Returning always means success.
4. **Use `withFileMutationQueue()`** — If your tool modifies files, wrap the operation to participate in the mutation queue.
5. **Store state in `details`** — Tool result `details` persist in session history and survive branching. Reconstruct state from session entries on `session_start`.

## UI Methods

All UI methods are on `ctx.ui`. **Always check `ctx.hasUI` first** — non-interactive modes (print, JSON, RPC) may not support UI.

```typescript
// Dialogs (blocking — waits for user response)
const choice = await ctx.ui.select("Pick one:", ["Option A", "Option B"]);
const confirmed = await ctx.ui.confirm("Are you sure?", "Details here");
const text = await ctx.ui.input("Enter a value:", "default");
const edited = await ctx.ui.editor("Edit this text", initialContent);

// Notifications (non-blocking)
ctx.ui.notify("Something happened", "info");  // "info" | "warning" | "error"

// Status indicators
ctx.ui.setStatus("Processing...");  // Footer status text
ctx.ui.setWidget("above", component);  // Widget above/below editor
ctx.ui.setFooter(component);  // Custom footer component

// Editor control
ctx.ui.setEditorText("prefilled text");
ctx.ui.pasteToEditor("appended text");

// Custom components (advanced)
const handle = ctx.ui.custom(component, { overlay: true });
handle.requestRender();
handle.close();
```

## Command Registration

```typescript
pi.registerCommand("commandname", {
  description: "What this command does",  // Shown in autocomplete
  args: "optional args description",

  // Argument autocompletion
  complete(partial) {
    return ["suggestion1", "suggestion2"].filter(s => s.startsWith(partial));
  },

  // Handler receives ExtensionCommandContext (superset of ExtensionContext)
  async handler(args, ctx) {
    await ctx.waitForIdle();     // Wait for agent to finish
    ctx.newSession();            // Create new session
    ctx.fork(entryId);           // Fork from entry
    ctx.navigateTree();          // Open tree navigator
    ctx.reload();                // Reload extensions
  },
});
```

## Keybinding Registration

```typescript
pi.registerKeybinding({
  key: "ctrl+shift+k",
  description: "Do something",
  handler: async (ctx) => { /* ... */ },
});
```

## CLI Flag Registration

```typescript
pi.registerFlag({
  name: "--my-flag",
  description: "Enable something",
  handler: (value) => { /* value is the flag argument */ },
});
```

## State Persistence

Extensions persist state via custom session entries:

```typescript
// Write state
pi.appendEntry("my-extension-state", { key: "value" });

// Read state on session restore
pi.on("session_start", async (_event, ctx) => {
  const branch = ctx.sessionManager.getBranch();
  for (const entry of branch.reverse()) {
    if (entry.type === "custom" && entry.name === "my-extension-state") {
      const state = entry.data;
      // Restore from state
      break;
    }
  }
});
```

## Provider Registration

Extensions can register custom LLM providers:

```typescript
pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com",
  api: "openai-completions",
  apiKey: "sk-...",
  models: [
    { id: "my-model", name: "My Model", contextWindow: 128000, maxTokens: 4096 },
  ],
});
```

For full custom streaming, implement `streamSimple` on the provider config. See `references/providers.md`.

## Bash Execution

```typescript
const { stdout, stderr, exitCode } = await pi.exec("git", ["status"]);
```

## Practical Examples

### Permission Gate

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = event.input.command as string;
  if (/\brm\s+(-rf?|--recursive)/i.test(cmd)) {
    if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked" };
    const ok = await ctx.ui.select(`⚠️ Dangerous: ${cmd}\nAllow?`, ["Yes", "No"]);
    if (ok !== "Yes") return { block: true, reason: "Blocked by user" };
  }
});
```

### System Prompt Injection

```typescript
pi.on("before_agent_start", async (event, _ctx) => {
  event.systemPrompt += "\n\nAdditional instructions here.";
});
```

### Git Checkpoint on Every Turn

```typescript
pi.on("turn_start", async () => {
  const { stdout } = await pi.exec("git", ["stash", "create"]);
  if (stdout.trim()) checkpoints.set(currentEntryId, stdout.trim());
});
```

### Custom Compaction

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  // Return a custom CompactionResult to override default compaction
  const allMessages = [...event.messagesToSummarize, ...event.turnPrefixMessages];
  const summary = await generateCustomSummary(allMessages);
  return { summary, firstKeptEntryId: event.firstKeptEntryId, tokensBefore: event.tokens };
});
```

### Dynamic Tool Registration

```typescript
pi.on("session_start", async () => {
  pi.registerTool({ name: "echo", /* ... */ });
});

pi.registerCommand("add-tool", {
  async handler(name, ctx) {
    pi.registerTool({ name, /* ... */ });
    ctx.ui.notify(`Registered tool: ${name}`, "info");
  },
});
```
