import { readFile } from "node:fs/promises";

import { parseModel } from "./classifier.js";
import { DEFAULT_THRESHOLDS, TUNED_THRESHOLDS } from "./route.js";
import type { Thresholds } from "./route.js";

export const MODES = ["on", "shadow", "off"] as const;
export type Mode = (typeof MODES)[number];

export interface AutoModeConfig {
  mode: Mode;
  /** A classifier model in Pi's catalog, as `provider/id`; Pi supplies its credentials. */
  model: string;
  timeoutMs: number;
  environment: string[];
  thresholds: Thresholds;
}

export const DEFAULT_CONFIG: AutoModeConfig = {
  mode: "on",
  model: "typesafe/jev-latest",
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
  const config: AutoModeConfig = { ...DEFAULT_CONFIG };

  if (value.mode !== undefined) {
    if (MODES.includes(value.mode as Mode)) config.mode = value.mode as Mode;
    else errors.push(`mode must be one of ${MODES.join(", ")}`);
  }
  if (value.model !== undefined) {
    if (typeof value.model === "string" && parseModel(value.model)) config.model = value.model;
    else errors.push(`model must be provider/id, such as ${DEFAULT_CONFIG.model}`);
  }
  if (value.apiKey !== undefined) {
    errors.push(
      "apiKey is no longer read: give Pi the provider's key instead (for TypeSafe, TYPESAFE_API_KEY or a typesafe entry in ~/.pi/agent/auth.json)",
    );
  }
  if (value.url !== undefined) {
    errors.push("url is no longer read: choose a classifier with model");
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
  const thresholds: Partial<Thresholds> = { ...TUNED_THRESHOLDS[config.model] };
  if (value.thresholds !== undefined) {
    if (!isRecord(value.thresholds)) errors.push("thresholds must be an object");
    else {
      for (const [key, threshold] of Object.entries(value.thresholds)) {
        if (!(key in DEFAULT_THRESHOLDS)) errors.push(`unknown threshold '${key}'`);
        else if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
          errors.push(`threshold '${key}' must be a number from 0 to 1`);
        } else thresholds[key as keyof Thresholds] = threshold;
      }
    }
  }
  if (isComplete(thresholds)) config.thresholds = thresholds;
  else {
    errors.push(
      `${config.model} has no tuned thresholds: set safe, intent, and hard under thresholds, or use ${Object.keys(TUNED_THRESHOLDS).join(", ")}`,
    );
  }
  if (errors.length > 0) return off(errors.map((e) => `${source}: ${e}`));
  return { config, errors };
}

function off(errors: string[]): LoadedConfig {
  return { config: { ...DEFAULT_CONFIG, mode: "off" }, errors };
}

function isComplete(thresholds: Partial<Thresholds>): thresholds is Thresholds {
  return Object.keys(DEFAULT_THRESHOLDS).every((key) => key in thresholds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
