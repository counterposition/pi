import { describe, expect, it } from "vitest";

import {
  MEMORY_DECISION_CONTRACT,
  buildInjectedPrompt,
  buildOrientationSummary,
} from "../src/prompt.js";

describe("buildOrientationSummary", () => {
  it("returns an empty summary for no topics", () => {
    const summary = buildOrientationSummary([]);

    expect(summary.totalTopics).toBe(0);
    expect(summary.topicNames).toEqual([]);
    expect(summary.text).toBe("Memory: 0 topics. Use memory_search to find specific memories.");
  });

  it("uses singular wording for one topic", () => {
    const summary = buildOrientationSummary(["build"]);

    expect(summary.totalTopics).toBe(1);
    expect(summary.text).toContain("Memory: 1 topic (build).");
    expect(summary.text).not.toContain("1 topics");
  });

  it("lists up to five topics without overflow", () => {
    const summary = buildOrientationSummary([
      "build",
      "testing",
      "preferences",
      "architecture",
      "workflow",
    ]);

    expect(summary.totalTopics).toBe(5);
    expect(summary.topicNames).toEqual([
      "architecture",
      "build",
      "preferences",
      "testing",
      "workflow",
    ]);
    expect(summary.text).toContain("(architecture, build, preferences, testing, workflow).");
    expect(summary.text).not.toContain("more");
  });

  it("deduplicates, filters, sorts, and shows overflow", () => {
    const summary = buildOrientationSummary([
      "testing",
      "",
      "build",
      "build",
      "workflow",
      "zeta",
      "alpha",
      "architecture",
    ]);

    expect(summary.totalTopics).toBe(6);
    expect(summary.topicNames).toEqual([
      "alpha",
      "architecture",
      "build",
      "testing",
      "workflow",
      "zeta",
    ]);
    expect(summary.text).toContain("(alpha, architecture, build, testing, workflow, +1 more).");
  });
});

describe("buildInjectedPrompt", () => {
  it("replaces the orientation placeholder and preserves the contract text", () => {
    const summary = buildOrientationSummary(["build", "testing"]);
    const prompt = buildInjectedPrompt(summary);

    expect(prompt).toContain(
      "Durable memory is available through memory_search, memory_write, and memory_move.",
    );
    expect(prompt).toContain(summary.text);
    expect(prompt).not.toContain("{{orientation_summary}}");
    expect(prompt).toBe(MEMORY_DECISION_CONTRACT.replace("{{orientation_summary}}", summary.text));
  });
});
