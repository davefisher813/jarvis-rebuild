import { describe, it, expect } from "vitest";
import { ateBeforeMarks, ateBeforeCountLine, ateBeforeForDate, tookItTimeline, callItHistory, stillThere } from "./timelines";
import type { AteBeforeEntry, CallItEntry, PointAtItEntry, TookItEntry } from "./types";

describe("Ate Before: marks, never a fraction", () => {
  const entries: AteBeforeEntry[] = [
    { id: "1", data: { category: "fuel", date: "2026-08-03", ate: true, at: 1 } },
    { id: "2", data: { category: "fuel", date: "2026-08-01", ate: false, at: 1 } },
    { id: "3", data: { category: "fuel", date: "2026-08-02", ate: true, at: 1 } },
  ];

  it("sorts marks by date, one row per answered event", () => {
    const marks = ateBeforeMarks(entries);
    expect(marks.map((m) => m.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(marks.map((m) => m.ate)).toEqual([false, true, true]);
  });

  it("the count line names what happened, never a total to fall short of", () => {
    const line = ateBeforeCountLine(ateBeforeMarks(entries));
    expect(line).toBe("2 Days Marked Eaten");
    // The banned shape, structurally: no "of" pairing a count with a total.
    expect(line).not.toMatch(/\d+\s+of\s+\d+/);
  });

  it("singular reads naturally", () => {
    expect(ateBeforeCountLine(ateBeforeMarks(entries.slice(0, 1)))).toBe("1 Day Marked Eaten");
  });

  it("looks up a single date directly", () => {
    expect(ateBeforeForDate(entries, "2026-08-02")?.ate).toBe(true);
    expect(ateBeforeForDate(entries, "2026-09-01")).toBeUndefined();
  });
});

describe("Took It: a timeline, never a miss count", () => {
  it("returns taps in order with no notion of an expected schedule", () => {
    const entries: TookItEntry[] = [
      { id: "1", data: { category: "medication", at: 2000 } },
      { id: "2", data: { category: "medication", at: 1000 } },
    ];
    const line = tookItTimeline(entries);
    expect(line.map((m) => m.at)).toEqual([1000, 2000]);
    // The function's own input never carries a target to miss.
    expect(entries[0]!.data).not.toHaveProperty("expected");
    expect(entries[0]!.data).not.toHaveProperty("scheduledAt");
  });
});

describe("Call It: plain history, feeds nothing else", () => {
  it("returns raw points, no rolling average or derived verdict", () => {
    const entries: CallItEntry[] = [
      { id: "1", data: { category: "load", rpe: 7, at: 2000 } },
      { id: "2", data: { category: "load", rpe: 3, at: 1000 } },
    ];
    const hist = callItHistory(entries);
    expect(hist).toEqual([
      { at: 1000, rpe: 3, durationMin: undefined },
      { at: 2000, rpe: 7, durationMin: undefined },
    ]);
  });
});

describe("Still There?: a counted pattern, never a diagnosis", () => {
  const tap = (dayOffset: number, x = 0.5, y = 0.5): PointAtItEntry => ({
    id: String(dayOffset),
    data: { category: "body", x, y, side: "front", at: Date.parse("2026-08-01T00:00:00Z") + dayOffset * 86400000 },
  });

  it("stays silent below the session threshold", () => {
    expect(stillThere([tap(0), tap(1)], 3)).toEqual([]);
  });

  it("surfaces a cluster once it spans enough distinct days", () => {
    const out = stillThere([tap(0), tap(3), tap(11)], 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.sessions).toBe(3);
    expect(out[0]!.days).toBe(12);
    expect(out[0]!.side).toBe("front");
  });

  it("does not name a body part, a condition, or a diagnosis", () => {
    const out = stillThere([tap(0), tap(3), tap(11)], 3);
    const s = JSON.stringify(out).toLowerCase();
    for (const word of ["fracture", "sprain", "concussion", "tear", "shin splint", "tendinitis"]) {
      expect(s).not.toContain(word);
    }
  });

  it("two different spots do not merge into one pattern", () => {
    const out = stillThere([tap(0, 0.1, 0.1), tap(1, 0.1, 0.1), tap(2, 0.1, 0.1), tap(3, 0.9, 0.9), tap(4, 0.9, 0.9), tap(5, 0.9, 0.9)], 3);
    expect(out).toHaveLength(2);
  });

  it("two taps the same day count as one session, not two", () => {
    const sameDayTwice: PointAtItEntry = { id: "x", data: { category: "body", x: 0.5, y: 0.5, side: "front", at: tap(0).data.at + 3600000 } };
    const out = stillThere([tap(0), sameDayTwice, tap(3), tap(11)], 3);
    expect(out[0]!.sessions).toBe(3);
  });
});
