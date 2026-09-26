import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, loadConfig, parseConfig, resolveApiKey } from "../src/config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-mode-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.AUTO_MODE_TEST_KEY;
});

describe("loadConfig", () => {
  it("uses the defaults when there is no file", async () => {
    expect(await loadConfig(join(dir, "missing.json"))).toEqual({
      config: DEFAULT_CONFIG,
      errors: [],
    });
  });

  it("merges a valid file over the defaults", async () => {
    const path = join(dir, "auto-mode.json");
    await writeFile(
      path,
      JSON.stringify({
        mode: "shadow",
        environment: ["Staging is safe"],
        thresholds: { safe: 0.2 },
      }),
    );
    const { config, errors } = await loadConfig(path);
    expect(errors).toEqual([]);
    expect(config.mode).toBe("shadow");
    expect(config.environment).toEqual(["Staging is safe"]);
    expect(config.thresholds).toEqual({ ...DEFAULT_CONFIG.thresholds, safe: 0.2 });
  });

  it("turns auto mode off when the file is not JSON", async () => {
    const path = join(dir, "auto-mode.json");
    await writeFile(path, "{ mode: on");
    const { config, errors } = await loadConfig(path);
    expect(config.mode).toBe("off");
    expect(errors[0]).toContain("not valid JSON");
  });
});

describe("parseConfig", () => {
  it.each([
    [{ mode: "yolo" }, "mode"],
    [{ timeoutMs: -1 }, "timeoutMs"],
    [{ environment: "trusted" }, "environment"],
    [{ thresholds: { safe: 2 } }, "threshold 'safe'"],
    [{ thresholds: { unsafe: 0.2 } }, "unknown threshold"],
    [{ apiKey: "" }, "apiKey"],
  ])("turns auto mode off for an invalid field: %j", (value, message) => {
    const { config, errors } = parseConfig(value, "cfg");
    expect(config.mode).toBe("off");
    expect(errors.join()).toContain(message);
  });

  it("does not let a partial threshold override leak into the defaults", () => {
    parseConfig({ thresholds: { hard: 0.1 } }, "cfg");
    expect(DEFAULT_CONFIG.thresholds.hard).not.toBe(0.1);
  });
});

describe("resolveApiKey", () => {
  it("resolves literals, environment variables, and commands", async () => {
    process.env.AUTO_MODE_TEST_KEY = "from-env";
    expect(await resolveApiKey("literal-key")).toBe("literal-key");
    expect(await resolveApiKey("$AUTO_MODE_TEST_KEY")).toBe("from-env");
    expect(await resolveApiKey("!printf ' from-cmd\\n'")).toBe("from-cmd");
  });

  it("resolves to undefined when the key cannot be found", async () => {
    expect(await resolveApiKey("$AUTO_MODE_MISSING_KEY")).toBeUndefined();
    expect(await resolveApiKey("!exit 1")).toBeUndefined();
  });

  it("runs a key command once per process", async () => {
    const counter = join(dir, "count");
    const spec = `!echo x >> ${counter}; echo key`;
    await resolveApiKey(spec);
    await resolveApiKey(spec);
    expect((await readFile(counter, "utf8")).trim().split("\n")).toHaveLength(1);
  });
});
