import { describe, it, expect } from "vitest";
import type { Program, Workout, WorkoutExercise, Exercise } from "./types";
import type { GymSettings } from "./settings";
import { DEFAULT_GYM_SETTINGS } from "./settings";
import { composeLibrary, searchLibrary, fallbackKey } from "./library";
import { libraryRows } from "./libraryEdit";
import { readClassStore } from "./classify";
import { defaultView, shownLibraryCount, seedsFromSettings } from "./libraryView";
import {
  deletePatch, deleteUndoSafe, goesLines, goalsOnExercise, historyLine, inProgressOf, invertDeletePatch,
  planDelete, programLine, settingsApply, settingsBefore, settingsRestore, settingsWithout, staysLine,
  type DeletePatch, type RestorePatch,
} from "./deleteExercise";
import type { Goal } from "../life/types";

// DELETE EXERCISE, THE PURE HALF (2026-10-01). What the plan says, what the
// patch writes, and that its inverse puts every byte back. The flow that runs
// these writes is proven end to end in GymFlow.deleteExercise.test.tsx.

const ex = (id: string, name: string, key?: string, over: Partial<Exercise> = {}): Exercise =>
  ({ id, name, kind: "weight_reps", sets: [], ...(key ? { exerciseKey: key } : {}), ...over });
const wex = (name: string, key: string | undefined, nSets: number, over: Partial<WorkoutExercise> = {}): WorkoutExercise =>
  ({ exerciseId: "x", name, kind: "weight_reps", ...(key ? { exerciseKey: key } : {}),
    sets: Array.from({ length: nSets }, (_, i) => ({ id: `s${i}`, w: 100, r: 5 })), ...over }) as WorkoutExercise;

const program = (id: string, days: Exercise[][], archived = false): Program => ({
  id,
  data: { name: id, ...(archived ? { archived: true } : {}), weeks: [{ id: id + "w", label: "Week 1", days: days.map((exs, i) => ({ id: `${id}d${i}`, name: `Day ${i}`, exercises: exs })) }] },
}) as unknown as Program;

const workout = (id: string, date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id, data: { programId: "p1", dayId: "d", dayName: "Day", date, startedAt: Date.parse(date), endedAt: Date.parse(date) + 1, exercises } }) as unknown as Workout;

const BENCH = ex("e1", "Bench Press", "ek-bench");
const CURL = ex("e2", "Curl", "ek-curl");
const MADE = ex("e3", "Face Pull", "ek-face");

const programs = [
  program("p1", [[BENCH, CURL], [MADE]]),
  program("p0", [[ex("e9", "Bench Press", "ek-bench")]], true),
];
const workouts = [
  workout("w1", "2026-09-01", [wex("Bench Press", "ek-bench", 3), wex("Curl", "ek-curl", 2)]),
  workout("w2", "2026-09-05", [wex("Bench Press", "ek-bench", 4)]), // only bench: emptied by a history delete
  workout("w3", "2026-09-09", [wex("Curl", "ek-curl", 3)]),
];
const row = (name: string, key: string) => ({ key, name, kind: "weight_reps" as const, exerciseKey: key });

/** What the store does with a patch, so the tests can apply and invert it. */
function apply(ws: Workout[], ps: Program[], p: DeletePatch | (RestorePatch & { remove?: undefined })): { workouts: Workout[]; programs: Program[] } {
  const rm = new Set(("remove" in p && p.remove ? p.remove : []).map((w) => w.id));
  let outW = ws.filter((w) => !rm.has(w.id)).map((w) => {
    const hit = p.workouts.find((x) => x.id === w.id);
    return hit ? { ...w, data: { ...w.data, exercises: hit.exercises } } : w;
  });
  if ("restore" in p) outW = [...outW, ...p.restore];
  const outP = ps.map((pr) => {
    const hit = p.programs.find((x) => x.id === pr.id);
    return hit ? { ...pr, data: { ...pr.data, weeks: hit.weeks } } : pr;
  });
  return { workouts: outW.sort((a, b) => a.id.localeCompare(b.id)), programs: outP };
}
const bytes = (x: unknown) => JSON.stringify(x);

