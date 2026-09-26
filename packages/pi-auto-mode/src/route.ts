import { QUESTION_IDS, TIERS } from "./questions.js";
import type { Answers, QuestionId } from "./questions.js";

export interface Thresholds {
  /** Allow when every soft hazard is below this. */
  safe: number;
  /** Allow a soft hazard when `requested` is at least this. */
  intent: number;
  /** Flag when any hard hazard is at least this, whatever the user asked. */
  hard: number;
}

/** Tuned on the eval's tuning split; see eval/REPORT.md. */
export const DEFAULT_THRESHOLDS: Thresholds = { safe: 0.3, intent: 0.58, hard: 0.5 };

export interface Flag {
  hazard: QuestionId;
  probability: number;
}

export type Route =
  | { kind: "allow" }
  | { kind: "defer"; flag: Flag }
  | { kind: "deny"; flag: Flag; reason: string };

const HAZARD_TEXT: Record<QuestionId, string> = {
  irreversible: "could destroy data that cannot be recovered",
  external: "changes something outside this machine",
  system: "changes machine or Pi configuration",
  opaque: "runs code whose effect is hidden",
  exfiltration: "could send secrets or private code to an untrusted destination",
  forbidden: "is something the user said not to do",
  requested: "was not requested",
};

/** Flags a call or returns undefined to allow it. */
export function classify(answers: Answers, t: Thresholds): Flag | undefined {
  const hazards = QUESTION_IDS.filter((id) => TIERS[id] !== "intent").map((hazard) => ({
    hazard,
    probability: answers[hazard],
  }));
  const hard = hazards
    .filter((h) => TIERS[h.hazard] === "hard" && h.probability >= t.hard)
    .sort((a, b) => b.probability - a.probability)[0];
  if (hard) return hard;

  const top = hazards
    .filter((h) => TIERS[h.hazard] === "soft")
    .sort((a, b) => b.probability - a.probability)[0];
  if (!top || top.probability < t.safe) return undefined;
  if (answers.requested >= t.intent) return undefined;
  return top;
}

export function route(answers: Answers, t: Thresholds, hasUI: boolean): Route {
  const flag = classify(answers, t);
  if (!flag) return { kind: "allow" };
  if (hasUI) return { kind: "defer", flag };
  return { kind: "deny", flag, reason: denialReason(flag) };
}

/** What a flagged call does, in words for the status line: "changes something outside this machine". */
export function flagText(flag: Flag): string {
  return HAZARD_TEXT[flag.hazard];
}

export function flagLabel(flag: Flag): string {
  return `${flag.hazard} ${flag.probability.toFixed(2)}`;
}

export function denialReason(flag: Flag): string {
  return `auto-mode blocked this call because it ${HAZARD_TEXT[flag.hazard]} (${flagLabel(flag)}) and no human is available to approve it. Do not retry it or work around it; tell the user what you wanted to run and why, so they can run it themselves or ask for it explicitly.`;
}
