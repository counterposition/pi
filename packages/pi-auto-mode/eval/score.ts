import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_CONFIG, resolveApiKey } from "../src/config.js";
import { JEV_URL, parseAnswers } from "../src/jev.js";
import { QUESTIONS } from "../src/questions.js";
import type { Answers } from "../src/questions.js";
import type { JevState } from "../src/state.js";
import { baselineRequest, baselineVerdict } from "./baseline.js";
import { EVAL_ENVIRONMENT } from "./ingest.js";
import type { ToolClass } from "./ingest.js";
import { mapLimit, readJsonl } from "./jsonl.js";
import { CACHE_DIR, MUST_CATCH_FILE, POOL_FILE } from "./paths.js";
import type { PoolItem, Split } from "./pool.js";

export const MODEL = DEFAULT_CONFIG.model;

interface CacheEntry {
  body: unknown;
  latencyMs: number;
  /** TypeSafe's Cloudflare edge refused the request; the link defers such calls to a human. */
  blocked?: boolean;
}

export interface MustCatchCase {
  id: string;
  expect: "ask" | "allow";
  category: string;
  user_messages: string[];
  action: JevState["action"];
}

/** Every scored item, pool and must-catch alike. */
export interface ScoredItem {
  id: string;
  source: "pool" | "must-catch";
  split: Split;
  toolClass: ToolClass;
  stratum: string;
  state: JevState;
  intentTrusted: boolean;
  /** The gate asks about a path outside cwd whatever the link says. */
  pathAsk: boolean;
  expect?: "ask" | "allow";
  category?: string;
}

export function mustCatchItems(cases: readonly MustCatchCase[]): ScoredItem[] {
  return cases.map((c) => ({
    id: c.id,
    source: "must-catch",
    // Hold out every third case so question rewording cannot overfit the whole set.
    split: Number(c.id.slice(-3)) % 3 === 0 ? "heldout" : "tune",
    toolClass: c.action.tool === "bash" ? "bash" : c.action.tool === "mcp" ? "mcp" : "custom",
    stratum: c.category,
    intentTrusted: true,
    pathAsk: false,
    state: {
      user_messages: c.user_messages,
      earlier_actions: [],
      action: c.action,
      cwd: "/Users/dev/project",
      environment: [...EVAL_ENVIRONMENT],
    },
    expect: c.expect,
    category: c.category,
  }));
}

export async function loadItems(): Promise<ScoredItem[]> {
  const pool = await readJsonl<PoolItem>(POOL_FILE);
  const cases = await readJsonl<MustCatchCase>(MUST_CATCH_FILE);
  return [
    ...pool.map(
      (p): ScoredItem => ({
        id: p.id,
        source: "pool",
        split: p.split,
        toolClass: p.toolClass,
        stratum: p.stratum,
        state: p.state,
        intentTrusted: p.intentTrusted,
        pathAsk: p.pathAsk,
      }),
    ),
    ...mustCatchItems(cases),
  ];
}

function cachePath(body: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return join(CACHE_DIR, "jev", hash.slice(0, 2), `${hash}.json`);
}

/** Atomic, so identical concurrent requests cannot tear the file. */
async function writeCache(path: string, entry: CacheEntry): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, JSON.stringify(entry));
  await rename(temp, path);
}

/** One raw System One call, cached by request body. */
export async function systemOne(request: unknown, apiKey: string): Promise<CacheEntry> {
  const path = cachePath(request);
  const cached = await readFile(path, "utf8").catch(() => undefined);
  if (cached) {
    try {
      return JSON.parse(cached) as CacheEntry;
    } catch {
      // A torn write from an older run; fetch again.
    }
  }

  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    const response = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    const latencyMs = Math.round(performance.now() - started);
    if (response instanceof Response && response.ok) {
      const entry: CacheEntry = { body: await response.json(), latencyMs };
      await writeCache(path, entry);
      return entry;
    }
    const why =
      response instanceof Response
        ? `HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`
        : response.message;
    if (response instanceof Response && response.status === 403) {
      const entry: CacheEntry = { body: null, latencyMs, blocked: true };
      await writeCache(path, entry);
      return entry;
    }
    if (attempt >= 5) throw new Error(`Jev failed after ${attempt} attempts: ${why}`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

export interface Scores {
  answers: Map<string, Answers>;
  baseline: Map<string, "allow" | "ask">;
  /** The baseline with its WAF-tripping criterion reworded. */
  baselineWafSafe: Map<string, "allow" | "ask">;
  /** Items the edge refused; they have no answers and count as asks. */
  blocked: Set<string>;
  /** Baseline requests the edge refused, as shipped and reworded. */
  baselineBlocked: { shipped: number; wafSafe: number };
  latencies: number[];
}

export async function scoreItems(
  items: readonly ScoredItem[],
  questions: typeof QUESTIONS = QUESTIONS,
  { baseline = true }: { baseline?: boolean } = {},
): Promise<Scores> {
  const apiKey = await resolveApiKey(DEFAULT_CONFIG.apiKey);
  if (!apiKey) throw new Error("No TypeSafe API key: set TYPESAFE_API_KEY");

  const scores: Scores = {
    answers: new Map(),
    baseline: new Map(),
    baselineWafSafe: new Map(),
    blocked: new Set(),
    baselineBlocked: { shipped: 0, wafSafe: 0 },
    latencies: [],
  };
  let done = 0;
  await mapLimit(items, 8, async (item) => {
    const ours = await systemOne({ model: MODEL, state: item.state, questions }, apiKey);
    if (ours.blocked) scores.blocked.add(item.id);
    else {
      scores.answers.set(item.id, parseAnswers(ours.body).answers);
      scores.latencies.push(ours.latencyMs);
    }
    if (baseline) {
      const base = await systemOne(baselineRequest(item.state, MODEL), apiKey);
      scores.baseline.set(item.id, base.blocked ? "ask" : baselineVerdict(base.body));
      const safe = await systemOne(baselineRequest(item.state, MODEL, true), apiKey);
      scores.baselineWafSafe.set(item.id, safe.blocked ? "ask" : baselineVerdict(safe.body));
      if (base.blocked) scores.baselineBlocked.shipped++;
      if (safe.blocked) scores.baselineBlocked.wafSafe++;
    }
    if (++done % 250 === 0) console.log(`scored ${done}/${items.length}`);
  });
  return scores;
}

export async function score(): Promise<void> {
  const items = await loadItems();
  const { answers, baseline, blocked } = await scoreItems(items);
  console.log(
    `scored ${answers.size} items, ${blocked.size} blocked by the edge (${baseline.size} baseline)`,
  );
}
