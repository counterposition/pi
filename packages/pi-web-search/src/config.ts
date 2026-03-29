import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ApiKeyEnvName,
  FetchProviderName,
  LoadedConfig,
  ResolvedSearchProviders,
  SearchCapability,
  SearchDepth,
  SearchFreshness,
  SearchProvider,
  SearchProviderName,
  WebSearchSettings,
} from "./types.js";

const SEARCH_KEY_BY_PROVIDER: Record<SearchProviderName, ApiKeyEnvName> = {
  brave: "BRAVE_API_KEY",
  tavily: "TAVILY_API_KEY",
  exa: "EXA_API_KEY",
};

const API_KEY_NAMES = [
  "BRAVE_API_KEY",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "JINA_API_KEY",
] satisfies ApiKeyEnvName[];

export function loadConfig(): LoadedConfig {
  const globalSettings = readSettingsFile(getGlobalSettingsPath());
  const projectSettingsPath = getProjectSettingsPath();
  const projectSettings = readSettingsFile(projectSettingsPath);
  const warnings: string[] = [];

  if (hasApiKeys(projectSettings.webSearch?.apiKeys)) {
    warnings.push(
      `Ignoring webSearch.apiKeys in project settings at ${projectSettingsPath}. Store credentials only in the global Pi settings file or environment variables.`,
    );
  }

  const apiKeys = Object.fromEntries(
    API_KEY_NAMES.map((name) => [
      name,
      readNonEmptyEnv(name) ?? readGlobalApiKey(globalSettings, name),
    ]),
  ) as LoadedConfig["apiKeys"];

  const settings = mergeSettings(globalSettings.webSearch, projectSettings.webSearch);

  return {
    apiKeys,
    settings,
    warnings,
  };
}

export function getGlobalSettingsPath(): string {
  const root = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  return path.join(root, "settings.json");
}

export function getProjectSettingsPath(cwd = process.cwd()): string {
  return path.join(cwd, ".pi", "settings.json");
}

export function normalizeDomains(domains: string[] | undefined): string[] | undefined {
  if (!domains || domains.length === 0) return undefined;

  const normalized = new Set<string>();

  for (const value of domains) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(":")) {
      throw new Error(`Invalid domain filter "${value}". Use bare hostnames only.`);
    }
    if (!/^[a-z0-9.-]+$/.test(trimmed) || trimmed.startsWith(".") || trimmed.endsWith(".")) {
      throw new Error(`Invalid domain filter "${value}". Use bare hostnames only.`);
    }
    normalized.add(trimmed);
  }

  return normalized.size > 0 ? [...normalized] : undefined;
}

export function rankingFor(
  depth: SearchDepth,
  args: { freshness?: SearchFreshness; domains?: string[] },
): SearchProviderName[] {
  if (depth === "thorough") return ["tavily", "exa", "brave"];
  if (args.domains?.length) return ["tavily", "exa", "brave"];
  if (args.freshness) return ["brave", "tavily", "exa"];
  return ["brave", "tavily", "exa"];
}

export function requiredCapabilities(depth: SearchDepth): ReadonlySet<SearchCapability> {
  return depth === "thorough" ? new Set(["search", "content"]) : new Set(["search"]);
}

export function canServe(provider: SearchProvider, depth: SearchDepth): boolean {
  const required = requiredCapabilities(depth);
  for (const capability of required) {
    if (!provider.capabilities.has(capability)) return false;
  }
  return true;
}

export function hasKey(
  config: LoadedConfig,
  providerName: SearchProviderName | FetchProviderName,
): boolean {
  if (providerName === "jina") return true;

  return Boolean(config.apiKeys[SEARCH_KEY_BY_PROVIDER[providerName as SearchProviderName]]);
}

export function resolveSearchProviders(
  args: {
    depth: SearchDepth;
    freshness?: SearchFreshness;
    domains?: string[];
  },
  searchProviders: Partial<Record<SearchProviderName, SearchProvider>>,
  config: LoadedConfig,
): ResolvedSearchProviders {
  const preferred =
    args.depth === "basic"
      ? config.settings.preferredBasicProvider
      : config.settings.preferredThoroughProvider;

  const providersInOrder: SearchProvider[] = [];
  const notes: string[] = [...config.warnings];
  const ranking = rankingFor(args.depth, args);

  if (preferred) {
    const candidate = searchProviders[preferred];
    if (candidate && hasKey(config, candidate.name) && canServe(candidate, args.depth)) {
      providersInOrder.push(candidate);
    }
  }

  for (const name of ranking) {
    const candidate = searchProviders[name];
    if (
      candidate &&
      hasKey(config, candidate.name) &&
      canServe(candidate, args.depth) &&
      !providersInOrder.includes(candidate)
    ) {
      providersInOrder.push(candidate);
    }
  }

  if (providersInOrder.length > 0) {
    return { providers: providersInOrder, servedDepth: args.depth, notes };
  }

  if (args.depth === "thorough") {
    const degradedProviders: SearchProvider[] = [];
    for (const name of rankingFor("basic", args)) {
      const candidate = searchProviders[name];
      if (
        candidate &&
        hasKey(config, candidate.name) &&
        canServe(candidate, "basic") &&
        !degradedProviders.includes(candidate)
      ) {
        degradedProviders.push(candidate);
      }
    }

    if (degradedProviders.length > 0) {
      notes.push(
        "Requested thorough search degraded to basic because no content-capable search provider is configured.",
      );

      return {
        providers: degradedProviders,
        servedDepth: "basic",
        notes,
      };
    }
  }

  return {
    providers: [],
    servedDepth: args.depth,
    notes,
  };
}

function readSettingsFile(filePath: string): {
  webSearch?: {
    apiKeys?: Partial<Record<ApiKeyEnvName, string>>;
  } & WebSearchSettings;
} {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return {};
    return parsed as {
      webSearch?: {
        apiKeys?: Partial<Record<ApiKeyEnvName, string>>;
      } & WebSearchSettings;
    };
  } catch {
    return {};
  }
}

function readGlobalApiKey(
  settings: ReturnType<typeof readSettingsFile>,
  name: ApiKeyEnvName,
): string | undefined {
  const value = settings.webSearch?.apiKeys?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mergeSettings(
  globalSettings: ({ apiKeys?: unknown } & WebSearchSettings) | undefined,
  projectSettings: ({ apiKeys?: unknown } & WebSearchSettings) | undefined,
): WebSearchSettings {
  return {
    preferredBasicProvider:
      projectSettings?.preferredBasicProvider ?? globalSettings?.preferredBasicProvider ?? null,
    preferredThoroughProvider:
      projectSettings?.preferredThoroughProvider ??
      globalSettings?.preferredThoroughProvider ??
      null,
  };
}

function hasApiKeys(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).some((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function readNonEmptyEnv(name: ApiKeyEnvName): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
