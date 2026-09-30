// A permission gate that asks a classifier model whether a bash command is destructive.
import type { ClassifierContext } from "@earendil-works/pi-ai";
import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";

const QUESTIONS = {
  destructive: {
    type: "bool",
    instructions: "Could running `command` delete or overwrite data the user may want to keep?",
    criteria: { true: "Destructive", false: "Not destructive" },
  },
} satisfies ClassifierContext["questions"];

// Highest P(destructive) that runs without asking. Tune it for your model and question.
const MAX_ALLOWED_PROBABILITY = 0.2;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // Also fires for calls codemode scripts make; those carry event.parentToolCallId.
    if (!isToolCallEventType("bash", event)) return;

    const jev = ctx.modelRegistry.findOfType("classifier", "typesafe", "jev-latest");
    let probability: number | undefined;
    if (jev) {
      // classify() never rejects: errors and aborts come back as stopReason.
      const result = await ctx.modelRegistry.classify(
        jev,
        { state: { command: event.input.command }, questions: QUESTIONS },
        { signal: ctx.signal },
      );
      if (result.stopReason === "aborted") return { block: true, reason: "Cancelled" };
      const answer = result.stopReason === "stop" ? result.answers.destructive : undefined;
      if (answer?.type === "bool" && Number.isFinite(answer.probability)) {
        probability = answer.probability;
      }
    }

    // Allow only a valid answer at or below the threshold; anything else needs a person.
    if (probability !== undefined && probability >= 0 && probability <= MAX_ALLOWED_PROBABILITY) return;

    const reason =
      probability === undefined ? "Classifier unavailable" : "Classifier flagged the command";
    if (!ctx.hasUI) return { block: true, reason: `${reason}; no UI to confirm` };
    const ok = await ctx.ui.confirm(`${reason}. Run it?`, event.input.command);
    if (!ok) return { block: true, reason: "Blocked by user" };
  });
}
