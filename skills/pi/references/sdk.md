# SDK

The SDK lets you embed Pi programmatically in Node.js applications via `createAgentSession()`.

## Installation

```bash
npm install @mariozechner/pi-coding-agent
```

## Quick Start

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession();

session.subscribe((event) => {
  if (event.type === "message_update" && event.delta?.type === "text_delta") {
    process.stdout.write(event.delta.text);
  }
  if (event.type === "agent_end") {
    console.log("\nDone.");
  }
});

await session.prompt("List all TypeScript files in the current directory");
```

Run with: `npx tsx my-script.ts`

## Factory Options

```typescript
const { session } = await createAgentSession({
  // Authentication
  authStorage: new AuthStorage({ path: "~/.pi/agent/auth.json" }),

  // Model configuration
  modelRegistry: new ModelRegistry(),
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  thinkingLevel: "medium",

  // Working directory
  cwd: process.cwd(),

  // Agent config directory
  agentDir: "~/.pi/agent",

  // Tools (built-in presets or custom)
  tools: codingTools(),          // Default: read, bash, edit, write
  // tools: readOnlyTools(),     // read, grep, find, ls
  // tools: allTools(),          // All seven built-in tools

  // Resource discovery
  resourceLoader: new DefaultResourceLoader(),

  // Extensions (inline factories)
  extensionFactories: [
    (pi) => {
      pi.on("agent_start", async () => { /* ... */ });
    },
  ],

  // Session persistence
  sessionManager: SessionManager.create("path/to/session.jsonl"),
  // sessionManager: SessionManager.inMemory(),  // No persistence

  // Settings
  settings: new SettingsManager({ /* ... */ }),

  // System prompt
  systemPrompt: "Custom system prompt",
});
```

## Key Imports

```typescript
import {
  createAgentSession,
  // Auth & config
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  SessionManager,
  DefaultResourceLoader,
  // Tools
  codingTools,
  readOnlyTools,
  allTools,
  readTool,
  bashTool,
  editTool,
  writeTool,
  grepTool,
  findTool,
  lsTool,
  // Models
  getModel,
} from "@mariozechner/pi-coding-agent";
```

## Event Types

```typescript
session.subscribe((event) => {
  switch (event.type) {
    // Streaming
    case "message_start":     // New assistant message begins
    case "message_update":    // Text/thinking/tool-call delta
    case "message_end":       // Assistant message complete (includes full message)

    // Tool execution
    case "tool_execution_start":  // Tool begins (toolCallId, toolName)
    case "tool_execution_update": // Partial tool output
    case "tool_execution_end":    // Tool complete (toolCallId, result)

    // Lifecycle
    case "agent_start":       // Agent begins processing
    case "agent_end":         // Agent finishes
    case "turn_start":        // New LLM turn
    case "turn_end":          // LLM turn complete

    // System
    case "auto_compaction_start":
    case "auto_compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
  }
});
```

## Session Methods

```typescript
// Send a prompt
await session.prompt("Do something");

// Queue message during active streaming
session.steer("Actually, do this instead");   // Interrupts current tool execution
session.followUp("After you're done, also..."); // Queued until agent finishes

// Control
session.abort();                    // Cancel current generation
await session.waitForIdle();        // Wait until agent is idle

// Model
session.setModel(getModel("openai", "gpt-4o"));
session.setThinkingLevel("high");
session.cycleModel();

// Compaction
await session.compact();

// State
const messages = session.getMessages();
const state = session.getState();
```

## Run Modes

For non-SDK usage, Pi provides run mode functions:

```typescript
import { runPrintMode, runRpcMode, InteractiveMode } from "@mariozechner/pi-coding-agent";

// Print mode (single-shot)
await runPrintMode(session, { outputFormat: "text" }); // or "json"

// RPC mode (JSON-RPC over stdin/stdout)
await runRpcMode(session);

// Interactive mode (full TUI)
const mode = new InteractiveMode(session);
await mode.start();
```
