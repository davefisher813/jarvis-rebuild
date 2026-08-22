import { describe, it, expect } from "vitest";
import type { TaskItem } from "./TasksService";
import type { ReminderInfo } from "../notes/types";
import {
  runsOn, effectiveTime, isDone, viewOf, todaysReminders, missedReminders,
  snoozeTime, cadenceLabel,
} from "./reminders";

// The reminder model (Dave 2026-08-19: "taking meds should just be a set
// reminder"). These pin the two decisions the whole feature rests on:
// done-ness is derived from a date so nothing has to reset at midnight, and a
// missed reminder is never treated as overdue.

const rem = (r: ReminderInfo, text = "Meds", id = "r1"): TaskItem =>
  ({ id, data: { text, category: "health", done: false, reminder: r } } as TaskItem);

const WED = "2026-08-19"; // a Wednesday
const SAT = "2026-08-22";

describe("runsOn", () => {
  it("runs every day when no days are set", () => {
    expect(runsOn({ time: "08:00" }, WED)).toBe(true);
    expect(runsOn({ time: "08:00" }, SAT)).toBe(true);
  });
  it("respects a weekday set", () => {
    const r: ReminderInfo = { time: "08:00", days: [1, 2, 3, 4, 5] };
    expect(runsOn(r, WED)).toBe(true);
    expect(runsOn(r, SAT)).toBe(false);
  });
  it("reads the weekday in local time, not UTC", () => {
    // Parsed at local noon, so a negative UTC offset cannot roll it back a day.
    expect(runsOn({ time: "08:00", days: [3] }, WED)).toBe(true);
  });
});

describe("done is derived from a date, so midnight resets it with no job", () => {
  it("is done only on the date it was ticked", () => {
    const r: ReminderInfo = { time: "08:00", lastDone: WED };
    expect(isDone(r, WED)).toBe(true);
    expect(isDone(r, "2026-08-20")).toBe(false);
  });
  it("a device asleep for days still wakes up showing it as due", () => {
    const v = viewOf(rem({ time: "08:00", lastDone: "2026-08-16" }), WED, "09:00");
    expect(v!.done).toBe(false);
  });
});

describe("snooze only counts on the day it was set", () => {
  it("applies today", () => {
    expect(effectiveTime({ time: "08:00", snoozedTo: "08:30", snoozeDate: WED }, WED)).toBe("08:30");
  });
  it("is ignored tomorrow, so last night's snooze cannot move this morning", () => {
    expect(effectiveTime({ time: "08:00", snoozedTo: "23:30", snoozeDate: "2026-08-18" }, WED)).toBe("08:00");
  });
  it("never spills past the end of the day", () => {
    expect(snoozeTime("23:50", 30)).toBe("23:59");
    expect(snoozeTime("08:00", 10)).toBe("08:10");
  });
});

describe("missed, but never overdue", () => {
  it("is missed once its time has passed and it is not done", () => {
    expect(viewOf(rem({ time: "08:00" }), WED, "09:00")!.missed).toBe(true);
    expect(viewOf(rem({ time: "08:00" }), WED, "07:00")!.missed).toBe(false);
  });
  it("is not missed once ticked", () => {
    expect(viewOf(rem({ time: "08:00", lastDone: WED }), WED, "09:00")!.missed).toBe(false);
  });
  it("surfaces at most two, because a list of failures is not help", () => {
    const items = ["a", "b", "c", "d"].map((k, i) => rem({ time: "0" + (7 + i) + ":00" }, k, k));
    expect(missedReminders(items, WED, "23:00")).toHaveLength(2);
  });
});

describe("the day's list", () => {
  it("is ordered by when it happens, done ones staying in place", () => {
    const items = [
      rem({ time: "21:00" }, "Night meds", "n"),
      rem({ time: "08:00", lastDone: WED }, "Morning meds", "m"),
      rem({ time: "13:00" }, "Vitamin D", "v"),
    ];
    expect(todaysReminders(items, WED, "14:00").map((v) => v.id)).toEqual(["m", "v", "n"]);
    expect(todaysReminders(items, WED, "14:00")[0]!.done).toBe(true);
  });
  it("hides reminders that do not run today at all", () => {
    const items = [rem({ time: "08:00", days: [1, 2, 3, 4, 5] })];
    expect(todaysReminders(items, SAT, "09:00")).toHaveLength(0);
  });
  it("ignores plain tasks entirely", () => {
    const plain = { id: "t", data: { text: "Pay rent", category: "", done: false } } as TaskItem;
    expect(todaysReminders([plain], WED, "09:00")).toHaveLength(0);
  });
});

describe("cadenceLabel", () => {
  it("names the presets", () => {
    expect(cadenceLabel({ time: "08:00" })).toBe("Every day");
    expect(cadenceLabel({ time: "08:00", days: [1, 2, 3, 4, 5] })).toBe("Weekdays");
    expect(cadenceLabel({ time: "08:00", days: [0, 6] })).toBe("Weekends");
  });
  it("lists an arbitrary set", () => {
    expect(cadenceLabel({ time: "08:00", days: [3, 1] })).toBe("Mon · Wed");
  });
});

// IF YOU MISS IT (2026-08-21). A setting that surfaces nowhere is friction;
// this one has to change what the app actually does.
describe("onMiss", () => {
  const mk = (onMiss?: "nag" | "let_go") => ({
    id: "r1",
    data: { text: "Meds", reminder: { time: "08:00", ...(onMiss ? { onMiss } : {}) } },
  }) as unknown as Parameters<typeof viewOf>[0];

  it("defaults to nagging, so every existing reminder is unchanged", () => {
    const v = viewOf(mk(), "2026-08-21", "12:00")!;
    expect(v.missed).toBe(true);
    expect(v.letGo).toBe(false);
    expect(missedReminders([mk()], "2026-08-21", "12:00").length).toBe(1);
  });

  it("let it go stops the chasing but keeps the row honest", () => {
    const v = viewOf(mk("let_go"), "2026-08-21", "12:00")!;
    expect(v.missed).toBe(true);   // the day really did pass it
    expect(v.letGo).toBe(true);    // but nothing chases
    expect(missedReminders([mk("let_go")], "2026-08-21", "12:00")).toEqual([]);
  });

  it("[edge] before its time, let-go changes nothing", () => {
    const v = viewOf(mk("let_go"), "2026-08-21", "07:00")!;
    expect(v.missed).toBe(false);
    expect(v.letGo).toBe(false);
  });
});
