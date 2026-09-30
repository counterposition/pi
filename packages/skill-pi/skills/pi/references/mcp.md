# MCP Servers

Pi 0.99 connects to MCP servers through a built-in extension. There is no package to install. Checked against Pi v0.99.1: [mcp.md](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md), [cli.md#mcp-commands](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/cli.md#mcp-commands), [extensions.md#mcp-servers](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md#mcp-servers).

## Configure

| File | Scope |
|------|-------|
| `~/.pi/agent/mcp.json` | Global. Put personal servers and servers with credentials here |
| `.pi/mcp.json` | Project. Read only after the project is trusted, because stdio servers run commands |

A project entry replaces a global entry with the same name. The format is the usual `mcpServers` object, so Claude Desktop, Claude Code, and Cursor entries copy over unchanged:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "docs": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "exposure": "direct"
    }
  }
}
```

- stdio: `command` (one executable, not a shell string), `args`, `env`, `cwd`. Relative `cwd` resolves against the session directory; a leading `~/` works in `command`, args, and `cwd`.
- HTTP: `url`, `headers`, `oauth`. Only streamable HTTP; `"type": "sse"` is rejected (try the server's `/mcp` endpoint instead of `/sse`).
- `type` is optional (`stdio`, `http`, or `streamable-http`); `command` implies stdio and `url` implies HTTP.
- `env` and `headers` values accept `${NAME}` and `!command`. A command must produce the whole value: `"Authorization": "!echo Bearer $(gh auth token)"`.
- `timeout` is seconds per request (default 60); progress notifications reset it. `enabled: false` keeps the entry without connecting.
- Server names use letters, digits, `_`, `-`. Tools are named `mcp__<server>__<tool>`.
- Invalid entries are skipped and reported; other servers still connect.

Converting other clients: VS Code uses `servers` + `inputs` (move under `mcpServers`, replace `${input:...}` with `${NAME}`); Codex uses TOML `[mcp_servers.<name>]` (same fields as JSON); opencode uses `"type": "local"` with an array `command` (split into `command`/`args`), `environment` for `env`, and `{env:NAME}` for `${NAME}`.

## Set Up From a Shell

These commands work outside a session, so an agent can run them through `bash`:

```bash
pi mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
pi mcp add docs --url https://example.com/mcp --bearer-token-env-var DOCS_TOKEN --exposure direct
pi mcp add -l tools --env API_KEY='${TOOLS_KEY}' -- uvx tools-mcp   # -l writes .pi/mcp.json
pi mcp list            # connects to every enabled server; exits 1 while anything is wrong
pi mcp login sentry    # OAuth: opens the browser and waits for the user to approve
pi mcp remove docs     # keeps stored OAuth credentials
pi mcp logout sentry
```

`pi mcp add` does not connect; verify with `pi mcp list`. A running session picks up added or changed servers after `/reload` or a new session.

In a session, `/mcp` opens the server manager (state, tools, errors, sign in/out, reconnect, exposure, enable/disable). Changes are written back to the `mcp.json` that defines the server. Outside the TUI, `/mcp` prints status and `/mcp login|logout|reconnect <server>` run directly.

Pi connects on session start; the first prompt waits up to 10 seconds for startup connections. OAuth tokens live in `~/.pi/agent/mcp-auth.json`; server log notifications go to `~/.pi/agent/mcp.log`. For servers without dynamic client registration, set `oauth: { clientId, clientSecret?, callbackPort? | callbackUrl?, scope? }`.

## Exposure

`exposure` decides how the model reaches a server's tools:

| Value | Declared to the model | Callable from codemode | Notes |
|-------|----------------------|------------------------|-------|
| `codemode` (default) | No | Yes, listed in the `codemode` description | Pi activates `codemode` when such a server connects |
| `codemode-deferred` | No | Yes, found with `searchTools()` / `ALL_TOOLS` | Description names only the server and tool count; for large, rarely used servers |
| `deferred` | After `tool_search` loads them | Yes | Pi activates `tool_search`; for large servers without codemode |
| `direct` | Yes, like built-in tools | Yes | |
| `hidden` | No | No | Registered but unreachable |

`toolExposure` overrides single tools by name or `*` pattern (exact name wins, then first matching pattern):

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "exposure": "deferred",
      "toolExposure": { "search_code": "direct", "get_*": "codemode", "delete_*": "hidden" }
    }
  }
}
```

Undeclared tools (`codemode`, `codemode-deferred`, `deferred`) are reachable through either tool: codemode scripts can call a `deferred` server's tools, and `tool_search` can load a `codemode` server's tools. Set top-level `"autoEnableCodemode": false` in `mcp.json` to stop Pi from activating `codemode`. Pi warns once when neither `codemode` nor `tool_search` is active, because the tools are then unreachable.

## Results

- Text results over 20KB reach the model with the middle cut out; the full text goes to a temp file named in the result.
- Codemode scripts receive the whole `CallToolResult` (`content`, `structuredContent`, `isError`). A result with `isError` resolves in scripts and is reported to the model as an error for direct calls. `image(result.content[0])` forwards an image block.
- Servers with resources add `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` (marked read-only).
- Tool calls are never retried (the server may have run them); resource reads retry once on 408/429/5xx.

## Permissions

Every MCP call goes through Pi's tool pipeline, so `tool_call` and `tool_result` handlers (permission gates included) see MCP tools. Calls from codemode scripts carry the `codemode` call's id as `parentToolCallId`. `pi.getAllTools()` reports the server's `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations. They are unverified hints; see [Tool Exposure](extensions.md#tool-exposure--structured-results).

## Servers From Extensions

```typescript
pi.registerMcpServer("jira", { url: "https://mcp.example.com/jira", exposure: "codemode" });
pi.unregisterMcpServer("jira");
```

- Same config shape as an `mcpServers` entry. Registrations are not saved: register on every load.
- Registered during load: connects on `session_start` with the `mcp.json` servers. Registered later: connects right away.
- An `mcp.json` server with the same name wins. Another extension's name, an invalid name, or an invalid config throws.
- `pi mcp` shell commands do not load extensions and only see `mcp.json` servers.
- Alternative MCP extensions read registrations with `pi.getMcpServers()` on `session_start` and handle `mcp_servers_change`.

## Turning It Off or Replacing It

- `"extensions": ["-builtin:mcp"]` in settings, or `pi config` → Built-in, disables the built-in support. `pi mcp` shell commands still work.
- `--no-extensions` disables built-ins too; `pi -ne -e builtin:mcp` keeps only MCP.
- An extension that registers the `/mcp` command (for example `pi-mcp-adapter`) replaces the built-in support: `mcp.json` is then not read in sessions.

## SDK

SDK sessions do not load built-in extensions. Add `createMcpExtension()`, plus `createCodemodeExtension()` for `codemode`/`codemode-deferred` servers and `createToolSearchExtension()` for `deferred` servers, then call `session.bindExtensions()` so `session_start` connects the servers. See `references/sdk.md`.

The standalone client is published as `@earendil-works/pi-mcp` (stdio and streamable HTTP transports, OAuth, an in-memory testing transport). It has no Pi session dependency.
