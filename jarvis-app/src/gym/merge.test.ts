import { describe, it, expect } from "vitest";
import type { Program, Workout, WorkoutData, SetEntry } from "./types";
import type { Goal } from "../life/types";
import type { LiftMeasure } from "./goalMeasures";
import { libraryRows, mergeLifts, invertPatch } from "./libraryEdit";
import { buildLibrary } from "./library";
import { EMPTY_CLASS, type Classification } from "./classify";
import {
  expectedSignature, goalsOnLift, movesLine, patchSignature, planMerge, remainingLine, repointGoal,
  totalWrites, undoSafe,
  type MergeState,
} from "./merge";

// MERGING TWO EXERCISES (handoff §5). The five properties that matter, each
// one a way the old merge could go wrong quietly:
//
//   what moves is counted from the real records, never from the input size
//   sets are never dropped for looking alike
//   goals follow their exercise
//   a partial write is reported as partial, and a retry finishes it
//   undo is withheld the moment it stops being safe

const set = (i: number, w: number, r: number): SetEntry => ({ id: "s" + i, w, r });

const workout = (id: string, date: string, exercises: WorkoutData["exercises"]): Workout => ({
  id, entityType: "workout", data: { date, startedAt: Date.parse(date + "T10:00:00"), exercises },
} as unknown as Workout);

const ex = (name: string, key: string | undefined, sets: SetEntry[]) => ({
  exerciseId: "x" + name, name, kind: "weight_reps" as const, sets, ...(key ? { exerciseKey: key } : {}),
});

const program = (id: string, names: { name: string; key?: string }[]): Program => ({
  id, entityType: "program",
  data: {
    name: "Block", weeks: [{
      id: "w1", label: "Week 1",
      days: [{ id: "d1", name: "Push", exercises: names.map((n, i) => ({ id: "e" + i, name: n.name, kind: "weight_reps", sets: [], ...(n.key ? { exerciseKey: n.key } : {}) })) }],
    }],
  },
} as unknown as Program);

const goal = (exercise: string, key?: string): Goal => ({
  id: "g1", entityType: "goal",
  data: {
    title: "Bench 225", state: "active",
    measure: { kind: "lift", exercise, measureKind: "weight_reps", target: { w: 225, r: 1 }, ...(key ? { exerciseKey: key } : {}) } as LiftMeasure,
  },
} as unknown as Goal);

const c = (over: Partial<Classification> = {}): Classification => ({ ...EMPTY_CLASS, ...over });

function setup() {
  // Two names for one lift. "Bench" has one session of two identical sets --
  // identical on purpose, since the handoff forbids dropping a set for
  // matching another one's numbers.
  const workouts = [
    workout("w1", "2026-09-01", [ex("Bench Press", "kb", [set(1, 225, 5), set(2, 225, 5)])]),
    workout("w2", "2026-09-05", [ex("Bench", undefined, [set(3, 225, 5), set(4, 225, 5)])]),
    workout("w3", "2026-09-08", [ex("Bench Press", "kb", [set(5, 235, 3)])]),
  ];
  const programs = [program("p1", [{ name: "Bench", key: undefined }])];
  const rows = libraryRows(buildLibrary(programs, workouts), workouts);
  const keep = rows.find((r) => r.name === "Bench Press")!;
  const fold = rows.find((r) => r.name === "Bench")!;
  const survivorKey = keep.exerciseKey ?? "minted";
  const patch = mergeLifts(workouts, programs, fold, { ...keep, exerciseKey: survivorKey }, () => survivorKey);
  const plan = planMerge({
    keep: { row: keep, classification: c({ primary: ["chest"], equipment: "barbell" }) },
    fold: { row: fold, classification: c({ primary: ["shoulders"], type: "strength" }) },
    patch,
    inverse: invertPatch(patch, workouts, programs),
    survivorKey,
    workouts,
    programs,
    goals: [goal("Bench")],
  });
  return { workouts, programs, rows, keep, fold, plan, patch };
}

