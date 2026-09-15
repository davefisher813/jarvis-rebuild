import { describe, it, expect } from "vitest";
import type { TaskItem } from "./TasksService";
import type { ReminderInfo } from "../notes/types";
import {
  runsOn, effectiveTime, nextOccurrence, describeRepeat, followUpOf, withEvent, HISTORY_CAP,
  consecutiveSnoozes, fireAt, timeLabelFor, viewOf, todaysReminders, scheduleKindOf, repeatRuleOf,
} from "./reminders";

// THE REMINDERS REBUILD (2026-09-15), the pure half. Every rule the sheet
// can write is pinned here against real dates, and the one invariant the
// old form broke (a clock beside an unscheduled reminder) is pinned as a
// law of the model, not of a screen.

const item = (r: ReminderInfo, text = "Meds", id = "r1"): TaskItem =>
  ({ id, data: { text, category: "health", done: false, reminder: r } } as TaskItem);

const TUE = "2026-09-15";
const WED = "2026-09-16";
const THU = "2026-09-17";
const NEXT_TUE = "2026-09-22";

describe("compatibility: a reminder written before the rebuild reads as it always did", () => {
  it("is timed, and its days[] is its rule", () => {
    expect(scheduleKindOf({ time: "08:00" })).toBe("timed");
    expect(repeatRuleOf({ time: "08:00" })).toEqual({ kind: "daily" });
    expect(repeatRuleOf({ time: "08:00", days: [1, 3] })).toEqual({ kind: "weekdays", days: [1, 3] });
    expect(runsOn({ time: "08:00" }, TUE)).toBe(true);
    expect(runsOn({ time: "08:00", days: [3] }, TUE)).toBe(false);
    expect(runsOn({ time: "08:00", days: [3] }, WED)).toBe(true);
  });
  it("its follow-up is what onMiss meant", () => {
    expect(followUpOf({ time: "08:00" })).toEqual({ delayMinutes: 15, maxCount: 1, stopAt: null });
    expect(followUpOf({ time: "08:00", onMiss: "let_go" })).toBeNull();
    expect(followUpOf({ time: "08:00", followUp: null })).toBeNull();
    expect(followUpOf({ time: "08:00", followUp: { delayMinutes: 30, maxCount: 9, stopAt: "21:00" } })).toEqual({ delayMinutes: 30, maxCount: 5, stopAt: "21:00" });
  });
});

describe("runsOn by rule", () => {
  it("once runs on its start day only", () => {
    const r: ReminderInfo = { time: "08:00", repeat: { kind: "once" }, startDate: WED };
    expect(runsOn(r, TUE)).toBe(false);
    expect(runsOn(r, WED)).toBe(true);
    expect(runsOn(r, THU)).toBe(false);
  });
  it("nothing runs before the start day", () => {
    expect(runsOn({ time: "08:00", repeat: { kind: "daily" }, startDate: WED }, TUE)).toBe(false);
    expect(runsOn({ time: "08:00", repeat: { kind: "daily" }, startDate: WED }, WED)).toBe(true);
  });
  it("weekly runs every seventh day from the start", () => {
    const r: ReminderInfo = { time: "08:00", repeat: { kind: "weekly" }, startDate: TUE };
    expect(runsOn(r, TUE)).toBe(true);
    expect(runsOn(r, WED)).toBe(false);
    expect(runsOn(r, NEXT_TUE)).toBe(true);
  });
  it("monthly runs on the start's date, clamped to a short month's last day", () => {
    const r: ReminderInfo = { time: "08:00", repeat: { kind: "monthly" }, startDate: "2026-01-31" };
    expect(runsOn(r, "2026-02-28")).toBe(true);
    expect(runsOn(r, "2026-02-27")).toBe(false);
    expect(runsOn(r, "2026-03-31")).toBe(true);
    expect(runsOn(r, "2026-03-30")).toBe(false);
  });
  it("every N days counts from the start", () => {
    const r: ReminderInfo = { time: "08:00", repeat: { kind: "everyNDays", n: 3 }, startDate: TUE };
    expect(runsOn(r, TUE)).toBe(true);
    expect(runsOn(r, WED)).toBe(false);
    expect(runsOn(r, "2026-09-18")).toBe(true);
  });
  it("after completion counts from the last completion, not the clock", () => {
    const r: ReminderInfo = { time: "08:00", repeat: { kind: "afterCompletion", days: 2 }, startDate: TUE };
    expect(runsOn(r, TUE), "nothing done yet: the start day").toBe(true);
    expect(runsOn(r, WED)).toBe(false);
    expect(runsOn(r, THU), "still nothing done: it comes round again").toBe(true);
    const done = { ...r, lastDone: WED };
    expect(runsOn(done, THU), "the clock restarted at the completion").toBe(false);
    expect(runsOn(done, "2026-09-18"), "two days after the completion").toBe(true);
    expect(runsOn(done, WED), "the day it was done is over").toBe(false);
  });
  it("a skipped date does not run; the series continues", () => {
    const r: ReminderInfo = { time: "08:00", repeat: { kind: "daily" }, skippedDates: [WED] };
    expect(runsOn(r, TUE)).toBe(true);
    expect(runsOn(r, WED)).toBe(false);
    expect(runsOn(r, THU)).toBe(true);
  });
  it("paused runs on no day at all", () => {
    expect(runsOn({ time: "08:00", paused: true }, TUE)).toBe(false);
  });
});

