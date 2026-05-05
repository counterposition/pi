import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import memoryExtension from "../extensions/memory.js";
import { resolveProjectIdentity } from "../src/identity.js";
import { resolveMemoryRoots } from "../src/storage.js";
import { cleanupTempDir, createRuntimeFixtureEnvironment } from "./helpers.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempDirs: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 3, 6, 12, 0));
});

afterEach(async () => {
  vi.useRealTimers();
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }

  await Promise.all(tempDirs.splice(0).map((directory) => cleanupTempDir(directory)));
});

describe("integration", () => {
  it("refreshes the orientation summary after creating a new topic", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const before = await callHandler(
      harness,
      "before_agent_start",
      { systemPrompt: "" },
      {
        cwd: environment.cwd,
        hasUI: false,
      },
    );
    expect(getReturnedPrompt(before)).toContain("Memory: 7 topics");

    const writeTool = harness.tools.get("memory_write");
    expect(writeTool).toBeDefined();
    await writeTool?.execute(
      "tool-1",
      {
        topic: "Architecture",
        content: "## Durable architecture note\n\nPersist this architectural convention.",
      },
      new AbortController().signal,
    );

    const after = await callHandler(
      harness,
      "before_agent_start",
      { systemPrompt: "" },
      {
        cwd: environment.cwd,
        hasUI: false,
      },
    );
    expect(getReturnedPrompt(after)).toContain("Memory: 8 topics");
  });

  it("moves an entry across scopes through the memory_move tool", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const moveTool = harness.tools.get("memory_move");
    expect(moveTool).toBeDefined();
    const entryId = "mem_01JW33BK6K3R6N3Y0F2A1M8Q9J";
    const result = (await moveTool?.execute(
      "tool-move",
      {
        entry_id: entryId,
        scope: "project",
      },
      new AbortController().signal,
    )) as {
      details: {
        targetFilePath: string;
      };
    };

    const source = await fs.readFile(
      path.join(environment.roots.topicDirs.global, "preferences.md"),
      "utf8",
    );
    const target = await fs.readFile(result.details.targetFilePath, "utf8");
    const realTargetPath = await fs.realpath(
      path.join(environment.roots.topicDirs.project, "preferences.md"),
    );

    expect(source).not.toContain(entryId);
    expect(target).toContain(entryId);
    expect(result.details.targetFilePath).toBe(realTargetPath);
  });

  it("searches across scopes and ranks project results ahead of equally relevant global results", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const searchTool = harness.tools.get("memory_search");
    expect(searchTool).toBeDefined();
    const result = (await searchTool?.execute(
      "tool-2",
      {
        query: "package management",
      },
      new AbortController().signal,
    )) as {
      details: {
        results: Array<{
          id: string;
          scope: "global" | "project";
          updatedLabel: string;
          lineSpan: { start: number; end: number };
        }>;
      };
    };

    expect(result.details.results[0].scope).toBe("project");
    expect(result.details.results[0].id).toBe("mem_01JW2ZZB7N6K4Q2R1P8D5H3C9F");
    expect(result.details.results[1].scope).toBe("global");
    expect(result.details.results[0].updatedLabel).toBe("2026-03-29 (8 days ago)");
    expect(result.details.results[0].lineSpan.start).toBeGreaterThan(1);
  });

  it("creates the full memory directory structure on first session_start", async () => {
    const environment = await createEmptyRuntimeEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const identity = resolveProjectIdentity(environment.cwd);
    const roots = resolveMemoryRoots(environment.agentDir, identity);

    await expect(fs.stat(roots.inboxDirs.global)).resolves.toBeDefined();
    await expect(fs.stat(roots.topicDirs.global)).resolves.toBeDefined();
    await expect(fs.stat(roots.inboxDirs.project)).resolves.toBeDefined();
    await expect(fs.stat(roots.topicDirs.project)).resolves.toBeDefined();
  });

  it("returns empty results when the memory store has no topic files", async () => {
    const environment = await createEmptyRuntimeEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const searchTool = harness.tools.get("memory_search");
    expect(searchTool).toBeDefined();

    const result = (await searchTool?.execute(
      "tool-empty",
      { query: "anything" },
      new AbortController().signal,
    )) as {
      content: Array<{ text: string }>;
      details: { results: unknown[] };
    };

    expect(result.details.results).toHaveLength(0);
    expect(result.content[0]?.text).toBe("No matching memories.");
  });

  it("reports a direct entry ID without invalidating in non-interactive /forget mode", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const targetId = "mem_01JW33BK6K3R6N3Y0F2A1M8Q9J";
    const result = await harness.commands.get("forget")?.handler(targetId, {
      cwd: environment.cwd,
      hasUI: false,
    });
    const output = getLastCommandOutput(harness);
    const source = await fs.readFile(
      path.join(environment.roots.topicDirs.global, "preferences.md"),
      "utf8",
    );

    expect(result).toBeUndefined();
    expect(output).toContain(targetId);
    expect(source).not.toContain("- Status: invalid");
  });

  it("confirms before invalidating a direct entry ID in interactive /forget mode", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const confirm = vi.fn(async () => true);
    const result = await harness.commands.get("forget")?.handler("mem_01JW33BK6K3R6N3Y0F2A1M8Q9J", {
      cwd: environment.cwd,
      hasUI: true,
      ui: {
        confirm,
        notify: vi.fn(),
        select: vi.fn(),
      },
    });
    const source = await fs.readFile(
      path.join(environment.roots.topicDirs.global, "preferences.md"),
      "utf8",
    );

    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toBe("Invalidated mem_01JW33BK6K3R6N3Y0F2A1M8Q9J.");
    expect(confirm).toHaveBeenCalledWith(
      "Forget memory?",
      expect.stringContaining("mem_01JW33BK6K3R6N3Y0F2A1M8Q9J"),
    );
    expect(source).toContain("- Status: invalid");
  });

  it("prompts for a query before invalidating in interactive empty /forget mode", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const input = vi.fn(async () => "Prefer terse responses");
    const confirm = vi.fn(async () => true);
    const result = await harness.commands.get("forget")?.handler("", {
      cwd: environment.cwd,
      hasUI: true,
      ui: {
        confirm,
        input,
        notify: vi.fn(),
        select: vi.fn(),
      },
    });
    const source = await fs.readFile(
      path.join(environment.roots.topicDirs.global, "preferences.md"),
      "utf8",
    );

    expect(input).toHaveBeenCalledWith("What should Pi forget?", "");
    expect(confirm).toHaveBeenCalledWith(
      "Forget memory?",
      expect.stringContaining("mem_01JW33BK6K3R6N3Y0F2A1M8Q9J"),
    );
    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toBe("Invalidated mem_01JW33BK6K3R6N3Y0F2A1M8Q9J.");
    expect(source).toContain("- Status: invalid");
  });

  it("confirms before invalidating one of multiple /forget matches", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const select = vi.fn(async (_title: string, options: string[]) => options[0]);
    const confirm = vi.fn(async () => false);
    const result = await harness.commands.get("forget")?.handler("package management", {
      cwd: environment.cwd,
      hasUI: true,
      ui: {
        confirm,
        notify: vi.fn(),
        select,
      },
    });
    const source = await fs.readFile(
      path.join(environment.roots.topicDirs.project, "build.md"),
      "utf8",
    );

    expect(result).toBeUndefined();
    expect(select).toHaveBeenCalledWith(
      "Select a memory to invalidate:",
      expect.arrayContaining(["1. [project] Use pnpm, not npm (mem_01JW2ZZB7N6K4Q2R1P8D5H3C9F)"]),
    );
    expect(confirm).toHaveBeenCalledWith(
      "Forget memory?",
      expect.stringContaining("mem_01JW2ZZB7N6K4Q2R1P8D5H3C9F"),
    );
    expect(getLastCommandOutput(harness)).toBe("Cancelled.");
    expect(source).toContain("- ID: mem_01JW2ZZB7N6K4Q2R1P8D5H3C9F\n- Status: active");
  });

  it("returns cancelled when the interactive empty /forget prompt is dismissed", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const input = vi.fn(async () => undefined);
    const confirm = vi.fn();
    const result = await harness.commands.get("forget")?.handler("", {
      cwd: environment.cwd,
      hasUI: true,
      ui: {
        confirm,
        input,
        notify: vi.fn(),
        select: vi.fn(),
      },
    });

    expect(input).toHaveBeenCalledWith("What should Pi forget?", "");
    expect(confirm).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toBe("Cancelled.");
  });

  it("falls back to text search for non-ID /forget queries", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const result = await harness.commands.get("forget")?.handler("Prefer terse responses", {
      cwd: environment.cwd,
      hasUI: false,
    });

    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toContain("mem_01JW33BK6K3R6N3Y0F2A1M8Q9J");
  });

  it("returns no matches for an unknown direct entry ID", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const result = await harness.commands.get("forget")?.handler("mem_01JW33BK6K3R6N3Y0F2A1M8QZZ", {
      cwd: environment.cwd,
      hasUI: false,
    });

    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toBe("No matching memories.");
  });

  it("truncates memory_search results at max_results", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const searchTool = harness.tools.get("memory_search");
    expect(searchTool).toBeDefined();

    const defaultResult = (await searchTool?.execute(
      "tool-max-default",
      { query: "many topic entry truncation" },
      new AbortController().signal,
    )) as {
      details: { results: unknown[] };
    };
    expect(defaultResult.details.results).toHaveLength(10);

    const cappedResult = (await searchTool?.execute(
      "tool-max-capped",
      { query: "many topic entry truncation", max_results: 3 },
      new AbortController().signal,
    )) as {
      details: { results: unknown[] };
    };
    expect(cappedResult.details.results).toHaveLength(3);
  });

  it("serializes concurrent writes to the same topic file without losing entries", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const writeTool = harness.tools.get("memory_write");
    expect(writeTool).toBeDefined();

    const [first, second] = (await Promise.all([
      writeTool?.execute(
        "tool-3",
        {
          topic: "Build",
          content: "## Concurrent note one\n\nFirst concurrent memory write.",
        },
        new AbortController().signal,
      ),
      writeTool?.execute(
        "tool-4",
        {
          topic: "Build",
          content: "## Concurrent note two\n\nSecond concurrent memory write.",
        },
        new AbortController().signal,
      ),
    ])) as Array<{
      details: {
        entryId: string;
      };
    }>;

    const source = await fs.readFile(
      path.join(environment.roots.topicDirs.project, "build.md"),
      "utf8",
    );

    expect(source).toContain(first.details.entryId);
    expect(source).toContain(second.details.entryId);
    expect(source).toContain("## Concurrent note one");
    expect(source).toContain("## Concurrent note two");
  });
});

