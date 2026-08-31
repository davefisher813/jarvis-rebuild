import { describe, it, expect } from "vitest";
import { isPR, bestBefore, receiptFor, lastTimeLine } from "./prs";
import type { Workout, WorkoutExercise, MeasureKind, SetLog } from "./types";

const wk = (date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id: date, data: { programId: "p", dayId: "d", dayName: "Day", date, startedAt: 0, endedAt: 0, exercises } });
// The logged strip is SetEntry[] (each chip carries an id); test fixtures
// still write plain SetLog literals and this stamps an id on the way in.
const wex = (name: string, kind: MeasureKind, sets: SetLog[], unit?: string): WorkoutExercise =>
  ({ exerciseId: "x", name, kind, unit, sets: sets.map((s, i) => ({ id: `s${i}`, ...s })) });

describe("isPR", () => {
  const history = [
    wk("2026-07-01", [wex("Bench", "weight_reps", [{ w: 125, r: 8 }], "lb")]),
    wk("2026-07-15", [wex("Bench", "weight_reps", [{ w: 135, r: 6 }], "lb")]),
    wk("2026-07-20", [wex("40 Yard Dash", "time_faster", [{ v: 4.71 }, { v: 4.68 }], "sec")]),
  ];

  it("first time on an exercise is its own moment", () => {
    expect(isPR(history, "Deadlift", "weight_reps", { w: 95, r: 5 })).toBe(true);
  });

  it("beats the heaviest ever for weight work", () => {
    expect(isPR(history, "Bench", "weight_reps", { w: 145, r: 3 })).toBe(true);
    expect(isPR(history, "Bench", "weight_reps", { w: 135, r: 10 })).toBe(false);
  });

  it("a faster sprint is the record, a slower one is not", () => {
    expect(isPR(history, "40 Yard Dash", "time_faster", { v: 4.64 })).toBe(true);
    expect(isPR(history, "40 Yard Dash", "time_faster", { v: 4.70 })).toBe(false);
  });

  it("skipped entries and Done never produce records", () => {
    expect(isPR(history, "Bench", "weight_reps", { w: 999, r: 1, skipped: true })).toBe(false);
    expect(isPR(history, "Stretching", "done", {})).toBe(false);
  });

  it("changing an exercise's kind starts fresh instead of ranking seconds against pounds", () => {
    // same name, different kind: prior weight history must not be compared
    expect(bestBefore(history, "Bench", "time_faster")).toBeNull();
    expect(isPR(history, "Bench", "time_faster", { v: 30 })).toBe(true);
  });

  it("distance_time compares only against the same distance", () => {
    const runs = [
      wk("2026-07-10", [wex("Run", "distance_time", [{ v: 1, t: 7 }], "mi")]), // 7:00 mile
      wk("2026-07-18", [wex("Run", "distance_time", [{ v: 3, t: 27 }], "mi")]), // 9:00 pace
    ];
    // 8:00 pace over 3 mi beats the prior 3 mi, even though the 1 mi was faster
    expect(isPR(runs, "Run", "distance_time", { v: 3, t: 24 })).toBe(true);
    // and a slower 3 mi is not a record
    expect(isPR(runs, "Run", "distance_time", { v: 3, t: 30 })).toBe(false);
  });
});

describe("receiptFor", () => {
  const history = [wk("2026-07-15", [wex("Bench", "weight_reps", [{ w: 125, r: 8 }], "lb")])];

  it("counts volume only from weight work and names the PR", () => {
    const r = receiptFor(
      [wex("Bench", "weight_reps", [{ w: 135, r: 8 }, { w: 135, r: 8 }], "lb")],
      history, 0, 42 * 60000,
    );
    expect(r.minutes).toBe(42);
    expect(r.exercises).toBe(1);
    expect(r.volume).toBe(2160);
    expect(r.volumeUnit).toBe("lb");
    expect(r.prs).toEqual([{ name: "Bench", text: "135 lb × 8", from: "125 lb × 8" }]);
  });

  it("a speed day reports no volume at all rather than an invented number", () => {
    const r = receiptFor(
      [wex("40 Yard Dash", "time_faster", [{ v: 4.64 }], "sec"), wex("Stretching", "done", [{}])],
      [], 0, 20 * 60000,
    );
    expect(r.volume).toBe(0);
    expect(r.volumeUnit).toBeNull();
    expect(r.exercises).toBe(2);
    expect(r.prs.map((p) => p.name)).toEqual(["40 Yard Dash"]); // Done never PRs
  });

  it("partial work still counts as a session; skipped exercises do not inflate it", () => {
    const r = receiptFor(
      [
        wex("Bench", "weight_reps", [{ w: 135, r: 8 }], "lb"),
        { ...wex("Row", "weight_reps", [], "lb"), skipped: true },
      ],
      history, 0, 15 * 60000,
    );
    expect(r.exercises).toBe(1);
  });

  // THE `done` BLIND SPOT FIX (catalog §4.8): done work gets named, and
  // non-weight work gets its own tile instead of vanishing into nothing.
  it("names done-kind exercises by name, and gives reps/rounds/timed work its own tile", () => {
    const r = receiptFor(
      [
        wex("T-Spine Rotations", "done", [{ done: true }]),
        wex("Farmer's Carry", "rounds", [{ r: 3 }, { r: 3 }]),
        wex("Plank", "time_longer", [{ v: 60 }], "sec"),
      ],
      [], 0, 20 * 60000,
    );
    expect(r.doneNames).toEqual(["T-Spine Rotations"]);
    expect(r.otherSets).toBe(3); // 2 rounds sets + 1 plank set
    expect(r.volume).toBe(0);
  });

  it("a skipped done exercise is never named", () => {
    const r = receiptFor(
      [{ ...wex("T-Spine Rotations", "done", [{ done: true }]), skipped: true }],
      [], 0, 10 * 60000,
    );
    expect(r.doneNames).toEqual([]);
  });
});

