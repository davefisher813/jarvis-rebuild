import { describe, it, expect } from "vitest";
import { CAPTURE_GOLD, TRIAGE_GOLD, toThreadRows } from "./goldenSet";
import { scoreCapture, scoreTriage, summarize } from "./score";
import { parseCapture } from "../capture";
import { parseTriage, fillSkipped } from "../../messages/triage";

// The offline half of the golden set: every expected output, rendered the way
// the model would emit it (as tool-call JSON), must ride through the real
// parsers and score 100%. This proves the parsers, schemas, and scorer agree
// on what "right" means; the live harness (tools/ai-harness.mjs) proves the
// model still produces it.

describe("golden set: recorded outputs score 100% through the real parsers", () => {
  it("capture", () => {
    const scores = CAPTURE_GOLD.map((gold) => {
      const modelReply = JSON.stringify(gold.expect);
      return scoreCapture(gold, parseCapture(modelReply));
    });
    const sum = summarize(scores);
    expect(sum.cases.filter((c) => !c.pass)).toEqual([]);
    expect(sum.passed).toBe(CAPTURE_GOLD.length);
  });

  it("triage", () => {
    const scores = TRIAGE_GOLD.map((gold) => {
      const modelReply = JSON.stringify({
        threads: gold.rows.map((r) => {
          const e = gold.expect[r.id]!;
          return { id: r.id, bucket: e.bucket, gist: "Recorded gist for " + r.id, by: e.by ?? "" };
        }),
      });
      return scoreTriage(gold, parseTriage(modelReply, toThreadRows(gold.rows)));
    });
    const sum = summarize(scores);
    expect(sum.cases.filter((c) => !c.pass)).toEqual([]);
    expect(sum.passed).toBe(TRIAGE_GOLD.length);
  });
});

describe("the scorer actually catches wrongness", () => {
  it("flags a wrong bucket and an invented deadline", () => {
    const gold = TRIAGE_GOLD[0]!;
    const wrong = JSON.stringify({
      threads: gold.rows.map((r) => ({ id: r.id, bucket: "noise", gist: "g", by: "tomorrow" })),
    });
    const score = scoreTriage(gold, parseTriage(wrong, toThreadRows(gold.rows)));
    expect(score.pass).toBe(false);
    expect(score.misses.join(" ")).toContain("bucket");
    expect(score.misses.join(" ")).toContain("by");
  });

  it("flags a wrong kind, a wrong date, and an invented category", () => {
    const gold = CAPTURE_GOLD[2]!; // dentist event
    const wrong = JSON.stringify({ kind: "task", title: gold.expect.title, date: "2026-08-23", category: "Work" });
    const score = scoreCapture(gold, parseCapture(wrong));
    expect(score.pass).toBe(false);
    expect(score.misses.length).toBeGreaterThanOrEqual(3);
  });

  it("flags a missing thread instead of skipping it silently", () => {
    const gold = TRIAGE_GOLD[1]!;
    const partial = JSON.stringify({ threads: [{ id: "g4", bucket: "needs_you", gist: "g", by: "" }] });
    const score = scoreTriage(gold, parseTriage(partial, toThreadRows(gold.rows)));
    expect(score.pass).toBe(false);
    expect(score.misses.join(" ")).toContain("g5: missing");
  });

  it("fillSkipped keeps a skipped thread visible, and the scorer sees the coerced bucket", () => {
    const gold = TRIAGE_GOLD[1]!;
    const partial = JSON.stringify({ threads: [{ id: "g4", bucket: "needs_you", gist: "g", by: "" }] });
    const filled = fillSkipped(parseTriage(partial, toThreadRows(gold.rows))!, toThreadRows(gold.rows));
    const score = scoreTriage(gold, filled);
    // g5 lands in worth_knowing (visible, safe) which the gold calls noise:
    // still a miss, but a bucket miss, not a disappearance.
    expect(score.misses).toEqual(["g5 bucket: noise -> worth_knowing"]);
  });
});
