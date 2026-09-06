import { describe, it, expect } from "vitest";
import { ateBeforeMarks, ateBeforeCountLine, tookItTimeline, callItHistory, stillThere, stillThereSummary, stillThereMessage, STILL_THERE_CLOSING } from "./timelines";
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

  // HMN-F-21 (2026-09-05): sessions counted local days while the span was a
  // clock difference, so three taps around two midnights read "3 sessions
  // over 2 days". The span is counted on the same local calendar now.
  it("the day span is never fewer than the sessions, even around midnight", () => {
    const at = (iso: string): PointAtItEntry => ({ id: iso, data: { category: "body", x: 0.5, y: 0.5, side: "front", at: new Date(iso).getTime() } });
    const out = stillThere([at("2026-08-03T23:50:00"), at("2026-08-04T00:10:00"), at("2026-08-05T00:10:00")], 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.sessions).toBe(3);
    expect(out[0]!.days).toBe(3);
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

  it("stillThereSummary produces one dated row per distinct day in the cluster, nothing else", () => {
    const entries = [tap(0), tap(3), tap(11)];
    const [pattern] = stillThere(entries, 3);
    const summary = stillThereSummary(entries, pattern!);
    expect(summary).toHaveLength(3);
    expect(summary.map((r) => r.date)).toEqual(["2026-08-01", "2026-08-04", "2026-08-12"]);
    for (const row of summary) expect(Object.keys(row).sort()).toEqual(["date", "side"]);
  });

  it("stillThereSummary excludes taps from a different pattern's spot", () => {
    const entries = [tap(0, 0.1, 0.1), tap(1, 0.1, 0.1), tap(2, 0.1, 0.1), tap(3, 0.9, 0.9), tap(4, 0.9, 0.9), tap(5, 0.9, 0.9)];
    const patterns = stillThere(entries, 3);
    const summary = stillThereSummary(entries, patterns[0]!);
    expect(summary).toHaveLength(3);
  });

  // UP-ATH-05 (2026-09-06): the message a real person receives.
  it("stillThereMessage writes the side, the count, the span and the dates, and nothing else", () => {
    const entries = [tap(0), tap(3), tap(11)];
    const patterns = stillThere(entries, 3);
    const msg = stillThereMessage(patterns, patterns.map((p) => stillThereSummary(entries, p)));
    expect(msg).toBe("Front, same spot. 3 sessions over 12 days: Aug 1, Aug 4, Aug 12.\n" + STILL_THERE_CLOSING);
  });

  it("stillThereMessage names no body part and states no severity", () => {
    const entries = [tap(0), tap(3), tap(11)];
    const patterns = stillThere(entries, 3);
    const msg = stillThereMessage(patterns, patterns.map((p) => stillThereSummary(entries, p)));
    for (const word of ["knee", "ankle", "shoulder", "hurt", "pain", "injury", "severe", "mild"]) {
      expect(msg.toLowerCase(), word + " must not appear in the one string that leaves the phone").not.toContain(word);
    }
    // And the coordinates themselves never travel either: the spot key is an
    // internal cluster id, not a fact about a person's body.
    expect(msg).not.toContain(patterns[0]!.spotKey);
  });

  it("stillThereMessage is empty when there is no pattern, so nothing can be sent about nothing", () => {
    expect(stillThereMessage([], [])).toBe("");
  });

  it("stillThereMessage covers every pattern on the screen, not only the first", () => {
    const entries = [tap(0, 0.1, 0.1), tap(1, 0.1, 0.1), tap(2, 0.1, 0.1), tap(3, 0.9, 0.9), tap(4, 0.9, 0.9), tap(5, 0.9, 0.9)];
    const patterns = stillThere(entries, 3);
    const msg = stillThereMessage(patterns, patterns.map((p) => stillThereSummary(entries, p)));
    expect(msg.split("\n")).toHaveLength(patterns.length + 1);
    expect(msg.endsWith(STILL_THERE_CLOSING)).toBe(true);
  });
});
