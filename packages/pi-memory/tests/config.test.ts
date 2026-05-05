import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, resolveAgentDir } from "../src/config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("config", () => {
  it("uses PI_CODING_AGENT_DIR and ignores project memory settings", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-config-"));
    tempDirs.push(tempDir);

    const agentDir = path.join(tempDir, "agent");
    const cwd = path.join(tempDir, "workspace");
    await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ memory: { enabled: false } }),
      "utf8",
    );
    await fs.writeFile(
      path.join(cwd, ".pi", "settings.json"),
      JSON.stringify({ memory: { enabled: true } }),
      "utf8",
    );

    const config = loadConfig(cwd, { PI_CODING_AGENT_DIR: agentDir }, tempDir);

    expect(config.agentDir).toBe(agentDir);
    expect(config.enabled).toBe(false);
    expect(config.warnings).toEqual([
      `Ignoring project memory settings at ${path.join(cwd, ".pi", "settings.json")}. Memory settings are user-level only in v1.`,
    ]);
  });

  it("defaults to the standard Pi agent dir and enabled memory", () => {
    expect(resolveAgentDir({}, "/home/tester")).toBe("/home/tester/.pi/agent");

    const config = loadConfig("/workspace", {}, "/home/tester");
    expect(config.agentDir).toBe("/home/tester/.pi/agent");
    expect(config.enabled).toBe(true);
    expect(config.warnings).toEqual([]);
  });
});
