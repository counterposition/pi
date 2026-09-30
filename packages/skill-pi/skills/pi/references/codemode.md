# Codemode and Tool Search

`codemode` is a built-in tool (Pi 0.99) that runs model-written JavaScript in a QuickJS sandbox. Scripts call Pi's other tools, filter their results, and return only what the model needs. `tool_search` declares tools the model cannot see yet. Checked against Pi v0.99.1: [cli.md#tools](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/cli.md#tools), [extensions.md#tool-exposure](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md#tool-exposure), [settings.md#tools](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/settings.md#tools), [codemode tool source](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/codemode/tool.ts).

## Enable

Both tools are registered inactive. The default tools stay `read`, `bash`, `edit`, `write`.

```json
{ "defaultTools": ["+codemode"] }
```

- `+name` adds to the default selection; `--tools` replaces it, so list everything: `pi --tools read,bash,edit,write,codemode`. `--tools` is an allowlist over every tool, including extension and MCP `mcp__*` tools: unlisted tools are not registered, so scripts can call only the listed ones.
- The MCP extension activates `codemode` for servers with `codemode`/`codemode-deferred` exposure and `tool_search` for `deferred` servers (see `references/mcp.md`).
- SDK sessions need `createCodemodeExtension()` / `createToolSearchExtension()` in the resource loader (see `references/sdk.md`).

| Setting | Default | Effect |
|---------|---------|--------|
| `codemode.mode` | `"on"` | `on`: declared tools stay declared and their descriptions show the script call; `codemode` lists only undeclared tools. `only`: active built-in and extension tools are hidden from the model and listed in the `codemode` description instead |
| `codemode.inlineBudget` | `3000` | Estimated tokens the `codemode` description may spend on tool declarations; the rest are found with `searchTools()`. `0` lists only namespaces |

## Script API

The script body is an async function: top-level `await` and `return` work.

- `await tools.<name>(args)` calls a tool. Names that are not identifiers are mangled (`my-tool` → `tools.my_tool`); `tools["my-tool"]` also works.
- `ALL_TOOLS` lists `{ name, description }`. `await searchTools(query, { limit, namespace })` ranks tools with BM25; `await describeTool(name)` returns one declaration.
- Output: `text(value)`, `image(dataUrlOrImageContent)`, `console.*`, and the returned value. `exit()` ends early and keeps output.
- `store(key, value)` / `load(key)` keep JSON values across `codemode` calls. Successful scripts append a `codemode-store` custom entry, so values follow the session branch.
- `models.getModelsOfType`, `getAvailableOfType`, `getModelOfType`, and `models.classify(model, { state, questions })` reach the model catalog and classifiers with session credentials (at most four classifications at a time). Their usage and cost are added to the `codemode` result.
- An optional first line `// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}`. Output is capped at 10000 estimated tokens by default (start and end kept, full text in a temp file); there is no timeout unless set.
- No timers, `fetch`, `process`, `require`, or modules.

The result starts with `Script completed` or `Script failed`, the wall time, and the output. A failed script keeps its partial output followed by `Script error:`.

## What a Script Receives

| Tool | `await tools.x(...)` resolves to |
|------|--------------------------------|
| Declares `outputSchema` | Its `structuredContent`, also when the result has `isError: true` |
| MCP tool | The whole `CallToolResult` (`content`, `structuredContent`, `isError`) |
| `bash` | `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`, also for non-zero exits; `output` holds up to 1 MiB |
| Anything else | Its text content as one string |

A failed, blocked, or invalid call without structured content rejects with an `Error` carrying the tool's error text. Catch it in the script (`Promise.allSettled` works) when partial results are useful.

## Which Tools Are Callable

"Active" means declared to the model (`pi.getActiveTools()`). "Callable" means reachable through `ctx.executeTool()`, which is how codemode calls tools. They are separate:

| Tool `exposure` | Declared to the model | Callable by codemode/`ctx.executeTool()` |
|-----------------|----------------------|-------------------------------------------|
| `direct` (default) | While active | Only while active |
| `model-only` | While active | Never; for tools that orchestrate other tools or ask the user |
| `codemode` | Only if explicitly activated | Always, and listed in the `codemode` description |
| `deferred` | After `tool_search` loads it | Always, but not listed; found by `tool_search`/`searchTools()` |
| `hidden` | Never | Never |

So an inactive `codemode`/`deferred` tool is still callable, while an inactive `direct` tool is unreachable from scripts. Because `codemode`/`deferred` tools do not depend on the active set, they stay callable after `/tree`, resume, and fork. `ctx.tools` in a tool's `execute()` lists exactly the callable tools.

## Nested Calls and Permissions

Each script call runs through `ctx.executeTool()`, the same pipeline as a model-issued call:

- Argument validation, then `tool_call` and `tool_result` handlers, then `tool_execution_start`/`update`/`end` events.
- Every event carries `parentToolCallId` (the `codemode` call's id); the nested call's `toolCallId` is `<parent id>/<n>`. Deeper calls nest the same way.
- Nested calls are not transcript tool calls or results. Only the calling tool's result reaches the model. The session keeps a bounded `nestedCalls` record on that result (name, arguments, status, duration, error; never results; arguments over 8 KiB per call or 32 KiB per result omitted; at most 256 calls; `complete: false` when anything was dropped).
- A `tool_call` block makes the script's `await tools.x()` reject. The script can continue.

For a permission extension this means:

- Judge a nested call from the live `tool_call` event (`event.toolName`, `event.input`, `event.parentToolCallId`). Do not look the id up in the last assistant message; it is not there.
- Do not approve a child because its parent `codemode` call was approved, and do not parse the script to predict children.
- `nestedCalls` is written after execution and may omit arguments; do not use it as the approval record.
- In print/JSON mode (`ctx.hasUI === false`) there is no one to ask: block or apply a non-interactive policy.
- `pi.getAllTools()` reports `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). They are unverified hints, useful for deciding which calls to confirm, not authority to skip policy.

## Tool Search

`tool_search` searches tools that are not declared (`codemode` and `deferred` exposure, such as MCP tools) with the same ranking as `searchTools()`, and declares the matches from the next model call on. Loaded tools are recorded like other tool changes and stay declared on that branch. Enable it with `"defaultTools": ["+tool_search"]` when no MCP server does.

## Replacing or Disabling

- An extension that registers a tool named `codemode` or `tool_search` replaces the built-in one.
- `"extensions": ["-builtin:codemode"]` or `["-builtin:tool-search"]` disables one (note the hyphen in the extension name); `pi config` lists them under Built-in.
- Both built-ins use only `exposure`, `prepareLoadout()`, and `ctx.executeTool()`, so an extension can build the same behavior under another name.

`@earendil-works/pi-codemode` publishes the sandbox (`CodemodeSandbox`) without Pi dependencies, for exposing any functions to model-written scripts.
