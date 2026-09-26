import { describe, it, expect } from "vitest";
import type { TaskItem } from "./TasksService";
import type { ReminderInfo } from "../notes/types";
import { pageSections, whenWords, followUpWords, inQuietHours, runsOn } from "./reminders";

// THE REMINDERS PAGE (push E): four views, each its sections, and a search
// over everything open.
const item = (r: ReminderInfo, text: string, id: string, category = "c1", done = false): TaskItem =>
  ({ id, data: { text, category, done, reminder: r } } as TaskItem);
const TUE = "2026-09-15";
const area = (id: string) => (id === "c1" ? "Bridge" : "Health");
const items = [
  item({ time: "09:00", days: [1, 2, 3, 4, 5] }, "Bridge Planning", "now1"),
  item({ time: "14:00", repeat: { kind: "once" } }, "Call Alberto", "later1"),
  item({ time: "09:00", repeat: { kind: "once" }, startDate: "2026-09-18" }, "Review the Facility Decision", "up1"),
  item({ time: "08:00", scheduleKind: "unscheduled" }, "Collect Ideas", "un1"),
  item({ time: "08:00", scheduleKind: "unscheduled", contextTrigger: { kind: "onOpenArea", targetId: "c1", cooldownMinutes: 240, lastShownAt: null } }, "Bridge First", "ctx1"),
  item({ time: "07:00", paused: true }, "Stretch", "p1"),
  item({ time: "08:00", lastDone: TUE }, "Send Practice Details", "done1", "c2"),
  item({ time: "10:00", skippedDates: [TUE, "2026-08-01"] }, "Log Effort", "sk1", "c2"),
];

describe("pageSections", () => {
  it("Today is Now and Later Today", () => {
    const s = pageSections(items, "today", TUE, "09:30");
    expect(s.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([["Now", ["now1"]], ["Later Today", ["later1"]]]);
  });
  it("Upcoming is Scheduled, Unscheduled and On an Action", () => {
    const s = pageSections(items, "upcoming", TUE, "09:30");
    expect(s.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([["Scheduled", ["sk1", "up1"]], ["Unscheduled", ["un1"]], ["On an Action", ["ctx1"]]]);
  });
  it("Routines is what repeats or responds, then Paused", () => {
    const s = pageSections(items, "routines", TUE, "09:30");
    const rep = s.find((x) => x.label === "Repeating and Contextual")!.rows.map((r) => r.id);
    expect(rep).toContain("now1");
    expect(rep).toContain("ctx1");
    expect(rep).not.toContain("later1");
    expect(s.find((x) => x.label === "Paused")!.rows[0]!.state).toBe("paused");
  });
  it("Done is Completed Today and the week's Skipped, newest first", () => {
    const s = pageSections(items, "done", TUE, "09:30");
    expect(s.find((x) => x.label === "Completed Today")!.rows.map((r) => r.id)).toEqual(["done1"]);
    const sk = s.find((x) => x.label === "Skipped")!.rows;
    expect(sk).toHaveLength(1);
    expect(sk[0]!.skippedDate).toBe(TUE);
    expect(sk[0]!.state).toBe("skipped");
  });
  it("a search is one section over titles and areas, whatever the view", () => {
    expect(pageSections(items, "done", TUE, "09:30", "alberto", area)[0]!.rows.map((r) => r.id)).toEqual(["later1"]);
    expect(pageSections(items, "today", TUE, "09:30", "health", area)[0]!.rows.map((r) => r.id).sort()).toEqual(["done1", "sk1"]);
    expect(pageSections(items, "today", TUE, "09:30", "zzz", area)).toEqual([]);
  });
});

describe("the words", () => {
  it("say when in the reference's shape", () => {
    expect(whenWords({ time: "09:00" }, TUE, "09:00", TUE)).toBe("Today, 9:00 AM");
    expect(whenWords({ time: "15:30" }, "2026-09-16", "15:30", TUE)).toBe("Tomorrow, 3:30 PM");
    expect(whenWords({ time: "11:00" }, "2026-09-18", "11:00", TUE)).toBe("Sep 18, 11:00 AM");
    expect(whenWords({ time: "08:00", scheduleKind: "unscheduled" }, null, null, TUE)).toBe("Unscheduled");
    expect(whenWords({ time: "08:00", scheduleKind: "unscheduled", contextTrigger: { kind: "onOpenArea", targetId: "c1", cooldownMinutes: 60, lastShownAt: null } }, null, null, TUE, "Bridge")).toBe("When I Open Bridge");
    expect(whenWords({ time: "08:00", paused: true }, null, null, TUE)).toBe("Paused");
  });
  it("say the follow-up", () => {
    expect(followUpWords({ time: "09:00", onMiss: "let_go" })).toBe("None");
    expect(followUpWords({ time: "09:00" })).toBe("Once After 15 Minutes");
    expect(followUpWords({ time: "09:00", followUp: { delayMinutes: 60, maxCount: 1, stopAt: null } })).toBe("Once After 1 Hour");
    expect(followUpWords({ time: "09:00", followUp: { delayMinutes: 30, maxCount: 2, stopAt: null } })).toBe("2 Times After 30 Minutes");
  });
});

describe("quiet hours and extra days", () => {
  it("the window wraps midnight and is closed at its end", () => {
    expect(inQuietHours("22:00", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("03:00", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("08:00", "21:00", "08:00")).toBe(false);
    expect(inQuietHours("12:00", "21:00", "08:00")).toBe(false);
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(inQuietHours("13:00", "13:00", "13:00")).toBe(false);
  });
  it("an occurrence moved onto a day the rule would not run runs there once", () => {
    const r: ReminderInfo = { time: "09:00", days: [1, 2, 3, 4, 5], skippedDates: ["2026-09-18"], extraDates: ["2026-09-19"] };
    expect(runsOn(r, "2026-09-18")).toBe(false);
    expect(runsOn(r, "2026-09-19")).toBe(true);
    expect(runsOn(r, "2026-09-20")).toBe(false);
  });
});
