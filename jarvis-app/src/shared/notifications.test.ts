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

  // SHARED-F-24 (2026-09-05): this test used to assert the bug. A brief time
  // at or after noon (a late shift) meant no morning nudge at all, and
  // nothing on the Routine or Notifications page said why. It is clamped to
  // the last minute the question still makes sense in, never dropped.
  it("clamps a late morning to 11:45 instead of dropping it", () => {
    expect(buildCheckinNotifications(r({ wakeMin: 12 * 60 })).find((x) => x.id === MORNING_ID))
      .toMatchObject({ hour: 11, minute: 45 });
    expect(buildCheckinNotifications(r(), "12:30").find((x) => x.id === MORNING_ID))
      .toMatchObject({ hour: 11, minute: 45 });
  });

  it("[edge] a brief time it cannot read falls back to wake + 15, not to nothing", () => {
    const n = buildCheckinNotifications(r({ wakeMin: 6 * 60 + 30 }), "garbage");
    expect(n.find((x) => x.id === MORNING_ID)).toMatchObject({ hour: 6, minute: 45 });
  });

  it("[edge] noon exactly is still clamped back inside the morning", () => {
    expect(buildCheckinNotifications(r(), "12:00").find((x) => x.id === MORNING_ID))
      .toMatchObject({ hour: 11, minute: 45 });
  });

  it("copy is kind: no guilt words, no em dashes, matches the check-in questions", () => {
    for (const n of buildCheckinNotifications(r(), "07:00")) {
      expect(n.title + n.body).not.toMatch(/overdue|behind|should have|missed/i);
      expect(n.title + n.body).not.toContain("\u2014");
    }
  });
});

// Event reminders (2026-08-09).
import { buildEventReminders, EVENT_REMINDER_BASE, EVENT_REMINDER_CAP, EVENT_REMINDER_SPAN, TASK_REMINDER_CAP, CHECKIN_BUDGET, IOS_PENDING_LIMIT } from "./notifications";

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

  // UP-CORE-07 (2026-09-05): the one rung that says stand up now.
  it("adds a leave rung at the leave time, and never doubles up with a ladder rung", () => {
    const rs = buildEventReminders(
      [{ date: "2026-08-09", start: "09:20", title: "Practice", location: "Rink 2", leaveMin: 25 }],
      NOW,
    );
    const leave = rs.find((r) => r.body === "Leave now for Rink 2")!;
    expect(leave.at).toEqual(new Date("2026-08-09T08:55:00"));
    // A leave lead equal to a ladder rung leaves ONE alert at that minute,
    // the one that says what to do.
    const collide = buildEventReminders(
      [{ date: "2026-08-09", start: "09:20", title: "Practice", location: "Rink 2", leaveMin: 30 }],
      NOW,
    );
    const at850 = collide.filter((r) => r.at.getTime() === new Date("2026-08-09T08:50:00").getTime());
    expect(at850).toHaveLength(1);
    expect(at850[0]!.body).toBe("Leave now for Rink 2");
  });

  it("says nothing about leaving for an event with no travel time", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", title: "Call" }], NOW);
    expect(rs.some((r) => r.body.startsWith("Leave now"))).toBe(false);
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

  // SHARED-F-05 (2026-09-05): iOS keeps 64 pending notifications and drops
  // the rest by fire time. Over budget, the ladder sheds its outer rungs
  // before it sheds an event: nothing on the calendar goes unannounced while
  // something else keeps four alerts.
  it("the three blocks together fit inside the OS limit", () => {
    expect(EVENT_REMINDER_CAP + TASK_REMINDER_CAP + CHECKIN_BUDGET).toBe(IOS_PENDING_LIMIT);
    expect(IOS_PENDING_LIMIT).toBe(64);
  });

  it("drops the hour and half-hour rungs before it drops an event", () => {
    // 14 events at 4 rungs each is 56, over the 44 event budget. Dropping
    // the 60-minute rung leaves 42, which fits, so every event survives.
    const many = Array.from({ length: 14 }, (_, i) => ({
      date: "2026-08-10", start: `${String(8 + i).padStart(2, "0")}:00`, title: "e" + i,
    }));
    const out = buildEventReminders(many, NOW);
    expect(out.length).toBeLessThanOrEqual(EVENT_REMINDER_CAP);
    expect(out.some((r) => r.body.includes("In an hour"))).toBe(false);
    // Every event still keeps its closing rung.
    for (let i = 0; i < 14; i++) expect(out.some((r) => r.title === "e" + i)).toBe(true);
  });

  it("[edge] a day inside the budget keeps the whole ladder", () => {
    const few = Array.from({ length: 5 }, (_, i) => ({
      date: "2026-08-10", start: `${String(8 + i).padStart(2, "0")}:00`, title: "e" + i,
    }));
    expect(buildEventReminders(few, NOW)).toHaveLength(20);
  });

  // S6-Q36 (2026-09-04): "the first move is thrown away, never stored."
  // firstMove rides the ReminderInput now, and only the closing (5-minute)
  // rung uses it -- the earlier rungs stay informational, unchanged.
  it("names the first move on the closing rung when the event has one", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", title: "ES Game", location: "188 Clinton Ave", firstMove: "Load the gear bag" }], NOW);
    expect(rs[0]!.body).toBe("In an hour · 188 Clinton Ave"); // unchanged
    expect(rs[3]!.body).toBe("Load the gear bag · 188 Clinton Ave");
  });

  it("keeps the generic closing instruction when the event has no first move", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", title: "ES Game" }], NOW);
    expect(rs[3]!.body).toBe("Leave what you're doing");
  });
});

