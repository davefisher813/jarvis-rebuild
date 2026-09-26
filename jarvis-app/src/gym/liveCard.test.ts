import { describe, it, expect } from "vitest";
import type { LiveSession } from "./liveSession";
import type { SetEntry, WorkoutExercise } from "./types";
import { liveCard } from "./liveCard";

// Dave, 2026-09-14: "when I hit start workout ... it automatically feeds to
// the today page and renders what we drew up. It still isn't doing that."
//
// The plan has been on the live session since sessions were built -- `plan` is
// copied onto every exercise at start so a mid-session program edit cannot
// reach it. Nothing outside the gym ever read it. This is the read.

const NOW = Date.parse("2026-09-14T10:30:00");
const set = (id: string, over: Partial<SetEntry> = {}): SetEntry => ({ id, ...over });

const ex = (name: string, over: Partial<WorkoutExercise> = {}): WorkoutExercise => ({
  exerciseId: "x" + name, name, kind: "weight_reps", unit: "lb", sets: [], ...over,
});

const session = (over: Partial<LiveSession> = {}): LiveSession => ({
  programId: "p", dayId: "d", dayName: "Push", date: "2026-09-14",
  startedAt: Date.parse("2026-09-14T10:18:00"), lastActivityAt: NOW, idx: 0,
  exercises: [
    ex("Bench Press", { plan: [set("a", { w: 225, r: 5 }), set("b", { w: 225, r: 5 }), set("c", { w: 225, r: 5 })] }),
    ex("Incline Press", { plan: [set("d", { w: 135, r: 8 }), set("e", { w: 135, r: 8 })] }),
    ex("Dips", { kind: "reps", plan: [set("f", { r: 10 }), set("g", { r: 10 })] }),
  ],
  ...over,
});

describe("the live card reads the plan off the session", () => {
  it("names every exercise in order, with the numbers drawn up for it", () => {
    const card = liveCard(session(), NOW);
    expect(card.lines.map((l) => [l.name, l.plan])).toEqual([
      ["Bench Press", "3 × 225 lb × 5"],
      ["Incline Press", "2 × 135 lb × 8"],
      ["Dips", "2 × 10 reps"],
    ]);
  });

  it("leads with the exercise the session is on, and its numbers", () => {
    expect(liveCard(session(), NOW).current).toMatchObject({ name: "Bench Press", plan: "3 × 225 lb × 5" });
    expect(liveCard(session({ idx: 2 }), NOW).current).toMatchObject({ name: "Dips", plan: "2 × 10 reps" });
  });

  it("falls back to the name when an exercise carries no plan", () => {
    const s = session({ exercises: [ex("Farmer Carry")] });
    expect(liveCard(s, NOW).lines[0]!.plan).toBeNull();
    expect(liveCard(s, NOW).current).toMatchObject({ name: "Farmer Carry", plan: null });
  });

  it("marks where he is", () => {
    const card = liveCard(session({ idx: 1 }), NOW);
    expect(card.lines.map((l) => l.current)).toEqual([false, true, false]);
    expect(card.current!.name).toBe("Incline Press");
  });
});

describe("it counts what happened, never what is owed", () => {
  it("says how many exercises carry logged work", () => {
    const s = session();
    s.exercises[0]!.sets = [set("l1", { w: 225, r: 5 })];
    expect(liveCard(s, NOW).progress).toBe("1 of 3 Logged");
  });

  it("is fresh while nothing has been logged, which is the moment after Start", () => {
    expect(liveCard(session(), NOW).fresh).toBe(true);
    const s = session();
    s.exercises[1]!.sets = [set("l1", { w: 135, r: 8 })];
    expect(liveCard(s, NOW).fresh).toBe(false);
  });

  it("does not count a skipped set as logged work", () => {
    const s = session();
    s.exercises[0]!.sets = [set("l1", { skipped: true })];
    expect(liveCard(s, NOW).lines[0]!.logged).toBe(0);
    expect(liveCard(s, NOW).fresh).toBe(true);
  });

  it("keeps a skipped exercise on the list, because it is part of what happened", () => {
    const s = session();
    s.exercises[1]!.skipped = true;
    const card = liveCard(s, NOW);
    expect(card.lines).toHaveLength(3);
    expect(card.lines[1]!.skipped).toBe(true);
  });
});

describe("elapsed time is a fact or it is absent", () => {
  it("says the minutes once there is a minute to say", () => {
    expect(liveCard(session(), NOW).elapsed).toBe("12 Min in");
  });

  it("says nothing at all in the first minute, rather than zero", () => {
    const s = session({ startedAt: NOW - 20_000 });
    expect(liveCard(s, NOW).elapsed).toBeNull();
  });

  it("does not count paused time", () => {
    const s = session({ startedAt: NOW - 20 * 60_000, pausedMs: 15 * 60_000 });
    expect(liveCard(s, NOW).elapsed).toBe("5 Min in");
  });
});

describe("time left, when a timer was set", () => {
  // Dave 2026-09-19: "a resume button up top with the time left in the
  // workout if there's a timer set". The fit's budget is the timer.
  it("counts down the budget on the session's own clock", () => {
    expect(liveCard(session({ budgetMin: 45 }), NOW).left).toBe("33 Min left");
  });
  it("says nothing about time left when no budget was set", () => {
    expect(liveCard(session(), NOW).left).toBeNull();
  });
  it("says so once the budget is gone, rather than counting into the negative", () => {
    expect(liveCard(session({ budgetMin: 10 }), NOW).left).toBe("Time's up");
  });
  it("holds its number while the session is parked", () => {
    const parked = session({ budgetMin: 45, pausedAt: NOW });
    expect(liveCard(parked, NOW + 20 * 60_000).left).toBe("33 Min left");
  });
});