describe("planDelete: three situations, counted from the records", () => {
  it("an exercise nobody has planned or used is 'unused'", () => {
    const plan = planDelete({ row: row("Test Press", "ek-test"), workouts, programs });
    expect(plan.tier).toBe("unused");
    expect([plan.sessions, plan.sets, plan.programDays, plan.emptied]).toEqual([0, 0, 0, 0]);
    expect(historyLine(plan)).toBeNull();
    expect(programLine(plan)).toBeNull();
  });

  it("one that is only in programs is 'programs', and counts the days, archived programs too", () => {
    const plan = planDelete({ row: row("Face Pull", "ek-face"), workouts, programs });
    expect(plan.tier).toBe("programs");
    expect(plan.programDays).toBe(1);
    expect(programLine(plan)).toBe("Used in 1 program day");
    const bench = planDelete({ row: row("Bench Press", "ek-bench"), workouts, programs });
    expect(bench.programDays).toBe(2); // p1 day 0 and the archived p0 day 0
    expect(programLine(bench)).toBe("Used in 2 program days");
  });

  it("one with logged history is 'history', with sessions, sets and the sessions it would empty", () => {
    const plan = planDelete({ row: row("Bench Press", "ek-bench"), workouts, programs });
    expect(plan.tier).toBe("history");
    expect(plan.sessions).toBe(2);
    expect(plan.sets).toBe(7);
    expect(plan.emptied).toBe(1);
    expect(historyLine(plan)).toBe("2 sessions, 7 sets");
  });

  it("says 1 session, 1 set in the singular", () => {
    const plan = planDelete({ row: row("Curl", "ek-curl"), workouts: [workout("w", "2026-09-01", [wex("Curl", "ek-curl", 1)])], programs: [] });
    expect(historyLine(plan)).toBe("1 session, 1 set");
  });

  it("skipped sets are not counted as sets", () => {
    const e = wex("Curl", "ek-curl", 3); e.sets[0] = { ...e.sets[0]!, skipped: true };
    const plan = planDelete({ row: row("Curl", "ek-curl"), workouts: [workout("w", "2026-09-01", [e])], programs: [] });
    expect(plan.sets).toBe(2);
  });

  it("an exercise with no key is found by its name and measurement, as the library finds it", () => {
    const fb = fallbackKey("Old Lift", "weight_reps");
    const ws = [workout("w", "2026-09-01", [wex("Old Lift", undefined, 2), wex("Curl", "ek-curl", 1)])];
    const plan = planDelete({ row: { key: fb, name: "Old Lift", kind: "weight_reps" }, workouts: ws, programs: [] });
    expect(plan.sessions).toBe(1);
    expect(deletePatch(ws, [], { key: fb }, true).workouts[0]!.exercises.map((e) => e.name)).toEqual(["Curl"]);
  });
});

describe("the sheet's words come from the plan", () => {
  it("unused: only the list, and the saved details that exist", () => {
    const settings = { ...DEFAULT_GYM_SETTINGS, favoriteKeys: ["ek-test"], aliases: { "ek-test": ["Old"] } };
    const plan = planDelete({ row: row("Test Press", "ek-test"), workouts, programs, settings });
    expect(goesLines(plan)).toEqual(["It leaves your Exercises list", "It also clears its favorite mark and its old names"]);
  });

  it("history: names the sessions and the emptied ones, and the program days", () => {
    const plan = planDelete({ row: row("Bench Press", "ek-bench"), workouts, programs });
    expect(goesLines(plan)).toEqual([
      "It leaves your Exercises list",
      "It comes out of 2 program days",
      "Its 2 sessions come out of your history",
      "1 Session left empty is removed",
    ]);
  });

  it("a single session reads in the singular", () => {
    const plan = planDelete({ row: row("Curl", "ek-curl"), workouts: [workout("w", "2026-09-01", [wex("Curl", "ek-curl", 1)])], programs: [] });
    expect(goesLines(plan)).toContain("Its 1 session comes out of your history");
    expect(goesLines(plan)).toContain("1 Session left empty is removed");
  });

  it("goals on the exercise are named as staying", () => {
    const goal = (measure: unknown) => ({ id: "g", data: { title: "g", measure } }) as unknown as Goal;
    const goals = [
      goal({ kind: "lift", exercise: "Bench Press", exerciseKey: "ek-bench", measureKind: "weight_reps", target: { w: 225, r: 5 } }),
      goal({ kind: "training", per: "week", times: 2, exercise: "Bench Press", exerciseKey: "ek-bench" }),
      goal({ kind: "training", per: "week", times: 2 }),
      goal({ kind: "lift", exercise: "Curl", exerciseKey: "ek-curl", measureKind: "weight_reps", target: { w: 50, r: 8 } }),
    ];
    expect(goalsOnExercise(goals, { name: "Bench Press", exerciseKey: "ek-bench" })).toHaveLength(2);
    const plan = planDelete({ row: row("Bench Press", "ek-bench"), workouts, programs, goals });
    expect(staysLine(plan)).toBe("2 Goals on it stay as they are");
  });
});

