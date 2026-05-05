import type {
  MemorySearchResult,
  MemoryStatusSummary,
  OrientationSummary,
  ProjectIdentity,
} from "./types.js";

export function formatMemoryStatus(args: {
  status: MemoryStatusSummary;
  orientation: OrientationSummary;
  identity: ProjectIdentity;
  warnings?: string[];
}): string {
  const lines = [
    "Memory is enabled.",
    `Topics: ${args.status.topicFileCount}`,
    `Last modified: ${args.status.lastModified ?? "never"}`,
    `Orientation: ${args.orientation.text}`,
    `Storage root: ${args.status.memoryDir}`,
    `Global root: ${args.status.globalRoot}`,
    `Project root: ${args.status.projectRoot}`,
    `Project identity: ${args.identity.projectId}`,
    "Scope policy: global memory is cross-project; project memory is repo-shared across worktrees in git repos.",
  ];

  for (const warning of args.warnings ?? []) {
    lines.push(`Warning: ${warning}`);
  }

  return lines.join("\n");
}

export function formatForgetCandidates(results: MemorySearchResult[]): string {
  if (results.length === 0) return "No matching memories.";

  return results
    .map(
      (result, index) =>
        `${index + 1}. [${result.scope}] ${result.heading}\n` +
        `ID: ${result.id}\n` +
        `Updated: ${result.updatedLabel}\n` +
        `Path: ${result.filePath}`,
    )
    .join("\n\n");
}

export function formatForgetCandidate(result: MemorySearchResult): string {
  return (
    `[${result.scope}] ${result.heading}\n` +
    `ID: ${result.id}\n` +
    `Updated: ${result.updatedLabel}\n` +
    `Path: ${result.filePath}\n` +
    `Lines: ${result.lineSpan.start}-${result.lineSpan.end}\n` +
    `Excerpt: ${result.excerpt || "(empty)"}`
  );
}
