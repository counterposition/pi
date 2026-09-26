import { describe, expect, it } from "vitest";

import type { Answers } from "../src/questions.js";
import { classify, route } from "../src/route.js";
import type { Thresholds } from "../src/route.js";

const t: Thresholds = { safe: 0.3, intent: 0.8, hard: 0.5 };

const answers = (overrides: Partial<Answers> = {}): Answers => ({
  irreversible: 0.02,
  external: 0.02,
  system: 0.02,
  opaque: 0.02,
  exfiltration: 0.02,
  forbidden: 0.02,
  requested: 0.1,
  ...overrides,
});

describe("classify", () => {
  it("allows a call with no hazard", () => {
    expect(classify(answers(), t)).toBeUndefined();
  });

  it("flags the top soft hazard when the user did not ask", () => {
    expect(classify(answers({ irreversible: 0.9, external: 0.6 }), t)).toEqual({
      hazard: "irreversible",
      probability: 0.9,
    });
  });

  it("allows a soft hazard the user asked for", () => {
    expect(classify(answers({ external: 0.95, requested: 0.85 }), t)).toBeUndefined();
  });

  it("flags a hard hazard even when the user asked", () => {
    expect(classify(answers({ exfiltration: 0.6, requested: 0.99 }), t)).toEqual({
      hazard: "exfiltration",
      probability: 0.6,
    });
  });

  it("treats the thresholds as inclusive for flags and exclusive for allows", () => {
    expect(classify(answers({ system: 0.3 }), t)?.hazard).toBe("system");
    expect(classify(answers({ system: 0.3, requested: 0.8 }), t)).toBeUndefined();
    expect(classify(answers({ exfiltration: 0.5 }), t)?.hazard).toBe("exfiltration");
  });

  it("flags a routine call the user said not to make", () => {
    expect(classify(answers({ forbidden: 0.9, requested: 0.02 }), t)?.hazard).toBe("forbidden");
    expect(classify(answers({ forbidden: 0.9, requested: 0.99 }), t)?.hazard).toBe("forbidden");
  });

  it("does not treat a below-threshold hard hazard as a soft one", () => {
    expect(classify(answers({ exfiltration: 0.45 }), t)).toBeUndefined();
  });
});

describe("route", () => {
  it("allows safe calls with or without a UI", () => {
    expect(route(answers(), t, true)).toEqual({ kind: "allow" });
    expect(route(answers(), t, false)).toEqual({ kind: "allow" });
  });

  it("defers a flagged call to the dialog when there is a UI", () => {
    expect(route(answers({ opaque: 0.9 }), t, true)).toEqual({
      kind: "defer",
      flag: { hazard: "opaque", probability: 0.9 },
    });
  });

  it("denies a flagged call headless, naming the hazard for the model", () => {
    const result = route(answers({ external: 0.93 }), t, false);
    expect(result.kind).toBe("deny");
    expect(result.kind === "deny" && result.reason).toContain("external 0.93");
  });
});
