import fs from "node:fs/promises";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { JsonObject, ToolResultMessage } from "@earendil-works/pi-ai";
import * as pi from "@earendil-works/pi-coding-agent";
import type { ExtensionFactory, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import memoryExtension from "../extensions/memory.js";
import { cleanupTempDir, createRuntimeFixtureEnvironment } from "./helpers.js";

const BLOCK_REASON =
  "Direct write/edit calls into the managed memory store are blocked. Use memory_write instead.";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempDirs: string[] = [];

afterEach(async () => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }

  await Promise.all(tempDirs.splice(0).map((directory) => cleanupTempDir(directory)));
});

describe("memory tools from codemode", () => {
  it("resolves memory_search to the same structured results as a direct call", async () => {
    const run = await runTurn([
      { name: "memory_search", args: { query: "flaky vitest" } },
      {
        name: "codemode",
        args: {
          code: `
            const found = await tools.memory_search({ query: "flaky vitest" });
            return { type: typeof found, found };
          `,
        },
      },
    ]);

    const direct = run.events.find((event) => event.toolName === "memory_search");
    expect(direct?.structuredContent).toMatchObject({
      results: [{ id: "mem_01JW30BK6K3R6N3Y0F2A1M8Q9E", scope: "project" }],
    });
    expect(run.scriptOutput).toEqual({ type: "object", found: direct?.structuredContent });
  });

  it("blocks nested write and edit calls into the managed store like direct calls", async () => {
    const environment = await createEnvironment();
    const managedFile = path.join(environment.roots.topicDirs.project, "testing.md");
    const before = await fs.readFile(managedFile, "utf8");

    const run = await runTurn(
      [
        { name: "write", args: { path: managedFile, content: "direct" } },
        {
          name: "codemode",
          args: {
            code: `
              const attempts = [
                tools.write({ path: ${JSON.stringify(managedFile)}, content: "nested" }),
                tools.edit({
                  path: ${JSON.stringify(managedFile)},
                  edits: [{ oldText: "# Testing", newText: "# Nested" }],
                }),
              ];
              const settled = await Promise.allSettled(attempts);
              return settled.map((outcome) => outcome.status === "rejected" ? outcome.reason.message : "written");
            `,
          },
        },
      ],
      environment,
    );

    const direct = run.messages.find((message) => message.toolName === "write");
    expect(direct?.isError).toBe(true);
    expect(textOf(direct?.content)).toContain(BLOCK_REASON);
    expect(run.scriptOutput).toEqual([
      expect.stringContaining(BLOCK_REASON),
      expect.stringContaining(BLOCK_REASON),
    ]);
    expect(await fs.readFile(managedFile, "utf8")).toBe(before);
  });

  it("persists concurrent memory_write calls from one script", async () => {
    const environment = await createEnvironment();

    const run = await runTurn(
      [
        {
          name: "codemode",
          args: {
            code: `
              return await Promise.all([
                tools.memory_write({ topic: "testing", content: "## Parallel note one\\n\\nFirst." }),
                tools.memory_write({ topic: "testing", content: "## Parallel note two\\n\\nSecond." }),
              ]);
            `,
          },
        },
      ],
      environment,
    );

    const written = run.scriptOutput as Array<{ entryId: string; filePath: string }>;
    const stored = await fs.readFile(
      path.join(environment.roots.topicDirs.project, "testing.md"),
      "utf8",
    );

    expect(written).toHaveLength(2);
    expect(written[0].entryId).not.toBe(written[1].entryId);
    expect(written[0].filePath).toBe(written[1].filePath);
    expect(path.basename(written[0].filePath)).toBe("testing.md");
    for (const result of written) {
      expect(stored).toContain(result.entryId);
    }
    expect(stored).toContain("## Parallel note one");
    expect(stored).toContain("## Parallel note two");
    expect(stored).toContain("## Flaky test workaround, refreshed");
  });
});

type Environment = Awaited<ReturnType<typeof createRuntimeFixtureEnvironment>>;

async function createEnvironment(): Promise<Environment> {
  const environment = await createRuntimeFixtureEnvironment();
  tempDirs.push(environment.tempDir);
  return environment;
}

/** One assistant turn that issues `calls`, run in an SDK session with the codemode extension. */
async function runTurn(
  calls: { name: string; args: JsonObject }[],
  environment?: Environment,
): Promise<{ events: ToolResultEvent[]; messages: ToolResultMessage[]; scriptOutput: unknown }> {
  const { cwd, roots } = environment ?? (await createEnvironment());
  process.env.PI_CODING_AGENT_DIR = roots.agentDir;

  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  faux.setResponses([
    fauxAssistantMessage(
      calls.map((call) => fauxToolCall(call.name, call.args)),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const events: ToolResultEvent[] = [];
  const extensionFactories: ExtensionFactory[] = [
    pi.createCodemodeExtension(),
    memoryExtension,
    (api) => {
      api.registerProvider(faux.provider);
      api.on("tool_result", (event) => {
        if (!event.parentToolCallId) events.push(event);
      });
    },
  ];
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir: roots.agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories,
  });
  await resourceLoader.reload();
  const { session } = await pi.createAgentSession({
    cwd,
    agentDir: roots.agentDir,
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(),
    settingsManager: pi.SettingsManager.inMemory(),
    tools: ["codemode", "memory_search", "memory_write", "memory_move", "write", "edit"],
  });

  let messages: ToolResultMessage[];
  try {
    await session.bindExtensions({});
    await session.setModel(faux.getModel());
    await session.prompt("go");
    messages = session.messages.filter(
      (message): message is ToolResultMessage => message.role === "toolResult",
    );
  } finally {
    session.dispose();
  }

  const script = messages.find((message) => message.toolName === "codemode");
  expect(script?.isError).toBe(false);
  const output = script?.content.at(-1);
  return {
    events,
    messages,
    scriptOutput: output?.type === "text" ? JSON.parse(output.text) : undefined,
  };
}

function textOf(content: ToolResultMessage["content"] | undefined): string {
  return (content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}
