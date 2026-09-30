import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import structuredTool from "../skills/pi/examples/structured-tool.js";

const originalOffline = process.env.PI_OFFLINE;
let dir: string;

beforeEach(async () => {
  process.env.PI_OFFLINE = "1";
  dir = await mkdtemp(join(tmpdir(), "skill-pi-examples-"));
});

afterEach(async () => {
  if (originalOffline === undefined) {
    delete process.env.PI_OFFLINE;
  } else {
    process.env.PI_OFFLINE = originalOffline;
  }
  await rm(dir, { recursive: true, force: true });
});

describe("structured-tool example", () => {
  it("hands structuredContent to codemode scripts, also for error results", async () => {
    await writeFile(join(dir, "a.txt"), "hello");
    const script = [
      'const stats = await tools.file_stats({ paths: ["a.txt", "gone.txt"] });',
      'const none = await tools.file_stats({ paths: ["gone.txt"] });',
      "return { kind: typeof stats, bytes: stats.files[0].bytes, missing: stats.missing, none };",
    ].join("\n");
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("codemode", { code: script }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const nestedErrors: boolean[] = [];

    const settingsManager = SettingsManager.inMemory({ defaultTools: ["+codemode"] });
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        (pi) => {
          pi.registerProvider(faux.provider);
          pi.on("tool_result", (event) => {
            if (event.toolName === "file_stats") nestedErrors.push(event.isError);
          });
        },
        createCodemodeExtension(),
        structuredTool,
      ],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(),
    });

    try {
      await session.bindExtensions({});
      await session.setModel(faux.getModel());
      expect(session.getActiveToolNames()).toEqual(
        expect.arrayContaining(["codemode", "file_stats"]),
      );

      await session.prompt("stats");

      const result = session.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "codemode",
      );
      const text =
        result?.role === "toolResult"
          ? result.content.map((block) => (block.type === "text" ? block.text : "")).join("")
          : "";
      expect(text).toContain("Script completed");
      expect(text).toContain('"kind":"object"');
      expect(text).toContain('"bytes":5');
      expect(text).toContain('"missing":["gone.txt"]');
      expect(text).toContain('"none":{"files":[],"missing":["gone.txt"]}');
      expect(nestedErrors).toEqual([false, true]);
    } finally {
      session.dispose();
    }
  });
});
