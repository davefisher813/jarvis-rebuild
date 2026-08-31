import { describe, expect, it } from "vitest";
import { workGaps, paceFor, paceLine, WORK_SEC, DEFAULT_REST_SEC } from "./pacing";
import type { Workout, SetEntry } from "./types";

// D5/D7: pace is learned from real logged gaps or it is a named default.
// The one sin this file guards against is a default dressed as a measurement.

let n = 0;
function entry(at: number | undefined, extra: Partial<SetEntry> = {}): SetEntry {
  return { id: `s${n++}`, w: 100, r: 5, ...(at ? { at } : {}), ...extra };
}

function workout(sets: SetEntry[], opts: { backdated?: boolean; date?: string } = {}): Workout {
  return {
    id: `w${n++}`,
    data: {
      programId: "p1", dayId: "d1", dayName: "Pull", date: opts.date ?? "2026-08-24",
      startedAt: 0, endedAt: 0,
      exercises: [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets }],
      ...(opts.backdated ? { backdated: true } : {}),
    },
  };
}

const M = 60_000;

describe("workGaps", () => {
  it("collects gaps between consecutive stamped sets", () => {
    const h = [workout([entry(0 * M + 1), entry(2 * M), entry(4 * M)])];
    // 0 is falsy as a stamp; use 1ms so the first chip counts.
    expect(workGaps(h, "Bench", "weight_reps").gaps.length).toBe(2);
  });

  it("throws out gaps outside the 20s..10min window instead of learning a phone call", () => {
    const h = [workout([entry(1), entry(10_000), entry(30 * M)])];
    expect(workGaps(h, "Bench", "weight_reps").gaps).toEqual([]);
  });

  it("skips backdated workouts: their stamps say when it was typed, not trained", () => {
    const h = [workout([entry(1), entry(2 * M), entry(4 * M)], { backdated: true })];
    expect(workGaps(h, "Bench", "weight_reps")).toEqual({ gaps: [], sessions: 0 });
  });

  it("a gap ending at a warm-up chip is not working pace", () => {
    const h = [workout([
      entry(1, { warmup: true }),
      entry(1 * M, { warmup: true }), // warm gap: excluded
      entry(3 * M), // ramp -> work transition: counts (ends at work)
      entry(6 * M), // work gap: counts
    ])];
    expect(workGaps(h, "Bench", "weight_reps").gaps).toEqual([3 * M - 1 * M, 3 * M]);
  });

  it("legacy chips with no stamp break the chain without inventing a gap", () => {
    const h = [workout([entry(1), entry(undefined), entry(5 * M)])];
    // 1 -> 5M spans the unstamped set; still one prev-to-next gap of ~5min: valid.
    expect(workGaps(h, "Bench", "weight_reps").gaps.length).toBe(1);
  });
});

describe("paceFor", () => {
  it("stays a default below three gaps, and says so", () => {
    const h = [workout([entry(1), entry(2 * M)])];
    const p = paceFor(h, { name: "Bench", kind: "weight_reps" });
    expect(p.learned).toBe(false);
    expect(p.secPerSet).toBe(WORK_SEC + DEFAULT_REST_SEC);
    expect(paceLine(p)).toBe("default pace · improves as you log");
  });

  it("prices the default from a stated rest target when one exists", () => {
    const p = paceFor([], { name: "Bench", kind: "weight_reps", restSec: 90 });
    expect(p.secPerSet).toBe(WORK_SEC + 90);
  });

  it("learns the median of real gaps and names its evidence", () => {
    const h = [
      workout([entry(1), entry(2 * M), entry(4 * M)], { date: "2026-08-20" }), // gaps ~2m, 2m
      workout([entry(1), entry(3 * M)], { date: "2026-08-22" }), // gap 3m
    ];
    const p = paceFor(h, { name: "Bench", kind: "weight_reps", restSec: 90 });
    expect(p.learned).toBe(true);
    expect(p.secPerSet).toBe(120); // median of [~120s, 180s, 120s]
    expect(p.sessions).toBe(2);
    expect(paceLine(p)).toBe("learned from your last 2 sessions");
  });

  it("only the newest PACE_WINDOW sessions teach it: pace drifts with programs", () => {
    const old = Array.from({ length: 6 }, (_, i) =>
      workout([entry(1), entry(8 * M)], { date: `2026-07-0${i + 1}` })); // slow 8m gaps
    const fresh = Array.from({ length: 5 }, (_, i) =>
      workout([entry(1), entry(1 * M)], { date: `2026-08-1${i}` })); // brisk 1m gaps
    const p = paceFor([...old, ...fresh], { name: "Bench", kind: "weight_reps" });
    expect(p.secPerSet).toBe(60);
    expect(p.sessions).toBe(5);
  });
});
