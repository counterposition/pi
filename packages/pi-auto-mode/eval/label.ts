import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { mapLimit, readJsonl } from "./jsonl.js";
import { LABELS_DIR, POOL_FILE, RUBRIC_FILE } from "./paths.js";
import type { PoolItem } from "./pool.js";

export type Label = "allow" | "ask";

export const LABELERS = ["openai-codex/gpt-6-luna", "opencode-go/deepseek-v4.1-flash"] as const;

export interface LabelRow {
  id: string;
  /** Hash of exactly what the labeler saw; a label for other evidence does not count. */
  key: string;
  label: Label;
}

/** What a label is bound to: the rubric and the state shown for the item. */
export function labelKey(item: Pick<PoolItem, "state">, rubric: string): string {
  const { user_messages, action, cwd } = item.state;
  return createHash("sha256")
    .update(rubric)
    .update(JSON.stringify({ user_messages, action, cwd }))
    .digest("hex")
    .slice(0, 16);
}

const BATCH_CHARS = 60_000;
const BATCH_ITEMS = 24;

export function labelsFile(model: string): string {
  return join(LABELS_DIR, `${model.replaceAll("/", "__")}.jsonl`);
}

/** Labels whose key still matches the item's current state; everything else is unlabeled. */
export async function readLabels(
  model: string,
  keys: ReadonlyMap<string, string>,
): Promise<Map<string, Label>> {
  const rows = await readJsonl<LabelRow>(labelsFile(model));
  return new Map(
    rows.filter((row) => row.key === keys.get(row.id)).map((row) => [row.id, row.label]),
  );
}

export async function labelKeys(
  items: readonly Pick<PoolItem, "id" | "state">[],
): Promise<Map<string, string>> {
  const rubric = await readFile(RUBRIC_FILE, "utf8");
  return new Map(items.map((item) => [item.id, labelKey(item, rubric)]));
}

function batches(items: readonly PoolItem[]): PoolItem[][] {
  const out: PoolItem[][] = [];
  let current: PoolItem[] = [];
  let chars = 0;
  for (const item of items) {
    const size = JSON.stringify(item.state).length;
    if (current.length > 0 && (chars + size > BATCH_CHARS || current.length >= BATCH_ITEMS)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function prompt(rubric: string, batch: readonly PoolItem[]): string {
  const items = batch.map((item, i) => {
    const { user_messages, action, cwd } = item.state;
    return `### Item ${i + 1}\n${JSON.stringify({ user_messages, action, cwd })}`;
  });
  return `${rubric}\nThe user messages are the most recent ones before the call, oldest first.\n\n## Items\n\n${items.join("\n\n")}\n`;
}

export function parseLabels(output: string, size: number): Map<number, Label> {
  const labels = new Map<number, Label>();
  for (const match of output.matchAll(
    /\{[^{}]*"id"\s*:\s*(\d+)[^{}]*"label"\s*:\s*"(allow|ask)"[^{}]*\}/g,
  )) {
    const n = Number(match[1]);
    if (n >= 1 && n <= size) labels.set(n, match[2] as Label);
  }
  return labels;
}

/** `pi -p` reads piped stdin until EOF, so stdin must be closed rather than left as an open pipe. */
function runModel(model: string, text: string): Promise<string> {
  const args = [
    "-p",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--model",
    model,
    "--thinking",
    "high",
    text,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("pi", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`pi exited ${code}: ${stderr.slice(-300)}`)),
    );
  });
}

/** Labels every unlabeled pool item with each labeler; resumable. */
export async function label(args: string[]): Promise<void> {
  const models = args.length > 0 ? args : [...LABELERS];
  const rubric = await readFile(RUBRIC_FILE, "utf8");
  // Ids are hashes, so sorting by id mixes strata within each batch.
  const pool = (await readJsonl<PoolItem>(POOL_FILE)).sort((a, b) => a.id.localeCompare(b.id));
  await mkdir(LABELS_DIR, { recursive: true });

  await Promise.all(
    models.map(async (model) => {
      const keys = new Map(pool.map((item) => [item.id, labelKey(item, rubric)]));
      const done = await readLabels(model, keys);
      const todo = batches(pool.filter((item) => !done.has(item.id)));
      console.log(`${model}: ${todo.length} batches`);
      let finished = 0;
      await mapLimit(todo, 4, async (batch) => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const labels = parseLabels(await runModel(model, prompt(rubric, batch)), batch.length);
            const rows = batch.flatMap((item, i) => {
              const value = labels.get(i + 1);
              return value ? [{ id: item.id, key: keys.get(item.id), label: value }] : [];
            });
            if (rows.length > 0) {
              await appendFile(
                labelsFile(model),
                rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
              );
            }
            if (rows.length === batch.length) break;
          } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.warn(
              `${model}: batch failed (attempt ${attempt}): ${err.message.slice(0, 200)}`,
            );
          }
        }
        if (++finished % 10 === 0) console.log(`${model}: ${finished}/${todo.length}`);
      });
      console.log(`${model}: done`);
    }),
  );
}
