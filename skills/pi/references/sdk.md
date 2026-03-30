# SDK

The SDK embeds Pi in Node.js applications via `createAgentSession()`.

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
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
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
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  thinkingLevel: "medium",
  scopedModels: [
    { model: getModel("anthropic", "claude-sonnet-4-20250514"), thinkingLevel: "high" },
  ],
  tools: createCodingTools(cwd),
  resourceLoader: new DefaultResourceLoader(),
  sessionManager: SessionManager.inMemory(),
});
```

Notes:

- `cwd` and `agentDir` control default resource discovery when using `DefaultResourceLoader`.
- If you provide a custom `cwd` **and** explicit built-in tools, use `createCodingTools(cwd)` / `createReadOnlyTools(cwd)` so paths resolve against that cwd.
- `DefaultResourceLoader` loads extensions, skills, prompt templates, themes, and context files. If you replace it, `cwd` and `agentDir` no longer drive resource discovery.

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

## Session Surface

```typescript
await session.newSession();
await session.switchSession("/path/to/session.jsonl");
await session.fork("entry-id");
await session.navigateTree("entry-id", { summarize: true });
await session.compact("Summarize design decisions only");

await session.abort();
await session.agent.waitForIdle();
session.dispose();
```

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
