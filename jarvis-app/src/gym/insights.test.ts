import { describe, expect, it } from "vitest";
import {
  correlate, INSIGHT_MIN_PAIRED, plateauFlag, PLATEAU_MIN_SESSIONS,
  hardSetRows, muscleMapFromProgram, backOffSignal, shouldOfferLighterWeek, BACK_OFF_OFFER_RATIO,
} from "./insights";
import { liftSessions } from "./chartData";
import type { Workout, SetEntry, WorkoutExercise, Program } from "./types";
import type { MetricDef, MetricLog } from "./metrics";

let n = 0;
const set = (extra: Partial<SetEntry>): SetEntry => ({ id: `s${n++}`, ...extra });
function workout(date: string, exercises: WorkoutExercise[]): Workout {
  return { id: `w${n++}`, data: { programId: "p1", dayId: "d1", dayName: "Push", date, startedAt: 0, endedAt: 0, exercises } };
}
const day = (i: number) => `2026-08-${String(i + 1).padStart(2, "0")}`;
const pushups = (i: number, r: number): Workout => workout(day(i), [{ exerciseId: "e1", name: "Pushups", kind: "reps", sets: [set({ r })] }]);

const metricDef = (id: string, over: Partial<MetricDef["data"]> = {}): MetricDef =>
  ({ id, data: { name: "Sleep", type: "number", unit: "hrs", createdOn: "2026-08-01", ...over } });
const metricLog = (metricId: string, date: string, value: number): MetricLog =>
  ({ id: `l${n++}`, data: { metricId, date, value, at: 0 } });

describe("correlate", () => {
  it("below the paired-session threshold, no card at all", () => {
    const h = [pushups(0, 100), pushups(1, 110)];
    const sessions = liftSessions(h, "Pushups", "reps");
    const def = metricDef("sleep");
    const logs = [metricLog("sleep", day(1), 8)];
    expect(correlate(sessions, "reps", "Pushups", def, logs)).toBeNull();
  });

  it("past the threshold, splits at the sample's own median and reports the higher-group edge", () => {
    const deltas = [10, 2, 10, 2, 10, 2, 10, 2, 10, 2, 10]; // 11 deltas -> 12 sessions
    const sleeps = [9, 4, 8.5, 4.5, 8, 5, 7.5, 5.5, 7, 6, 6.5];
    let r = 100;
    const h: Workout[] = [pushups(0, r)];
    const logs: MetricLog[] = [];
    deltas.forEach((d, idx) => {
      r += d;
      h.push(pushups(idx + 1, r));
      logs.push(metricLog("sleep", day(idx + 1), sleeps[idx]!));
    });
    const sessions = liftSessions(h, "Pushups", "reps");
    expect(sessions.length).toBe(12);
    const def = metricDef("sleep");
    const insight = correlate(sessions, "reps", "Pushups", def, logs);
    expect(insight).not.toBeNull();
    expect(insight!.pairedSessions).toBe(11);
    expect(insight!.pairedSessions).toBeGreaterThanOrEqual(INSIGHT_MIN_PAIRED);
    // Sessions logged with more sleep gained more, every time by design.
    expect(insight!.deltaDiff).toBeGreaterThan(0);
    expect(insight!.line).toMatch(/Correlation, not cause/);
  });

  it("a metric with no split available (everyone the same) never renders a link", () => {
    const h: Workout[] = [pushups(0, 100)];
    const logs: MetricLog[] = [];
    for (let i = 1; i <= 11; i++) { h.push(pushups(i, 100 + i)); logs.push(metricLog("sleep", day(i), 7)); }
    const sessions = liftSessions(h, "Pushups", "reps");
    const insight = correlate(sessions, "reps", "Pushups", metricDef("sleep"), logs);
    expect(insight).toBeNull(); // every value equals the median -> no group clears the 3-session floor
  });
});

