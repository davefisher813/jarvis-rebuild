import { describe, it, expect } from "vitest";
import { fmtDistance, minToHHMM } from "./calendar";

describe("fmtDistance", () => {
  it("reads time as distance, never negative", () => {
    expect(fmtDistance("14:40", "14:00")).toBe("in 40m");
    expect(fmtDistance("16:10", "14:00")).toBe("in 2h 10m");
    expect(fmtDistance("16:00", "14:00")).toBe("in 2h");
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
