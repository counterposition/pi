import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import memoryExtension from "../extensions/memory.js";
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

describe("memory extension", () => {
  it("registers a friendly renderer for command messages", () => {
    const harness = registerExtension();

    expect(harness.messageRenderers.has("pi-memory-command")).toBe(true);
  });

  it("injects the memory contract and cached orientation summary", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const event = { systemPrompt: "Base prompt" };
    const result = await callHandler(harness, "before_agent_start", event, {
      cwd: environment.cwd,
      hasUI: false,
    });
    const returnedPrompt = getReturnedPrompt(result);

    expect(event.systemPrompt).toBe("Base prompt");
    expect(returnedPrompt).toContain("Base prompt");
    expect(returnedPrompt).toContain(
      "Durable memory is available through memory_search, memory_write, and memory_move.",
    );
    expect(returnedPrompt).toContain("Memory: 7 topics");
  });

  it("does not append the memory contract twice", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const first = await callHandler(
      harness,
      "before_agent_start",
      { systemPrompt: "Base prompt" },
      { cwd: environment.cwd, hasUI: false },
    );
    const second = await callHandler(
      harness,
      "before_agent_start",
      { systemPrompt: getReturnedPrompt(first) },
      { cwd: environment.cwd, hasUI: false },
    );

    expect(countOccurrences(getReturnedPrompt(second), "Durable memory is available")).toBe(1);
  });

  it("allows read tool calls into the managed memory root", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const result = await callHandler(
      harness,
      "tool_call",
      {
        toolName: "read",
        input: {
          path: `${environment.roots.topicDirs.project}/build.md`,
        },
      },
      { cwd: environment.cwd, hasUI: false },
    );

    expect(result).toBeUndefined();
  });

  it("blocks direct write/edit tool calls into the managed memory root", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const blocked = await callHandler(
      harness,
      "tool_call",
      {
        toolName: "write",
        input: {
          path: `${environment.roots.topicDirs.project}/build.md`,
        },
      },
      { cwd: environment.cwd, hasUI: false },
    );
    const allowed = await callHandler(
      harness,
      "tool_call",
      {
        toolName: "write",
        input: {
          path: `${environment.cwd}/memory-notes.md`,
        },
      },
      { cwd: environment.cwd, hasUI: false },
    );

    expect(blocked).toEqual({
      block: true,
      reason:
        "Direct write/edit calls into the managed memory store are blocked. Use memory_write instead.",
    });
    expect(allowed).toBeUndefined();
  });

  it("blocks write tool calls that traverse out of the managed memory root", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const blocked = await callHandler(
      harness,
      "tool_call",
      {
        toolName: "write",
        input: {
          path: `${environment.roots.topicDirs.project}/../escape.md`,
        },
      },
      { cwd: environment.cwd, hasUI: false },
    );

    expect(blocked).toEqual({
      block: true,
      reason:
        "Direct write/edit calls into the managed memory store are blocked. Use memory_write instead.",
    });
  });

  it("sends the full /memory status through an explicit command message", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const notify = vi.fn();
    const result = await harness.commands.get("memory")?.handler("", {
      cwd: environment.cwd,
      hasUI: true,
      ui: {
        notify,
      },
    });
    const output = getLastCommandOutput(harness);

    expect(result).toBeUndefined();
    expect(output).toContain("Memory is enabled.");
    expect(output).toContain(`Storage root: ${environment.roots.memoryDir}`);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stores /remember arguments directly in project memory", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const result = await harness.commands.get("remember")?.handler("Prefer terse answers.", {
      cwd: environment.cwd,
      hasUI: false,
    });
    const output = getLastCommandOutput(harness);
    const stored = await fs.readFile(
      path.join(environment.roots.topicDirs.project, "preferences.md"),
      "utf8",
    );

    expect(result).toBeUndefined();
    expect(output).toContain("Stored memory mem_");
    expect(output).toContain('under topic "preferences"');
    expect(stored).toContain("## Prefer terse answers");
  });

  it("collects missing /remember text from the UI editor and stores it", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const editor = vi.fn(async () => "Vitest is the default test runner.");
    const input = vi.fn(async (title: string, suggestedTopic?: string) => suggestedTopic);
    const notify = vi.fn();
    const result = await harness.commands.get("remember")?.handler("", {
      cwd: environment.cwd,
      hasUI: true,
      ui: {
        editor,
        input,
        notify,
      },
    });
    const output = getLastCommandOutput(harness);
    const stored = await fs.readFile(
      path.join(environment.roots.topicDirs.project, "testing.md"),
      "utf8",
    );

    expect(editor).toHaveBeenCalledWith("What should Pi remember?", "");
    expect(input).toHaveBeenCalledWith("Topic name:", "testing");
    expect(result).toBeUndefined();
    expect(output).toContain("Stored memory mem_");
    expect(output).toContain('under topic "testing"');
    expect(stored).toContain("## Vitest is the default test runner");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Stored memory mem_"), "info");
  });

  it("returns cancelled when the empty /remember prompt is dismissed", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const editor = vi.fn(async () => undefined);
    const input = vi.fn(async () => undefined);
    const result = await harness.commands.get("remember")?.handler("", {
      cwd: environment.cwd,
      hasUI: true,
      ui: {
        editor,
        input,
        notify: vi.fn(),
      },
    });

    expect(editor).toHaveBeenCalledWith("What should Pi remember?", "");
    expect(input).toHaveBeenCalledWith("What should Pi remember?", "");
    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toBe("Cancelled.");
  });

  it("prompts for an editable new topic when no strong existing match exists", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const input = vi.fn(async () => "roadmap");
    const select = vi.fn();
    const result = await harness.commands
      .get("remember")
      ?.handler("Our long term goal with the pi-memory extension is autonomous memory capture.", {
        cwd: environment.cwd,
        hasUI: true,
        ui: {
          input,
          notify: vi.fn(),
          select,
        },
      });
    const stored = await fs.readFile(
      path.join(environment.roots.topicDirs.project, "roadmap.md"),
      "utf8",
    );

    expect(select).not.toHaveBeenCalled();
    expect(input).toHaveBeenCalledWith("Topic name:", "goals");
    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toContain('under topic "roadmap"');
    expect(stored).toContain(
      "## Our long term goal with the pi-memory extension is autonomous memory capture",
    );
  });

  it("offers real existing topics before creating a new one", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const select = vi.fn(async () => "Use topic: testing");
    const input = vi.fn();
    const result = await harness.commands
      .get("remember")
      ?.handler("Testing notes: reset process state between Vitest runs.", {
        cwd: environment.cwd,
        hasUI: true,
        ui: {
          input,
          notify: vi.fn(),
          select,
        },
      });

    expect(select).toHaveBeenCalledWith("Where should Pi file this memory?", [
      "Use topic: testing",
      "New topic...",
      "Cancel",
    ]);
    expect(input).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toContain('under topic "testing"');
  });

  it("returns to the topic picker when new topic naming is cancelled", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const select = vi
      .fn<ExtensionUiSelect>()
      .mockResolvedValueOnce("New topic...")
      .mockResolvedValueOnce("Use topic: testing");
    const input = vi.fn(async () => undefined);
    const result = await harness.commands
      .get("remember")
      ?.handler("Testing notes: reset process state between Vitest runs.", {
        cwd: environment.cwd,
        hasUI: true,
        ui: {
          input,
          notify: vi.fn(),
          select,
        },
      });

    expect(select).toHaveBeenCalledTimes(2);
    expect(input).toHaveBeenCalledWith("Topic name:", "test note reset");
    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toContain('under topic "testing"');
  });

  it("keeps a plain usage message for non-interactive empty /remember", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const result = await harness.commands.get("remember")?.handler("", {
      cwd: environment.cwd,
      hasUI: false,
    });

    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toBe("Usage: /remember <text>");
  });

  it("keeps a plain usage message for non-interactive empty /forget", async () => {
    const environment = await createRuntimeFixtureEnvironment();
    tempDirs.push(environment.tempDir);
    process.env.PI_CODING_AGENT_DIR = environment.roots.agentDir;

    const harness = registerExtension();
    await callHandler(harness, "session_start", {}, { cwd: environment.cwd, hasUI: false });

    const result = await harness.commands.get("forget")?.handler("", {
      cwd: environment.cwd,
      hasUI: false,
    });

    expect(result).toBeUndefined();
    expect(getLastCommandOutput(harness)).toBe("Usage: /forget <query>");
  });
});

function registerExtension(): {
  commands: Map<
    string,
    { description: string; handler: (args: string, ctx: unknown) => Promise<unknown> | unknown }
  >;
  handlers: Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown> | unknown>>;
  messageRenderers: Map<string, unknown>;
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
  const messageRenderers = new Map<string, unknown>();
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
    registerMessageRenderer: vi.fn((customType: string, renderer: unknown) => {
      messageRenderers.set(customType, renderer);
    }),
    sendMessage: vi.fn((message: TestCommandMessage) => {
      messages.push(message);
    }),
  } as unknown as Parameters<typeof memoryExtension>[0]);

  return { commands, handlers, messageRenderers, messages, tools };
}

type ExtensionUiSelect = (title: string, options: string[]) => Promise<string | undefined>;

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

function countOccurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}