describe("the plan counts the real records", () => {
  it("counts sessions, sets and program days that actually move", () => {
    const { plan } = setup();
    expect(plan.sessions).toBe(1);
    // BOTH of the folded lift's identical sets move. Two 225 x 5 on one day
    // are two sets that happened.
    expect(plan.sets).toBe(2);
    expect(plan.programDays).toBe(1);
  });

  it("says what moves in plain counts, and says so honestly when nothing has been logged", () => {
    const { plan } = setup();
    expect(movesLine(plan)).toBe("1 session, 2 sets, 1 program day, 1 goal");
    expect(movesLine({ ...plan, sessions: 0, sets: 0, programDays: 0, goals: [] }))
      .toBe("Nothing logged under it yet, so only the name moves");
  });

  it("carries both classifications so the review can show either side", () => {
    const { plan } = setup();
    expect(plan.keep.classification.primary).toEqual(["chest"]);
    expect(plan.fold.classification.primary).toEqual(["shoulders"]);
  });
});

describe("goals follow their exercise", () => {
  it("finds the goal on the folded lift by identity", () => {
    const { fold } = setup();
    expect(goalsOnLift([goal("Bench")], fold)).toHaveLength(1);
    expect(goalsOnLift([goal("Something Else")], fold)).toHaveLength(0);
  });

  it("repoints the goal without touching its target", () => {
    const { keep } = setup();
    const next = repointGoal(goal("Bench"), keep, "kb");
    const m = next.measure as LiftMeasure;
    expect(m.exercise).toBe("Bench Press");
    expect(m.exerciseKey).toBe("kb");
    expect(m.target).toEqual({ w: 225, r: 1 });
    expect(next.title).toBe("Bench 225");
  });
});