describe("deletePatch: what it writes", () => {
  it("without history it touches only programs, never a session", () => {
    const p = deletePatch(workouts, programs, row("Bench Press", "ek-bench"), false);
    expect(p.workouts).toEqual([]);
    expect(p.remove).toEqual([]);
    expect(p.programs.map((x) => x.id).sort()).toEqual(["p0", "p1"]);
    const day0 = p.programs.find((x) => x.id === "p1")!.weeks[0]!.days[0]!;
    expect(day0.exercises.map((e) => e.name)).toEqual(["Curl"]);
    // The archived program loses it too: it would otherwise bring it back.
    expect(p.programs.find((x) => x.id === "p0")!.weeks[0]!.days[0]!.exercises).toEqual([]);
  });

  it("with history it rewrites the sessions that keep other work, and removes the ones it empties", () => {
    const p = deletePatch(workouts, programs, row("Bench Press", "ek-bench"), true);
    expect(p.workouts.map((w) => w.id)).toEqual(["w1"]);
    expect(p.workouts[0]!.exercises.map((e) => e.name)).toEqual(["Curl"]);
    expect(p.remove.map((w) => w.id)).toEqual(["w2"]);
    // w3 never held it and is not in the patch at all.
    expect(p.workouts.concat(p.remove as never).some((w) => w.id === "w3")).toBe(false);
  });

  it("an exercise in nothing is an empty patch", () => {
    expect(deletePatch(workouts, programs, row("Nope", "ek-nope"), true)).toEqual({ workouts: [], programs: [], remove: [] });
  });

  it("leaves the rest of a superset together, and a lone survivor ungrouped", () => {
    const a = ex("a", "A", "ek-a", { groupId: "g" }), b = ex("b", "B", "ek-b", { groupId: "g" }), c = ex("c", "C", "ek-c", { groupId: "g" });
    const three = [program("p", [[a, b, c]])];
    const out = deletePatch([], three, row("B", "ek-b"), false).programs[0]!.weeks[0]!.days[0]!.exercises;
    expect(out.map((e) => [e.name, e.groupId])).toEqual([["A", "g"], ["C", "g"]]);
    const pair = [program("p", [[a, b]])];
    const left = deletePatch([], pair, row("B", "ek-b"), false).programs[0]!.weeks[0]!.days[0]!.exercises;
    expect(left).toHaveLength(1);
    expect(left[0]!.groupId).toBeUndefined();
  });

  it("is idempotent: running it on its own result changes nothing", () => {
    const first = deletePatch(workouts, programs, row("Bench Press", "ek-bench"), true);
    const after = apply(workouts, programs, first);
    expect(deletePatch(after.workouts, after.programs, row("Bench Press", "ek-bench"), true)).toEqual({ workouts: [], programs: [], remove: [] });
  });
});

describe("the inverse restores byte-identical data", () => {
  for (const withHistory of [false, true]) {
    it(`programs and workouts come back exactly (withHistory ${withHistory})`, () => {
      const patch = deletePatch(workouts, programs, row("Bench Press", "ek-bench"), withHistory);
      const inverse = invertDeletePatch(patch, workouts, programs);
      const gone = apply(workouts, programs, patch);
      expect(bytes(gone)).not.toBe(bytes({ workouts, programs }));
      const back = apply(gone.workouts, gone.programs, inverse);
      expect(bytes(back)).toBe(bytes({ workouts: [...workouts].sort((a, b) => a.id.localeCompare(b.id)), programs }));
    });
  }

  it("brings a removed session back whole, under its own id", () => {
    const patch = deletePatch(workouts, programs, row("Bench Press", "ek-bench"), true);
    const inverse = invertDeletePatch(patch, workouts, programs);
    expect(inverse.restore.map((w) => w.id)).toEqual(["w2"]);
    expect(bytes(inverse.restore[0])).toBe(bytes(workouts[1]));
  });
});

describe("deleteUndoSafe: only while the records are as the delete left them", () => {
  const patch = deletePatch(workouts, programs, row("Bench Press", "ek-bench"), true);
  const gone = apply(workouts, programs, patch);

  it("is safe straight after the delete", () => {
    expect(deleteUndoSafe(patch, gone)).toBe(true);
  });

  it("is not safe once a rewritten session was edited since", () => {
    const edited = { ...gone, workouts: gone.workouts.map((w) => (w.id === "w1" ? { ...w, data: { ...w.data, exercises: [] } } : w)) };
    expect(deleteUndoSafe(patch, edited)).toBe(false);
  });

  it("is not safe once a program was edited since", () => {
    const edited = { ...gone, programs: gone.programs.map((p) => (p.id === "p1" ? { ...p, data: { ...p.data, weeks: [] } } : p)) };
    expect(deleteUndoSafe(patch, edited)).toBe(false);
  });

  it("is not safe if a removed session's id has been taken again", () => {
    expect(deleteUndoSafe(patch, { ...gone, workouts: [...gone.workouts, workouts[1]!] })).toBe(false);
  });
});