// Task reminders (S1-01, 2026-09-04): "Meds, 9:00 PM, every day" never made
// the phone do anything. buildTaskReminderNotifications is the pure half of
// the fix: which dated notifications a reminder's days, snooze and last-done
// actually produce for today and tomorrow.
import { buildTaskReminderNotifications, TASK_REMINDER_BASE, TASK_REMINDER_SPAN, type TaskReminderInput } from "./notifications";
import type { ReminderInfo } from "../notes/types";

describe("buildTaskReminderNotifications", () => {
  const TODAY = "2026-08-09";
  const TOMORROW = "2026-08-10";
  const NOW = new Date("2026-08-09T08:00:00").getTime();
  const rem = (id: string, text: string, reminder: ReminderInfo): TaskReminderInput => ({ id, text, reminder });

  // TODAY-F-10 (2026-09-05): every reminder defaults to "Ask Again in 15m",
  // so the expected shape of a day is the ping and its follow-up. The
  // let-go cases below are the ones that fire exactly once.
  it("fires today and tomorrow at the set time, every day by default", () => {
    const out = buildTaskReminderNotifications([rem("r1", "Take meds", { time: "21:00" })], TODAY, NOW, 2);
    expect(out.map((n) => n.at)).toEqual([
      new Date("2026-08-09T21:00:00"),
      new Date("2026-08-09T21:15:00"),
      new Date("2026-08-10T21:00:00"),
      new Date("2026-08-10T21:15:00"),
    ]);
    expect(out[0]!.title).toBe("Take meds");
    expect(out[0]!.body).toBe("Reminder");
    expect(out[1]!.body).toBe("Asking again");
    expect(out[0]!.id).toBe(TASK_REMINDER_BASE);
  });

  it("a let-go reminder fires once and never chases", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Take meds", { time: "21:00", onMiss: "let_go" })], TODAY, NOW, 2,
    );
    expect(out.map((n) => n.at)).toEqual([
      new Date("2026-08-09T21:00:00"),
      new Date("2026-08-10T21:00:00"),
    ]);
  });

  // 2026-08-09 is a Sunday: weekdays-only skips today, keeps tomorrow (Monday).
  it("honors days: skips a date it does not run on", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Standup", { time: "09:00", days: [1, 2, 3, 4, 5], onMiss: "let_go" })],
      TODAY, NOW, 2,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toEqual(new Date("2026-08-10T09:00:00"));
  });

  it("a reminder already done today does not ping again today, but still pings tomorrow", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Take meds", { time: "21:00", lastDone: TODAY, onMiss: "let_go" })],
      TODAY, NOW, 2,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toEqual(new Date("2026-08-10T21:00:00"));
  });

  it("ticking it clears the follow-up too, because a done reminder builds nothing", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Take meds", { time: "21:00", lastDone: TODAY })],
      TODAY, NOW, 2,
    );
    expect(out.filter((n) => n.at < new Date("2026-08-10T00:00:00"))).toEqual([]);
  });

  // A snooze set today moves today's ping; tomorrow is unaffected, because a
  // snooze set today only counts today (reminders.ts effectiveTime).
  it("a same-day snooze moves today's fire time but not tomorrow's", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Take meds", { time: "09:00", snoozedTo: "09:15", snoozeDate: TODAY, onMiss: "let_go" })],
      TODAY, NOW, 2,
    );
    expect(out.map((n) => n.at)).toEqual([
      new Date("2026-08-09T09:15:00"),
      new Date("2026-08-10T09:00:00"),
    ]);
  });

  it("the follow-up rides the snoozed time, not the original one", () => {
    const out = buildTaskReminderNotifications(
      [rem("r1", "Take meds", { time: "09:00", snoozedTo: "09:15", snoozeDate: TODAY })],
      TODAY, NOW, 2,
    );
    expect(out[0]!.at).toEqual(new Date("2026-08-09T09:15:00"));
    expect(out[1]!.at).toEqual(new Date("2026-08-09T09:30:00"));
  });

  it("drops a fire time already in the past instead of scheduling a stale buzz", () => {
    // NOW is 08:00; a 07:00 reminder today has already passed, but tomorrow's
    // 07:00 has not.
    const out = buildTaskReminderNotifications([rem("r1", "Early", { time: "07:00", onMiss: "let_go" })], TODAY, NOW, 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toEqual(new Date("2026-08-10T07:00:00"));
  });

  it("[edge] a follow-up that has itself already passed is not scheduled", () => {
    // 07:50 today: the ping passed at 07:50 and its 08:05 follow-up has not.
    const out = buildTaskReminderNotifications([rem("r1", "Early", { time: "07:50" })], TODAY, NOW, 2);
    expect(out[0]!.at).toEqual(new Date("2026-08-09T08:05:00"));
    // And with NOW past the follow-up too, today contributes nothing.
    const later = buildTaskReminderNotifications([rem("r1", "Early", { time: "07:00" })], TODAY, NOW, 2);
    expect(later.filter((n) => n.at < new Date("2026-08-10T00:00:00"))).toEqual([]);
  });

  it("assigns ids from the task-reminder block in fire order and honors the cap", () => {
    const many = Array.from({ length: TASK_REMINDER_CAP }, (_, i) => rem("r" + i, "t" + i, { time: "23:59", days: [0] }));
    // Every one of these also fires tomorrow (Monday is not in days:[0]... wait
    // Sunday=0, TOMORROW 08-10 is Monday=1, so only TODAY's occurrence fires):
    // that alone already exceeds the cap once combined with a second batch.
    const out = buildTaskReminderNotifications([...many, ...many], TODAY, NOW, 2);
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
    // The SPANS, not the budgets: a tap on a notification an older build
    // scheduled (SHARED-F-05 shrank the caps) still lands on its screen.
    expect(kindOfNotification(EVENT_REMINDER_BASE + EVENT_REMINDER_SPAN - 1)).toBe("event");
    expect(kindOfNotification(EVENT_REMINDER_BASE + EVENT_REMINDER_SPAN)).toBeNull();
    expect(kindOfNotification(TASK_REMINDER_BASE)).toBe("reminder");
    expect(kindOfNotification(TASK_REMINDER_BASE + TASK_REMINDER_SPAN - 1)).toBe("reminder");
    expect(kindOfNotification(TASK_REMINDER_BASE + TASK_REMINDER_SPAN)).toBeNull();
    expect(kindOfNotification(1)).toBeNull();
  });

  it("registering off native is a clean no-op, same contract as the rest of this file", () => {
    expect(() => onNotificationTap(() => {})()).not.toThrow();
  });
});

