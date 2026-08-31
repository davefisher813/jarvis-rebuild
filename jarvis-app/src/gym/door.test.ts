import { describe, expect, it } from "vitest";
import { doorInfoFor, dowOfIso } from "./door";
import { DEFAULT_BAR, DEFAULT_PLATES, type RackConfig } from "./ramp";
import type { Program, Workout } from "./types";

// D4-C: the door NAMES the day's lift from the athlete's own pins -- never
// from a guess -- and its facts line is derived, not stored.

const rack: RackConfig = { bar: DEFAULT_BAR, plates: [...DEFAULT_PLATES] };

function program(pinDays: number[] | undefined, archived = false): Program {
  return {
    id: "p1",
    data: {
      name: "PPL", archived,
      weeks: [{
        id: "w1", label: "Week 1",
        days: [{
          id: "d1", name: "Pull Day 1", ...(pinDays ? { pinDays } : {}),
          exercises: [{ id: "e1", name: "Rows", kind: "weight_reps", unit: "lb", sets: [{ id: "s1", w: 100, r: 5 }] }],
        }],
      }],
    },
  };
}

describe("the door's facts (D4-C)", () => {
  it("dowOfIso is Mon-first like the rest of the gym", () => {
    expect(dowOfIso("2026-08-31")).toBe(0); // a Monday
    expect(dowOfIso("2026-09-06")).toBe(6); // a Sunday
  });

  it("names the pinned day with its derived facts line", () => {
    const history: Workout[] = [{
      id: "w1",
      data: { programId: "p1", dayId: "d1", dayName: "Pull Day 1", date: "2026-08-24", startedAt: 0, endedAt: 0, exercises: [] },
    }];
    const info = doorInfoFor([program([0])], "p1", history, rack, "2026-08-31");
    expect(info?.day.name).toBe("Pull Day 1");
    expect(info?.meta).toContain("1 exercise");
    expect(info?.meta).toContain("Est ");
    expect(info?.meta).toContain("Last trained Aug 24");
  });

  it("claims nothing when no day is pinned to that weekday", () => {
    expect(doorInfoFor([program([2])], "p1", [], rack, "2026-08-31")).toBeNull();
    expect(doorInfoFor([program(undefined)], "p1", [], rack, "2026-08-31")).toBeNull();
    expect(doorInfoFor([], "p1", [], rack, "2026-08-31")).toBeNull();
  });
});
