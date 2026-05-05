import { describe, expect, it } from "vitest";

import { normalizeAnchorPath, resolveProjectIdentity } from "../src/identity.js";

describe("identity", () => {
  it("derives the same project identity for sibling worktrees that share a git common dir", () => {
    const execGit = () => ({
      ok: true as const,
      stdout: "/tmp/repo/.git\n",
    });

    const worktreeA = resolveProjectIdentity("/tmp/repo-main", {
      execGit,
      platform: "darwin",
      realpath: (filePath) => filePath,
    });
    const worktreeB = resolveProjectIdentity("/tmp/repo-feature", {
      execGit,
      platform: "darwin",
      realpath: (filePath) => filePath,
    });

    expect(worktreeA.mode).toBe("git");
    expect(worktreeA.projectId).toBe(worktreeB.projectId);
    expect(worktreeA.slug).toBe("repo");
    expect(worktreeA.anchorPath).toBe("/tmp/repo/.git");
  });

  it("falls back cleanly to directory identity when git resolution fails", () => {
    const identity = resolveProjectIdentity("/tmp/non-git/workspace", {
      execGit: () => ({
        ok: false,
        stdout: "",
        error: new Error("git timed out"),
        timedOut: true,
      }),
      platform: "darwin",
      realpath: (filePath) => filePath,
    });

    expect(identity.mode).toBe("directory");
    expect(identity.anchorPath).toBe("/tmp/non-git/workspace");
    expect(identity.slug).toBe("workspace");
    expect(identity.projectId).toMatch(/^workspace-[a-f0-9]{20}$/u);
  });

  it("normalizes windows anchors case-insensitively", () => {
    expect(normalizeAnchorPath("C:\\Repo\\.Git\\", "win32")).toBe("c:/repo/.git");
  });
});
