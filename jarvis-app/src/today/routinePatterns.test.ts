import { describe, it, expect } from "vitest";
import { routineBlockCandidate } from "./routinePatterns";
import { DEFAULT_ROUTINE } from "../routine/types";
import type { EventItem } from "../schedule/types";

// The routine that builds itself: repeated one-off events offer themselves as
// routine blocks. Evidence-gated like every other observation in the app.

const NOW = new Date("2026-08-09T12:00:00").getTime();

// days-ago helper anchored to NOW, local-safe
function dISO(daysAgo: number): string {
  return new Date(NOW - daysAgo * 86400000).toISOString().slice(0, 10);
}
const ev = (id: string, title: string, date: string, start: string, end?: string, extra: Record<string, unknown> = {}): EventItem =>
  ({ id, data: { title, date, start, category: "", ...(end ? { end } : {}), ...extra } }) as EventItem;

const gymWeek = (weeksAgo: number) => ev("g" + weeksAgo, "Gym", dISO(weeksAgo * 7), "06:00", "07:00");

describe("routineBlockCandidate", () => {
  it("offers a block after three similar one-off events", () => {
    const c = routineBlockCandidate([gymWeek(1), gymWeek(2), gymWeek(3)], DEFAULT_ROUTINE, NOW);
    expect(c).not.toBeNull();
    expect(c!.text).toContain("Gym · around 6 AM"); // SPEC MOVED (short copy, 2026-08-15)
    expect(c!.text).toContain("times this month");
    expect(c!.block).toMatchObject({ label: "Gym", startMin: 360, endMin: 420 });
    expect(c!.block.days.length).toBeGreaterThan(0);
  });

  it("two occurrences are a coincidence, not a routine", () => {
    expect(routineBlockCandidate([gymWeek(1), gymWeek(2)], DEFAULT_ROUTINE, NOW)).toBeNull();
  });

  it("scattered start times are not a routine either", () => {
    const evs = [
      ev("a", "Errands", dISO(2), "09:00"),
      ev("b", "Errands", dISO(9), "14:00"),
      ev("c", "Errands", dISO(16), "19:00"),
    ];
    expect(routineBlockCandidate(evs, DEFAULT_ROUTINE, NOW)).toBeNull();
  });

  it("recurring events and planner-created blocks never count as evidence", () => {
    const evs = [
      ev("r1", "Standup", dISO(1), "09:00", "09:15", { recurrence: "daily" }),
      ev("r2", "Standup", dISO(2), "09:00", "09:15", { recurrence: "daily" }),
      ev("r3", "Standup", dISO(3), "09:00", "09:15", { recurrence: "daily" }),
      ev("p1", "Write report", dISO(1), "10:00", "11:00", { sourceTaskId: "t1" }),
      ev("p2", "Write report", dISO(2), "10:00", "11:00", { sourceTaskId: "t1" }),
      ev("p3", "Write report", dISO(3), "10:00", "11:00", { sourceTaskId: "t1" }),
    ];
    expect(routineBlockCandidate(evs, DEFAULT_ROUTINE, NOW)).toBeNull();
  });

  it("stays quiet when the routine already covers that time", () => {
    const routine = {
      ...DEFAULT_ROUTINE,
      protectedBlocks: [{ id: "x", label: "Morning workout", startMin: 350, endMin: 430, days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    expect(routineBlockCandidate([gymWeek(1), gymWeek(2), gymWeek(3)], routine, NOW)).toBeNull();
  });

  it("carries a location when the events had one", () => {
    const evs = [
      ev("a", "Gym", dISO(1), "06:00", "07:00", { location: "Cortland YMCA" }),
      ev("b", "Gym", dISO(8), "06:00", "07:00"),
      ev("c", "Gym", dISO(15), "06:00", "07:00", { location: "Cortland YMCA" }),
    ];
    expect(routineBlockCandidate(evs, DEFAULT_ROUTINE, NOW)!.block.location).toBe("Cortland YMCA");
  });

  it("forgets events older than the 28-day window", () => {
    expect(routineBlockCandidate([gymWeek(5), gymWeek(6), gymWeek(7)], DEFAULT_ROUTINE, NOW)).toBeNull();
  });
});
