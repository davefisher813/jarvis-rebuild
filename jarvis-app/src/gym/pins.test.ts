import { describe, it, expect } from "vitest";
import { pinLabel, nextPinnedDay, WEEKDAY_ABBR } from "./pins";
import type { ProgramDay } from "./types";

const day = (id: string, pinDays?: number[]): ProgramDay =>
  ({ id, name: id, exercises: [{ id: id + "e", name: "X", kind: "weight_reps", sets: [{ id: "s" }] }], ...(pinDays ? { pinDays } : {}) });

// PINS, D4 (approved 2026-08-31). Mon=0..Sun=6, the module's own convention.
describe("pinLabel", () => {
  it("speaks the days in week order, however they were stored", () => {
    expect(pinLabel([4, 1])).toBe("Tue · Fri");
    expect(pinLabel([0])).toBe("Mon");
    expect(pinLabel([])).toBe("");
    expect(pinLabel(undefined)).toBe("");
  });
});

describe("nextPinnedDay", () => {
  it("today's pin wins outright", () => {
    const days = [day("a", [0]), day("b", [2])]; // Mon, Wed
    expect(nextPinnedDay(days, 2)).toMatchObject({ day: { id: "b" }, inDays: 0 });
  });

  it("otherwise the soonest upcoming pin, wrapping the week", () => {
    const days = [day("a", [0]), day("b", [4])]; // Mon, Fri
    // On Saturday (5): Monday is 2 days out, Friday is 6.
    expect(nextPinnedDay(days, 5)).toMatchObject({ day: { id: "a" }, inDays: 2 });
  });

  it("a tie goes to the earlier day in the program, the athlete's own order", () => {
    const days = [day("a", [3]), day("b", [3])];
    expect(nextPinnedDay(days, 1)!.day.id).toBe("a");
  });

  it("null when nothing is pinned: rotation keeps its job", () => {
    expect(nextPinnedDay([day("a"), day("b")], 2)).toBeNull();
  });

  it("an empty day is never offered, pinned or not", () => {
    const empty: ProgramDay = { id: "e", name: "Leg Day", exercises: [], pinDays: [2] };
    const days = [empty, day("b", [4])];
    expect(nextPinnedDay(days, 2)!.day.id).toBe("b");
  });

  it("pinnedTo finds the day trained on a given weekday", async () => {
    const { pinnedTo } = await import("./pins");
    const days = [day("a", [0, 3]), day("b", [4])];
    expect(pinnedTo(days, 3)!.id).toBe("a");
    expect(pinnedTo(days, 6)).toBeNull();
  });
});

describe("WEEKDAY_ABBR", () => {
  it("is Mon-first, matching the week dots", () => {
    expect(WEEKDAY_ABBR[0]).toBe("Mon");
    expect(WEEKDAY_ABBR[6]).toBe("Sun");
  });
});
