import { describe, it, expect } from "vitest";
import { chronotypeFor, peakWindowFor } from "./energy";
import { DEFAULT_ROUTINE } from "../routine/types";

const r = (patch: Partial<typeof DEFAULT_ROUTINE>) => ({ ...DEFAULT_ROUTINE, ...patch });

describe("chronotypeFor", () => {
  it("reads an early start or early wake as a morning person", () => {
    expect(chronotypeFor(r({ workStartMin: 7 * 60, workEndMin: 15 * 60 }))).toBe("morning"); // early-bird preset
    expect(chronotypeFor(r({ wakeMin: 6 * 60 }))).toBe("morning");
  });

  it("reads a late start or late wake as an evening person", () => {
    expect(chronotypeFor(r({ workStartMin: 11 * 60, workEndMin: 19 * 60 }))).toBe("evening"); // night-owl preset
    expect(chronotypeFor(r({ wakeMin: 9 * 60 }))).toBe("evening");
  });

  it("reads standard 9-to-5 hours as neutral", () => {
    expect(chronotypeFor(r({ wakeMin: 7 * 60, workStartMin: 9 * 60, workEndMin: 17 * 60 }))).toBe("neutral");
  });
});

describe("peakWindowFor", () => {
  it("puts a morning peak near the start of work hours", () => {
    const w = peakWindowFor(r({ workStartMin: 7 * 60, workEndMin: 15 * 60 }), "morning");
    expect(w.s).toBe(7 * 60);
    expect(w.e).toBe(10 * 60); // 3-hour peak
  });

  it("puts an evening peak near the end of work hours", () => {
    const w = peakWindowFor(r({ workStartMin: 11 * 60, workEndMin: 19 * 60 }), "evening");
    expect(w.e).toBe(19 * 60);
    expect(w.s).toBe(16 * 60); // 3 hours before end
  });

  it("stays inside work hours even on a short work day", () => {
    const w = peakWindowFor(r({ workStartMin: 9 * 60, workEndMin: 11 * 60 }), "morning");
    expect(w.s).toBeGreaterThanOrEqual(9 * 60);
    expect(w.e).toBeLessThanOrEqual(11 * 60);
    expect(w.e).toBeGreaterThan(w.s);
  });
});