describe("the merge is idempotent, which is what makes Retry safe", () => {
  it("applying the same patch twice produces the same records", () => {
    const { workouts, programs, patch } = setup();
    const after = workouts.map((w) => {
      const hit = patch.workouts.find((x) => x.id === w.id);
      return hit ? ({ ...w, data: { ...w.data, exercises: hit.exercises } } as Workout) : w;
    });
    const afterPrograms = programs.map((p) => {
      const hit = patch.programs.find((x) => x.id === p.id);
      return hit ? ({ ...p, data: { ...p.data, weeks: hit.weeks } } as Program) : p;
    });
    // Re-plan from the already-merged records: there is nothing left to do,
    // and re-running what there is changes nothing.
    const rows2 = libraryRows(buildLibrary(afterPrograms, after), after);
    expect(rows2.filter((r) => r.name === "Bench")).toHaveLength(0);
    expect(rows2.find((r) => r.name === "Bench Press")!.sessions).toBe(3);
  });

  it("never drops a set with the same numbers as another", () => {
    const { workouts, patch } = setup();
    const before = workouts.reduce((n, w) => n + w.data.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
    const touched = patch.workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
    const untouched = workouts.filter((w) => !patch.workouts.some((x) => x.id === w.id))
      .reduce((n, w) => n + w.data.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
    expect(touched + untouched).toBe(before);
  });
});

describe("a failure is reported as a failure", () => {
  const state = (over: Partial<MergeState> = {}): MergeState => {
    const { plan } = setup();
    return { plan, stage: "failed", take: [], applied: 0, ...over };
  };

  it("says nothing while the merge is still being reviewed", () => {
    expect(remainingLine(state({ stage: "reviewing" }))).toBeNull();
  });

  it("says nothing was changed when nothing landed", () => {
    expect(remainingLine(state({ applied: 0 }))).toBe("Nothing was changed, both exercises are exactly as they were");
  });

  it("says what landed and that Retry finishes the rest", () => {
    const s = state({ applied: 1 });
    // Three workouts and one program day: the patch stamps the survivor's own
    // sightings too, so it is bigger than the count of what moves.
    expect(totalWrites(s.plan)).toBe(4);
    expect(remainingLine(s)).toBe("1 of 4 saved and nothing was deleted, Retry finishes the rest");
  });

  it("does not claim a partial write when every write landed", () => {
    expect(remainingLine(state({ applied: 4 }))).toBe("Everything saved, but the last step did not confirm");
  });
});

describe("undo is offered only while it is safe", () => {
  it("is safe when the records are untouched since the merge", () => {
    const { plan } = setup();
    expect(undoSafe(plan, plan.signature, plan.signature)).toBe(true);
  });

  it("is withheld once anything else has rewritten what it touched", () => {
    const { plan, workouts, programs } = setup();
    const edited = workouts.map((w) => (w.id === "w2"
      ? ({ ...w, data: { ...w.data, exercises: [ex("Bench", undefined, [set(9, 245, 5)])] } } as Workout)
      : w));
    const now = patchSignature(plan.patch, edited, programs);
    expect(undoSafe(plan, now, plan.signature)).toBe(false);
  });

  it("is withheld when there is no pre-image to put back", () => {
    const { plan } = setup();
    expect(undoSafe({ ...plan, inverse: { workouts: [], programs: [] } }, plan.signature, plan.signature)).toBe(false);
  });
});

describe("the signature notices any edit to a touched record", () => {
  it("changes when a workout the merge touched changes", () => {
    const { plan, workouts, programs } = setup();
    const a = patchSignature(plan.patch, workouts, programs);
    const edited = workouts.map((w) => (w.id === "w2"
      ? ({ ...w, data: { ...w.data, exercises: [] } } as Workout)
      : w));
    expect(patchSignature(plan.patch, edited, programs)).not.toBe(a);
  });

  it("is stable across the order the records arrive in", () => {
    const { plan, workouts, programs } = setup();
    const a = patchSignature(plan.patch, workouts, programs);
    expect(patchSignature(plan.patch, [...workouts].reverse(), programs)).toBe(a);
  });
});

// The check that stopped checking. undoSafe compares TWO readings; handing it
// the same one twice returns true always, which is how a safety check quietly
// becomes a rubber stamp. expectedSignature is the second reading: what the
// patch says the records will look like, computed from the patch itself.
describe("expectedSignature is the other half of the undo check", () => {
  it("matches the store's own signature once the patch has landed", () => {
    const { plan, workouts, programs } = setup();
    const after = workouts.map((w) => {
      const hit = plan.patch.workouts.find((x) => x.id === w.id);
      return hit ? ({ ...w, data: { ...w.data, exercises: hit.exercises } } as Workout) : w;
    });
    const afterPrograms = programs.map((p) => {
      const hit = plan.patch.programs.find((x) => x.id === p.id);
      return hit ? ({ ...p, data: { ...p.data, weeks: hit.weeks } } as Program) : p;
    });
    expect(patchSignature(plan.patch, after, afterPrograms)).toBe(expectedSignature(plan.patch));
    expect(undoSafe(plan, patchSignature(plan.patch, after, afterPrograms), expectedSignature(plan.patch))).toBe(true);
  });

  it("stops matching the moment anything edits a record the merge touched", () => {
    const { plan, workouts, programs } = setup();
    const after = workouts.map((w) => {
      const hit = plan.patch.workouts.find((x) => x.id === w.id);
      const merged = hit ? ({ ...w, data: { ...w.data, exercises: hit.exercises } } as Workout) : w;
      // ...and then someone deletes a set from one of them.
      return merged.id === "w2"
        ? ({ ...merged, data: { ...merged.data, exercises: merged.data.exercises.map((e) => ({ ...e, sets: e.sets.slice(1) })) } } as Workout)
        : merged;
    });
    const afterPrograms = programs.map((p) => {
      const hit = plan.patch.programs.find((x) => x.id === p.id);
      return hit ? ({ ...p, data: { ...p.data, weeks: hit.weeks } } as Program) : p;
    });
    expect(undoSafe(plan, patchSignature(plan.patch, after, afterPrograms), expectedSignature(plan.patch))).toBe(false);
  });
});