describe("settings: every field keyed by the exercise is cleaned, and Undo is exact", () => {
  const settings = {
    ...DEFAULT_GYM_SETTINGS,
    hiddenKeys: ["ek-test", "ek-other"],
    aliases: { "ek-test": ["Old Name"], "ek-other": ["Other Old"] },
    favoriteKeys: ["ek-test", "ek-other"],
    muscleByKey: { "ek-test": ["chest"], "ek-other": ["back"] },
    classByKey: { "ek-test": { primary: ["chest"], archived: true }, "ek-other": { primary: ["back"] } },
    dismissedDupes: ["ek-other|ek-test", "ek-test|ek-zed", "ek-a|ek-b"],
    createdLifts: [{ key: "ek-test", name: "Test Press", kind: "weight_reps" }, { key: "ek-other", name: "Other", kind: "weight_reps" }],
    merges: [{ at: 1, loserName: "A", survivorName: "Test Press", survivorKey: "ek-test", sessions: 1, programDays: 0 }],
  } as unknown as GymSettings;
  const r = { key: "ek-test", exerciseKey: "ek-test", name: "Test Press", kind: "weight_reps" as const };

  it("removes the key from every keyed field and leaves the other exercises alone", () => {
    const changed = settingsWithout(settings, r);
    expect(Object.keys(changed).sort()).toEqual(["aliases", "classByKey", "createdLifts", "dismissedDupes", "favoriteKeys", "hiddenKeys", "muscleByKey"]);
    const next = settingsApply(settings, changed);
    expect(next.hiddenKeys).toEqual(["ek-other"]);
    expect(next.favoriteKeys).toEqual(["ek-other"]);
    expect(next.aliases).toEqual({ "ek-other": ["Other Old"] });
    expect(next.muscleByKey).toEqual({ "ek-other": ["back"] });
    expect(next.classByKey).toEqual({ "ek-other": { primary: ["back"] } });
    expect(next.createdLifts!.map((c) => c.key)).toEqual(["ek-other"]);
    expect(next.dismissedDupes).toEqual(["ek-a|ek-b"]);
    // The record of the merge is history, and stays.
    expect(next.merges).toEqual(settings.merges);
    // And the rack and everything else is untouched.
    expect(next.barWeight).toBe(settings.barWeight);
  });

  it("changes nothing for an exercise the settings never mention, field for field", () => {
    expect(settingsWithout(settings, { key: "ek-none", name: "None", kind: "weight_reps" })).toEqual({});
    expect(bytes(settingsApply(settings, {}))).toBe(bytes(settings));
  });

  it("Undo restores the settings byte for byte", () => {
    const changed = settingsWithout(settings, r);
    const before = settingsBefore(settings, changed);
    const next = settingsApply(settings, changed);
    expect(bytes(next)).not.toBe(bytes(settings));
    expect(bytes(settingsRestore(next, before))).toBe(bytes(settings));
  });

  it("a field that was absent is removed again by Undo, not left as an empty list", () => {
    const sparse = { ...DEFAULT_GYM_SETTINGS, hiddenKeys: ["ek-test"] } as GymSettings;
    const changed = settingsWithout(sparse, r);
    expect(Object.keys(changed)).toEqual(["hiddenKeys"]);
    const next = settingsApply(sparse, changed);
    expect(next.hiddenKeys).toEqual([]);
    expect(bytes(settingsRestore(next, settingsBefore(sparse, changed)))).toBe(bytes(sparse));
    // settingsRestore handles the absent case explicitly too.
    expect("favoriteKeys" in settingsRestore(next, { favoriteKeys: undefined })).toBe(false);
  });

  it("clears the key it is filed under in the older stores as well as its exerciseKey", () => {
    const s = { ...DEFAULT_GYM_SETTINGS, favoriteKeys: ["ek-new"] } as GymSettings;
    const stamped = { key: fallbackKey("Test Press", "weight_reps"), exerciseKey: "ek-new", name: "Test Press", kind: "weight_reps" as const };
    expect(settingsWithout(s, stamped).favoriteKeys).toEqual([]);
  });

  it("a hand-made seed that a real sighting shadows is cleared too, or it walks back into the list", () => {
    // The seed has one key and the logged lift another, same name and
    // measurement: library.withCreated hides the seed behind the sighting.
    const s = { ...DEFAULT_GYM_SETTINGS, createdLifts: [{ key: "ek-seed", name: "Leg Curls", kind: "weight_reps" }] } as GymSettings;
    const ws = [workout("w", "2026-09-01", [wex("Leg Curls", "ek-logged", 3)])];
    const before = composeLibrary([], ws, { created: s.createdLifts });
    expect(before.map((e) => e.key)).toEqual(["ek-logged"]);
    const logged = { key: "ek-logged", exerciseKey: "ek-logged", name: "Leg Curls", kind: "weight_reps" as const };
    const changed = settingsWithout(s, logged);
    expect(changed.createdLifts).toEqual([]);
    const after = apply(ws, [], deletePatch(ws, [], logged, true));
    const lib = composeLibrary([], after.workouts, { created: settingsApply(s, changed).createdLifts });
    expect(lib).toEqual([]);
  });
});