// UP-PLAT-01 (2026-09-06): the two builders carry the id of the thing the
// banner is about, which is what lets Done, Tomorrow and a plain tap act on
// THAT item instead of landing on a tab. Pure halves, same as above.
describe("a banner knows which item it is about (UP-PLAT-01)", () => {
  const TODAY = "2026-08-09";
  const NOW = new Date("2026-08-09T08:00:00").getTime();

  it("every event rung carries its event id", () => {
    const rs = buildEventReminders([{ id: "ev1", date: "2026-08-09", start: "09:20", title: "ES Game" }], NOW);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.eventId === "ev1")).toBe(true);
  });

  it("an event with no id still builds its rungs, and simply routes to the tab", () => {
    const rs = buildEventReminders([{ date: "2026-08-09", start: "09:20", title: "ES Game" }], NOW);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.eventId === undefined)).toBe(true);
  });

  it("the reminder ping and its follow-up both name the task", () => {
    const out = buildTaskReminderNotifications(
      [{ id: "t1", text: "Take meds", reminder: { time: "21:00" } }],
      TODAY,
      NOW,
      1,
    );
    expect(out).toHaveLength(2); // the ping and its "Asking again"
    expect(out.map((o) => o.taskId)).toEqual(["t1", "t1"]);
  });
});

