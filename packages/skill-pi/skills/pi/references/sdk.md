# SDK

The SDK embeds Pi in Node.js applications via `createAgentSession()`. Use `createAgentSessionRuntime()` when you need `/new`, `/resume`, `/fork`, or import-style session replacement.

## Installation

```bash
npm install @mariozechner/pi-coding-agent
```

## Quick Start

```typescript
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

Run with `npx tsx my-script.ts`.

**Important:** `ModelRegistry` no longer has a public constructor. Use `ModelRegistry.create(authStorage, modelsJsonPath?)` for file-backed registries or `ModelRegistry.inMemory(authStorage)` for built-in models only.

## Key Imports

```typescript
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
```

## Core Options

```typescript
const cwd = "/path/to/project";
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session } = await createAgentSession({
  cwd,
  agentDir: "~/.pi/agent",
  authStorage,
  modelRegistry,
  model: getModel("anthropic", "claude-opus-4-7"),
  thinkingLevel: "medium",
  scopedModels: [
    { model: getModel("anthropic", "claude-opus-4-7"), thinkingLevel: "high" },
  ],
  tools: ["read", "bash", "edit", "write"],
  customTools: [/* defineTool(...) entries */],
  resourceLoader: new DefaultResourceLoader(),
  sessionManager: SessionManager.inMemory(),
  shouldStopAfterTurn: (state) => state.turnCount >= 5,
});
```

Notes:

- `cwd` and `agentDir` control default resource discovery when using `DefaultResourceLoader`.
- Pi 0.68.0 changed the SDK `tools` option from `Tool[]` to a `string[]` allowlist of built-in, extension, and custom tool names. Use `noTools: "builtin"` to disable built-ins while keeping extension/custom tools enabled, or `noTools: "all"` for none.
- `customTools` accepts `ToolDefinition[]`. Build them with `defineTool({...})` for full TypeScript inference.
- The `create*Tool(cwd)` factories still exist for code that needs explicit `AgentTool` instances (e.g. when wiring tools into pi-agent-core directly), but they are no longer the value passed to `createAgentSession({ tools })`.
- `DefaultResourceLoader` loads extensions, skills, prompt templates, themes, and context files. Replace it to drive resource discovery from custom sources (and it must implement `loadProjectContextFiles()` if you want `AGENTS.md`/`CLAUDE.md` discovery; that helper is also exported standalone).
- Pass `shouldStopAfterTurn(state) => boolean` (Pi 0.72.0) to exit the agent loop gracefully after a completed turn.

## Prompting & Queueing

```typescript
await session.prompt("Review the current directory");

// During streaming, choose how the new prompt should queue.
await session.prompt("Stop and do this instead", { streamingBehavior: "steer" });
await session.prompt("After you finish, also check tests", { streamingBehavior: "followUp" });

await session.steer("Use a smaller diff");
await session.followUp("Summarize the changes afterward");
```

`prompt()` expands file-based prompt templates. During active streaming, calling it without `streamingBehavior` throws.

## Session Runtime

Pi 0.65.0 moved session replacement off `AgentSession` and onto `AgentSessionRuntime`. Use the runtime when you need `newSession()`, `switchSession()`, `fork()`, or `importFromJsonl()`.

```typescript
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});

let session = runtime.session;
let unsubscribe = session.subscribe(() => {});

await runtime.newSession();
await runtime.fork("entry-id", { position: "at" });   // "before" | "at" — `at` powers /clone

unsubscribe();
session = runtime.session;
unsubscribe = session.subscribe(() => {});
```

Notes:

- `runtime.session` changes after replacement. Re-subscribe to session-local events after `newSession()`, `switchSession()`, `fork()`, or `importFromJsonl()`.
- Cross-cwd replacement rebuilds cwd-bound services and session configuration.
- `runtime.diagnostics` carries startup and replacement diagnostics instead of printing or exiting directly.

## Session Surface

```typescript
await session.navigateTree("entry-id", { summarize: true });
await session.compact("Summarize design decisions only");

await session.abort();
await session.agent.waitForIdle();
session.dispose();
```

Use `runtime.newSession()`, `runtime.switchSession()`, and `runtime.fork()` for session replacement. Keep `navigateTree()` and `compact()` on the live `session`.

Useful state:

- `session.sessionFile` / `session.sessionId`
- `session.agent.state.messages`
- `session.model`
- `session.thinkingLevel`

## Events

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      break;
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
    case "agent_start":
    case "agent_end":
    case "turn_start":
    case "turn_end":
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
      break;
  }
});
```

## Resource Loader Hooks

`DefaultResourceLoader` supports overrides for extensions, skills, prompts, themes, and context files. Common patterns:

- Add inline extension factories
- Override `agentsFiles` to inject virtual `AGENTS.md` content
- Add custom skills or prompt templates without touching disk
- Share an event bus between the host app and loaded extensions

## Standalone Custom Tools

Use `defineTool()` when you want a reusable custom tool definition outside `pi.registerTool(...)`:

```typescript
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const myTool = defineTool({
  name: "my_tool",
  label: "My Tool",
  description: "Does something useful",
  parameters: Type.Object({
    input: Type.String({ description: "Input value" }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Result: ${params.input}` }],
      details: {},
      // terminate: true,  // optional — end the tool batch without an automatic follow-up LLM turn
    };
  },
});
```

Pass these via `customTools: [myTool]` on `createAgentSession()` or via `pi.registerTool(myTool)` from inside an extension.
