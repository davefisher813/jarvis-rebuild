import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { movedToDay } from "./edit";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17: "Also should be able to fully edit completed workouts."
//
// A finished session could have its sets corrected and its end time corrected,
// and that was the whole list. Its NAME and its DATE -- the two things the
// history list is read by, and the two most likely to be wrong on a session
// logged from memory the next morning -- were fixed forever, and so was which
// exercises were in it. His screenshot has a lift called SHRUGS with no sets
// under it and no way to take it out.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const FLOW = read("gym/GymFlow.tsx");

describe("moving a session to another day takes its clock with it", () => {
  const data = { date: "2026-09-17", startedAt: Date.UTC(2026, 8, 17, 18, 0), endedAt: Date.UTC(2026, 8, 17, 19, 5) };

  it("shifts both stamps by the same whole number of days", () => {
    const p = movedToDay(data, "2026-09-14")!;
    expect(p.date).toBe("2026-09-14");
    expect(p.endedAt! - p.startedAt!, "the duration is untouched by construction").toBe(data.endedAt - data.startedAt);
    expect(new Date(p.startedAt!).getUTCDate()).toBe(14);
    // The time of day is kept: this happened at six in the evening, on a
    // different Tuesday.
    expect(new Date(p.startedAt!).getUTCHours()).toBe(18);
  });

  it("moves forward as readily as back", () => {
    expect(movedToDay(data, "2026-09-20")!.date).toBe("2026-09-20");
    expect(new Date(movedToDay(data, "2026-09-20")!.startedAt!).getUTCDate()).toBe(20);
  });

  it("crosses a month end without arithmetic drift", () => {
    const p = movedToDay({ ...data, date: "2026-10-02" }, "2026-09-29")!;
    expect(p.date).toBe("2026-09-29");
    expect(Math.round((data.startedAt - p.startedAt!) / 86_400_000)).toBe(3);
  });

  it("says nothing when nothing moved", () => {
    expect(movedToDay(data, "2026-09-17")).toBeNull();
  });

  it("says nothing rather than inventing a date", () => {
    expect(movedToDay(data, "")).toBeNull();
    expect(movedToDay(data, "tomorrow")).toBeNull();
    expect(movedToDay({ date: "not a date" }, "2026-09-14")).toBeNull();
  });

  it("carries only the stamps that exist", () => {
    expect(movedToDay({ date: "2026-09-17" }, "2026-09-14")).toEqual({ date: "2026-09-14" });
  });
});

describe("the finished-workout screen is fully editable", () => {
  it("opens the session's own name and date", () => {
    expect(FLOW).toContain("<WorkoutMetaSheet initialName={w.data.dayName} initialDate={w.data.date}");
    expect(FLOW).toContain('<button className="nav-action-text" onClick={() => setWorkoutMetaOpen(true)}>Edit</button>');
    // A session that already happened cannot have happened tomorrow, the same
    // rule BackdateSheet keeps.
    expect(FLOW).toContain('<input className="input" type="date" max={todayISO()} value={date} aria-label="Session Date"');
  });

  it("cases the session's name the way every other workout title is cased", () => {
    expect(FLOW).toContain("onSave({ dayName: workoutTitle(name.trim()), date: date || initialDate })");
  });

  // This is the bug the add and remove would otherwise have walked into: the
  // list was the SAVED exercises while each strip read its sets out of the
  // draft by index. Fine while the only edit is to a set; a mismatched pair of
  // lists the moment one can be added or removed.
  it("renders the draft, not the saved list", () => {
    expect(FLOW).toContain("{workoutDraft.map((e, ei) => (");
    expect(FLOW).not.toContain("entries={workoutDraft[ei]?.sets ?? []}");
  });

  it("gives each exercise the same overflow every other gym row wears", () => {
    expect(FLOW).toContain('onClick={() => setWorkoutExMenu(ei)}');
    expect(FLOW).toContain('label: "Rename", onClick: () => { setWorkoutExRename(workoutExMenu); setWorkoutExMenu(null); }');
    expect(FLOW).toContain('label: "Remove From This Workout"');
  });

  it("can add a lift that was never logged, with its loading convention", () => {
    expect(FLOW).toContain('<button className="row-create" onClick={() => setWorkoutAddOpen(true)}>Add Exercise</button>');
    expect(FLOW).toContain("exerciseId: `add${Date.now().toString(36)}`");
    const add = FLOW.slice(FLOW.indexOf("{workoutAddOpen && ("), FLOW.indexOf("{workoutAddOpen && (") + 1400);
    expect(add, "the strip would step it by 5 for everything").toContain("...loadFields(draft)");
    expect(add, "and it belongs in the library like any other new lift").toContain("seedLibrary(draft);");
  });

  // Every exercise move lands in the draft, so Save Changes is still the one
  // write and backing out is still the way to undo. A removal that wrote
  // straight through would be the only destructive edit here with no way back.
  it("keeps every exercise edit behind the one Save", () => {
    expect(FLOW).toContain("const patchDraft = (fn: (d: WorkoutExercise[]) => WorkoutExercise[])");
    expect(FLOW).toContain("patchDraft((d) => d.filter((_, x) => x !== i));");
    expect(FLOW).toContain("svc.updateWorkout(w.id, { exercises: workoutDraft })");
  });

  it("closes every sheet it opened when the screen closes", () => {
    for (const s of ["setWorkoutMetaOpen(false)", "setWorkoutExMenu(null)", "setWorkoutExRename(null)", "setWorkoutAddOpen(false)"]) {
      expect(FLOW.slice(FLOW.indexOf("const closeWorkout = () => {"), FLOW.indexOf("const patchDraft")), s).toContain(s);
    }
  });
});