describe("lastTimeLine", () => {
  it("shows the most recent real numbers, skipping empty sessions", () => {
    const history = [
      wk("2026-07-01", [wex("Bench", "weight_reps", [{ w: 125, r: 8 }, { w: 125, r: 7 }], "lb")]),
      wk("2026-07-15", [wex("Bench", "weight_reps", [], "lb")]), // nothing logged
    ];
    expect(lastTimeLine(history, "Bench", "weight_reps")).toBe("Last time: 125 lb × 8, 125 lb × 7");
    expect(lastTimeLine(history, "Squat", "weight_reps")).toBeNull();
  });
});

describe("isSessionPR (audit 2026-08-25)", () => {
  it("one pill per standing best: a repeat of the same weight earns nothing", async () => {
    const { isSessionPR } = await import("./prs");
    const sets = [{ w: 135, r: 8 }, { w: 135, r: 8 }, { w: 140, r: 6 }];
    // No saved history: the first set is a first-ever best, the tie is not,
    // and the heavier third set takes the pill back.
    expect(isSessionPR([], "Bench", "weight_reps", sets, 0)).toBe(true);
    expect(isSessionPR([], "Bench", "weight_reps", sets, 1)).toBe(false);
    expect(isSessionPR([], "Bench", "weight_reps", sets, 2)).toBe(true);
  });
});

// D2, LAST TIME ALWAYS IN SIGHT (Training Catalog V2, approved 2026-08-31).
describe("lastSessionFor + lastHeader", () => {
  const history = [
    wk("2026-08-10", [wex("Bench", "weight_reps", [{ w: 285, r: 3 }], "lb")]),
    wk("2026-08-24", [wex("Bench", "weight_reps", [{ w: 275, r: 5 }, { w: 275, r: 5 }, { w: 275, r: 4 }, { skipped: true }], "lb")]),
  ];

  it("finds the most recent session with real logged sets, skips filtered", async () => {
    const { lastSessionFor } = await import("./prs");
    const hit = lastSessionFor(history, "Bench", "weight_reps")!;
    expect(hit.date).toBe("2026-08-24");
    expect(hit.sets).toHaveLength(3); // the skipped chip never shows as a ghost
    expect(hit.sets[0]!.w).toBe(275);
  });

  it("null when the exercise has never been trained", async () => {
    const { lastSessionFor } = await import("./prs");
    expect(lastSessionFor(history, "Squat", "weight_reps")).toBeNull();
  });

  it("compresses a same-weight strip to one line and carries the all-time best", async () => {
    const { lastHeader } = await import("./prs");
    const h = lastHeader(history, "Bench", "weight_reps")!;
    expect(h.last).toBe("275 lb × 5, 5, 4");
    expect(h.date).toBe("2026-08-24");
    expect(h.best).toBe("285 lb × 3"); // the older, heavier single is still the best
  });

  it("mixed weights fall back to listing the sets", async () => {
    const { lastHeader } = await import("./prs");
    const hist = [wk("2026-08-20", [wex("Row", "weight_reps", [{ w: 225, r: 5 }, { w: 245, r: 3 }], "lb")])];
    const h = lastHeader(hist, "Row", "weight_reps")!;
    expect(h.last).toBe("225 lb × 5, 245 lb × 3");
  });

  it("distance_time never speaks a cross-distance best", async () => {
    const { lastHeader } = await import("./prs");
    const hist = [wk("2026-08-20", [wex("Tempo Run", "distance_time", [{ v: 1, t: 8 }], "mi")])];
    expect(lastHeader(hist, "Tempo Run", "distance_time")!.best).toBeNull();
  });
});
