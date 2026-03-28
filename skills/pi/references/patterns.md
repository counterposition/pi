# Common Patterns & Recipes

Practical recipes for extending Pi. Each pattern is a self-contained example.

## Table of Contents

1. [Permission Gate](#permission-gate)
2. [Protected Paths](#protected-paths)
3. [Preset System](#preset-system)
4. [Sub-agents](#sub-agents)
5. [Git Checkpoint & Restore](#git-checkpoint--restore)
6. [Auto-Commit on Exit](#auto-commit-on-exit)
7. [Custom Compaction](#custom-compaction)
8. [Plan Mode (Read-Only)](#plan-mode-read-only)
9. [Claude Rules Integration](#claude-rules-integration)
10. [Interactive Shell](#interactive-shell)
11. [TUI Components](#tui-components)
12. [Status Line & Widgets](#status-line--widgets)
13. [File Watcher / Trigger](#file-watcher--trigger)
14. [Input Transform](#input-transform)
15. [Tool Override](#tool-override)

---

## Permission Gate

Block dangerous bash commands with user confirmation:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const dangerous = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const cmd = event.input.command as string;
    if (!dangerous.some(p => p.test(cmd))) return;
    if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked (no UI)" };
    const ok = await ctx.ui.select(`⚠️ ${cmd}\nAllow?`, ["Yes", "No"]);
    if (ok !== "Yes") return { block: true, reason: "Blocked by user" };
  });
}
```

## Protected Paths

Block writes to sensitive files:

```typescript
export default function (pi: ExtensionAPI) {
  const protected = [".env", ".git/", "node_modules/", "*.pem", "*.key"];

  pi.on("tool_call", async (event, ctx) => {
    if (!["write", "edit"].includes(event.toolName)) return;
    const path = (event.input.file_path || event.input.path) as string;
    if (protected.some(p => path.includes(p))) {
      return { block: true, reason: `Protected path: ${path}` };
    }
  });
}
```

## Preset System

Named configurations (model + thinking + tools + instructions):

**`~/.pi/agent/presets.json`:**

```json
{
  "plan": {
    "model": "claude-sonnet-4-20250514",
    "thinkingLevel": "high",
    "tools": ["read", "grep", "find", "ls"],
    "instructions": "Analyze the codebase and propose a plan. Do not modify any files."
  },
  "implement": {
    "model": "claude-sonnet-4-20250514",
    "thinkingLevel": "medium",
    "tools": ["read", "bash", "edit", "write"],
    "instructions": "Implement the requested changes with minimal, focused edits."
  }
}
```

The preset extension (from Pi examples) loads these and exposes `/preset [name]` + `Ctrl+Shift+U` cycling.

## Sub-agents

Delegate tasks to isolated Pi processes. The subagent extension (from Pi examples) provides:

```text
// Single agent
{ agent: "researcher", task: "Find all API endpoints in this codebase" }

// Parallel execution
{ tasks: [
  { agent: "researcher", task: "Analyze auth module" },
  { agent: "researcher", task: "Analyze database module" }
]}

// Sequential chain with context passing
{ chain: [
  { agent: "researcher", task: "Find all TODO comments" },
  { agent: "writer", task: "Write a summary of: {previous}" }
]}
```

Agent definitions live in `~/.pi/agent/agents/` or `.pi/agents/`. Each is a directory with a config file specifying model, tools, and system prompt.

## Git Checkpoint & Restore

Save code state at each turn, offer restore on fork:

```typescript
export default function (pi: ExtensionAPI) {
  const checkpoints = new Map<string, string>();
  let currentEntryId: string | undefined;

  pi.on("tool_result", async (_event, ctx) => {
    const leaf = ctx.sessionManager.getLeafEntry();
    if (leaf) currentEntryId = leaf.id;
  });

  pi.on("turn_start", async () => {
    const { stdout } = await pi.exec("git", ["stash", "create"]);
    if (stdout.trim() && currentEntryId) checkpoints.set(currentEntryId, stdout.trim());
  });

  pi.on("session_before_fork", async (event, ctx) => {
    const ref = checkpoints.get(event.entryId);
    if (!ref || !ctx.hasUI) return;
    const ok = await ctx.ui.select("Restore code?", ["Yes", "No"]);
    if (ok?.startsWith("Yes")) await pi.exec("git", ["stash", "apply", ref]);
  });
}
```

## Auto-Commit on Exit

Stage and commit all changes when session ends:

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async (_event, ctx) => {
    const { stdout } = await pi.exec("git", ["status", "--porcelain"]);
    if (!stdout.trim()) return;

    const messages = ctx.sessionManager.getBranch();
    const lastAssistant = messages.reverse().find(m => m.role === "assistant");
    const text = lastAssistant?.content?.find(c => c.type === "text")?.text || "pi session changes";
    const firstLine = text.split("\n")[0].slice(0, 50);

    await pi.exec("git", ["add", "-A"]);
    await pi.exec("git", ["commit", "-m", `[pi] ${firstLine}`]);
    ctx.ui?.notify("Changes committed", "info");
  });
}
```

## Custom Compaction

Replace default compaction with a custom summary model:

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    const allMessages = [...event.messagesToSummarize, ...event.turnPrefixMessages];
    // Use a cheaper model for summarization
    const summary = await myCustomSummarize(allMessages);
    return {
      summary,
      firstKeptEntryId: event.firstKeptEntryId,
      tokensBefore: event.tokens,
    };
  });
}
```

## Plan Mode (Read-Only)

Restrict to read-only tools for safe exploration:

```typescript
export default function (pi: ExtensionAPI) {
  let planMode = false;

  pi.registerCommand("plan", {
    description: "Toggle read-only plan mode",
    async handler(_args, ctx) {
      planMode = !planMode;
      if (planMode) {
        pi.setActiveTools(["read", "bash", "grep", "find", "ls"]);
        ctx.ui.notify("Plan mode ON — read-only tools only", "info");
      } else {
        pi.setActiveTools(["read", "bash", "edit", "write"]);
        ctx.ui.notify("Plan mode OFF — full tools restored", "info");
      }
    },
  });

  pi.on("tool_call", async (event) => {
    if (!planMode || event.toolName !== "bash") return;
    const cmd = event.input.command as string;
    // Block destructive bash in plan mode
    if (/\b(rm|mv|cp|chmod|chown|git\s+(push|commit|reset))\b/.test(cmd)) {
      return { block: true, reason: "Blocked in plan mode" };
    }
  });
}
```

## Claude Rules Integration

Scan `.claude/rules/` and inject into system prompt:

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const rulesDir = path.join(ctx.cwd, ".claude", "rules");
    if (!fs.existsSync(rulesDir)) return;
    const files = fs.readdirSync(rulesDir, { recursive: true })
      .filter(f => f.toString().endsWith(".md"));
    if (files.length === 0) return;
    const listing = files.map(f => `- .claude/rules/${f}`).join("\n");
    event.systemPrompt += `\n\nProject rules (${files.length} files):\n${listing}\nUse the read tool to load relevant rules.`;
  });
}
```

## Interactive Shell

Keep a persistent shell session across tool calls (rather than spawning a new shell each time):

The Pi examples include an `interactive-shell.ts` extension that maintains a persistent bash process, allowing stateful shell operations (cd, environment variables, etc.) across multiple tool invocations.

## TUI Components

Pi's TUI library (`@mariozechner/pi-tui`) provides:

- `Text` — Word-wrapped text
- `Box` — Padded container with border
- `Container` — Vertical grouping
- `Spacer` — Vertical space
- `Markdown` — Rendered markdown
- `Image` — Terminal image display
- `SelectList` — Interactive selection list
- `BorderedLoader` — Async spinner with cancel

All components implement `render(width) → string[]` and optional `handleInput(data)`.

## Status Line & Widgets

```typescript
// Footer status text
ctx.ui.setStatus("🔍 Searching...");

// Widget above the editor
ctx.ui.setWidget("above", new Text("Current task: refactoring auth", 0, 0));

// Widget below the editor
ctx.ui.setWidget("below", progressComponent);

// Custom footer
ctx.ui.setFooter(new Text(theme.fg("accent", "My Extension v1.0"), 0, 0));
```

## File Watcher / Trigger

Run actions when files change:

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    fs.watch(ctx.cwd, { recursive: true }, (eventType, filename) => {
      if (filename?.endsWith(".test.ts")) {
        ctx.ui.notify(`Test file changed: ${filename}`, "info");
      }
    });
  });
}
```

## Input Transform

Modify user input before it reaches the LLM:

```typescript
pi.on("input", async (event) => {
  // Expand shorthand
  event.text = event.text.replace(/^fix /, "Find and fix the bug: ");
  // Or block certain inputs
  if (event.text.includes("DELETE EVERYTHING")) {
    return { block: true };
  }
});
```

## Tool Override

Replace a built-in tool's behavior:

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "write") {
    // Add a backup before every write
    const filePath = event.input.file_path as string;
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
  }
});
```
