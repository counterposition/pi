import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, normalizeDomains, rankingFor, resolveSearchProviders } from "../src/config.js";
import type { LoadedConfig, SearchProvider } from "../src/types.js";

const originalCwd = process.cwd();
const ENV_NAMES = [
  "PI_CODING_AGENT_DIR",
  "BRAVE_API_KEY",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "JINA_API_KEY",
] as const;
const originalEnv = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
) as Record<(typeof ENV_NAMES)[number], string | undefined>;

afterEach(() => {
  process.chdir(originalCwd);
  for (const name of ENV_NAMES) {
    resetEnv(name, originalEnv[name]);
  }
});

describe("normalizeDomains", () => {
  it("normalizes and deduplicates bare hostnames", () => {
    expect(normalizeDomains([" Docs.Python.Org ", "docs.python.org"])).toEqual(["docs.python.org"]);
  });

  it("rejects paths and schemes", () => {
    expect(() => normalizeDomains(["https://example.com/docs"])).toThrow(/bare hostnames only/i);
  });
});

describe("rankingFor", () => {
  it("prefers domain-capable providers for domain-constrained searches", () => {
    expect(rankingFor("basic", { domains: ["react.dev"] }).slice(0, 2)).toEqual(["tavily", "exa"]);
  });
});

describe("resolveSearchProviders", () => {
  it("degrades thorough searches to basic when needed", () => {
    const brave = makeProvider("brave", ["search"]);
    const config = makeConfig({
      BRAVE_API_KEY: "brave-test",
    });

    const resolution = resolveSearchProviders({ depth: "thorough" }, { brave }, config);

    expect(resolution.servedDepth).toBe("basic");
    expect(resolution.providers.map((provider) => provider.name)).toEqual(["brave"]);
    expect(resolution.notes.join(" ")).toMatch(/degraded to basic/i);
  });

  it("ignores an unusable preferred provider", () => {
    const brave = makeProvider("brave", ["search", "freshness"]);
    const exa = makeProvider("exa", ["search", "content", "freshness"]);
    const config = makeConfig(
      {
        BRAVE_API_KEY: "brave-test",
        EXA_API_KEY: "exa-test",
      },
      {
        preferredThoroughProvider: "brave",
      },
    );

    const resolution = resolveSearchProviders(
      { depth: "thorough", freshness: "week" },
      { brave, exa },
      config,
    );

    expect(resolution.providers.map((provider) => provider.name)[0]).toBe("exa");
    expect(resolution.servedDepth).toBe("thorough");
  });
});

describe("loadConfig", () => {
  it("prefers env keys and warns on project-local secrets", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-search-config-"));
    const globalDir = path.join(tempDir, "global");
    const projectDir = path.join(tempDir, "project");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });

    fs.writeFileSync(
      path.join(globalDir, "settings.json"),
      JSON.stringify({
        webSearch: {
          apiKeys: {
            BRAVE_API_KEY: "global-brave",
          },
          preferredBasicProvider: "brave",
        },
      }),
    );
    fs.writeFileSync(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({
        webSearch: {
          apiKeys: {
            EXA_API_KEY: "should-not-be-used",
          },
        },
      }),
    );

    process.env.PI_CODING_AGENT_DIR = globalDir;
    process.env.BRAVE_API_KEY = "env-brave";
    delete process.env.EXA_API_KEY;
    process.chdir(projectDir);

    const config = loadConfig();

    expect(config.apiKeys.BRAVE_API_KEY).toBe("env-brave");
    expect(config.apiKeys.EXA_API_KEY).toBeUndefined();
    expect(config.settings.preferredBasicProvider).toBe("brave");
    expect(config.settings.preferredThoroughProvider).toBeNull();
    expect(config.warnings.join(" ")).toMatch(/ignoring websearch\.apikeys/i);
  });
});

function makeProvider(
  name: SearchProvider["name"],
  capabilities: Iterable<Parameters<Set<string>["add"]>[0]>,
): SearchProvider {
  return {
    name,
    capabilities: new Set(capabilities) as ReadonlySet<
      SearchProvider["capabilities"] extends ReadonlySet<infer T> ? T : never
    >,
    async search() {
      return { results: [] };
    },
  };
}

function makeConfig(
  apiKeys: Partial<LoadedConfig["apiKeys"]>,
  settings?: LoadedConfig["settings"],
): LoadedConfig {
  return {
    apiKeys,
    settings: {
      preferredBasicProvider: null,
      preferredThoroughProvider: null,
      ...settings,
    },
    warnings: [],
  };
}

function resetEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
