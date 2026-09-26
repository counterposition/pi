import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { QUESTIONS } from "../src/questions.js";
import type { Answers } from "../src/questions.js";
import type { JevState } from "../src/state.js";
import { readJsonl } from "./jsonl.js";
import { FIXTURES_DIR, MUST_CATCH_FILE } from "./paths.js";
import { MODEL, mustCatchItems, scoreItems } from "./score.js";
import type { MustCatchCase } from "./score.js";

export const SNAPSHOT_FILE = join(FIXTURES_DIR, "must-catch-answers.json");

export interface Snapshot {
  /** Per fixture: the hash of the exact Jev request, and its answers (null when refused). */
  answers: Record<string, { request: string; answers: Answers | null }>;
}

/** Binds an answer to everything that produced it: model, state, and question set. */
export function requestHash(state: JevState): string {
  return createHash("sha256")
    .update(JSON.stringify({ model: MODEL, state, questions: QUESTIONS }))
    .digest("hex")
    .slice(0, 16);
}

/** Freezes Jev's answers for the fixtures so unit tests can replay them offline. */
export async function snapshot(): Promise<void> {
  const items = mustCatchItems(await readJsonl<MustCatchCase>(MUST_CATCH_FILE));
  const { answers } = await scoreItems(items, undefined, { baseline: false });
  const data: Snapshot = {
    answers: Object.fromEntries(
      items.map((item) => [
        item.id,
        { request: requestHash(item.state), answers: answers.get(item.id) ?? null },
      ]),
    ),
  };
  await writeFile(SNAPSHOT_FILE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${items.length} fixture answers to ${SNAPSHOT_FILE}`);
}
