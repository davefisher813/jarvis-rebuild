import { describe, it, expect } from "vitest";
import { comparableGain, findings } from "./findings";
import { periodFor } from "./analytics";
import type { Workout } from "../gym/types";

// The approved Health design (2026-09-14), "Your progress" and item 5: a gain
// is only claimed at the same lift, rep count, counting convention and unit.
const T = (iso: string, h: number) => new Date(`${iso}T${String(h).padStart(2, "0")}:00:00`).getTime();
const w = (id: string, date: string, sets: { w: number; r: number; warmup?: boolean }[], extra: Record<string, unknown> = {}, unit = "lb"): Workout =>
  ({ id, data: { programId: "p", dayId: "d", dayName: "Push", date, startedAt: T(date, 18), endedAt: T(date, 19), exercises: [{ exerciseId: "e", exerciseKey: "k1", name: "Incline Bench", kind: "weight_reps", unit, sets: sets.map((s, i) => ({ id: "s" + i, at: T(date, 18) + i * 60000, ...s })), ...extra }] } }) as Workout;
const lift = { name: "Incline Bench", exerciseKey: "k1", kind: "weight_reps" as const, unit: "lb" };

describe("comparableGain", () => {
  it("reads the change at the same rep count across comparable sessions", () => {
    const g = comparableGain([w("a", "2026-08-24", [{ w: 125, r: 5 }]), w("b", "2026-08-31", [{ w: 125, r: 5 }]), w("c", "2026-09-07", [{ w: 130, r: 5 }]), w("d", "2026-09-14", [{ w: 135, r: 5 }, { w: 95, r: 8, warmup: true }])], lift);
    expect(g).toMatchObject({ reps: 5, delta: 10, sessions: 4, from: { w: 125, date: "2026-08-24" }, to: { w: 135, date: "2026-09-14" } });
  });
  it("does not compare across a change of unit or of counting convention", () => {
    expect(comparableGain([w("a", "2026-09-01", [{ w: 60, r: 5 }], {}, "kg"), w("b", "2026-09-08", [{ w: 135, r: 5 }])], lift)).toBeNull();
    expect(comparableGain([w("a", "2026-09-01", [{ w: 100, r: 5 }], { equipment: "stack" }), w("b", "2026-09-08", [{ w: 135, r: 5 }], { equipment: "machine" })], lift)).toBeNull();
  });
  it("needs a second session at the rep count", () => {
    expect(comparableGain([w("a", "2026-09-01", [{ w: 125, r: 5 }]), w("b", "2026-09-08", [{ w: 135, r: 3 }])], lift)).toBeNull();
  });
});

describe("findings", () => {
  const period = periodFor("7d", "2026-09-14");
  it("leads with the gain, then an observation, then a data issue, three at most", () => {
    const ws = [w("a", "2026-08-31", [{ w: 125, r: 5 }]), w("b", "2026-09-07", [{ w: 130, r: 5 }]), w("c", "2026-09-12", [{ w: 135, r: 5 }, { w: 135, r: 5 }])];
    const f = findings({ workouts: ws, sleepDef: null, logs: [], period, muscleMap: new Map(), now: T("2026-09-14", 12) });
    expect(f.map((x) => x.kind)).toEqual(["change", "observation", "issue"]);
    expect(f[0]).toMatchObject({ title: "Incline Bench", value: "135 lb × 5", open: { kind: "lift" } });
    // AMENDED 2026-09-16 (Dave's Health screenshot). This pinned the bug: a
    // RAW ISO STAMP on a row a person reads, inside a single string that
    // carried its own middots. The context is a list of facts now, the CSS
    // draws the separators, and a date is a date.
    expect(f[0]!.context).toEqual(["+10 lb since Aug 31", "3 comparable sessions"]);
    expect(f[1]).toMatchObject({ title: "Working Sets", value: "2" });
    expect(f[2]).toMatchObject({ kind: "issue", open: { kind: "assign" } });
    expect(f[2]!.value).toBe("2 Sets need a muscle assigned");
  });
  // THE TWO THINGS THAT PUT "· +140 lb at 2 reps since 2026-08-24 · 6 compa…"
  // ON HIS PHONE. A string carrying its own middot cannot wrap the way a row
  // of facts does, so it either ran off the end of the row or wrapped and
  // left the separator leading the new line. And an ISO stamp is a storage
  // format, not something a person reads.
  it("no finding hands over a fact carrying its own separator", () => {
    const ws = [w("a", "2026-08-31", [{ w: 125, r: 5 }]), w("b", "2026-09-07", [{ w: 130, r: 5 }]), w("c", "2026-09-12", [{ w: 135, r: 5 }, { w: 135, r: 5 }])];
    for (const p of ["7d", "28d", "90d"] as const) {
      for (const f of findings({ workouts: ws, sleepDef: null, logs: [], period: periodFor(p, "2026-09-14"), muscleMap: new Map(), now: T("2026-09-14", 12) })) {
        for (const c of [f.value, ...f.context]) {
          expect(c, `"${c}" carries its own middot`).not.toMatch(/\u00b7/);
          expect(c, `"${c}" shows a raw ISO date`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        }
      }
    }
  });

  it("says nothing it cannot support: no records, no findings", () => {
    expect(findings({ workouts: [], sleepDef: null, logs: [], period, muscleMap: new Map() })).toEqual([]);
  });
  it("prefers sleep over logged nights as the observation, and a flagged duration once muscles are all assigned", () => {
    const def = { id: "m1", data: { name: "Sleep", type: "number" as const, unit: "hrs", presetKey: "sleep", createdOn: "2026-09-01" } };
    const logs = ["2026-09-10", "2026-09-11", "2026-09-12"].map((date, i) => ({ id: date, data: { metricId: "m1", date, value: 7 + i * 0.5, at: 1 } }));
    const long = w("long", "2026-09-13", [{ w: 135, r: 5 }]);
    long.data.endedAt = long.data.startedAt + 627 * 60000;
    const f = findings({ workouts: [long], sleepDef: def, logs, period, muscleMap: new Map([["k1", ["chest"]]]), now: T("2026-09-14", 12) });
    expect(f.find((x) => x.kind === "observation")).toMatchObject({ title: "Sleep", value: "7h 30m" });
    expect(f.find((x) => x.kind === "issue")).toMatchObject({ open: { kind: "duration", workoutId: "long" } });
  });
});
