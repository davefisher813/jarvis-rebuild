import { describe, it, expect } from "vitest";
import { restDayOffer, REST_DAYS_TARGET } from "./twoDaysOff";
import { weekShape } from "./weekShape";
import type { SportSession } from "./loadCandidates";

const WEEK = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];

describe("restDayOffer", () => {
  it("offers nothing when the week already has two rest days", () => {
    const sessions: SportSession[] = WEEK.slice(0, 5).map((date) => ({ date, org: "School Team", durationMin: 60 }));
    const offer = restDayOffer(weekShape(sessions, WEEK));
    expect(offer.needed).toBe(false);
    expect(offer.restDaysNow).toBeGreaterThanOrEqual(REST_DAYS_TARGET);
  });

  it("offers an existing open day when the week has none scheduled off", () => {
    const sessions: SportSession[] = WEEK.map((date) => ({ date, org: "School Team", durationMin: 60 }));
    const offer = restDayOffer(weekShape(sessions, WEEK));
    expect(offer.needed).toBe(true);
    expect(offer.suggestedDate).toBeNull(); // no open day exists to suggest
  });

  it("suggests the open day it finds when there is exactly one", () => {
    const sessions: SportSession[] = WEEK.slice(0, 6).map((date) => ({ date, org: "School Team", durationMin: 60 }));
    const offer = restDayOffer(weekShape(sessions, WEEK));
    expect(offer.needed).toBe(true);
    expect(offer.suggestedDate).toBe(WEEK[6]);
  });

  it("never overwrites a day that already carries a session", () => {
    const sessions: SportSession[] = [{ date: WEEK[0]!, org: "School Team", durationMin: 60 }];
    const offer = restDayOffer(weekShape(sessions, WEEK));
    expect(offer.suggestedDate).not.toBe(WEEK[0]);
  });
});
