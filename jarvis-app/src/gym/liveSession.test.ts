import { describe, it, expect } from "vitest";
import { readLive, writeLive, clearLive, logSet, undoLast, skipExercise, queueFinished, readPending, flushPending, hasWork, type LiveSession, type Storage2 } from "./liveSession";
import type { WorkoutData, WorkoutExercise } from "./types";

// The offline contract: a set logged in a basement is never lost, and a
// finished session that could not reach the server stays queued in order.

function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

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
    l = logSet(l, 0, { w: 135, r: 8 });
    l = logSet(l, 0, { w: 135, r: 7 });
    expect(l.exercises[0]!.sets).toHaveLength(2);
    expect(l.exercises[1]!.sets).toHaveLength(0);
    l = undoLast(l, 0);
    expect(l.exercises[0]!.sets).toEqual([{ w: 135, r: 8 }]);
    l = skipExercise(l, 1);
    expect(l.exercises[1]!.skipped).toBe(true);
    expect(l.exercises[0]!.skipped).toBeUndefined();
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
    expect(hasWork([{ ...ex("Row"), sets: [{ w: 95, r: 5 }] }])).toBe(true);
    expect(hasWork([ex("Row")])).toBe(false);
    expect(hasWork([{ ...ex("Row"), sets: [{ skipped: true }] }])).toBe(false);
  });
});
