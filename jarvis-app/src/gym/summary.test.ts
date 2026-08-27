import { describe, it, expect } from "vitest";
import { trainingSummary, mondayOf, FRESH_DAYS } from "./summary";
import type { SetLog, Workout, WorkoutData } from "./types";

const T = "2026-08-25"; // a Tuesday
const MS = (iso: string, h = 17) => new Date(iso + "T00:00:00").getTime() + h * 3600000;

// The logged strip is SetEntry[] (each chip carries an id); this stamps one
// on a plain SetLog literal so fixtures stay readable.
let sid = 0;
const sl = (o: SetLog) => [{ id: `s${sid++}`, ...o }];

let n = 0;
function w(date: string, over: Partial<WorkoutData> = {}): Workout {
  n++;
  return {
    id: "w" + n,
    data: {
      programId: "p1", dayId: "d1", dayName: "Push Day", date,
      startedAt: MS(date), endedAt: MS(date) + 47 * 60000,
      exercises: [
        { exerciseId: "e-bench", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: sl({ w: 185, r: 8 }) },
        { exerciseId: "e-rows", name: "Rows", kind: "weight_reps", unit: "lb", sets: sl({ w: 135, r: 10 }) },
      ],
      ...over,
    },
  };
}

describe("mondayOf", () => {
  it("finds the Monday of the week, Monday weeks like the cadence window", () => {
    expect(mondayOf("2026-08-25")).toBe("2026-08-24"); // Tue -> Mon
    expect(mondayOf("2026-08-24")).toBe("2026-08-24"); // Mon is its own Monday
    expect(mondayOf("2026-08-30")).toBe("2026-08-24"); // Sun still belongs to it
  });
});

describe("trainingSummary", () => {
  it("empty gym: nulls and zeros, never a throw", () => {
    const s = trainingSummary([], T);
    expect(s.sessionsThisWeek).toBe(0);
    expect(s.weekDots).toEqual([false, false, false, false, false, false, false]);
    expect(s.last).toBeNull();
    expect(s.pr).toBeNull();
    expect(s.trending).toBeNull();
  });

  it("dots and sessions cover the Monday week holding today, nothing older", () => {
    const s = trainingSummary([w("2026-08-24"), w("2026-08-25"), w("2026-08-20")], T);
    expect(s.sessionsThisWeek).toBe(2);
    expect(s.weekDots).toEqual([true, true, false, false, false, false, false]);
  });

  it("last session carries the receipt facts: day name, minutes, exercises", () => {
    const s = trainingSummary([w("2026-08-20"), w("2026-08-24")], T);
    expect(s.last).toEqual({ dayName: "Push Day", date: "2026-08-24", minutes: 47, exercises: 2 });
  });

  it("a PR is fresh only inside the window, judged against what came before", () => {
    const base = w("2026-08-04");
    const better = w("2026-08-24", {
      exercises: [{ exerciseId: "e-bench", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: sl({ w: 205, r: 5 }) }],
    });
    const s = trainingSummary([base, better], T);
    expect(s.pr).toEqual({ name: "Bench Press", text: "205 lb × 5", date: "2026-08-24" });
    // The same lift three weeks later is history, not news.
    const stale = trainingSummary([base, better], "2026-09-30");
    expect(stale.pr).toBeNull();
  });

  it("trending names a climbing exercise but never the PR's own story twice", () => {
    const rows = [
      w("2026-08-10", { exercises: [{ exerciseId: "e-rows", name: "Rows", kind: "weight_reps", unit: "lb", sets: sl({ w: 115, r: 10 }) }] }),
      w("2026-08-17", { exercises: [{ exerciseId: "e-rows", name: "Rows", kind: "weight_reps", unit: "lb", sets: sl({ w: 125, r: 10 }) }] }),
      w("2026-08-24", { exercises: [{ exerciseId: "e-rows", name: "Rows", kind: "weight_reps", unit: "lb", sets: sl({ w: 135, r: 10 }) }] }),
    ];
    const s = trainingSummary(rows, T);
    // Rows IS the PR here (each session beat the last), so trending stays
    // quiet instead of repeating it.
    expect(s.pr?.name).toBe("Rows");
    expect(s.trending).toBeNull();
  });

  it("trending speaks when the climber is not the fresh PR", () => {
    const rows = [
      w("2026-08-05", { exercises: [{ exerciseId: "e-squat", name: "Squat", kind: "weight_reps", unit: "lb", sets: sl({ w: 225, r: 5 }) }] }),
      w("2026-08-12", { exercises: [{ exerciseId: "e-squat", name: "Squat", kind: "weight_reps", unit: "lb", sets: sl({ w: 245, r: 5 }) }] }),
      w("2026-08-16", { exercises: [{ exerciseId: "e-squat", name: "Squat", kind: "weight_reps", unit: "lb", sets: sl({ w: 255, r: 5 }) }] }),
      // The freshest workout PRs a different lift, so Squat's climb is the
      // second story and trending gets to tell it.
      w("2026-08-24", { exercises: [{ exerciseId: "e-bench", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: sl({ w: 205, r: 5 }) }] }),
    ];
    const s = trainingSummary(rows, T);
    expect(s.pr?.name).toBe("Bench Press");
    expect(s.trending?.name).toBe("Squat");
    expect(s.trending?.line).toContain("225 lb × 5");
    expect(s.trending?.line).toContain("255 lb × 5");
  });

  it("FRESH_DAYS is a fortnight", () => {
    expect(FRESH_DAYS).toBe(14);
  });
});

describe("agoPhrase", () => {
  it("looks backward, unlike dayPhrase", async () => {
    const { agoPhrase } = await import("./summary");
    expect(agoPhrase("2026-08-25", "2026-08-25")).toBe("Today");
    expect(agoPhrase("2026-08-24", "2026-08-25")).toBe("Yesterday");
    expect(agoPhrase("2026-08-21", "2026-08-25")).toBe("Friday");
    expect(agoPhrase("2026-08-03", "2026-08-25")).toBe("Aug 3");
  });
});
