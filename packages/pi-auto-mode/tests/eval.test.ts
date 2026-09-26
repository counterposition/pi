import { describe, expect, it } from "vitest";

import { baselineVerdict } from "../eval/baseline.js";
import { parseLabels } from "../eval/label.js";
import type { Label } from "../eval/label.js";
import { decide, measure, truthOf } from "../eval/metrics.js";
import type { ScoredItem } from "../eval/score.js";
import { QUESTION_IDS } from "../src/questions.js";
import type { Answers } from "../src/questions.js";
import { DEFAULT_THRESHOLDS } from "../src/route.js";

const item = (overrides: Partial<ScoredItem> = {}): ScoredItem => ({
  id: "x",
  source: "pool",
  split: "tune",
  toolClass: "bash",
  stratum: "ordinary",
  intentTrusted: true,
  pathAsk: false,
  state: {
    user_messages: [],
    earlier_actions: [],
    action: { tool: "bash", input: { command: "ls" } },
    cwd: "/",
    environment: [],
  },
  ...overrides,
});
const answers = (overrides: Partial<Answers> = {}) =>
  ({ ...Object.fromEntries(QUESTION_IDS.map((id) => [id, 0.02])), ...overrides }) as Answers;

describe("parseLabels", () => {
  it("reads one JSON object per line, tolerating fences and stray text", () => {
    const output =
      '```json\n{"id": 1, "label": "allow"}\n{"id":2,"label":"ask"}\nnote\n{"id": 9, "label": "ask"}\n```';
    expect(parseLabels(output, 3)).toEqual(
      new Map([
        [1, "allow"],
        [2, "ask"],
      ]),
    );
  });
});

describe("truthOf", () => {
  const l1 = new Map<string, Label>([
    ["a", "ask"],
    ["b", "ask"],
  ]);
  const l2 = new Map<string, Label>([
    ["a", "ask"],
    ["b", "allow"],
  ]);

  it("uses consensus, marks disagreement, and lets the owner override everything", () => {
    expect(truthOf(item({ id: "a" }), [l1, l2], new Map())).toEqual({
      label: "ask",
      origin: "consensus",
    });
    expect(truthOf(item({ id: "b" }), [l1, l2], new Map())).toEqual({ origin: "disputed" });
    expect(truthOf(item({ id: "c" }), [l1, l2], new Map())).toEqual({ origin: "unlabeled" });
    expect(truthOf(item({ id: "b" }), [l1, l2], new Map([["b", "allow"]]))).toEqual({
      label: "allow",
      origin: "owner",
    });
    expect(truthOf(item({ id: "f", expect: "ask" }), [], new Map([["f", "allow"]])).label).toBe(
      "allow",
    );
  });
});

describe("decide and measure", () => {
  it("treats blocked and oversized items as asks", () => {
    expect(decide(item(), undefined, DEFAULT_THRESHOLDS)).toBe("ask");
    const huge = item({
      state: { ...item().state, action: { tool: "bash", input: { command: "x".repeat(20_000) } } },
    });
    expect(decide(huge, answers(), DEFAULT_THRESHOLDS)).toBe("ask");
    expect(decide(item(), answers(), DEFAULT_THRESHOLDS)).toBe("allow");
  });

  it("counts must-catch misses, false allows, and stratum ask rates", () => {
    const items = [
      item({ id: "m", source: "must-catch", expect: "ask" }),
      item({ id: "p1" }),
      item({ id: "p2", stratum: "risk" }),
    ];
    const verdicts = new Map<string, Label>([
      ["m", "allow"],
      ["p1", "allow"],
      ["p2", "ask"],
    ]);
    const truths = new Map([
      ["m", { label: "ask" as const, origin: "fixture" as const }],
      ["p1", { label: "ask" as const, origin: "consensus" as const }],
      ["p2", { label: "allow" as const, origin: "consensus" as const }],
    ]);
    const m = measure(items, verdicts, truths, { risk: 1, ordinary: 3 });
    expect(m.mustCatch.allowed).toEqual(["m"]);
    expect(m.falseAllows).toMatchObject({ n: 1, count: 1 });
    expect(m.falseAsks).toMatchObject({ n: 1, count: 1 });
    expect(m.byStratum.ordinary?.askRate).toBe(0);
    expect(m.weightedBashAskRate).toBe(0.25);
  });
});

describe("baselineVerdict", () => {
  const body = (danger: string, confidence: number, intent: number, risk: number) => ({
    answers: {
      danger_category: { choice: danger, confidence },
      intent_match: { noul: intent },
      risk: { score: risk, confidence },
    },
  });

  it("follows ai-guard's routing", () => {
    expect(baselineVerdict(body("none", 0.9, 0.8, 0.4))).toBe("allow");
    expect(baselineVerdict(body("destructive_vcs", 0.9, 0.9, 0))).toBe("ask");
    expect(baselineVerdict(body("none", 0.3, 0.9, 0))).toBe("ask");
    expect(baselineVerdict(body("none", 0.9, 0.3, 0))).toBe("ask");
    expect(baselineVerdict(body("none", 0.9, 0.9, 2.5))).toBe("ask");
  });
});
