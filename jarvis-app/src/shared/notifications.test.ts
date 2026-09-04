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

  // Overnight fix (2026-08-10): bed at 1 AM used to read as "before 6 PM" and
  // silently dropped the evening check-in for every night owl.
  it("asks the evening question at 11 PM for a bed-at-1-AM night owl", () => {
    const n = buildCheckinNotifications(r({ wakeMin: 8 * 60 + 30, sleepMin: 60 }), "09:00");
    expect(n.find((x) => x.id === EVENING_ID)).toMatchObject({ hour: 23, minute: 0 });
  });

  it("caps the evening ask before midnight when bed is just past midnight", () => {
    // Bed 00:30: two hours before is 22:30, still today. Fires.
    const n = buildCheckinNotifications(r({ wakeMin: 8 * 60, sleepMin: 30 }), "09:00");
    expect(n.find((x) => x.id === EVENING_ID)).toMatchObject({ hour: 22, minute: 30 });
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

  // B1 (2026-08-20): a ladder now, not one ping. NOW is 08:00, so a 09:20
  // event is 80 minutes out and earns all four rungs, soonest fired last.
  it("fires a ladder ahead of the start, with the location riding along", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", title: "ES Game", location: "188 Clinton Ave" }], NOW);
    expect(rs.map((r) => r.at)).toEqual([
      new Date("2026-08-09T08:20:00"),
      new Date("2026-08-09T08:50:00"),
      new Date("2026-08-09T09:05:00"),
      new Date("2026-08-09T09:15:00"),
    ]);
    expect(rs[0]!.title).toBe("ES Game");
    expect(rs[0]!.body).toBe("In an hour · 188 Clinton Ave");
    expect(rs[3]!.body).toBe("Leave what you're doing · 188 Clinton Ave");
  });

  it("skips rungs that have already passed rather than stacking them", () => {
    // 08:10 is ten minutes out: only the 5-minute rung is still ahead.
    const rs = buildEventReminders([{ date: "2026-08-09", start: "08:10", title: "Soon" }], NOW);
    expect(rs.map((r) => r.at)).toEqual([new Date("2026-08-09T08:05:00")]);
  });

  it("skips anything whose every rung already passed", () => {
    expect(buildEventReminders([{ date: "2026-08-09", start: "08:02", title: "Too soon" }], NOW)).toHaveLength(0);
  });

  // S1-05 (2026-09-04): countdown.ts's law -- "a fifteen-minute reminder
  // does not need an hour of warning" -- was never enforced here because the
  // builder had no end time to know an event's length. Same 80-minutes-out
  // event as the very first test above (which earns all four rungs by time
  // alone), but now 15 minutes long: only rungs no longer than the event
  // itself survive.
  it("drops rungs longer than the event itself once it knows the end time", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", end: "09:35", title: "Standup" }], NOW);
    // Only 15 and 5 survive: 60 and 30 are both longer than this 15-minute event.
    expect(rs.map((r) => r.at)).toEqual([
      new Date("2026-08-09T09:05:00"),
      new Date("2026-08-09T09:15:00"),
    ]);
  });

  it("an event with no end time keeps every rung, exactly as before this fix", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", title: "ES Game" }], NOW);
    expect(rs).toHaveLength(4);
  });

  it("an event long enough to outlast the whole ladder keeps every rung", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", end: "12:00", title: "Offsite" }], NOW);
    expect(rs).toHaveLength(4);
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

// Task reminders (S1-01, 2026-09-04): "Meds, 9:00 PM, every day" never made
// the phone do anything. buildTaskReminderNotifications is the pure half of
// the fix: which dated notifications a reminder's days, snooze and last-done
// actually produce for today and tomorrow.
import { buildTaskReminderNotifications, TASK_REMINDER_BASE, TASK_REMINDER_CAP, type TaskReminderInput } from "./notifications";
import type { ReminderInfo } from "../notes/types";

describe("buildTaskReminderNotifications", () => {
  const TODAY = "2026-08-09";
  const TOMORROW = "2026-08-10";
  const NOW = new Date("2026-08-09T08:00:00").getTime();
  const rem = (id: string, text: string, reminder: ReminderInfo): TaskReminderInput => ({ id, text, reminder });

  it("fires today and tomorrow at the set time, every day by default", () => {
    const out = buildTaskReminderNotifications([rem("r1", "Take meds", { time: "21:00" })], TODAY, TOMORROW, NOW);
    expect(out.map((n) => n.at)).toEqual([
      new Date("2026-08-09T21:00:00"),
      new Date("2026-08-10T21:00:00"),
    ]);
    expect(out[0]!.title).toBe("Take meds");
    expect(out[0]!.id).toBe(TASK_REMINDER_BASE);
  });

  // 2026-08-09 is a Sunday: weekdays-only skips today, keeps tomorrow (Monday).
  it("honors days: skips a date it does not run on", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Standup", { time: "09:00", days: [1, 2, 3, 4, 5] })],
      TODAY, TOMORROW, NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toEqual(new Date("2026-08-10T09:00:00"));
  });

  it("a reminder already done today does not ping again today, but still pings tomorrow", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Take meds", { time: "21:00", lastDone: TODAY })],
      TODAY, TOMORROW, NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toEqual(new Date("2026-08-10T21:00:00"));
  });

  // A snooze set today moves today's ping; tomorrow is unaffected, because a
  // snooze set today only counts today (reminders.ts effectiveTime).
  it("a same-day snooze moves today's fire time but not tomorrow's", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Take meds", { time: "09:00", snoozedTo: "09:15", snoozeDate: TODAY })],
      TODAY, TOMORROW, NOW,
    );
    expect(out.map((n) => n.at)).toEqual([
      new Date("2026-08-09T09:15:00"),
      new Date("2026-08-10T09:00:00"),
    ]);
  });

  it("drops a fire time already in the past instead of scheduling a stale buzz", () => {
    // NOW is 08:00; a 07:00 reminder today has already passed, but tomorrow's
    // 07:00 has not.
    const out = buildTaskReminderNotifications([rem("r1", "Early", { time: "07:00" })], TODAY, TOMORROW, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toEqual(new Date("2026-08-10T07:00:00"));
  });

  it("assigns ids from the task-reminder block in fire order and honors the cap", () => {
    const many = Array.from({ length: TASK_REMINDER_CAP }, (_, i) => rem("r" + i, "t" + i, { time: "23:59", days: [0] }));
    // Every one of these also fires tomorrow (Monday is not in days:[0]... wait
    // Sunday=0, TOMORROW 08-10 is Monday=1, so only TODAY's occurrence fires):
    // that alone already exceeds the cap once combined with a second batch.
    const out = buildTaskReminderNotifications([...many, ...many], TODAY, TOMORROW, NOW);
    expect(out).toHaveLength(TASK_REMINDER_CAP);
    expect(out[0]!.id).toBe(TASK_REMINDER_BASE);
  });
});

