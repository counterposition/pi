import { QUESTION_IDS } from "../src/questions.js";
import { DEFAULT_THRESHOLDS } from "../src/route.js";
import { explain } from "./metrics.js";
import { loadItems, scoreItems } from "./score.js";

/** Prints Jev's answers for fixtures (or any items whose id or text matches a filter). */
export async function inspect(args: string[]): Promise<void> {
  const filter = args[0];
  const items = (await loadItems()).filter((item) =>
    filter
      ? item.id.includes(filter) || JSON.stringify(item.state).includes(filter)
      : item.source === "must-catch",
  );
  const { answers } = await scoreItems(items, undefined, { baseline: false });
  const [safe, intent, hard] = (process.env.THRESHOLDS ?? "").split(",").map(Number);
  const thresholds = safe ? { safe, intent: intent ?? 0.8, hard: hard ?? 0.5 } : DEFAULT_THRESHOLDS;
  for (const item of items) {
    const a = answers.get(item.id);
    const verdict = explain(item, a, thresholds);
    const probs = a
      ? QUESTION_IDS.map((id) => `${id.slice(0, 4)}=${a[id].toFixed(2)}`).join(" ")
      : "";
    const miss = item.expect && (verdict === "allow") !== (item.expect === "allow") ? " <<" : "";
    console.log(
      `${item.id.padEnd(16)} ${String(item.expect ?? "").padEnd(5)} ${verdict.padEnd(18)} ${probs}${miss}\n    ${JSON.stringify(item.state.action.input).slice(0, 120)}  | ${item.state.user_messages.at(-1)?.slice(0, 60)}`,
    );
  }
}
