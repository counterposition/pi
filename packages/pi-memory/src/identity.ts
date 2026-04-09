import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ProjectIdentity } from "./types.js";

export interface GitCommandResult {
  ok: boolean;
  stdout: string;
  error?: Error;
  timedOut?: boolean;
}

export type GitCommandRunner = (cwd: string, args: string[], timeoutMs: number) => GitCommandResult;

const DEFAULT_GIT_TIMEOUT_MS = 1_500;

export function resolveProjectIdentity(
  cwd = process.cwd(),
  options: {
    execGit?: GitCommandRunner;
    platform?: NodeJS.Platform;
    realpath?: (filePath: string) => string;
    timeoutMs?: number;
  } = {},
): ProjectIdentity {
  const platform = options.platform ?? process.platform;
  const realpath = options.realpath ?? safeRealpath;
  const realCwd = realpath(cwd);
  const commonDir = resolveGitCommonDir(realCwd, {
    execGit: options.execGit ?? runGitCommand,
    realpath,
    timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
  });

  const anchorPath = commonDir ?? realCwd;
  const mode = commonDir ? "git" : "directory";
  const displayName = commonDir
    ? path.basename(path.dirname(commonDir))
    : path.basename(anchorPath);
  const normalizedAnchor = normalizeAnchorPath(anchorPath, platform);
  const slug = slugifyReadable(displayName || "project", "project");
  const hash = createHash("sha256").update(normalizedAnchor).digest("hex").slice(0, 20);

  return {
    anchorPath,
    normalizedAnchor,
    projectId: `${slug}-${hash}`,
    slug,
    displayName: displayName || "project",
    mode,
  };
}

export function normalizeAnchorPath(anchorPath: string, platform = process.platform): string {
  const normalized = anchorPath.normalize("NFC").replace(/\\/g, "/");
  const maybeLowercase = platform === "win32" ? normalized.toLowerCase() : normalized;
  if (isFilesystemRoot(maybeLowercase)) return maybeLowercase;
  return maybeLowercase.replace(/\/+$/u, "");
}

export function slugifyReadable(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug || fallback;
}

function resolveGitCommonDir(
  cwd: string,
  options: {
    execGit: GitCommandRunner;
    realpath: (filePath: string) => string;
    timeoutMs: number;
  },
): string | null {
  const result = options.execGit(
    cwd,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    options.timeoutMs,
  );
  if (!result.ok) return null;

  const trimmed = result.stdout.trim();
  if (!trimmed) return null;
  const absolute = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  return options.realpath(absolute);
}

function runGitCommand(cwd: string, args: string[], timeoutMs: number): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      stdout: "",
      error: toError(result.error),
      timedOut: result.error.message.includes("ETIMEDOUT"),
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      stdout: result.stdout ?? "",
      error: new Error((result.stderr ?? "").trim() || `git exited with status ${result.status}`),
      timedOut: false,
    };
  }

  return {
    ok: true,
    stdout: result.stdout ?? "",
  };
}

function safeRealpath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isFilesystemRoot(value: string): boolean {
  return value === "/" || /^[a-z]:\/$/iu.test(value);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
