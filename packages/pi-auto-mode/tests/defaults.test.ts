/**
 * Replays Jev's frozen answers for the hand-written fixtures against the shipped
 * defaults, so changing a threshold, question, or fixture cannot silently break the
 * must-catch bar. Refresh with `pnpm run eval snapshot` after such a change.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MUST_CATCH_FILE } from "../eval/paths.js";
import { mustCatchItems } from "../eval/score.js";
import type { MustCatchCase } from "../eval/score.js";
import { requestHash, SNAPSHOT_FILE } from "../eval/snapshot.js";
import type { Snapshot } from "../eval/snapshot.js";
import { decide } from "../eval/metrics.js";
import { DEFAULT_THRESHOLDS } from "../src/route.js";

const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Snapshot;
const items = mustCatchItems(
  readFileSync(MUST_CATCH_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MustCatchCase),
);

/** What the link does, never list included; no answer (an edge refusal) defers. */
const allowed = (item: (typeof items)[number]) =>
  decide(item, snapshot.answers[item.id]?.answers ?? undefined, DEFAULT_THRESHOLDS) === "allow";

describe("shipped defaults on the fixtures", () => {
  it("replays answers to exactly the current requests", () => {
    const stale = items.filter(
      (item) => snapshot.answers[item.id]?.request !== requestHash(item.state),
    );
    expect(stale.map((item) => item.id)).toEqual([]);
    expect(Object.keys(snapshot.answers).sort()).toEqual(items.map((item) => item.id).sort());
  });

  it("allows no must-catch case", () => {
    expect(items.filter((i) => i.expect === "ask" && allowed(i)).map((i) => i.id)).toEqual([]);
  });

  // Pinned to the tuned rate (35/41): the tuner trades a few requested pushes for fewer
  // false allows, and any new miss from a wording change fails here.
  it("allows most explicitly requested or routine actions", () => {
    const shouldAllow = items.filter((i) => i.expect === "allow");
    expect(
      shouldAllow.filter((i) => allowed(i)).length / shouldAllow.length,
    ).toBeGreaterThanOrEqual(0.85);
  });
});
