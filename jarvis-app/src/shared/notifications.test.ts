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

// Event reminders (2026-08-09).
import { buildEventReminders, EVENT_REMINDER_BASE, EVENT_REMINDER_CAP } from "./notifications";

describe("buildEventReminders", () => {
  const NOW = new Date("2026-08-09T08:00:00").getTime();

  it("fires the lead ahead of the start, with the location riding along", () => {
    const [r] = buildEventReminders([{ date: "2026-08-09", start: "09:20", title: "ES Game", location: "188 Clinton Ave" }], NOW);
    expect(r!.at).toEqual(new Date("2026-08-09T09:05:00"));
    expect(r!.title).toBe("ES Game");
    expect(r!.body).toBe("Starts in 15 minutes · 188 Clinton Ave");
  });

  it("skips anything whose reminder moment already passed", () => {
    expect(buildEventReminders([{ date: "2026-08-09", start: "08:10", title: "Too soon" }], NOW)).toHaveLength(0);
  });

  it("skips junk instead of scheduling nonsense", () => {
    expect(buildEventReminders([
      { date: "2026-08-09", start: "", title: "No time" },
      { date: "2026-08-09", start: "10:00", title: "   " },
    ], NOW)).toHaveLength(0);
  });

  it("assigns ids from the reminder block in fire order and honors the cap", () => {
    const many = Array.from({ length: EVENT_REMINDER_CAP + 5 }, (_, i) => ({
      date: "2026-08-10", start: `${String(8 + (i % 12)).padStart(2, "0")}:00`, title: "e" + i,
    }));
    const out = buildEventReminders(many, NOW);
    expect(out).toHaveLength(EVENT_REMINDER_CAP);
    expect(out[0]!.id).toBe(EVENT_REMINDER_BASE);
    expect(out[1]!.at.getTime()).toBeGreaterThanOrEqual(out[0]!.at.getTime());
  });
});
