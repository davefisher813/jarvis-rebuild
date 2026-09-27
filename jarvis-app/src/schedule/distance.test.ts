import { describe, it, expect } from "vitest";
import { fmtDistance, minToHHMM } from "./calendar";

describe("fmtDistance", () => {
  it("reads time as distance, never negative", () => {
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(fmtDistance("14:40", "14:00")).toBe("In 40 Min");
    expect(fmtDistance("16:10", "14:00")).toBe("In 2h 10m");
    expect(fmtDistance("16:00", "14:00")).toBe("In 2h");
    expect(fmtDistance("14:00", "14:00")).toBeNull();
    expect(fmtDistance("13:00", "14:00")).toBeNull();
  });
});

describe("minToHHMM", () => {
  it("converts and clamps", () => {
    expect(minToHHMM(390)).toBe("06:30");
    expect(minToHHMM(0)).toBe("00:00");
    expect(minToHHMM(2000)).toBe("23:59");
  });
});
