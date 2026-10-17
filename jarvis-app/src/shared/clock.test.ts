import { describe, it, expect } from "vitest";
import { clock12 } from "./clock";
import { bindMeridiem } from "./casing";

// ONE CLOCK (2026-10-17). toLocaleTimeString joins the digits to AM or PM with
// U+202F in every modern engine, so the same moment read "8:32 PM" from
// nineteen call sites and "8:32 PM" from the schedule. One formatter, a plain
// space, 12-hour, whatever the device's region says.
describe("clock12", () => {
  it("spells a Date, an epoch and an ISO string the same, with a plain space", () => {
    const d = new Date(2026, 9, 3, 20, 32);
    expect(clock12(d)).toBe("8:32 PM");
    expect(clock12(d.getTime())).toBe("8:32 PM");
    expect(clock12(d.toISOString())).toBe("8:32 PM");
    expect(clock12(d)).not.toMatch(/ /);
  });

  it("takes an HH:MM clock string too, and never prints 24-hour", () => {
    expect(clock12("00:07")).toBe("12:07 AM");
    expect(clock12("12:00")).toBe("12:00 PM");
    expect(clock12("23:59")).toBe("11:59 PM");
    expect(clock12(new Date(2026, 0, 1, 14, 5))).toBe("2:05 PM");
  });

  it("says nothing for a moment it cannot read", () => {
    expect(clock12("not a time")).toBe("");
    expect(clock12(Number.NaN)).toBe("");
  });
});

describe("bindMeridiem takes the platform's narrow space as well as a plain one", () => {
  it("binds both to the no-break space", () => {
    expect(bindMeridiem("Dinner at 7:00 PM")).toBe("Dinner at 7:00 PM");
    expect(bindMeridiem("Dinner at 7:00 PM")).toBe("Dinner at 7:00 PM");
  });
});
