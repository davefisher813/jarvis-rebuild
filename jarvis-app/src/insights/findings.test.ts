import { describe, it, expect } from "vitest";
import { comparableGain, comparableSeries, gainLine, findings } from "./findings";
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

// THE SERIES BEHIND THE GAIN (Dave 2026-10-16, W). The Insights trend plotted every session with a set at the rep count,
// comparable or not, and a date once per session, so a day trained three times drew one point three times over.
describe("comparableSeries", () => {
  it("is the comparable sessions only, one point per date, the best of that day", () => {
    const ws = [
      w("a", "2026-08-24", [{ w: 125, r: 5 }]),
      w("a2", "2026-08-24", [{ w: 130, r: 5 }]),
      w("a3", "2026-08-24", [{ w: 120, r: 5 }]),
      w("kg", "2026-08-28", [{ w: 60, r: 5 }], {}, "kg"),
      w("b", "2026-08-31", [{ w: 135, r: 5 }]),
    ];
    const g = comparableGain(ws, lift)!;
    const pts = comparableSeries(ws, g);
    expect(new Set(pts.map((p) => p.date)).size, "unique per date").toBe(pts.length);
    expect(pts).toEqual([{ workoutId: "a2", date: "2026-08-24", w: 130 }, { workoutId: "b", date: "2026-08-31", w: 135 }]);
  });
  it("says the same number both ways", () => {
    const ws = [w("a", "2026-08-24", [{ w: 125, r: 2 }]), w("b", "2026-08-31", [{ w: 265, r: 2 }])];
    const g = comparableGain(ws, lift)!;
    expect(gainLine(g, "sign")).toBe("+140 Lb at 2 Reps Since Aug 24");
    expect(gainLine(g, "word")).toBe("Up 140 Lb at 2 Reps Since Aug 24");
    const down = comparableGain([w("a", "2026-08-24", [{ w: 150, r: 2 }]), w("b", "2026-08-31", [{ w: 140, r: 2 }])], lift)!;
    expect(gainLine(down, "word")).toBe("Down 10 Lb at 2 Reps Since Aug 24");
  });
});

describe("findings", () => {
  const period = periodFor("7d", "2026-09-14");
  it("leads with the gain, then an observation, then a data issue, three at most", () => {
    const ws = [w("a", "2026-08-31", [{ w: 125, r: 5 }]), w("b", "2026-09-07", [{ w: 130, r: 5 }]), w("c", "2026-09-12", [{ w: 135, r: 5 }, { w: 135, r: 5 }])];
    const f = findings({ workouts: ws, sleepDef: null, logs: [], period, muscleMap: new Map(), now: T("2026-09-14", 12) });
    expect(f.map((x) => x.kind)).toEqual(["change", "observation", "issue"]);
    // Casing sweep 1 (2026-09-26): Title Case by the whole rule (§H2), units spelled "Min".
    expect(f[0]).toMatchObject({ title: "Incline Bench", value: "135 Lb × 5", open: { kind: "lift" } });
    // AMENDED 2026-09-16 (Dave's Health screenshot). This pinned the bug: a
    // RAW ISO STAMP on a row a person reads, inside a single string that
    // carried its own middots. The context is a list of facts now, the CSS
    // draws the separators, and a date is a date.
    // AMENDED 2026-10-16 (Dave, V): the gain names the rep count it was measured at, so the hub's "+140 Lb" cannot be
    // read as a max and says the same thing the exercise page says.
    expect(f[0]!.context).toEqual(["+10 Lb at 5 Reps Since Aug 31"]);
    expect(f[1]).toMatchObject({ title: "Working Sets", value: "2" });
    expect(f[2]).toMatchObject({ kind: "issue", open: { kind: "assign" } });
    expect(f[2]!.value).toBe("2 Sets Need a Muscle Assigned");
  });
  // THE TWO THINGS THAT PUT "· +140 lb at 2 reps since 2026-08-24 · 6 compa…"
  // ON HIS PHONE. A string carrying its own middot cannot wrap the way a row
  // of facts does, so it either ran off the end of the row or wrapped and
  // left the separator leading the new line. And an ISO stamp is a storage
  // format, not something a person reads.
  // TWO LINES IS WHAT A ROW GETS (2026-09-16, Dave: "too much grey subtext.
  // Looks extremely cluttered and breaks 4 lines rule"). Name, then the
  // reading and ONE fact. Sample size is not lost -- it is on the page the
  // row opens, with room to read it.
  it("hands over one fact, so the row cannot run to four lines", () => {
    const ws = [w("a", "2026-08-31", [{ w: 125, r: 5 }]), w("b", "2026-09-07", [{ w: 130, r: 5 }]), w("c", "2026-09-12", [{ w: 135, r: 5 }, { w: 135, r: 5 }])];
    for (const p of ["7d", "30d", "90d"] as const) {
      for (const f of findings({ workouts: ws, sleepDef: null, logs: [], period: periodFor(p, "2026-09-14"), muscleMap: new Map(), now: T("2026-09-14", 12) })) {
        expect(f.context.length, `${f.title} carries ${f.context.length} facts`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("no finding hands over a fact carrying its own separator", () => {
    const ws = [w("a", "2026-08-31", [{ w: 125, r: 5 }]), w("b", "2026-09-07", [{ w: 130, r: 5 }]), w("c", "2026-09-12", [{ w: 135, r: 5 }, { w: 135, r: 5 }])];
    for (const p of ["7d", "30d", "90d"] as const) {
      for (const f of findings({ workouts: ws, sleepDef: null, logs: [], period: periodFor(p, "2026-09-14"), muscleMap: new Map(), now: T("2026-09-14", 12) })) {
        for (const c of [f.value, ...f.context]) {
          expect(c, `"${c}" carries its own middot`).not.toMatch(/\u00b7/);
          expect(c, `"${c}" shows a raw ISO date`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        }
      }
    }
  });

  // ALFRED 2026-10-04 (R2): "78 · −9 on the 7 before". The working-sets comparison was the one finding line not cased through
  // lineCase: the word behind a leading number takes a capital and the line is Title Case like every other.
  it("the working-sets comparison reads Title Case: the word behind the number is capitalized", () => {
    const ten = Array.from({ length: 10 }, () => ({ w: 100, r: 5 }));
    const ws = [w("p", "2026-09-02", ten), w("c", "2026-09-12", [{ w: 135, r: 5 }])];
    const f = findings({ workouts: ws, sleepDef: null, logs: [], period, muscleMap: new Map(), now: T("2026-09-14", 12) });
    const sets = f.find((x) => x.id === "sets")!;
    expect(sets.value).toBe("1");
    expect(sets.context).toEqual(["-9 On the 7 Before"]);
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
    // Violet is a budget or a pair in the Health key (§AM). The average is a
    // number with no state, so white (plainValue); lime marks the glyph only.
    expect(f.find((x) => x.kind === "observation")).toMatchObject({ title: "Sleep", value: "7h 30m", hue: "lime", plainValue: true });
    expect(f.find((x) => x.kind === "issue")).toMatchObject({ open: { kind: "duration", workoutId: "long" } });
  });
});
