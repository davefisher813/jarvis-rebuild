import { describe, it, expect } from "vitest";
import { leaveByOf, leadFor, travelFor, rememberTravel, isTravel } from "./leaveBy";

// LEAVE BY (UP-CORE-07, 2026-09-05). The one number time-blind people cannot
// compute. Everything here is arithmetic on minutes the person typed: no
// route, no location, no learned place.
describe("leaveByOf", () => {
  it("is the start minus travel and slack", () => {
    expect(leaveByOf({ start: "15:40", travelMin: 20 })).toBe("15:20");
    expect(leaveByOf({ start: "15:40", travelMin: 20, bufferMin: 10 })).toBe("15:10");
    expect(leadFor({ start: "15:40", travelMin: 20, bufferMin: 10 })).toBe(30);
  });

  it("says nothing without a travel time, which is most events", () => {
    expect(leaveByOf({ start: "15:40" })).toBeNull();
    expect(leaveByOf({ start: "15:40", bufferMin: 10 })).toBeNull();
    expect(leadFor({ start: "15:40" })).toBeNull();
  });

  it("refuses a length that is not a length, rather than clamping it", () => {
    expect(isTravel(0)).toBe(false);
    expect(isTravel(-5)).toBe(false);
    expect(isTravel(12.5)).toBe(false);
    expect(isTravel(10 * 60)).toBe(false);
    expect(leaveByOf({ start: "15:40", travelMin: -5 })).toBeNull();
  });

  // A leave time before midnight for an early event would sort to the END of
  // the day and read as after the thing it is for.
  it("clamps at the start of the day instead of wrapping into yesterday", () => {
    expect(leaveByOf({ start: "00:10", travelMin: 45 })).toBe("00:00");
  });
});

describe("the travel memory", () => {
  it("remembers minutes against the place as typed, ignoring case and outside space", () => {
    const first = rememberTravel({}, "Rink 2", 20)!;
    expect(travelFor(first, "rink 2 ")).toBe(20);
    expect(travelFor(first, "Rink 3")).toBeUndefined();
    expect(travelFor(undefined, "Rink 2")).toBeUndefined();
  });

  it("writes nothing when nothing would change", () => {
    const mem = rememberTravel({}, "Rink 2", 20)!;
    expect(rememberTravel(mem, "Rink 2", 20)).toBeNull();
    expect(rememberTravel(mem, "", 20)).toBeNull();
    expect(rememberTravel(mem, "Rink 2", 0)).toBeNull();
  });

  it("forgets a place outright, which is what the Forget row does", () => {
    const mem = rememberTravel({}, "Rink 2", 20)!;
    const gone = rememberTravel(mem, "Rink 2", null)!;
    expect(travelFor(gone, "Rink 2")).toBeUndefined();
    // Nothing to forget writes nothing.
    expect(rememberTravel(gone, "Rink 2", null)).toBeNull();
  });
});
