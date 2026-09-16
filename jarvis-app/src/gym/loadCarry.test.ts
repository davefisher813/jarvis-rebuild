import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFields } from "./equipment";
import { addExerciseMidSession, type LiveSession } from "./liveSession";
import { dayWithSessionEntry } from "./edit";
import type { ProgramDay } from "./types";

const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

// A LIFT'S CONVENTION HAS TO SURVIVE THE TRIP (2026-09-16, found while
// answering Dave's "the module that renders when you click on an exercise
// has everything you need... I still don't see enough options with various
// weight loading").
//
// `sided` was added as a third axis this morning. FOUR places carry a lift's
// convention forward -- starting a session, adding one mid-session, writing a
// session entry back into a program, and the classification store -- and three
// of them were spelling out equipment and counted by hand. All three dropped
// the new axis silently, so a lift set to Per Side in the plan logged its sets
// as if it were not. The write-back had never carried ANY of it: a dumbbell
// press swapped in and kept landed in the program unclassified.
//
// One helper is the fix, so a fourth axis is one edit and not a sweep.
describe("loadFields is the one spelling of the convention", () => {
  it("copies all three axes, and omits what was never said", () => {
    expect(loadFields({ equipment: "dumbbell", counted: "each_hand", sided: true }))
      .toEqual({ equipment: "dumbbell", counted: "each_hand", sided: true });
    expect(loadFields({})).toEqual({});
    // Never a null into storage.
    expect(Object.keys(loadFields({ equipment: "stack" }))).toEqual(["equipment", "counted"]);
  });

  it("reads the retired values on the way through, like everything else does", () => {
    // "unilateral" was a COUNT in the first menu and is not equipment.
    expect(loadFields({ equipment: "unilateral" })).toEqual({ equipment: "other", counted: "each_side" });
    expect(loadFields({ load: "each" })).toEqual({ equipment: "dumbbell", counted: "each_hand" });
  });

  it("is what every carrying path calls, rather than each spelling it out", () => {
    const flow = src("GymFlow.tsx");
    expect(flow, "starting a session").toMatch(/plan: e\.sets, \.\.\.loadFields\(e\)/);
    expect(flow, "adding one mid-session").toMatch(/\.\.\.loadFields\(draft\)/);
    expect(src("edit.ts"), "writing one back into a program").toMatch(/\.\.\.loadFields\(entry\)/);
    expect(src("liveSession.ts")).toMatch(/\.\.\.loadFields\(ex\)/);
    // And nobody hand-spells the pair any more.
    for (const f of ["GymFlow.tsx", "edit.ts", "liveSession.ts"]) {
      expect(src(f), `${f} spells the copy by hand`)
        .not.toMatch(/\{ equipment: loadStyleOf\([a-z]+\)\.equipment \}/);
    }
  });
});

describe("the convention survives every trip", () => {
  const live: LiveSession = {
    programId: "p", dayId: "d", dayName: "Push", date: "2026-09-16",
    startedAt: 0, idx: 0, exercises: [],
  };

  it("a lift added mid-session keeps what it was added with", () => {
    const next = addExerciseMidSession(live, {
      name: "Single-Arm Row", kind: "weight_reps", unit: "lb",
      equipment: "dumbbell", counted: "each_hand", sided: true, plan: [],
    });
    expect(next.exercises[0]).toMatchObject({ equipment: "dumbbell", counted: "each_hand", sided: true });
  });

  it("and Also Update the Program carries it into the plan", () => {
    const day: ProgramDay = { id: "d", name: "Push", exercises: [] } as ProgramDay;
    const out = dayWithSessionEntry(day, {
      exerciseId: "mid1", name: "Single-Arm Row", kind: "weight_reps", unit: "lb",
      equipment: "dumbbell", counted: "each_hand", sided: true, plan: [],
    }, () => "e1");
    expect(out.exercises[0]).toMatchObject({ equipment: "dumbbell", counted: "each_hand", sided: true });
  });

  it("an unclassified lift still writes nothing, rather than writing blanks", () => {
    const day: ProgramDay = { id: "d", name: "Push", exercises: [] } as ProgramDay;
    const out = dayWithSessionEntry(day, { exerciseId: "m", name: "Thing", kind: "reps", plan: [] }, () => "e1");
    expect("equipment" in out.exercises[0]!).toBe(false);
    expect("sided" in out.exercises[0]!).toBe(false);
  });
});

// AND THE SHEET THAT PLANS A LIFT CAN SET IT. Dave: "you cannot tell me the
// module that renders when you click on an exercise has everything you need."
// It did not: the live session's own sheet asked this and the planning sheet
// never did.
describe("Edit Exercise carries every loading axis", () => {
  const sheet = src("ExerciseSheet.tsx");
  it("asks the reps axis, beside the reading it completes", () => {
    expect(sheet).toMatch(/const \[sided, setSided\]/);
    expect(sheet).toMatch(/ariaLabel="Reps count"/);
    expect(sheet, "and saves it").toMatch(/\.\.\.\(sided \? \{ sided: true as const \} : \{\}\)/);
  });
  it("as a value, not a toggle that needs a sentence under it", () => {
    expect(sheet).toMatch(/label: "Both Sides" \}, \{ value: "side", label: "Per Side" \}/);
    expect(sheet, "the session's sheet offers the same two words")
      .toBeTruthy();
    expect(src("LoadSheet.tsx")).toMatch(/label: "Both Sides" \}, \{ value: "side", label: "Per Side" \}/);
  });
});