describe("plateauFlag", () => {
  it("under the minimum flat stretch, no flag", () => {
    const rs = [100, 110, 120, 115, 118]; // only 2 flat sessions after the peak
    const h = rs.map((r, i) => pushups(i, r));
    const sessions = liftSessions(h, "Pushups", "reps");
    expect(plateauFlag(sessions, "reps", "Pushups", h)).toBeNull();
  });

  it("flags at exactly the minimum, and the what-changed rows compare real numbers", () => {
    // Climb (idx 0-2, moving window), peak at idx 2 = 120, then 6 flat sessions.
    const climb = [100, 110, 120];
    const flat = [115, 118, 120, 112, 119, 117]; // never exceeds 120
    const rs = [...climb, ...flat];
    const h = rs.map((r, i) => pushups(i, r));
    // Different working-set counts either side, so "Sets a Session" has a real number.
    h.slice(0, 3).forEach((w) => { w.data.exercises[0]!.sets.push(set({ r: 1 }), set({ r: 1 }), set({ r: 1 }), set({ r: 1 })); }); // 5 sets total, moving window
    h.slice(3).forEach((w) => { w.data.exercises[0]!.sets.push(set({ r: 1 }), set({ r: 1 })); }); // 3 sets total, flat window
    const sessions = liftSessions(h, "Pushups", "reps");
    const flag = plateauFlag(sessions, "reps", "Pushups", h);
    expect(flag).not.toBeNull();
    expect(flag!.flatSessions).toBe(PLATEAU_MIN_SESSIONS);
    expect(flag!.peakValue).toBe(120);
    const setsRow = flag!.whatChanged.find((r) => r.label === "Sets a Session");
    expect(setsRow).toBeDefined();
    expect(setsRow!.moving).toBe(5);
    expect(setsRow!.flat).toBe(3);
  });

  it("a metric row appears only with at least 2 points on each side", () => {
    const climb = [100, 110, 120];
    const flat = [115, 118, 120, 112, 119, 117];
    const rs = [...climb, ...flat];
    const h = rs.map((r, i) => pushups(i, r));
    const sessions = liftSessions(h, "Pushups", "reps");
    const def = metricDef("sleep");
    const logsThin = [metricLog("sleep", day(0), 8)]; // one point total -- never enough
    const flagThin = plateauFlag(sessions, "reps", "Pushups", h, [{ def, logs: logsThin }]);
    expect(flagThin!.whatChanged.some((r) => r.label === "Sleep")).toBe(false);

    const logsFull = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => metricLog("sleep", day(i), i < 3 ? 8 : 5));
    const flagFull = plateauFlag(sessions, "reps", "Pushups", h, [{ def, logs: logsFull }]);
    const row = flagFull!.whatChanged.find((r) => r.label === "Sleep");
    expect(row).toBeDefined();
    expect(row!.moving).toBe(8);
    expect(row!.flat).toBe(5);
  });
});

describe("hardSetRows", () => {
  it("zero is a verdict: a muscle with nothing this week gets no row", () => {
    const program: Program = { id: "p1", data: { name: "Prog", weeks: [{ id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench", kind: "weight_reps", sets: [], muscleGroup: "chest" }, { id: "e2", name: "Squat", kind: "weight_reps", sets: [], muscleGroup: "quads" }] }] }] } };
    const map = muscleMapFromProgram(program);
    const now = new Date("2026-08-31T12:00:00").getTime();
    const h = [workout("2026-08-30", [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: [set({ w: 100, r: 5 })] }])];
    const rows = hardSetRows(h, map, now);
    expect(rows.map((r) => r.muscle)).toEqual(["chest"]); // Squat never logged this week
    expect(rows[0]!.range.low).toBe(10);
  });

  it("outside the rolling 7-day window, sets don't count", () => {
    const map = new Map([["Bench", "chest" as const]]);
    const now = new Date("2026-08-31T12:00:00").getTime();
    const h = [workout("2026-08-10", [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: [set({ w: 100, r: 5 })] }])];
    expect(hardSetRows(h, map, now)).toEqual([]);
  });
});

describe("backOffSignal / shouldOfferLighterWeek", () => {
  it("too few marked sets says nothing at all", () => {
    const h = [pushups(0, 100)];
    h[0]!.data.exercises[0]!.sets = [set({ r: 10, moved: "grind" })];
    expect(backOffSignal(h, new Date("2026-08-05").getTime())).toBeNull();
  });

  it("offers a lighter week only once the grind/miss ratio clears the bar", () => {
    const now = new Date("2026-08-10").getTime();
    const marks: ("clean" | "grind" | "missed")[] = ["grind", "grind", "grind", "clean", "clean", "clean"]; // 3 of 6 = 0.5
    const h = marks.map((m, i) => {
      const w = pushups(i, 100);
      w.data.exercises[0]!.sets = [set({ r: 10, moved: m })];
      return w;
    });
    const sig = backOffSignal(h, now);
    expect(sig).not.toBeNull();
    expect(sig!.grindsAndMisses / sig!.total).toBeGreaterThanOrEqual(BACK_OFF_OFFER_RATIO);
    expect(shouldOfferLighterWeek(sig)).toBe(true);
  });

  it("mostly clean sets never trigger the offer", () => {
    const now = new Date("2026-08-10").getTime();
    const marks: ("clean" | "grind" | "missed")[] = ["clean", "clean", "clean", "clean", "clean", "grind"];
    const h = marks.map((m, i) => {
      const w = pushups(i, 100);
      w.data.exercises[0]!.sets = [set({ r: 10, moved: m })];
      return w;
    });
    expect(shouldOfferLighterWeek(backOffSignal(h, now))).toBe(false);
  });
});
