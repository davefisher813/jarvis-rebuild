import { describe, it, expect } from "vitest";
import { readLive, writeLive, clearLive, logSet, setLoggedSets, undoLast, skipExercise, swapExercise, addExerciseMidSession, sessionExercisesSameAsLastTime, queueFinished, readPending, flushPending, hasWork, type LiveSession, type Storage2 } from "./liveSession";
import type { ProgramDay, SetEntry, WorkoutData, WorkoutExercise } from "./types";

// The offline contract: a set logged in a basement is never lost, and a
// finished session that could not reach the server stays queued in order.

function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

let sid = 0;
const mkSet = (over: Partial<SetEntry> = {}): SetEntry => ({ id: `s${sid++}`, ...over });

const ex = (name: string): WorkoutExercise => ({ exerciseId: name, name, kind: "weight_reps", unit: "lb", sets: [] });
const live = (): LiveSession => ({
  programId: "p", dayId: "d", dayName: "Pull", date: "2026-08-04", startedAt: 0, idx: 0,
  exercises: [ex("Row"), ex("Curl")],
});
const wd = (date: string): WorkoutData =>
  ({ programId: "p", dayId: "d", dayName: "Pull", date, startedAt: 0, endedAt: 1, exercises: [] });

describe("live session survives with no network", () => {
  it("round-trips through storage and clears", () => {
    const s = mem();
    expect(readLive(s)).toBeNull();
    writeLive(live(), s);
    expect(readLive(s)!.dayName).toBe("Pull");
    clearLive(s);
    expect(readLive(s)).toBeNull();
  });

  it("logs, undoes, and skips without touching other exercises", () => {
    let l = live();
    l = logSet(l, 0, mkSet({ w: 135, r: 8 }));
    l = logSet(l, 0, mkSet({ w: 135, r: 7 }));
    expect(l.exercises[0]!.sets).toHaveLength(2);
    expect(l.exercises[1]!.sets).toHaveLength(0);
    l = undoLast(l, 0);
    expect(l.exercises[0]!.sets).toMatchObject([{ w: 135, r: 8 }]);
    l = skipExercise(l, 1);
    expect(l.exercises[1]!.skipped).toBe(true);
    expect(l.exercises[0]!.skipped).toBeUndefined();
  });

  // THE SET STRIP (catalog §3.1): the strip owns add / duplicate / delete /
  // reorder / edit as ONE change to the whole array. setLoggedSets is where
  // that lands in the live session -- everything the strip does in the
  // session screen is, underneath, one call to this.
  it("setLoggedSets replaces the whole logged strip for one exercise only", () => {
    let l = live();
    l = logSet(l, 0, mkSet({ w: 135, r: 8 }));
    const reordered = [mkSet({ w: 145, r: 5 }), ...l.exercises[0]!.sets];
    l = setLoggedSets(l, 0, reordered);
    expect(l.exercises[0]!.sets).toEqual(reordered);
    expect(l.exercises[1]!.sets).toHaveLength(0); // the other exercise is untouched

    // Deleting a chip (swipe) is just a shorter array through the same call.
    l = setLoggedSets(l, 0, [reordered[1]!]);
    expect(l.exercises[0]!.sets).toEqual([reordered[1]]);
  });

  it("corrupt storage reads as no session rather than throwing mid-gym", () => {
    const s = mem();
    s.write("jarvis.gym.live.v1", "{not json");
    expect(readLive(s)).toBeNull();
  });
});

describe("pending queue", () => {
  it("keeps what could not be saved, in order, and drops what landed", async () => {
    const s = mem();
    queueFinished(wd("2026-08-01"), s);
    queueFinished(wd("2026-08-02"), s);
    expect(readPending(s)).toHaveLength(2);

    // first attempt: the network is down for everything
    let saved = await flushPending(async () => { throw new Error("offline"); }, s);
    expect(saved).toBe(0);
    expect(readPending(s).map((w) => w.date)).toEqual(["2026-08-01", "2026-08-02"]);

    // second attempt: only the first succeeds
    saved = await flushPending(async (w) => (w.date === "2026-08-01" ? "id1" : null), s);
    expect(saved).toBe(1);
    expect(readPending(s).map((w) => w.date)).toEqual(["2026-08-02"]);

    // third: everything lands and the queue empties
    saved = await flushPending(async () => "id2", s);
    expect(saved).toBe(1);
    expect(readPending(s)).toHaveLength(0);
  });

  it("flushing an empty queue is a no-op", async () => {
    const s = mem();
    expect(await flushPending(async () => "x", s)).toBe(0);
  });
});

