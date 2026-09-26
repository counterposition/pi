import { createHash } from "node:crypto";

import type { EvalItem } from "./ingest.js";
import { readJsonl, writeJsonl } from "./jsonl.js";
import { ITEMS_FILE, POOL_FILE } from "./paths.js";
import { pathAsk as gateAsks } from "./structural.js";

export type Split = "tune" | "heldout";
export type Stratum = "risk" | "ordinary" | "custom" | "mcp";

export interface PoolItem extends EvalItem {
  split: Split;
  stratum: Stratum;
  /** The gate's external-directory rule asks about this call whatever the link says. */
  pathAsk: boolean;
}

/** Commands worth over-sampling: anything that could plausibly need a human. */
const RISK = new RegExp(
  [
    String.raw`\brm\s`,
    String.raw`\bgit\s+(push|reset|clean|checkout\s+(--|\.)|restore|branch\s+-[dD]|stash\s+(drop|clear)|rebase|filter-|commit\s+--amend|tag\s+-d|config\s+--global|remote\s+(add|set-url|remove))`,
    String.raw`--force|--hard|\s-rf\b|\s-fr\b`,
    String.raw`\b(curl|wget)\b.*(\|\s*(sh|bash|zsh|python|node)|-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-F\s|-T\s|@)`,
    String.raw`\bsudo\b|\bchmod\b|\bchown\b|\bdd\s|\bmkfs|\btruncate\b`,
    String.raw`\b(npm|pnpm|yarn|bun)\s+(publish|unpublish|deprecate|(add|install|i)\s+(-g|--global))|\bcargo\s+publish|\btwine\s+upload|\bgem\s+push`,
    String.raw`\b(pip|pip3|uv\s+pip)\s+install\b|\bbrew\s+(install|uninstall|upgrade)`,
    String.raw`\b(docker|kubectl|helm|terraform|aws|gcloud|az|heroku|vercel|fly|flyctl|wrangler|netlify)\s`,
    String.raw`\bgh\s+(pr|issue|release|repo|workflow|api|gist|secret)\b`,
    String.raw`\b(ssh|scp|rsync|sftp)\s`,
    String.raw`\b(psql|mysql|sqlite3|mongo|redis-cli)\b|\b(DROP|DELETE\s+FROM|TRUNCATE|ALTER)\b`,
    String.raw`\b(kill|pkill|killall)\b|\blaunchctl\b|\bcrontab\b|\bsystemctl\b`,
    String.raw`\beval\b|\bbase64\b|\bexec\b`,
    String.raw`\.env\b|\.ssh/|id_rsa|id_ed25519|\.aws/|\.npmrc|\.netrc|credentials|secret|token|api[_-]?key`,
    String.raw`(^|\s)~/?\.|\$HOME/\.|\.pi/|\.git/hooks|\.bashrc|\.zshrc|\.profile`,
    String.raw`>\s*/(etc|usr|System|Library)/|\bmv\s`,
  ].join("|"),
  "i",
);

const TARGETS = { risk: 900, ordinary: 1500, perCustomTool: 30 };

export function isRisky(command: string): boolean {
  return RISK.test(command);
}

export function splitOf(session: string): Split {
  const bucket = createHash("sha256").update(session).digest()[0] ?? 0;
  return bucket % 10 < 7 ? "tune" : "heldout";
}

/** Deterministic shuffle keyed on item ids. */
function sample<T extends { id: string }>(items: T[], n: number, salt: string): T[] {
  const key = (item: T) =>
    createHash("sha256")
      .update(salt + item.id)
      .digest("hex");
  return items
    .map((item) => ({ item, key: key(item) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, n)
    .map(({ item }) => item);
}

export function buildPool(items: readonly EvalItem[]): Omit<PoolItem, "pathAsk">[] {
  const risk: EvalItem[] = [];
  const ordinary: EvalItem[] = [];
  const byTool = new Map<string, EvalItem[]>();
  for (const item of items) {
    const tool = item.state.action.tool;
    if (!tool.trim()) continue;
    if (item.toolClass === "bash") {
      const command = (item.state.action.input as { command?: unknown }).command;
      if (typeof command !== "string" || !command.trim()) continue;
      (isRisky(command) ? risk : ordinary).push(item);
    } else {
      byTool.set(tool, [...(byTool.get(tool) ?? []), item]);
    }
  }
  const tag =
    (stratum: Stratum) =>
    (item: EvalItem): Omit<PoolItem, "pathAsk"> => ({
      ...item,
      stratum,
      split: splitOf(item.session),
    });
  return [
    ...sample(risk, TARGETS.risk, "risk").map(tag("risk")),
    ...sample(ordinary, TARGETS.ordinary, "ordinary").map(tag("ordinary")),
    ...[...byTool.values()].flatMap((calls) =>
      sample(calls, TARGETS.perCustomTool, "custom").map((item) =>
        tag(item.toolClass === "mcp" ? "mcp" : "custom")(item),
      ),
    ),
  ];
}

export async function pool(): Promise<void> {
  const items = await readJsonl<EvalItem>(ITEMS_FILE);
  const pooled: PoolItem[] = [];
  for (const item of buildPool(items)) {
    const command = (item.state.action.input as { command?: unknown }).command;
    const pathAsk =
      item.toolClass === "bash" && typeof command === "string"
        ? await gateAsks(command, item.state.cwd)
        : false;
    pooled.push({ ...item, pathAsk });
  }
  await writeJsonl(POOL_FILE, pooled);
  const counts: Record<string, number> = {};
  for (const item of pooled)
    counts[`${item.stratum}/${item.split}`] = (counts[`${item.stratum}/${item.split}`] ?? 0) + 1;
  const riskTotal = items.filter(
    (i) =>
      i.toolClass === "bash" &&
      isRisky(String((i.state.action.input as { command?: unknown }).command ?? "")),
  ).length;
  console.log(
    `${pooled.length} pooled from ${items.length} (${riskTotal} risk-pattern bash)`,
    counts,
  );
}
