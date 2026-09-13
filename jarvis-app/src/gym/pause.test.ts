import { describe, it, expect } from "vitest";
import { parkLive, resumeLive, elapsedMs, type LiveSession } from "./liveSession";
import { receiptFor } from "./prs";
import { workoutMinutes } from "./summary";

// H-52 (Health Push B, 2026-09-12): a parked session keeps the clock honest.
const live = (over: Partial<LiveSession> = {}): LiveSession => ({
  programId: "p", dayId: "d", dayName: "Pull", date: "2026-09-13", startedAt: 1_000_000, idx: 0, exercises: [], ...over,
});
const MIN = 60_000;

describe("park and resume", () => {
  it("parking stamps when the clock stopped, once", () => {
    const parked = parkLive(live(), 1_000_000 + 10 * MIN);
    expect(parked.pausedAt).toBe(1_000_000 + 10 * MIN);
    expect(parkLive(parked, 1_000_000 + 12 * MIN)).toBe(parked);
  });
  it("resuming folds the parked stretch into pausedMs and clears the stamp", () => {
    const parked = parkLive(live(), 1_000_000 + 10 * MIN);
    const back = resumeLive(parked, 1_000_000 + 25 * MIN);
    expect(back.pausedMs).toBe(15 * MIN);
    expect(back.pausedAt).toBeUndefined();
    // A second park adds to the first.
    const again = resumeLive(parkLive(back, 1_000_000 + 30 * MIN), 1_000_000 + 35 * MIN);
    expect(again.pausedMs).toBe(20 * MIN);
  });
  it("resuming a session that was never parked changes nothing", () => {
    const s = live();
    expect(resumeLive(s, 5)).toBe(s);
  });
});

describe("elapsed and the receipt exclude parked time", () => {
  it("elapsed is gym time, with an open park excluded too", () => {
    const s = live({ pausedMs: 15 * MIN });
    expect(elapsedMs(s, 1_000_000 + 41 * MIN)).toBe(26 * MIN);
    const parked = parkLive(s, 1_000_000 + 41 * MIN);
    expect(elapsedMs(parked, 1_000_000 + 50 * MIN)).toBe(26 * MIN);
  });
  it("the receipt's minutes leave the parked stretch out", () => {
    const r = receiptFor([], [], 1_000_000, 1_000_000 + 60 * MIN, 15 * MIN);
    expect(r.minutes).toBe(45);
    expect(workoutMinutes({ startedAt: 1_000_000, endedAt: 1_000_000 + 60 * MIN, pausedMs: 15 * MIN })).toBe(45);
    expect(workoutMinutes({ startedAt: 1_000_000, endedAt: 1_000_000 + 60 * MIN })).toBe(60);
  });
});
