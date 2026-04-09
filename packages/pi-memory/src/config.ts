import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { MemoryConfig } from "./types.js";

interface MemorySettingsFile {
  memory?: {
    enabled?: boolean;
  };
}

export function resolveAgentDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  return configured ? configured : path.join(homeDir, ".pi", "agent");
}

export function getGlobalSettingsPath(agentDir: string): string {
  return path.join(agentDir, "settings.json");
}

export function getProjectSettingsPath(cwd = process.cwd()): string {
  return path.join(cwd, ".pi", "settings.json");
}

export function loadConfig(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): MemoryConfig {
  const agentDir = resolveAgentDir(env, homeDir);
  const globalSettingsPath = getGlobalSettingsPath(agentDir);
  const projectSettingsPath = getProjectSettingsPath(cwd);
  const globalSettings = readSettingsFile(globalSettingsPath);
  const projectSettings = readSettingsFile(projectSettingsPath);
  const warnings: string[] = [];

  if ("memory" in projectSettings) {
    warnings.push(
      `Ignoring project memory settings at ${projectSettingsPath}. Memory settings are user-level only in v1.`,
    );
  }

  return {
    agentDir,
    globalSettingsPath,
    projectSettingsPath,
    enabled: globalSettings.memory?.enabled ?? true,
    warnings,
  };
}

function readSettingsFile(filePath: string): MemorySettingsFile {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isPlainObject(parsed) ? (parsed as MemorySettingsFile) : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