describe("one occurrence moved", () => {
  it("fires at the moved time that day and its own time every other day", () => {
    const r: ReminderInfo = { time: "08:00", movedTimes: { [WED]: "14:30" } };
    expect(effectiveTime(r, WED)).toBe("14:30");
    expect(effectiveTime(r, THU)).toBe("08:00");
  });
  it("a snooze set today still wins over a move", () => {
    const r: ReminderInfo = { time: "08:00", movedTimes: { [WED]: "14:30" }, snoozedTo: "15:00", snoozeDate: WED };
    expect(effectiveTime(r, WED)).toBe("15:00");
  });
});

describe("nextOccurrence", () => {
  it("is later today when the time is still ahead, tomorrow when it has passed", () => {
    expect(nextOccurrence({ time: "21:00" }, TUE, "09:00")).toEqual({ date: TUE, time: "21:00" });
    expect(nextOccurrence({ time: "08:00" }, TUE, "09:00")).toEqual({ date: WED, time: "08:00" });
  });
  it("skips a day already done and follows the rule", () => {
    expect(nextOccurrence({ time: "21:00", lastDone: TUE }, TUE, "09:00")).toEqual({ date: WED, time: "21:00" });
    expect(nextOccurrence({ time: "09:00", repeat: { kind: "weekly" }, startDate: TUE }, TUE, "10:00")).toEqual({ date: NEXT_TUE, time: "09:00" });
  });
  it("is null for unscheduled, paused, and a one-off already past", () => {
    expect(nextOccurrence({ time: "08:00", scheduleKind: "unscheduled" }, TUE, "09:00")).toBeNull();
    expect(nextOccurrence({ time: "08:00", paused: true }, TUE, "09:00")).toBeNull();
    expect(nextOccurrence({ time: "08:00", repeat: { kind: "once" }, startDate: "2026-09-01" }, TUE, "09:00")).toBeNull();
  });
});

describe("describeRepeat", () => {
  it("says each rule in words", () => {
    expect(describeRepeat({ kind: "once" })).toBe("Just Once");
    expect(describeRepeat({ kind: "daily" })).toBe("Every Day");
    expect(describeRepeat({ kind: "weekdays", days: [1, 2, 3, 4, 5] })).toBe("Weekdays");
    expect(describeRepeat({ kind: "weekdays", days: [6, 0] })).toBe("Weekends");
    expect(describeRepeat({ kind: "weekdays", days: [1, 3] })).toBe("Mon, Wed");
    expect(describeRepeat({ kind: "weekly" })).toBe("Every Week");
    expect(describeRepeat({ kind: "monthly" })).toBe("Every Month");
    expect(describeRepeat({ kind: "everyNDays", n: 3 })).toBe("Every 3 Days");
    expect(describeRepeat({ kind: "afterCompletion", days: 3 })).toBe("3 Days After Completion");
  });
});

describe("history", () => {
  it("appends newest last and never grows past the cap", () => {
    let r: ReminderInfo = { time: "08:00" };
    for (let i = 0; i < HISTORY_CAP + 5; i++) r = withEvent(r, "completed", `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`, { i });
    expect(r.history).toHaveLength(HISTORY_CAP);
    expect(r.history![HISTORY_CAP - 1]!.meta).toEqual({ i: HISTORY_CAP + 4 });
  });
  it("counts consecutive snoozes back from the newest event until a completion or a skip", () => {
    let r: ReminderInfo = { time: "08:00" };
    r = withEvent(r, "snoozed", "a");
    r = withEvent(r, "completed", "b");
    r = withEvent(r, "snoozed", "c");
    r = withEvent(r, "edited", "d");
    r = withEvent(r, "snoozed", "e");
    expect(consecutiveSnoozes(r)).toBe(2);
    expect(consecutiveSnoozes({ time: "08:00" })).toBe(0);
  });
});

describe("fireAt", () => {
  it("local keeps the clock; a pinned zone pins the instant", () => {
    expect(fireAt(TUE, "09:00").getTime()).toBe(new Date(`${TUE}T09:00:00`).getTime());
    expect(fireAt(TUE, "09:00", "local").getTime()).toBe(new Date(`${TUE}T09:00:00`).getTime());
    // 9 AM in New York in September is 13:00 UTC (EDT).
    expect(fireAt(TUE, "09:00", "America/New_York").toISOString()).toBe("2026-09-15T13:00:00.000Z");
    // and 14:00 UTC once the clocks go back (EST).
    expect(fireAt("2026-12-15", "09:00", "America/New_York").toISOString()).toBe("2026-12-15T14:00:00.000Z");
  });
});

describe("THE INVARIANT: an unscheduled reminder never renders a time", () => {
  const r: ReminderInfo = { time: "08:00", scheduleKind: "unscheduled", days: [1, 2, 3, 4, 5], repeat: { kind: "daily" } };
  it("has no time label, no next occurrence, and a view with no clock", () => {
    expect(timeLabelFor(r, TUE)).toBeNull();
    expect(nextOccurrence(r, TUE, "07:00")).toBeNull();
    const v = viewOf(item(r), TUE, "09:00")!;
    expect(v.unscheduled).toBe(true);
    expect(v.time).toBe("");
    expect(v.missed).toBe(false);
    expect(v.letGo).toBe(false);
  });
  it("sits after every timed reminder on the day's list, and a paused one is off it", () => {
    const list = todaysReminders([item(r, "Call Mom", "u"), item({ time: "21:00" }, "Meds", "t"), item({ time: "08:00", paused: true }, "Stretch", "p")], TUE, "09:00");
    expect(list.map((v) => v.id)).toEqual(["t", "u"]);
  });
  it("a timed reminder still has one", () => {
    expect(timeLabelFor({ time: "08:00" }, TUE)).toBe("08:00");
  });
});
