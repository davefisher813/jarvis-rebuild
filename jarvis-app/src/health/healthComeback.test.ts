import { describe, it, expect } from "vitest";
import { healthComebackMessage, GAP_DAYS, MIN_RUN_TO_CELEBRATE } from "./healthComeback";

const DAY = 86400000;
const at = (iso: string) => Date.parse(iso + "T08:00:00");

describe("healthComebackMessage", () => {
  it("says nothing with no history", () => {
    expect(healthComebackMessage([], "2026-08-27")).toBeNull();
  });

  it("says nothing across an ordinary short gap", () => {
    const marks = [{ at: at("2026-08-25") }];
    expect(healthComebackMessage(marks, "2026-08-27")).toBeNull(); // 2-day gap, under GAP_DAYS
  });

  it("celebrates a real run returning after a real gap", () => {
    const marks = [
      { at: at("2026-08-01") },
      { at: at("2026-08-02") },
      { at: at("2026-08-03") },
      { at: at("2026-08-04") },
    ];
    const today = "2026-08-04T08:00:00".slice(0, 10);
    const later = new Date(at(today) + (GAP_DAYS + 2) * DAY).toISOString().slice(0, 10);
    const msg = healthComebackMessage(marks, later);
    expect(msg).toBe("4-day run still counts");
  });

  it("gives no ceremony to a short run, even after a real gap", () => {
    const marks = [{ at: at("2026-08-01") }, { at: at("2026-08-02") }];
    expect(marks.length).toBeLessThan(MIN_RUN_TO_CELEBRATE + 1);
    const later = new Date(at("2026-08-02") + (GAP_DAYS + 2) * DAY).toISOString().slice(0, 10);
    expect(healthComebackMessage(marks, later)).toBeNull();
  });

  it("never renders the gap itself: the message names only the run length", () => {
    const marks = [{ at: at("2026-08-01") }, { at: at("2026-08-02") }, { at: at("2026-08-03") }];
    const later = new Date(at("2026-08-03") + 20 * DAY).toISOString().slice(0, 10);
    const msg = healthComebackMessage(marks, later);
    expect(msg).not.toMatch(/20|days since|missed/i);
  });
});
