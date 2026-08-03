import { describe, it, expect } from "vitest";
import type { TaskItem } from "./TasksService";
import type { TaskData } from "../notes/types";
import { setAsideCandidates, firstStepCandidate, nextStreak, backOnTrackMessage } from "./lifecycle";

const T = "2026-07-30";
let n = 0;
function task(due: string | null, extra: Partial<TaskData> = {}): TaskItem {
  n++;
  return { id: "t" + n, data: { text: "Task " + n, category: "", done: false, due, ...extra } };
}

describe("setAsideCandidates", () => {
  it("targets only long-overdue, non-recurring, open tasks", () => {
    const ancient = task("2026-07-01");
    const recent = task("2026-07-25");
    const recurring = task("2026-07-01", { recurrence: "weekly" });
    const doneOld = task("2026-07-01", { done: true });
    const noDue = task(null);
    const out = setAsideCandidates([ancient, recent, recurring, doneOld, noDue], T);
    expect(out.map((t) => t.id)).toEqual([ancient.id]);
  });

  it("14 days is inside the grace window, 15 is not", () => {
    expect(setAsideCandidates([task("2026-07-16")], T)).toHaveLength(0);
    expect(setAsideCandidates([task("2026-07-15")], T)).toHaveLength(1);
  });

  it("NEVER sweeps a bill out of view, however overdue (Money v1 carve-out)", () => {
    const overdueRent = task("2026-06-01", { bill: { amount: 1850 } });
    expect(setAsideCandidates([overdueRent], T)).toHaveLength(0);
  });
});

describe("firstStepCandidate", () => {
  it("picks the oldest slider by age or by pushes, one at a time", () => {
    const pushed = task(T, { slips: 3 });
    const aged = task("2026-07-20");
    const fresh = task(T);
    expect(firstStepCandidate([fresh], T)).toBeNull();
    expect(firstStepCandidate([fresh, pushed], T)!.id).toBe(pushed.id);
    expect(firstStepCandidate([fresh, pushed, aged], T)!.id).toBe(aged.id); // oldest due leads
  });

  it("never offers on recurring or done tasks", () => {
    expect(firstStepCandidate([task("2026-07-01", { recurrence: "daily" })], T)).toBeNull();
    expect(firstStepCandidate([task("2026-07-01", { done: true })], T)).toBeNull();
  });

  it("never offers to break a bill into a smaller step (Money v1 carve-out)", () => {
    expect(firstStepCandidate([task("2026-07-01", { bill: { amount: 120 } })], T)).toBeNull();
    expect(firstStepCandidate([task(T, { slips: 5, bill: { amount: 120 } })], T)).toBeNull();
  });
});

describe("nextStreak", () => {
  const base: TaskData = { text: "Gym", category: "", done: false, recurrence: "daily" };
  it("starts at one, extends on contiguous days, allows one slow day", () => {
    expect(nextStreak(base, T)).toEqual({ lastDone: T, runLen: 1, bestRun: 1 });
    expect(nextStreak({ ...base, lastDone: "2026-07-29", runLen: 4, bestRun: 4 }, T).runLen).toBe(5);
    // one missed day within slack still extends: rest days never kill a streak
    expect(nextStreak({ ...base, lastDone: "2026-07-28", runLen: 4, bestRun: 4 }, T).runLen).toBe(5);
  });

  it("a real gap restarts the run but the best run never shrinks", () => {
    const s = nextStreak({ ...base, lastDone: "2026-07-20", runLen: 12, bestRun: 12 }, T);
    expect(s.runLen).toBe(1);
    expect(s.bestRun).toBe(12);
  });

  it("weekly slack is a week plus a day", () => {
    const wk: TaskData = { ...base, recurrence: "weekly", lastDone: "2026-07-22", runLen: 3, bestRun: 3 };
    expect(nextStreak(wk, T).runLen).toBe(4);
  });
});

describe("backOnTrackMessage", () => {
  const base: TaskData = { text: "Gym", category: "", done: false, recurrence: "daily" };
  it("fires only after a real gap ends a run worth naming", () => {
    expect(backOnTrackMessage({ ...base, lastDone: "2026-07-17", runLen: 12 }, T)).toBe(
      "Back on track. The 12-day run still counts.",
    );
    expect(backOnTrackMessage({ ...base, lastDone: "2026-07-29", runLen: 12 }, T)).toBeNull(); // no gap
    expect(backOnTrackMessage({ ...base, lastDone: "2026-07-17", runLen: 2 }, T)).toBeNull(); // short run
    expect(backOnTrackMessage({ ...base, lastDone: "2026-07-17", runLen: 12, done: true }, T)).toBeNull();
    expect(backOnTrackMessage({ text: "x", category: "", done: false }, T)).toBeNull(); // not recurring
  });
});
