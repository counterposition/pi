import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import structuredTool from "../skills/pi/examples/structured-tool.js";

let dir: string;

beforeEach(async () => {
  process.env.PI_OFFLINE = "1";
  dir = await mkdtemp(join(tmpdir(), "skill-pi-examples-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("structured-tool example", () => {
  it("hands structuredContent to codemode scripts", async () => {
    await writeFile(join(dir, "a.txt"), "hello");
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    const script = [
      'const stats = await tools.file_stats({ paths: ["a.txt", "gone.txt"] });',
      "return { kind: typeof stats, bytes: stats.files[0].bytes, missing: stats.missing };",
    ].join("\n");
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("codemode", { code: script }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);

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
        (pi) => pi.registerProvider(faux.provider),
        createCodemodeExtension(),
        structuredTool,
      ],
    });
    await resourceLoader.reload();
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
    });
    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      modelRuntime,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(),
    });

    try {
      await session.bindExtensions({});
      const model = modelRuntime.getModel("faux", "faux-1");
      if (!model) throw new Error("faux model not registered");
      await session.setModel(model);
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
    } finally {
      session.dispose();
    }
  });
});
