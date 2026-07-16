# SDK

The SDK embeds Pi in Node.js applications via `createAgentSession()`. Use `createAgentSessionRuntime()` when you need `/new`, `/resume`, `/fork`, or import-style session replacement.

## Installation

```bash
npm install @earendil-works/pi-coding-agent
```

## Quick Start

```typescript
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

Run with `npx tsx my-script.ts`.

**Breaking (Pi 0.80.8):** `ModelRuntime` replaced the old `AuthStorage`/`ModelRegistry` pair as the SDK model/auth facade. `CreateAgentSessionOptions.authStorage` and `modelRegistry` are gone — pass the async `modelRuntime` instead. `AuthStorage` is no longer exported; use `ModelRuntime` (or a custom pi-ai `CredentialStore`), or `readStoredCredential()` for one-off reads of `auth.json`. `ModelRegistry` still exists only as the synchronous extension-facing compatibility facade, and its `refresh()` is now `Promise<void>`.

## Key Imports

```typescript
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
```

**pi-ai 0.80.0 API move:** the old global API (`getModel`, `getModels`, `getProviders`, `stream`, `complete`, `completeSimple`, `registerApiProvider`, `getEnvApiKey`, ...) moved off the `@earendil-works/pi-ai` root entrypoint to `@earendil-works/pi-ai/compat` (a deprecated shim slated for removal). For built-in model lookup use `getBuiltinModel(provider, modelId)` from `@earendil-works/pi-ai/providers/all`, or the provider-factory API (`createModels()` / `Models.getModel()`). Extensions loaded by Pi are unaffected at runtime — the extension loader aliases the pi-ai root to the compat superset — but standalone SDK scripts and typechecked extension sources must use the new paths. The selective `@earendil-works/pi-ai/base` / `@earendil-works/pi-agent-core/base` entrypoints introduced in 0.79.8 were removed again in 0.80.0.

## Core Options

```typescript
const cwd = "/path/to/project";
const modelRuntime = await ModelRuntime.create();

const { session } = await createAgentSession({
  cwd,
  agentDir: "~/.pi/agent",
  modelRuntime,
  model: getBuiltinModel("anthropic", "claude-opus-4-8"),
  thinkingLevel: "medium",  // off | minimal | low | medium | high | xhigh | max
  scopedModels: [
    { model: getBuiltinModel("anthropic", "claude-opus-4-8"), thinkingLevel: "high" },
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

## Models & Auth (`ModelRuntime`)

`ModelRuntime` (Pi 0.80.8) implements the pi-ai `Models` interface and owns credential storage. Auth resolution priority: runtime overrides (`setRuntimeApiKey`, not persisted) → stored credentials in `auth.json` → environment variables → fallback resolver for `models.json` keys.

```typescript
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// Default: ~/.pi/agent/auth.json and ~/.pi/agent/models.json
const modelRuntime = await ModelRuntime.create();

// Model lookup (use pi-ai Models methods directly; the old
// getAll()/find()/getSnapshot() projections were removed)
const model = modelRuntime.getModel("my-provider", "my-model");
const available = await modelRuntime.getAvailable();  // only models with valid auth

// Provider-owned auth methods and current status
for (const provider of modelRuntime.getProviders()) {
  const status = await modelRuntime.checkAuth(provider.id);
}

modelRuntime.setRuntimeApiKey("anthropic", "sk-my-temp-key");

// Custom locations, or inject any pi-ai CredentialStore
const custom = await ModelRuntime.create({ authPath: "/my/auth.json", modelsPath: "/my/models.json" });
const inMemory = await ModelRuntime.create({ credentials: new InMemoryCredentialStore() });
```

`ModelRuntime.getAuth(providerOrModel)` assembles final request auth (replacing `ModelRegistry.getApiKeyAndHeaders()` on the SDK side); passing a model also resolves built-in, `models.json`, and extension model headers. Dynamic provider catalogs refresh via async `ModelRuntime.refresh()` and are cached in `~/.pi/agent/models-store.json`.

To match CLI model parsing, use the exported resolver helpers (Pi 0.80.4):

```typescript
import { resolveCliModel, resolveModelScopeWithDiagnostics } from "@earendil-works/pi-coding-agent";

const cliModel = resolveCliModel({ cliModel: "anthropic/claude-opus-4-8:high", modelRuntime });
const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(
  ["anthropic/*:high", "gpt-5"],
  modelRuntime,
);
```

`resolveCliModel()` resolves against all registered models (so `--api-key`-style first-time setup works before stored auth exists); `resolveModelScopeWithDiagnostics()` matches `--models`/`enabledModels` semantics and returns warnings instead of printing.

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
} from "@earendil-works/pi-coding-agent";

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
    case "agent_end":      // one low-level run; may be followed by retry/compaction/queued follow-ups
    case "agent_settled":  // fully settled — no automatic continuation left (Pi 0.80.4)
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

`compaction_end` results and RPC `compact` responses include estimated post-compaction token counts (Pi 0.79.8) so clients can show the approximate context reduction.

## RPC Mode

`pi --mode rpc` speaks newline-delimited JSON over stdio. Additions since Pi 0.79:

- `agent_settled` event (Pi 0.80.4) fires when a run is fully settled — no automatic retry, compaction retry, or queued continuation remains; `agent_end` now carries `willRetry`. `set_thinking_level` accepts `"max"` where the model supports it.
- `get_entries` / `get_tree` (Pi 0.80.3) read session entries and tree snapshots over RPC.
- `@earendil-works/pi-coding-agent/rpc-entry` (Pi 0.80.3) launches Pi directly in RPC mode from an importing process.
- RPC extension UI request/response types are exported from the public API (Pi 0.79.0).
- Package asset path helpers are exported from the public API (Pi 0.79.0).
- `CONFIG_DIR_NAME` and edit diff helpers (`generateDiffString`, `generateUnifiedPatch`, `EditDiffResult`) are exported for extensions and hosts (Pi 0.79.7).

## Resource Loader Hooks

`DefaultResourceLoader` supports overrides for extensions, skills, prompts, themes, and context files. Common patterns:

- Add inline extension factories
- Override `agentsFiles` to inject virtual `AGENTS.md` content
- Add custom skills or prompt templates without touching disk
- Share an event bus between the host app and loaded extensions

To name an inline factory in the startup Extensions list (instead of `<inline:1>`), wrap it in an `InlineExtension` (Pi 0.80.4):

```typescript
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

const myProvider: InlineExtension = {
  name: "my-provider",
  factory: (pi) => { /* ... */ },
};
const loader = new DefaultResourceLoader({ extensionFactories: [myProvider] });
```

Bare factory functions are still accepted.

## Standalone Custom Tools

Use `defineTool()` when you want a reusable custom tool definition outside `pi.registerTool(...)`:

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";
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