function registerExtension(): {
  commands: Map<
    string,
    { description: string; handler: (args: string, ctx: unknown) => Promise<unknown> | unknown }
  >;
  handlers: Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown> | unknown>>;
  messages: TestCommandMessage[];
  tools: Map<
    string,
    {
      execute: (
        toolCallId: string,
        params: unknown,
        signal: AbortSignal,
        onUpdate?: (update: unknown) => void,
        ctx?: unknown,
      ) => Promise<unknown>;
    }
  >;
} {
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: unknown) => Promise<unknown> | unknown>
  >();
  const tools = new Map<
    string,
    {
      execute: (
        toolCallId: string,
        params: unknown,
        signal: AbortSignal,
        onUpdate?: (update: unknown) => void,
        ctx?: unknown,
      ) => Promise<unknown>;
    }
  >();
  const commands = new Map<
    string,
    { description: string; handler: (args: string, ctx: unknown) => Promise<unknown> | unknown }
  >();
  const messages: TestCommandMessage[] = [];

  memoryExtension({
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => {
        const existing = handlers.get(event) ?? [];
        existing.push(handler);
        handlers.set(event, existing);
      },
    ),
    registerTool: vi.fn(
      (tool: {
        name: string;
        execute: (
          toolCallId: string,
          params: unknown,
          signal: AbortSignal,
          onUpdate?: (update: unknown) => void,
          ctx?: unknown,
        ) => Promise<unknown>;
      }) => {
        tools.set(tool.name, tool);
      },
    ),
    registerCommand: vi.fn(
      (
        name: string,
        command: {
          description: string;
          handler: (args: string, ctx: unknown) => Promise<unknown> | unknown;
        },
      ) => {
        commands.set(name, command);
      },
    ),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn((message: TestCommandMessage) => {
      messages.push(message);
    }),
  } as unknown as Parameters<typeof memoryExtension>[0]);

  return { commands, handlers, messages, tools };
}