// Tap routing (S1-04, 2026-09-04): kindOfNotification is the pure half of
// "a notification tap lands nowhere" -- which id block maps to which kind of
// screen, independent of the native listener itself (untestable off-device).
import { kindOfNotification, onNotificationTap } from "./notifications";

describe("kindOfNotification", () => {
  it("classifies each id block, and nothing outside them", () => {
    expect(kindOfNotification(MORNING_ID)).toBe("morning");
    expect(kindOfNotification(EVENING_ID)).toBe("evening");
    expect(kindOfNotification(EVENT_REMINDER_BASE)).toBe("event");
    expect(kindOfNotification(EVENT_REMINDER_BASE + EVENT_REMINDER_CAP - 1)).toBe("event");
    expect(kindOfNotification(EVENT_REMINDER_BASE + EVENT_REMINDER_CAP)).toBeNull();
    expect(kindOfNotification(TASK_REMINDER_BASE)).toBe("reminder");
    expect(kindOfNotification(TASK_REMINDER_BASE + TASK_REMINDER_CAP - 1)).toBe("reminder");
    expect(kindOfNotification(TASK_REMINDER_BASE + TASK_REMINDER_CAP)).toBeNull();
    expect(kindOfNotification(1)).toBeNull();
  });

  it("registering off native is a clean no-op, same contract as the rest of this file", () => {
    expect(() => onNotificationTap(() => {})()).not.toThrow();
  });
});
