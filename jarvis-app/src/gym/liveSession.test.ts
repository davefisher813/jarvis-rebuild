import { describe, it, expect } from "vitest";
import { readLive, writeLive, clearLive, logSet, setLoggedSets, undoLast, skipExercise, swapExercise, addExerciseMidSession, sessionExercisesSameAsLastTime, queueFinished, readPending, flushPending, hasWork, isStillActive, STALE_GRACE_MS, type LiveSession, type Storage2 } from "./liveSession";
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
    // Since D7 the new chip gains an `at` stamp on the way in; everything
    // else about the array is exactly what was handed over.
    expect(l.exercises[0]!.sets.map(({ at: _, ...rest }) => rest)).toEqual(
      reordered.map(({ at: _, ...rest }) => rest));
    expect(l.exercises[1]!.sets).toHaveLength(0); // the other exercise is untouched

    // Deleting a chip (swipe) is just a shorter array through the same call.
    const kept = l.exercises[0]!.sets[1]!;
    l = setLoggedSets(l, 0, [kept]);
    expect(l.exercises[0]!.sets).toEqual([kept]);
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

  // GYM-F-23 (2026-09-05): the two mount effects in GymFlow flush in the
  // same commit; the second queues the unfinished session first. A was
  // saved twice and Recent showed it twice.
  it("GYM-F-23: two flushes in one commit save each session exactly once, the later-queued one included", async () => {
    const s = mem();
    const server: string[] = [];
    const save = async (w: { date: string }) => { await new Promise((r) => setTimeout(r, 15)); server.push(w.date); return "id-" + w.date; };
    queueFinished(wd("2026-08-01"), s); // A: failed to save in the basement yesterday
    const reloadFlush = flushPending(save, s);
    queueFinished(wd("2026-08-02"), s); // B: the recovery effect queues the unfinished session...
    const recoveryFlush = flushPending(save, s); // ...and flushes
    // Which pass carries B depends on when the first snapshot is taken; what
    // matters is that each session lands once, in order, across both.
    expect((await reloadFlush) + (await recoveryFlush)).toBe(2);
    expect(server).toEqual(["2026-08-01", "2026-08-02"]);
    expect(readPending(s)).toHaveLength(0);
  });

  it("GYM-F-23: a session queued while a flush is in flight survives that flush", async () => {
    const s = mem();
    queueFinished(wd("2026-08-01"), s);
    const first = flushPending(async () => { await new Promise((r) => setTimeout(r, 15)); return "id"; }, s);
    await new Promise((r) => setTimeout(r, 3));
    queueFinished(wd("2026-08-02"), s);
    await first;
    expect(readPending(s).map((w) => w.date)).toEqual(["2026-08-02"]);
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

describe("isStillActive: sessions resume, not fragment (2026-08-30)", () => {
  const NOON_AUG_24 = Date.parse("2026-08-24T12:00:00");

  it("a same-day session is always active, no matter how stale lastActivityAt looks", () => {
    const s = live();
    expect(isStillActive({ ...s, date: "2026-08-24", startedAt: NOON_AUG_24, lastActivityAt: NOON_AUG_24 - 999 * STALE_GRACE_MS }, "2026-08-24", NOON_AUG_24)).toBe(true);
  });

  it("a backdated session is always active regardless of date or activity", () => {
    const s = live();
    expect(isStillActive({ ...s, date: "2026-08-01", backdated: true, lastActivityAt: NOON_AUG_24 - 999 * STALE_GRACE_MS }, "2026-08-24", NOON_AUG_24)).toBe(true);
  });

  // THE BUG (training catalog audit, §5.4): a workout started at 11:58pm and
  // still being logged at 12:05am used to look identical to one abandoned
  // the night before, because both have date !== today. Recent real activity
  // is what tells them apart.
  it("crossed midnight but logged a set 2 minutes ago -- still active", () => {
    const startedAt = Date.parse("2026-08-24T23:58:00");
    const lastActivityAt = Date.parse("2026-08-25T00:05:00");
    const now = Date.parse("2026-08-25T00:07:00"); // remount right after
    const s: LiveSession = { ...live(), date: "2026-08-24", startedAt, lastActivityAt };
    expect(isStillActive(s, "2026-08-25", now)).toBe(true);
  });

  it("crossed midnight and nothing logged in 7 hours -- genuinely stale, recovered", () => {
    const startedAt = Date.parse("2026-08-24T23:58:00");
    const lastActivityAt = Date.parse("2026-08-25T00:05:00");
    const now = Date.parse("2026-08-25T07:10:00"); // 7+ hours of silence
    const s: LiveSession = { ...live(), date: "2026-08-24", startedAt, lastActivityAt };
    expect(isStillActive(s, "2026-08-25", now)).toBe(false);
  });

  it("right at the edge of the grace window: just under is active, just over is not", () => {
    const s: LiveSession = { ...live(), date: "2026-08-24", startedAt: NOON_AUG_24, lastActivityAt: NOON_AUG_24 };
    expect(isStillActive(s, "2026-08-25", NOON_AUG_24 + STALE_GRACE_MS - 1)).toBe(true);
    expect(isStillActive(s, "2026-08-25", NOON_AUG_24 + STALE_GRACE_MS + 1)).toBe(false);
  });

  it("a session persisted before this field existed falls back to startedAt", () => {
    const s: LiveSession = { ...live(), date: "2026-08-24", startedAt: NOON_AUG_24 };
    delete (s as { lastActivityAt?: number }).lastActivityAt;
    expect(isStillActive(s, "2026-08-25", NOON_AUG_24 + 60_000)).toBe(true); // 1 min since start: active
    expect(isStillActive(s, "2026-08-25", NOON_AUG_24 + STALE_GRACE_MS + 60_000)).toBe(false); // well past grace: stale
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

// D7, LEARNED PACING (Training Catalog V2, approved 2026-08-31). Every entry
// that enters the live log gets a wall-clock stamp at its two write doors --
// never asked of the user, never shown as a judgment. Pacing derivations
// (Wave 3) read the stamps; here we only guarantee they exist and are honest.
describe("D7: logged sets carry `at` stamps", () => {
  it("logSet stamps the moment the entry lands", () => {
    const out = logSet(live(), 0, mkSet({ w: 135, r: 8 }), 1111);
    expect(out.exercises[0]!.sets[0]!.at).toBe(1111);
  });

  it("logSet keeps a stamp the entry already carries", () => {
    const out = logSet(live(), 0, mkSet({ w: 135, r: 8, at: 42 }), 1111);
    expect(out.exercises[0]!.sets[0]!.at).toBe(42);
  });

  it("setLoggedSets stamps only NEW chips; edited survivors keep their own", () => {
    let s = logSet(live(), 0, mkSet({ w: 135, r: 8 }), 1000);
    const first = s.exercises[0]!.sets[0]!;
    const edited = { ...first, r: 9 };
    const added = mkSet({ w: 135, r: 8 });
    s = setLoggedSets(s, 0, [edited, added], 2000);
    expect(s.exercises[0]!.sets[0]!.at).toBe(1000); // edit is a correction, not a new event
    expect(s.exercises[0]!.sets[1]!.at).toBe(2000);
  });

  it("a legacy chip (id existed before, no stamp) is never back-stamped with a lie", () => {
    const base = live();
    const legacy = mkSet({ w: 95, r: 5 }); // pre-D7 entry already in the strip
    const withLegacy = { ...base, exercises: base.exercises.map((e, i) => (i === 0 ? { ...e, sets: [legacy] } : e)) };
    const out = setLoggedSets(withLegacy, 0, [{ ...legacy, r: 6 }], 3000);
    expect(out.exercises[0]!.sets[0]!.at).toBeUndefined();
  });

  it("same-as-last-time plan chips never inherit last session's stamps", () => {
    const day: ProgramDay = { id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: [] }] };
    const last: WorkoutData = {
      programId: "p", dayId: "d1", dayName: "Push", date: "2026-08-01", startedAt: 0, endedAt: 1,
      exercises: [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", sets: [mkSet({ w: 135, r: 8, at: 777, moved: "clean" })] }],
    };
    const out = sessionExercisesSameAsLastTime(day, last);
    expect(out[0]!.plan![0]!.at).toBeUndefined();
    expect(out[0]!.plan![0]!.moved).toBeUndefined();
    expect(out[0]!.plan![0]!.w).toBe(135);
  });
});

// THE RAMP SHIFTED THE PLAN (found by driving a real session, 2026-08-31).
// Warm-ups live in the SAME logged strip as the work, so anything that walks
// the plan has to count working sets, never the strip's length.
describe("D3: a ramp never advances the athlete's place in the plan", () => {
  it("the working count ignores warm-ups", () => {
    const sets: SetEntry[] = [
      mkSet({ w: 45, r: 10, warmup: true }),
      mkSet({ w: 135, r: 5, warmup: true }),
      mkSet({ w: 225, r: 5 }),
    ];
    expect(sets.filter((s) => !s.warmup).length).toBe(1);
    expect(sets.length).toBe(3); // the strip is longer than the work, on purpose
  });

  it("plannedEntryAt reads the plan by working position", async () => {
    const { plannedEntryAt } = await import("./measures");
    const ex = { sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }] };
    // Two warm-ups and one work set logged: the next plan entry is the
    // SECOND working set, not the third slot of the strip.
    expect(plannedEntryAt(ex, 1)!.id).toBe("p2");
    expect(plannedEntryAt(ex, 3)).toBeUndefined();
  });
});
