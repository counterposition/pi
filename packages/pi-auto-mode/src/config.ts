import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { JEV_URL } from "./jev.js";
import { DEFAULT_THRESHOLDS } from "./route.js";
import type { Thresholds } from "./route.js";

const execFileAsync = promisify(execFile);

export const MODES = ["on", "shadow", "off"] as const;
export type Mode = (typeof MODES)[number];

export interface AutoModeConfig {
  mode: Mode;
  model: string;
  /** TypeSafe's endpoint; override only for a proxy or a local fake in tests. */
  url: string;
  apiKey: string;
  timeoutMs: number;
  environment: string[];
  thresholds: Thresholds;
}

export const DEFAULT_CONFIG: AutoModeConfig = {
  mode: "on",
  model: "jev-1.13.0",
  url: JEV_URL,
  apiKey: "$TYPESAFE_API_KEY",
  timeoutMs: 2000,
  environment: [],
  thresholds: DEFAULT_THRESHOLDS,
};

export interface LoadedConfig {
  config: AutoModeConfig;
  /** Problems found; any problem turns auto mode off so every ask reaches a human. */
  errors: string[];
}

export async function loadConfig(path: string): Promise<LoadedConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { config: DEFAULT_CONFIG, errors: [] };
    return off([`cannot read ${path}: ${err.message}`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return off([`${path} is not valid JSON`]);
  }
  return parseConfig(parsed, path);
}

export function parseConfig(value: unknown, source: string): LoadedConfig {
  if (!isRecord(value)) return off([`${source} must be a JSON object`]);
  const errors: string[] = [];
  const config: AutoModeConfig = { ...DEFAULT_CONFIG, thresholds: { ...DEFAULT_THRESHOLDS } };

  if (value.mode !== undefined) {
    if (MODES.includes(value.mode as Mode)) config.mode = value.mode as Mode;
    else errors.push(`mode must be one of ${MODES.join(", ")}`);
  }
  if (value.model !== undefined) {
    if (typeof value.model === "string" && value.model) config.model = value.model;
    else errors.push("model must be a non-empty string");
  }
  if (value.url !== undefined) {
    if (typeof value.url === "string" && /^https?:\/\//.test(value.url)) config.url = value.url;
    else errors.push("url must be an http(s) URL");
  }
  if (value.apiKey !== undefined) {
    if (typeof value.apiKey === "string" && value.apiKey) config.apiKey = value.apiKey;
    else errors.push("apiKey must be a non-empty string");
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs === "number" && value.timeoutMs > 0)
      config.timeoutMs = value.timeoutMs;
    else errors.push("timeoutMs must be a positive number");
  }
  if (value.environment !== undefined) {
    if (Array.isArray(value.environment) && value.environment.every((e) => typeof e === "string")) {
      config.environment = value.environment;
    } else errors.push("environment must be an array of strings");
  }
  if (value.thresholds !== undefined) {
    if (!isRecord(value.thresholds)) errors.push("thresholds must be an object");
    else {
      for (const [key, threshold] of Object.entries(value.thresholds)) {
        if (!(key in DEFAULT_THRESHOLDS)) errors.push(`unknown threshold '${key}'`);
        else if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
          errors.push(`threshold '${key}' must be a number from 0 to 1`);
        } else config.thresholds[key as keyof Thresholds] = threshold;
      }
    }
  }
  if (errors.length > 0) return off(errors.map((e) => `${source}: ${e}`));
  return { config, errors };
}

const resolvedKeys = new Map<string, Promise<string | undefined>>();

/**
 * Resolves `!command` (run once per process), `$ENV_VAR`, or a literal key.
 * Resolves to undefined when the key cannot be found.
 */
export function resolveApiKey(spec: string): Promise<string | undefined> {
  let resolved = resolvedKeys.get(spec);
  if (!resolved) {
    resolved = resolveUncached(spec);
    resolvedKeys.set(spec, resolved);
    // A missing key is looked up again next time, so adding one works without a restart.
    void resolved.then((key) => {
      if (!key) resolvedKeys.delete(spec);
    });
  }
  return resolved;
}

async function resolveUncached(spec: string): Promise<string | undefined> {
  if (spec.startsWith("!")) {
    try {
      const { stdout } = await execFileAsync("/bin/sh", ["-c", spec.slice(1)], { timeout: 10_000 });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  if (spec.startsWith("$")) {
    const value = process.env[spec.slice(1)];
    if (value) return value;
    // By default, macOS users can keep the key in the Keychain instead.
    if (spec === DEFAULT_CONFIG.apiKey && process.platform === "darwin") {
      return resolveUncached("!security find-generic-password -s TYPESAFE_API_KEY -w");
    }
    return undefined;
  }
  return spec;
}

function off(errors: string[]): LoadedConfig {
  return { config: { ...DEFAULT_CONFIG, mode: "off" }, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
