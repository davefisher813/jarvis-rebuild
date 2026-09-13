import { describe, it, expect } from "vitest";
import { chronologicalLog, dayBounds } from "./log";
import type { Workout } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";

// Health Push C, H-48 (2026-09-12): today's entries, in order, from the
// same records the tiles read.
const DAY = "2026-09-13";
const t = (h: number, m = 0) => new Date(`${DAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();

const workout = (id: string, date: string, endedAt: number): Workout =>
  ({ id, data: { programId: "p", dayId: "d", dayName: "Push Day", date, startedAt: endedAt - 48 * 60_000, endedAt, exercises: [] } }) as Workout;
const def = (id: string, name: string, type: MetricDef["data"]["type"], unit?: string, hidden = false): MetricDef =>
  ({ id, data: { name, type, unit, hidden } }) as MetricDef;
const log = (id: string, metricId: string, date: string, at: number, value: number): MetricLog =>
  ({ id, data: { metricId, date, at, value } }) as MetricLog;

describe("dayBounds", () => {
  it("covers the local day from midnight to midnight", () => {
    const b = dayBounds(DAY);
    expect(b.start).toBe(t(0));
    expect(b.end - b.start).toBe(24 * 60 * 60_000);
  });
});

describe("chronologicalLog", () => {
  it("lists today's entries oldest first, in their own hues, with the way back", () => {
    const rows = chronologicalLog({
      day: DAY,
      lightsOut: [{ id: "l1", data: { category: "sleep", at: t(23, 5) } }, { id: "l0", data: { category: "sleep", at: t(23) - 86_400_000 } }] as never,
      tookIt: [{ id: "k1", data: { category: "medication", at: t(8, 5) } }] as never,
      callIt: [{ id: "c1", data: { category: "session", rpe: 7, at: t(18, 30) } }] as never,
      pointAtIt: [],
      workouts: [workout("w1", DAY, t(18)), workout("w0", "2026-09-12", t(18) - 86_400_000)],
      metricDefs: [def("m1", "Sleep", "number", "hrs"), def("m2", "Hidden", "number", "x", true)],
      metricLogs: [log("g1", "m1", DAY, t(7), 7.5), log("g2", "m2", DAY, t(7, 10), 1), log("g3", "m1", "2026-09-12", t(7) - 86_400_000, 6)],
    });
    expect(rows.map((r) => [r.title, r.kind, r.detail])).toEqual([
      ["Sleep", "reading", "7.5 hrs"],
      ["Dose", "medication", null],
      ["Push Day", "sets", "48 Min"],
      ["Session Effort", "reading", "7/10"],
      ["Bedtime", "sleep", null],
    ]);
    expect(rows[1]!.open).toEqual({ kind: "tookIt" });
    expect(rows[2]!.open).toEqual({ kind: "workout", id: "w1" });
    expect(rows[0]!.open).toEqual({ kind: "metric", defId: "m1" });
  });
  it("is empty on a day with nothing written", () => {
    expect(chronologicalLog({ day: DAY, lightsOut: [], tookIt: [], callIt: [], pointAtIt: [], workouts: [], metricDefs: [], metricLogs: [] })).toEqual([]);
  });
});
