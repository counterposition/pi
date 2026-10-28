# Codemode and Tool Search

`codemode` is a built-in tool (Pi 0.99) that runs model-written JavaScript in a QuickJS sandbox. Scripts call Pi's other tools, filter their results, and return only what the model needs. `tool_search` declares tools the model cannot see yet. Checked against Pi v1.4.0: [codemode.md](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/codemode.md), [cli.md#tools](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/cli.md#tools), [extensions.md#tool-exposure](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md#tool-exposure), [settings.md#tools](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/settings.md#tools), [codemode tool source](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/extensions/codemode/tool.ts).

## Enable

Both tools are registered inactive. The default tools stay `read`, `bash`, `edit`, `write`.

```json
{ "defaultTools": ["+codemode"] }
```

- `+name` adds to the default selection, also on the command line (`pi --tools +codemode`, Pi 1.1.0). `--tools` with plain names replaces the selection and unregisters unlisted built-in and extension tools, so scripts cannot call them; MCP tools stay unless an entry starts with `mcp__` (Pi 1.0.4). See `references/settings.md`.
- The MCP extension activates `codemode` for servers with `codemode` exposure and `tool_search` for `deferred` servers (see `references/mcp.md`).
- SDK sessions need `createCodemodeExtension()` / `createToolSearchExtension()` in the resource loader (see `references/sdk.md`).

| Setting | Default | Effect |
|---------|---------|--------|
| `codemode.mode` | `"on"` | `on`: declared tools stay declared and their descriptions show the script call; `codemode` lists only undeclared tools. `only`: active built-in and extension tools are hidden from the model and listed in the `codemode` description instead |
| `codemode.inlineBudget` | `3000` | Estimated tokens the `codemode` description may spend on tool declarations; the rest are found with `searchTools()`. `0` lists only namespaces |

Since Pi 1.2.0, tool declarations in scripts show parameter constraints (integer, minimum/maximum, length, pattern, default) as `@` tags on property comments, so a tool need not repeat them in its descriptions. Use `Type.Integer` for counts and offsets.

## Script API

The script body is an async function: top-level `await` and `return` work.

- `await tools.<name>(args)` calls a tool. Characters that are not valid in an identifier become `_` (`mcp__dev-radius__search` → `tools.mcp__dev_radius__search`).
- Since Pi 1.0.0, reading a member of `tools`, `models`, or another global namespace that does not exist throws an error naming the close matches (`tools.Bash` suggests `tools.bash`). Check for a tool with `"name" in tools`; `typeof tools.name` now throws.
- `ALL_TOOLS` lists `{ name, description }`. `await searchTools(query, { limit, namespace })` ranks tools with BM25; `await describeTool(name)` returns one declaration; `await describeNamespace(name)` returns `{ name, description?, instructions?, tools }` for a namespace such as an MCP server (`mcp__dev-radius`, `dev_radius`, and similar spellings all work).
- Output: `text(value)`, `image(dataUrlOrImageContent)`, `console.*`, and the returned value. Since Pi 0.99.2 `image()` accepts only base64 PNG, JPEG, GIF, or WebP (a `data:` URL, `{ image_url }`, or an image block); it derives the MIME type from the image bytes, rejects remote URLs, and throws a `TypeError` for anything else, such as an SVG. Since Pi 1.0.3 it also saves each image to a temp file and names the path in the result, so a later turn can copy or move it. `exit()` ends early and keeps output.
- `store(key, value)` / `load(key)` keep JSON values across `codemode` calls (storing `undefined` deletes). Successful scripts append a `codemode-store` custom entry, so values follow the session branch. Limits: 262144 characters of JSON per value, 1048576 in total; do not store image data.
- `models.getModelsOfType`, `getAvailableOfType`, `getModelOfType`, `models.classify(model, { state, questions })`, and `models.generateImages(model, { input })` (Pi 1.0.0) reach the model catalog, classifiers, and image models with session credentials. Both calls use only the model's `provider` and `id`, never throw on provider errors (check `stopReason`), and run at most four at a time per script. Their usage and cost are added to the `codemode` result. Show generated images with `image(block)` rather than printing `data`; generation can take minutes, so avoid a short `timeout_ms`.
- `models.classify()` also takes `images` (Pi 1.1.0): image blocks judged with the state, for classifiers whose `input` includes `"image"`: `openai/gpt-6-luna` and, since Pi 1.4.0, Jev, Clef, and OpenRouter classifiers that list image input (see `references/providers.md`). Other classifiers return an error result. `await tools.read({ path })` on an image file resolves to such a block (Pi 1.0.4).
- Malformed `classify()`/`generateImages()` arguments are rejected with the expected shape, and an unknown model points to `models.getAvailableOfType()`.
- An optional first line `// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}`. It must be the first line: since Pi 1.2.0 an options line anywhere else fails the call before the script runs. Output is capped at 10000 estimated tokens by default (start and end kept, full text in a temp file); there is no timeout unless set. Since Pi 1.0.1 a script fails with a `RangeError` once its output passes 16777216 characters (text plus base64 image data) or 100000 `text()`/`image()`/`console` calls; write large data to a file with a tool.
- No timers, `fetch`, `process`, `require`, or modules. The VM has 256 MB of memory; a script awaiting a promise that can never settle fails at once; scripts cannot start other `codemode` scripts.
- At most two codemode workers are alive at once across all sessions in one Pi process (Pi 1.3.0); a cancelled worker holds its slot until it exits. Since Pi 1.4.0 further scripts wait for a free worker in arrival order instead of failing, and fail without running after 60 seconds or their `timeout_ms`. `PI_CODEMODE_MAX_WORKERS` raises the limit, for example for in-process subagents.