describe("hasWork", () => {
  it("partial work counts as a session; nothing logged does not", () => {
    expect(hasWork([{ ...ex("Row"), sets: [mkSet({ w: 95, r: 5 })] }])).toBe(true);
    expect(hasWork([ex("Row")])).toBe(false);
    expect(hasWork([{ ...ex("Row"), sets: [mkSet({ skipped: true })] }])).toBe(false);
  });

  // A "done" chip (no numbers) still counts as real work: it is a fact that
  // happened, not a value that happened to be zero (catalog §1.10, §3.1).
  it("a done-kind mark counts as work too", () => {
    expect(hasWork([{ ...ex("Stretching"), kind: "done", sets: [mkSet({ done: true })] }])).toBe(true);
  });
});

describe("swapExercise: mid-session substitution (catalog §3.9)", () => {
  it("replaces the exercise at idx and clears whatever was already logged there", () => {
    let l = live();
    l = logSet(l, 0, mkSet({ w: 135, r: 8 }));
    l = swapExercise(l, 0, { name: "Landmine Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek9" });
    expect(l.exercises[0]).toMatchObject({ name: "Landmine Press", exerciseKey: "ek9", sets: [], custom: true });
    expect(l.exercises[1]!.name).toBe("Curl"); // the other exercise is untouched
  });

  it("carries no plan target -- a swap has nothing planned for it", () => {
    let l = live();
    l = swapExercise(l, 0, { name: "Landmine Press", kind: "weight_reps" });
    expect(l.exercises[0]!.plan).toEqual([]);
  });
});

describe("addExerciseMidSession: catalog §3.10", () => {
  it("appends a new exercise without touching the plan already on screen", () => {
    let l = live();
    l = addExerciseMidSession(l, { name: "Face Pulls", kind: "reps", plan: [mkSet({ r: 15 })] });
    expect(l.exercises).toHaveLength(3);
    const added = l.exercises[2]!;
    expect(added).toMatchObject({ name: "Face Pulls", kind: "reps", custom: true, sets: [] });
    expect(added.plan).toHaveLength(1);
    expect(l.exercises[0]!.name).toBe("Row"); // the original two are untouched
  });

  it("mints an exerciseId that no other exercise in the session carries", () => {
    let l = live();
    l = addExerciseMidSession(l, { name: "Face Pulls", kind: "reps", plan: [] });
    const ids = l.exercises.map((e) => e.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sessionExercisesSameAsLastTime: catalog §3.13", () => {
  const day: ProgramDay = {
    id: "d1", name: "Push", exercises: [
      { id: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: [mkSet({ w: 95, r: 5 })] },
      { id: "e2", name: "Overhead Press", kind: "weight_reps", unit: "lb", sets: [mkSet({ w: 65, r: 5 })] },
    ],
  };

  it("pre-fills the plan from the prior session's actual numbers, matched by exercise id", () => {
    const last: WorkoutData = {
      programId: "p", dayId: "d1", dayName: "Push", date: "2026-08-01", startedAt: 0, endedAt: 1,
      exercises: [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: [mkSet({ w: 135, r: 8 }), mkSet({ w: 135, r: 7 })] }],
    };
    const out = sessionExercisesSameAsLastTime(day, last);
    expect(out[0]).toMatchObject({ name: "Bench", custom: true, sets: [] });
    expect(out[0]!.plan).toMatchObject([{ w: 135, r: 8 }, { w: 135, r: 7 }]);
    // an exercise with nothing prior falls back to no override at all --
    // GymFlow reads the program's own plan for it, same as any normal day.
    expect(out[1]).toMatchObject({ name: "Overhead Press", sets: [] });
    expect(out[1]!.custom).toBeUndefined();
  });

  it("a wholly skipped prior exercise falls back to the program's own plan", () => {
    const last: WorkoutData = {
      programId: "p", dayId: "d1", dayName: "Push", date: "2026-08-01", startedAt: 0, endedAt: 1,
      exercises: [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", sets: [mkSet({ skipped: true })] }],
    };
    const out = sessionExercisesSameAsLastTime(day, last);
    expect(out[0]!.custom).toBeUndefined();
  });
});
