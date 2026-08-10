// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { learnedDurations, readCommittedDurations, type CommittedDuration } from "./learnedDurations";
import { emit, eventLog } from "../events";

const NOW = 1_700_000_000_000;
const DAY = 86400000;
const s = (category: string, minutes: number, daysAgo = 0): CommittedDuration => ({ category, minutes, ts: NOW - daysAgo * DAY });

describe("learnedDurations", () => {
  it("needs three samples before it says anything: silence beats a guess", () => {
    expect(learnedDurations([s("work", 60), s("work", 60)], NOW)).toEqual({});
  });

  it("takes the median so one runaway afternoon cannot skew a category", () => {
    expect(learnedDurations([s("work", 30), s("work", 45), s("work", 180)], NOW)).toEqual({ work: 45 });
  });

  it("snaps to the stepper's step and clamps to its range", () => {
    // median 50 -> 45; a category living at 10 minutes floors to 15.
    expect(learnedDurations([s("work", 50), s("work", 50), s("work", 50)], NOW)).toEqual({ work: 45 });
    expect(learnedDurations([s("q", 10), s("q", 10), s("q", 10)], NOW)).toEqual({ q: 15 });
  });

  it("forgets samples older than 30 days", () => {
    expect(learnedDurations([s("work", 60, 40), s("work", 60, 45), s("work", 60, 50)], NOW)).toEqual({});
  });

  it("learns each category on its own evidence", () => {
    const out = learnedDurations(
      [s("work", 60), s("work", 60), s("work", 60), s("gym", 90), s("gym", 90)],
      NOW,
    );
    expect(out).toEqual({ work: 60 }); // gym has only 2 samples: silence
  });
});

describe("readCommittedDurations", () => {
  beforeEach(() => { eventLog.clear(); });

  it("reads plan.duration_committed back and ignores noise and junk", () => {
    emit({ type: "plan.duration_committed", entityType: "task", entityId: "t1", props: { category: "work", n: 45 } });
    emit({ type: "plan.duration_committed", entityType: "task", entityId: "t2", props: { category: "", n: 45 } }); // no category: dropped
    emit({ type: "plan.picked", entityType: "task", entityId: "t3", props: { n: 1 } }); // noise
    const out = readCommittedDurations();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: "work", minutes: 45 });
  });
});