describe("after a delete, the exercise is gone from every list", () => {
  const settings = {
    ...DEFAULT_GYM_SETTINGS,
    createdLifts: [{ key: "ek-test", name: "Test Press", kind: "weight_reps" }],
    favoriteKeys: ["ek-test"], hiddenKeys: ["ek-test"],
    classByKey: { "ek-test": { primary: ["chest"] } },
  } as unknown as GymSettings;
  const seedsOf = (s: GymSettings) => seedsFromSettings(s);

  it("a hand-made, unused exercise leaves the library, the page's default list, the badge and the pickers", () => {
    const visible = { ...settings, hiddenKeys: [] } as GymSettings;
    const countBefore = shownLibraryCount(programs, workouts, seedsOf(visible));
    expect(composeLibrary(programs, workouts, seedsOf(visible)).map((e) => e.name)).toContain("Test Press");
    expect(searchLibrary(composeLibrary(programs, workouts, seedsOf(visible)), "test").map((e) => e.name)).toEqual(["Test Press"]);

    const r = { key: "ek-test", exerciseKey: "ek-test", name: "Test Press", kind: "weight_reps" as const };
    const patch = deletePatch(workouts, programs, r, false);
    expect(patch).toEqual({ workouts: [], programs: [], remove: [] });
    const next = settingsApply(visible, settingsWithout(visible, r));
    const lib = composeLibrary(programs, workouts, seedsOf(next));
    expect(lib.map((e) => e.name)).not.toContain("Test Press");
    expect(searchLibrary(lib, "test")).toEqual([]);
    const rows = libraryRows(lib, workouts, next.hiddenKeys ?? []);
    const view = defaultView(rows, readClassStore(next.classByKey, next.muscleByKey));
    expect(view.rows.map((x) => x.name)).not.toContain("Test Press");
    expect(shownLibraryCount(programs, workouts, seedsOf(next))).toBe(countBefore - 1);
  });

  it("an exercise with history leaves everything once its history goes", () => {
    const r = row("Bench Press", "ek-bench");
    const patch = deletePatch(workouts, programs, r, true);
    const after = apply(workouts, programs, patch);
    const lib = composeLibrary(after.programs, after.workouts, {});
    expect(lib.map((e) => e.name)).toEqual(["Curl", "Face Pull"]);
    expect(searchLibrary(lib, "bench")).toEqual([]);
  });
});

describe("inProgressOf: an exercise in a workout right now is not deletable", () => {
  const live = { exercises: [wex("Bench Press", "ek-bench", 1)] };
  it("blocks on the live session", () => {
    expect(inProgressOf({ key: "ek-bench", exerciseKey: "ek-bench" }, live)).toBe("live");
  });
  it("blocks on a finished workout still waiting to save", () => {
    expect(inProgressOf({ key: "ek-bench", exerciseKey: "ek-bench" }, null, [{ exercises: live.exercises }])).toBe("pending");
  });
  it("lets an exercise that is in neither go", () => {
    expect(inProgressOf({ key: "ek-curl", exerciseKey: "ek-curl" }, live, [{ exercises: live.exercises }])).toBeNull();
    expect(inProgressOf({ key: "ek-curl" }, null)).toBeNull();
  });
  it("finds a pre-library exercise in the live session by its name and measurement", () => {
    const l = { exercises: [wex("Old Lift", undefined, 1)] };
    expect(inProgressOf({ key: fallbackKey("Old Lift", "weight_reps") }, l)).toBe("live");
  });
});
