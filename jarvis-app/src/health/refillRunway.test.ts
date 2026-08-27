import { describe, it, expect } from "vitest";
import { refillRunway, needsRefillCall, refillOffer, REFILL_CALL_WITHIN_DOSES } from "./refillRunway";
import type { MedRefillEntry, TookItEntry } from "./types";

const DAY = 86400000;

function refill(filledAt: number, dosesInFill: number): MedRefillEntry {
  return { id: "r", data: { category: "logistics", filledAt, dosesInFill, at: filledAt } };
}
function taken(at: number): TookItEntry {
  return { id: String(at), data: { category: "medication", at } };
}

describe("refillRunway", () => {
  it("reports no fill when none has been logged", () => {
    const s = refillRunway([], []);
    expect(s.hasFill).toBe(false);
    expect(needsRefillCall(s)).toBe(false);
    expect(refillOffer(s)).toBeNull();
  });

  it("counts remaining doses from real Took It taps, never a stored countdown", () => {
    const start = Date.parse("2026-08-01T00:00:00Z");
    const tookIt = [taken(start + DAY), taken(start + 2 * DAY), taken(start + 3 * DAY)];
    const s = refillRunway([refill(start, 30)], tookIt, start + 3 * DAY + 1000);
    expect(s.taken).toBe(3);
    expect(s.remaining).toBe(27);
  });

  it("uses the most recently started fill when more than one has been logged", () => {
    const s = refillRunway(
      [refill(Date.parse("2026-07-01T00:00:00Z"), 30), refill(Date.parse("2026-08-01T00:00:00Z"), 30)],
      [],
      Date.parse("2026-08-02T00:00:00Z"),
    );
    expect(s.dosesInFill).toBe(30);
    expect(s.taken).toBe(0);
  });

  it("never counts a tap logged before the fill started", () => {
    const start = Date.parse("2026-08-10T00:00:00Z");
    const s = refillRunway([refill(start, 30)], [taken(start - DAY)], start + DAY);
    expect(s.taken).toBe(0);
    expect(s.remaining).toBe(30);
  });

  it("offers no projection until there is at least a day of pace to read", () => {
    const start = Date.parse("2026-08-10T00:00:00Z");
    const s = refillRunway([refill(start, 30)], [taken(start + 1000)], start + 2000);
    expect(s.runwayDays).toBeUndefined();
    expect(s.paceDosesPerDay).toBeUndefined();
  });

  it("needs a call once remaining doses cross the fixed threshold", () => {
    const start = Date.parse("2026-08-01T00:00:00Z");
    const dosesToTake = 30 - REFILL_CALL_WITHIN_DOSES;
    const tookIt = Array.from({ length: dosesToTake }, (_, i) => taken(start + (i + 1) * DAY));
    const s = refillRunway([refill(start, 30)], tookIt, start + (dosesToTake + 1) * DAY);
    expect(s.remaining).toBe(REFILL_CALL_WITHIN_DOSES);
    expect(needsRefillCall(s)).toBe(true);
    expect(refillOffer(s)).toBe("Call the pharmacy about the next refill");
  });

  it("names no medication and suggests no dose", () => {
    const start = Date.parse("2026-08-01T00:00:00Z");
    const s = refillRunway([refill(start, 5)], [], start + 2 * DAY);
    const offer = refillOffer(s);
    expect(offer).not.toMatch(/dose|mg|stimulant|pill/i);
  });
});