async function callHandler(
  harness: ReturnType<typeof registerExtension>,
  eventName: string,
  event: unknown,
  ctx: unknown,
): Promise<unknown> {
  const handlers = harness.handlers.get(eventName);
  expect(handlers).toHaveLength(1);
  return handlers?.[0](event, ctx);
}

interface TestCommandMessage {
  customType: string;
  content: string | Array<{ type: string }>;
  display: boolean;
  details?: unknown;
}

function getLastCommandOutput(harness: ReturnType<typeof registerExtension>): string {
  const message = harness.messages.at(-1);
  expect(message).toMatchObject({
    customType: "pi-memory-command",
    display: true,
  });
  expect(typeof message?.content).toBe("string");
  return String(message?.content);
}

function getReturnedPrompt(result: unknown): string {
  expect(result).toMatchObject({
    systemPrompt: expect.any(String),
  });
  return (result as { systemPrompt: string }).systemPrompt;
}

async function createEmptyRuntimeEnvironment(): Promise<{
  tempDir: string;
  cwd: string;
  agentDir: string;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-empty-"));
  const cwd = path.join(tempDir, "workspace");
  const agentDir = path.join(tempDir, "agent");

  await fs.mkdir(cwd, { recursive: true });

  return {
    tempDir,
    cwd,
    agentDir,
  };
}
