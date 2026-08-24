import { describe, it, expect } from "vitest";
import { DUR_CHOICES, durLabel, minutesBetween, endFor } from "./durations";

describe("the one duration list", () => {
  it("is the list both surfaces were declaring separately", () => {
    expect(DUR_CHOICES).toEqual([15, 30, 45, 60, 90, 120]);
  });

  it("labels the way a person says it, not the way a clock stores it", () => {
    expect(DUR_CHOICES.map(durLabel)).toEqual(["15m", "30m", "45m", "1h", "1h 30m", "2h"]);
  });
});

describe("minutesBetween", () => {
  it("measures a block", () => {
    expect(minutesBetween("09:00", "10:00")).toBe(60);
    expect(minutesBetween("09:15", "09:45")).toBe(30);
    expect(minutesBetween("13:30", "15:00")).toBe(90);
  });
});

describe("endFor", () => {
  it("adds the duration to the start", () => {
    expect(endFor("09:00", 60)).toBe("10:00");
    expect(endFor("09:15", 45)).toBe("10:00");
    expect(endFor("13:30", 90)).toBe("15:00");
  });

  it("pads to HH:MM so it sorts as a string, the way the rest of the app stores time", () => {
    expect(endFor("08:00", 15)).toBe("08:15");
    expect(endFor("00:00", 5)).toBe("00:05");
  });

  // The one that matters: a block stretched past midnight would wrap to a
  // small number and sort to the TOP of the day.
  it("never rolls past midnight into the next morning", () => {
    expect(endFor("23:00", 120)).toBe("23:59");
    expect(endFor("22:30", 240)).toBe("23:59");
    expect(endFor("23:58", 15)).toBe("23:59");
  });

  it("round-trips against minutesBetween", () => {
    for (const d of DUR_CHOICES) {
      expect(minutesBetween("09:00", endFor("09:00", d))).toBe(d);
    }
  });
});
