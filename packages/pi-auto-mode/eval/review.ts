import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { emitKeypressEvents } from "node:readline";

import { QUESTION_IDS } from "../src/questions.js";
import type { Answers } from "../src/questions.js";
import { DEFAULT_THRESHOLDS } from "../src/route.js";
import type { Label } from "./label.js";
import { decide, explain } from "./metrics.js";
import { OWNER_LABELS_FILE } from "./paths.js";
import type { ScoredItem } from "./score.js";
import { loadContext } from "./tune.js";
import type { EvalContext, OwnerLabel } from "./tune.js";

const LIMIT_MS = 60 * 60_000;
const TARGET = 150;

export type Reason = "must-catch failure" | "labelers disagree" | "Jev disagrees" | "spot check";

interface QueueEntry {
  item: ScoredItem;
  reason: Reason;
  stakes: number;
}

function maxHazard(answers: Answers | undefined): number {
  if (!answers) return 1;
  return Math.max(
    answers.irreversible,
    answers.external,
    answers.system,
    answers.opaque,
    answers.exfiltration,
    answers.forbidden,
  );
}

/** The plan's review order: must-catch failures, disagreements, Jev disagreements by stakes, spot checks. */
export function reviewQueue(ctx: EvalContext): QueueEntry[] {
  const t = DEFAULT_THRESHOLDS;
  const queue: QueueEntry[] = [];
  const spot: QueueEntry[] = [];
  for (const item of ctx.items) {
    if (ctx.owner.has(item.id)) continue;
    const answers = ctx.answers.get(item.id);
    const verdict = decide(item, answers, t);
    const stakes = maxHazard(answers);
    if (item.source === "must-catch") {
      if (verdict !== item.expect)
        queue.push({ item, reason: "must-catch failure", stakes: 3 + stakes });
      continue;
    }
    const labels = ctx.labelers.map((l) => l.get(item.id));
    if (labels.some((l) => l === undefined)) continue;
    if (labels.some((l) => l !== labels[0])) {
      queue.push({ item, reason: "labelers disagree", stakes: 2 + stakes });
    } else if (labels[0] !== verdict) {
      queue.push({ item, reason: "Jev disagrees", stakes: 1 + stakes });
    } else {
      spot.push({ item, reason: "spot check", stakes });
    }
  }
  queue.sort((a, b) => b.stakes - a.stakes);
  // A deterministic sprinkle of agreements, riskiest first.
  spot.sort((a, b) => b.stakes - a.stakes || a.item.id.localeCompare(b.item.id));
  return [...queue, ...spot.filter((_, i) => i % 25 === 0)];
}

function render(
  entry: QueueEntry,
  ctx: EvalContext,
  index: number,
  total: number,
  elapsed: number,
  full: boolean,
): string {
  const { item, reason } = entry;
  const answers = ctx.answers.get(item.id);
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);
  const clock = `${minutes}:${String(seconds).padStart(2, "0")} / 60:00`;
  const labels = ctx.labelers.map((l, i) => `L${i + 1}=${l.get(item.id) ?? "—"}`).join("  ");
  const scores = answers
    ? QUESTION_IDS.map((id) => `${id} ${answers[id].toFixed(2)}`).join("  ")
    : "no Jev answer (blocked or oversized)";
  const messages = item.state.user_messages;
  const shown = full ? messages : messages.slice(-3);
  const users = shown.map((m) => `  > ${full ? m : m.replace(/\s+/g, " ").slice(0, 400)}`);
  const cutMessages = !full && shown.some((m) => m.replace(/\s+/g, " ").length > 400);
  const actionText = JSON.stringify(item.state.action, null, 2);
  const action = full ? actionText : actionText.slice(0, 1800);
  const hidden = [
    messages.length > shown.length ? `${messages.length - shown.length} older messages` : "",
    cutMessages ? "the end of long messages" : "",
    action.length < actionText.length
      ? `${actionText.length - action.length} characters of the call`
      : "",
  ].filter(Boolean);
  const omitted = hidden.length
    ? `\x1b[33mHidden: ${hidden.join(", ")}. Press [f] to see everything before labeling.\x1b[0m`
    : "";
  return [
    `\x1b[2J\x1b[H\x1b[1m[${index + 1}/${total}] ${reason}\x1b[0m   ${clock}   done this session: ${index}`,
    `${item.id}  ${item.source}/${item.stratum}/${item.split}${item.expect ? `  fixture expects ${item.expect}` : ""}`,
    "",
    `\x1b[1mUser (${full ? "all" : "last 3"} of ${messages.length}):\x1b[0m`,
    ...(users.length ? users : ["  (none)"]),
    "",
    "\x1b[1mCall:\x1b[0m",
    action,
    "",
    `\x1b[1mLabelers:\x1b[0m ${labels}`,
    `\x1b[1mJev:\x1b[0m ${scores}`,
    `\x1b[1mLink now:\x1b[0m ${explain(item, answers ?? undefined, DEFAULT_THRESHOLDS)}`,
    ...(omitted ? ["", omitted] : []),
    "",
    "Could this run WITHOUT asking you?   [a] allow   [k] ask   [s] skip   [u] undo   [f] full   [q] quit",
  ].join("\n");
}