// SHARED-F-06 (2026-09-05): cancel-then-schedule is two awaited bridge calls
// with nothing holding the door between them, and Today's effects re-run
// several times per reload. Run A cancels, run B cancels, A schedules the old
// six rungs, B the new four: A's extra ids survive and the phone buzzes for
// an event that no longer exists.
import { serializeLatest } from "./notifications";

describe("serializeLatest", () => {
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

  it("never lets two runs overlap", async () => {
    const q = serializeLatest();
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(name + ":start");
      await tick(5);
      log.push(name + ":end");
    };
    const a = q(job("a"));
    await tick(0); // a is now in flight, which is the interleaving case
    const b = q(job("b"));
    await Promise.all([a, b]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("a newer call supersedes an older one still waiting", async () => {
    const q = serializeLatest();
    const ran: string[] = [];
    const job = (name: string) => async () => { ran.push(name); await tick(5); };
    const a = q(job("a"));
    await tick(0);
    const b = q(job("b"));
    const c = q(job("c"));
    await Promise.all([a, b, c]);
    // b never runs: c replaced it before its turn came, and c writes the
    // same ids from fresher state.
    expect(ran).toEqual(["a", "c"]);
  });

  it("two effects firing in the same tick write once, from the newest state", async () => {
    const q = serializeLatest();
    const ran: string[] = [];
    const job = (name: string) => async () => { ran.push(name); await tick(5); };
    await Promise.all([q(job("stale")), q(job("fresh"))]);
    expect(ran).toEqual(["fresh"]);
  });

  it("a job that throws does not wedge the queue", async () => {
    const q = serializeLatest();
    const ran: string[] = [];
    await q(async () => { ran.push("boom"); throw new Error("bridge down"); });
    await q(async () => { ran.push("after"); });
    expect(ran).toEqual(["boom", "after"]);
  });
});

// TODAY-F-15 / SHARED-F-08 (2026-09-05): two days of expansion, refreshed
// only by a visit to Today, meant a reminder was armed for at most 48 hours
// from the last visit. A weekend away and Monday was silent.
describe("buildTaskReminderNotifications over a week", () => {
  const TODAY = "2026-08-09"; // a Sunday
  const NOW = new Date("2026-08-09T08:00:00").getTime();
  const rem = (reminder: ReminderInfo): TaskReminderInput => ({ id: "r1", text: "Take meds", reminder });

  it("arms a daily reminder past the weekend by default", () => {
    const out = buildTaskReminderNotifications([rem({ time: "21:00", onMiss: "let_go" })], TODAY, NOW);
    expect(out.map((n) => n.at)).toEqual([
      new Date("2026-08-09T21:00:00"),
      new Date("2026-08-10T21:00:00"),
      new Date("2026-08-11T21:00:00"),
      new Date("2026-08-12T21:00:00"),
      new Date("2026-08-13T21:00:00"),
      new Date("2026-08-14T21:00:00"),
      new Date("2026-08-15T21:00:00"),
    ]);
  });

  it("still honors the days a reminder runs on, across the week", () => {
    const out = buildTaskReminderNotifications([rem({ time: "09:00", days: [1], onMiss: "let_go" })], TODAY, NOW);
    // Mondays only: 08-10 inside the window, then nothing until the next one.
    expect(out.map((n) => n.at)).toEqual([new Date("2026-08-10T09:00:00")]);
  });

  it("keeps the soonest inside the budget and drops the rest, never the near ones", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: "r" + i, text: "r" + i, reminder: { time: "21:00", onMiss: "let_go" as const } }));
    const out = buildTaskReminderNotifications(many, TODAY, NOW);
    expect(out).toHaveLength(TASK_REMINDER_CAP);
    // The first six are today's, all of them, before any of tomorrow's.
    expect(out.slice(0, 6).every((n) => n.at < new Date("2026-08-10T00:00:00"))).toBe(true);
    expect(out[out.length - 1]!.at.getTime()).toBeGreaterThan(out[0]!.at.getTime());
  });

  it("[edge] a lastDone from an earlier day does not silence the rest of the week", () => {
    const out = buildTaskReminderNotifications([rem({ time: "21:00", lastDone: TODAY, onMiss: "let_go" })], TODAY, NOW);
    expect(out.map((n) => n.at)[0]).toEqual(new Date("2026-08-10T21:00:00"));
    expect(out).toHaveLength(6);
  });
});
