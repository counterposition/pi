import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { JsonObject } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  ClassifierError,
  isProbability,
  parseModel,
  servedModel,
  toAnswers,
} from "../src/classifier.js";
import type { Classifier } from "../src/classifier.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { QUESTION_IDS, QUESTIONS } from "../src/questions.js";
import { TUNED_REVISIONS } from "../src/route.js";
import type { Answers } from "../src/questions.js";
import type { ClassifierState } from "../src/state.js";
import { baselineRequest, baselineVerdict } from "./baseline.js";
import { EVAL_ENVIRONMENT } from "./ingest.js";
import type { ToolClass } from "./ingest.js";
import { mapLimit, readJsonl } from "./jsonl.js";
import { CACHE_DIR, MUST_CATCH_FILE, POOL_FILE } from "./paths.js";
import type { PoolItem, Split } from "./pool.js";

/** The classifier under evaluation, as `provider/id`; Pi supplies its credentials. */
export const MODEL = process.env.AUTO_MODE_EVAL_MODEL ?? DEFAULT_CONFIG.model;
/** ai-guard's reviewer, sent straight to TypeSafe as it ships. */
const BASELINE_MODEL = "jev-1.13.0";
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

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
  action: ClassifierState["action"];
}

/** Every scored item, pool and must-catch alike. */
export interface ScoredItem {
  id: string;
  source: "pool" | "must-catch";
  split: Split;
  toolClass: ToolClass;
  stratum: string;
  state: ClassifierState;
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
async function writeEntry(path: string, entry: CacheEntry | ClassifiedEntry): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, JSON.stringify(entry));
  await rename(temp, path);
}

/** One raw TypeSafe System One call, cached by request body. */
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
    const response = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    const latencyMs = Math.round(performance.now() - started);
    if (response instanceof Response && response.ok) {
      const entry: CacheEntry = { body: await response.json(), latencyMs };
      await writeEntry(path, entry);
      return entry;
    }
    const why =
      response instanceof Response
        ? `HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`
        : response.message;
    if (response instanceof Response && response.status === 403) {
      const entry: CacheEntry = { body: null, latencyMs, blocked: true };
      await writeEntry(path, entry);
      return entry;
    }
    if (attempt >= 5) throw new Error(`TypeSafe failed after ${attempt} attempts: ${why}`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

interface ClassifiedEntry {
  /**
   * Null when the service's edge refused the request or the answers were out of
   * range; the link defers such calls.
   */
  answers: Answers | null;
  latencyMs: number;
  /** The model the service said it served, when it names one. */
  served?: string;
}

/** Pi's model runtime with the user's credentials, as a session would build it. */
let runtime: Promise<{ runtime: ModelRuntime; model: Classifier }> | undefined;

function classifier() {
  runtime ??= (async () => {
    const parsed = parseModel(MODEL);
    if (!parsed) throw new Error(`AUTO_MODE_EVAL_MODEL must be provider/id, not ${MODEL}`);
    const created = await ModelRuntime.create();
    const model = created.getModelOfType("classifier", parsed.provider, parsed.id);
    if (!model) throw new Error(`Pi has no classifier model ${MODEL}`);
    return { runtime: created, model };
  })();
  return runtime;
}

/**
 * One classification of `state` through Pi's runtime, cached by model, state, and
 * questions. The cache does not notice a service changing the model behind an ID:
 * delete `.cache/classifier` to measure again.
 */
export async function classify(
  state: ClassifierState,
  questions: typeof QUESTIONS,
): Promise<ClassifiedEntry> {
  const hash = createHash("sha256")
    .update(JSON.stringify({ model: MODEL, state, questions }))
    .digest("hex");
  const path = join(CACHE_DIR, "classifier", hash.slice(0, 2), `${hash}.json`);
  const cached = await readFile(path, "utf8").catch(() => undefined);
  if (cached) {
    try {
      const entry = JSON.parse(cached) as ClassifiedEntry;
      // Entries from before answers were checked count as asks, like the link's.
      const { answers } = entry;
      if (answers && !QUESTION_IDS.every((id) => isProbability(answers[id]))) {
        return { ...entry, answers: null };
      }
      return entry;
    } catch {
      // A torn write from an older run; classify again.
    }
  }

  const { runtime: models, model } = await classifier();
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    let status: number | undefined;
    let served: string | undefined;
    const result = await models.classify(
      model,
      { state: state as unknown as JsonObject, questions },
      {
        maxRetries: 0,
        signal: AbortSignal.timeout(30_000),
        // Pi reports no HTTP status for a failed request, and a 403 is an edge refusal.
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          status = response.status;
          served = await servedModel(response);
          return response;
        },
      },
    );
    const latencyMs = Math.round(performance.now() - started);
    if (result.stopReason === "stop") {
      const revision = TUNED_REVISIONS[MODEL];
      if (revision && served !== revision) {
        throw new Error(`${MODEL} served ${served ?? "an unnamed model"}, not ${revision}`);
      }
      let answers: Answers | null;
      try {
        answers = toAnswers(result);
      } catch (error: unknown) {
        // The link defers on answers it cannot use, so they count as asks here too.
        if (!(error instanceof ClassifierError)) throw error;
        answers = null;
      }
      const entry: ClassifiedEntry = { answers, latencyMs, ...(served ? { served } : {}) };
      await writeEntry(path, entry);
      return entry;
    }
    if (status === 403) {
      const entry: ClassifiedEntry = { answers: null, latencyMs };
      await writeEntry(path, entry);
      return entry;
    }
    if (attempt >= 5) {
      throw new Error(`${MODEL} failed after ${attempt} attempts: ${result.errorMessage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

export interface Scores {
  answers: Map<string, Answers>;
  baseline: Map<string, "allow" | "ask">;
  /** The baseline with its WAF-tripping criterion reworded. */
  baselineWafSafe: Map<string, "allow" | "ask">;
  /** Items the edge refused or answered out of range; they count as asks. */
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
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (baseline && !apiKey) throw new Error("The baseline needs TYPESAFE_API_KEY");

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
    const ours = await classify(item.state, questions);
    if (!ours.answers) scores.blocked.add(item.id);
    else {
      scores.answers.set(item.id, ours.answers);
      scores.latencies.push(ours.latencyMs);
    }
    if (baseline && apiKey) {
      const base = await systemOne(baselineRequest(item.state, BASELINE_MODEL), apiKey);
      scores.baseline.set(item.id, base.blocked ? "ask" : baselineVerdict(base.body));
      const safe = await systemOne(baselineRequest(item.state, BASELINE_MODEL, true), apiKey);
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
