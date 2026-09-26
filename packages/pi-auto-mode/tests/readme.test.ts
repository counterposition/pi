import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");

describe("README", () => {
  it("shows only JSON that parses, so copying an example cannot turn auto mode off", () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(() => JSON.parse(block) as unknown).not.toThrow();
  });

  it("documents a config the loader accepts", () => {
    const config = blocks
      .map((b) => JSON.parse(b) as Record<string, unknown>)
      .find((b) => "apiKey" in b);
    expect(parseConfig(config, "README").errors).toEqual([]);
  });
});
