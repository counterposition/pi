import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config.js";
import { DEFAULT_THRESHOLDS } from "../src/route.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-mode-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
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
    [{ model: "jev-1.13.0" }, "model must be provider/id"],
    [{ apiKey: "$TYPESAFE_API_KEY" }, "apiKey is no longer read"],
    [{ url: "https://api.typesafe.ai/v1/systemone" }, "url is no longer read"],
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

describe("model thresholds", () => {
  it("uses the tuned thresholds of a tuned model, with overrides on top", () => {
    const { config, errors } = parseConfig(
      { model: "openrouter/typesafe/jev-1.13", thresholds: { safe: 0.2 } },
      "cfg",
    );
    expect(errors).toEqual([]);
    expect(config.thresholds).toEqual({ ...DEFAULT_THRESHOLDS, safe: 0.2 });
  });

  it("turns auto mode off for an untuned model without all three thresholds", () => {
    const partial = parseConfig(
      { model: "openrouter/upstage/solar-decide", thresholds: { safe: 0.2 } },
      "cfg",
    );
    expect(partial.config.mode).toBe("off");
    expect(partial.errors.join()).toContain("has no tuned thresholds");

    const thresholds = { safe: 0.2, intent: 0.6, hard: 0.4 };
    const full = parseConfig({ model: "openrouter/upstage/solar-decide", thresholds }, "cfg");
    expect(full.errors).toEqual([]);
    expect(full.config.thresholds).toEqual(thresholds);
  });
});
