import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-ai";
import * as pi from "@earendil-works/pi-coding-agent";
import type { ExtensionFactory, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InitializedProviders } from "../src/types.js";

const providers = vi.hoisted(
  (): InitializedProviders => ({
    search: {
      parallel: {
        name: "parallel",
        capabilities: new Set(["search"]),
        search: async () => ({
          results: [{ title: "Docs", url: "https://example.com/docs", snippet: "Result snippet" }],
        }),
      },
    },
    fetch: {
      jina: { name: "jina", fetch: async () => "# Page\n\nBody text." },
    },
  }),
);

vi.mock("../src/providers/index.js", () => ({
  initProviders: () => providers,
}));

import webSearchExtension from "../extensions/web-search.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir: string;

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "pi-web-search-codemode-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  vi.stubGlobal("fetch", async () => {
    throw new Error("Tests must not touch the network.");
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  await rm(agentDir, { recursive: true, force: true });
});

describe.skipIf(!("createCodemodeExtension" in pi))("web tools from codemode", () => {
  it("resolves to the same structured results as direct calls and rejects failures", async () => {
    const search = { query: "docs" };
    const page = { url: "https://example.com/page" };
    const { events, scriptOutput } = await runTurn([
      { name: "web_search", args: search },
      { name: "web_fetch", args: page },
      {
        name: "codemode",
        args: {
          code: `
            const [search, page, blocked] = await Promise.allSettled([
              tools.web_search(${JSON.stringify(search)}),
              tools.web_fetch(${JSON.stringify(page)}),
              tools.web_fetch({ url: "http://127.0.0.1/admin" }),
            ]);
            return {
              types: [typeof search.value, typeof page.value],
              search: search.value,
              page: page.value,
              blocked: blocked.status === "rejected" ? blocked.reason.message : "fulfilled",
            };
          `,
        },
      },
    ]);

    const direct = (name: string) => events.find((event) => event.toolName === name);
    expect(direct("web_search")?.structuredContent).toMatchObject({
      provider: "parallel",
      results: [{ url: "https://example.com/docs" }],
    });
    expect(direct("web_fetch")?.structuredContent).toMatchObject({
      content: "# Page\n\nBody text.",
      hasMore: false,
    });
    expect(scriptOutput).toEqual({
      types: ["object", "object"],
      search: direct("web_search")?.structuredContent,
      page: direct("web_fetch")?.structuredContent,
      blocked: "Blocked URL: target host is not allowed.",
    });
  });
});

/** One assistant turn that issues `calls`, run in an SDK session with the codemode extension. */
async function runTurn(
  calls: { name: string; args: JsonObject }[],
): Promise<{ events: ToolResultEvent[]; scriptOutput: unknown }> {
  const cwd = process.cwd();
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
    webSearchExtension,
    (api) => {
      api.registerProvider(faux.provider);
      api.on("tool_result", (event) => {
        if (!event.parentToolCallId) events.push(event);
      });
    },
  ];
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
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
    agentDir,
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(),
    settingsManager: pi.SettingsManager.inMemory(),
    tools: ["codemode", "web_search", "web_fetch"],
  });

  try {
    await session.bindExtensions({});
    await session.setModel(faux.getModel());
    await session.prompt("go");
  } finally {
    session.dispose();
  }

  const script = events.find((event) => event.toolName === "codemode");
  expect(script?.isError).toBe(false);
  const output = script?.content.at(-1);
  return {
    events,
    scriptOutput: output?.type === "text" ? JSON.parse(output.text) : undefined,
  };
}