export async function review(): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("review needs an interactive terminal");
  const ctx = await loadContext();
  const queue = reviewQueue(ctx);
  console.log(`${queue.length} items queued; target ${TARGET} in 60 minutes.`);
  await mkdir(dirname(OWNER_LABELS_FILE), { recursive: true });

  const started = Date.now();
  const history: { index: number; label?: Label }[] = [];
  let index = 0;
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  // The full view is for scrolling back through, so the clock does not redraw it.
  let full = false;
  const show = () =>
    process.stdout.write(
      render(queue[index]!, ctx, index, queue.length, Date.now() - started, full),
    );
  // Keys and the timer are handled one at a time, so an undo cannot overtake the save
  // it undoes, and time running out cannot cut off a save in flight.
  let pending: Promise<unknown> = Promise.resolve();
  const tick = setInterval(() => {
    if (Date.now() - started >= LIMIT_MS) {
      pending = pending.then(() => finish("time is up")).catch(() => undefined);
    } else if (index < queue.length && !full) show();
  }, 1000);

  let finish: (why: string) => void = () => {};
  let stopped = false;
  const done = new Promise<void>((resolve) => {
    finish = (why: string) => {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const labeled = history.filter((h) => h.label).length;
      console.log(
        `\n${why}: ${labeled} labels saved to ${OWNER_LABELS_FILE}. Run the tune step next.`,
      );
      resolve();
    };
  });

  const save = async (label: Label | null) => {
    const id = queue[index]!.item.id;
    const key = ctx.keys.get(id) ?? "";
    const row: OwnerLabel = { id, key, label, at: new Date().toISOString() };
    await appendFile(OWNER_LABELS_FILE, `${JSON.stringify(row)}\n`);
  };

  process.stdin.on("keypress", (_text: string, key: { name?: string; ctrl?: boolean }) => {
    pending = pending
      .then(async () => {
        // Keys that arrive after the session ended are ignored.
        if (stopped) return;
        if (key.ctrl && key.name === "c") return finish("stopped");
        if (key.name === "q") return finish("stopped");
        if (key.name === "f") {
          full = !full;
          return show();
        }
        if (key.name === "u") {
          full = false;
          const last = history.pop();
          if (last) index = last.index;
          // Owner labels are append-only, so undo appends a revocation.
          if (last?.label) await save(null);
          return show();
        }
        const label = key.name === "a" ? "allow" : key.name === "k" ? "ask" : undefined;
        if (!label && key.name !== "s") return;
        if (label) await save(label);
        history.push({ index, label });
        full = false;
        index++;
        if (index >= queue.length) return finish("queue empty");
        show();
      })
      .catch((error: unknown) => {
        // A label that cannot be saved ends the session rather than being lost silently.
        finish(`could not save a label: ${error instanceof Error ? error.message : String(error)}`);
      });
  });

  if (queue.length === 0) finish("nothing to review");
  else show();
  await done;
}