The result starts with `Script completed` or `Script failed`, the wall time, and the output. Since Pi 1.1.0, with more than one text item each starts with a `==> text N/M <==` line, and `console` calls follow the other output in one `<console_output>` block, one line per call. A failed script keeps its partial output followed by `Script error:`.

## What a Script Receives

| Tool | `await tools.x(...)` resolves to |
|------|--------------------------------|
| Declares `outputSchema` | Its `structuredContent`, also when the result has `isError: true` |
| MCP tool | The whole `CallToolResult` (`content`, `structuredContent`, `isError`) |
| `read` on an image | An image block `{ type: "image", data, mimeType, note }` that `image()` shows (Pi 1.0.4) |
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

MCP tools with the default server `codemode` exposure are registered like `deferred` tools: callable, but not listed in the `codemode` description, so it stays the same while servers connect. Scripts find them with `searchTools()` or `describeNamespace()`.

So an inactive `codemode`/`deferred` tool is still callable, while an inactive `direct` tool is unreachable from scripts. Because `codemode`/`deferred` tools do not depend on the active set, they stay callable after `/tree`, resume, and fork. `ctx.tools` in a tool's `execute()` lists exactly the callable tools.

## Nested Calls and Permissions

Each `tools.*` call runs through `ctx.executeTool()`, the same pipeline as a model-issued call. `models.classify()` and `models.generateImages()` do not: they run with the session's credentials and fire no `tool_call`/`tool_result` events, so a permission extension cannot gate them separately from the `codemode` call itself.

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
- `codemode` uses only `exposure`, `prepareLoadout()`, and `ctx.executeTool()`, and `tool_search` only ranks registered tools (`pi.getAllTools()`) and adds matches with `pi.setActiveTools()`, so an extension can build either under another name.
- A replacement should declare `reachesTools` (Pi 1.2.0, see `references/extensions.md`): only then does Pi activate it for MCP servers and wait for the servers its calls need.

`@earendil-works/pi-codemode` publishes the sandbox (`CodemodeSandbox`) without Pi dependencies, for exposing any functions to model-written scripts. Since Pi 1.2.0 its `/portable` entry adds sandboxes with the same API for Cloudflare Workers and other runtimes without worker threads. Breaking in Pi 1.3.0: results and `close()` settle once shutdown is requested, not when the worker exits; a host that must count workers until they exit uses the `onWorkerStarted(exited)` callback or reserves capacity with `acquireWorker()`.
