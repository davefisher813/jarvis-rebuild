import { describe, it, expect } from "vitest";
import { buildCheckinNotifications, MORNING_ID, EVENING_ID } from "./notifications";
import { DEFAULT_ROUTINE } from "../routine/types";

const r = (patch: Partial<typeof DEFAULT_ROUTINE> = {}) => ({ ...DEFAULT_ROUTINE, ...patch });

describe("buildCheckinNotifications", () => {
  it("schedules morning at the brief time and evening two hours before bed", () => {
    const n = buildCheckinNotifications(r({ sleepMin: 22 * 60 }), "07:00");
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({ id: MORNING_ID, hour: 7, minute: 0 });
    expect(n[1]).toMatchObject({ id: EVENING_ID, hour: 20, minute: 0 });
  });

  it("falls back to wake + 15 without a brief time", () => {
    const n = buildCheckinNotifications(r({ wakeMin: 6 * 60 + 30 }));
    expect(n[0]).toMatchObject({ hour: 6, minute: 45 });
  });

  it("never asks the evening question before 6 PM, even for early sleepers", () => {
    const n = buildCheckinNotifications(r({ sleepMin: 19 * 60 }), "07:00");
    const evening = n.find((x) => x.id === EVENING_ID);
    expect(evening).toMatchObject({ hour: 18, minute: 0 });
  });

  it("skips the evening nudge when bedtime is at or before 6 PM (cannot fit)", () => {
    const n = buildCheckinNotifications(r({ sleepMin: 17 * 60 }), "07:00");
    expect(n.find((x) => x.id === EVENING_ID)).toBeUndefined();
  });

  it("skips the morning nudge when it would land after noon (matches CheckIn's window)", () => {
    const n = buildCheckinNotifications(r({ wakeMin: 12 * 60 }));
    expect(n.find((x) => x.id === MORNING_ID)).toBeUndefined();
  });

  it("copy is kind: no guilt words, no em dashes, matches the check-in questions", () => {
    for (const n of buildCheckinNotifications(r(), "07:00")) {
      expect(n.title + n.body).not.toMatch(/overdue|behind|should have|missed/i);
      expect(n.title + n.body).not.toContain("\u2014");
    }
  });
});
