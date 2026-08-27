import { describe, it, expect } from "vitest";
import { weekShape } from "./weekShape";
import type { SportSession } from "./loadCandidates";

const WEEK = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];

describe("weekShape", () => {
  it("returns exactly one row per date handed in, no invented week boundary", () => {
    const shape = weekShape([], WEEK);
    expect(shape.days).toHaveLength(7);
    expect(shape.days.map((d) => d.date)).toEqual(WEEK);
  });

  it("counts sessions and hours per day, honestly, no ratio or target field", () => {
    const sessions: SportSession[] = [
      { date: "2026-08-25", org: "School Team", durationMin: 90 },
      { date: "2026-08-25", org: "Travel Team", durationMin: 60 },
      { date: "2026-08-27", org: "School Team", durationMin: 45 },
    ];
    const shape = weekShape(sessions, WEEK);
    const mon = shape.days.find((d) => d.date === "2026-08-25")!;
    expect(mon.sessions).toBe(2);
    expect(mon.hours).toBe(2.5);
    expect(shape.totalSessions).toBe(3);
    expect(Object.keys(shape).sort()).toEqual(["days", "daysWithNone", "totalHours", "totalSessions"]);
  });

  it("counts which days had none, without framing it as a decline", () => {
    const sessions: SportSession[] = [{ date: "2026-08-25", org: "School Team", durationMin: 60 }];
    const shape = weekShape(sessions, WEEK);
    expect(shape.daysWithNone).toBe(6);
  });
});
