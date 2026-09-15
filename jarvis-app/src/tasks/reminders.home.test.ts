import { describe, it, expect } from "vitest";
import type { TaskItem } from "./TasksService";
import type { ReminderInfo } from "../notes/types";
import { homeSections } from "./reminders";

// REMINDERS HOME (the reminders rebuild push B, 2026-09-15): organised by
// when. Each section is pinned against one clock.
const item = (r: ReminderInfo, text: string, id: string, done = false): TaskItem =>
  ({ id, data: { text, category: "c1", done, reminder: r } } as TaskItem);

const TUE = "2026-09-15";
const WED = "2026-09-16";

describe("homeSections", () => {
  const items = [
    item({ time: "09:00" }, "Bridge Planning", "now1"),
    item({ time: "10:00" }, "Log Meds", "later1"),
    item({ time: "14:00" }, "Call Alberto", "later2"),
    item({ time: "09:00", repeat: { kind: "once" }, startDate: "2026-09-29" }, "Review This Decision", "up1"),
    item({ time: "08:00", scheduleKind: "unscheduled" }, "Call Mom", "un1"),
    item({ time: "07:00", paused: true }, "Stretch", "p1"),
    item({ time: "07:00", lastDone: TUE }, "Water", "done1"),
    item({ time: "07:00" }, "Finished task", "x1", true),
  ];
  const s = homeSections(items, TUE, "09:30");

  it("puts what is due or past and not done in Now, the rest of today in Later Today", () => {
    expect(s.now.map((x) => x.id)).toEqual(["now1"]);
    expect(s.laterToday.map((x) => x.id)).toEqual(["later1", "later2"]);
    expect(s.now[0]!.time).toBe("09:00");
    expect(s.now[0]!.date).toBe(TUE);
  });
  it("Upcoming is the next occurrence for what is not running today, with its date", () => {
    expect(s.upcoming.map((x) => x.id)).toEqual(["up1"]);
    expect(s.upcoming[0]!.date).toBe("2026-09-29");
  });
  it("Unscheduled and Paused carry no date and no time; Completed is what was done today", () => {
    expect(s.unscheduled.map((x) => x.id)).toEqual(["un1"]);
    expect(s.unscheduled[0]!.time).toBeNull();
    expect(s.paused.map((x) => x.id)).toEqual(["p1"]);
    expect(s.paused[0]!.time).toBeNull();
    expect(s.completed.map((x) => x.id)).toEqual(["done1"]);
    expect(s.completed[0]!.done).toBe(true);
  });
  it("a task marked done outright is nowhere on the page", () => {
    const all = [...s.now, ...s.laterToday, ...s.upcoming, ...s.unscheduled, ...s.paused, ...s.completed];
    expect(all.find((x) => x.id === "x1")).toBeUndefined();
  });
  it("a one-off six weeks out is past the horizon; a wider horizon finds it", () => {
    const far = [item({ time: "09:00", repeat: { kind: "once" }, startDate: "2026-11-01" }, "Far", "far")];
    expect(homeSections(far, TUE, "09:30").upcoming).toEqual([]);
    expect(homeSections(far, TUE, "09:30", 60).upcoming.map((x) => x.id)).toEqual(["far"]);
  });
  it("a weekday reminder on a Saturday is Upcoming for Monday", () => {
    const sat = "2026-09-19";
    const wk = [item({ time: "09:00", days: [1, 2, 3, 4, 5] }, "Bridge Planning", "wk")];
    const out = homeSections(wk, sat, "12:00");
    expect(out.now).toEqual([]);
    expect(out.upcoming[0]!.date).toBe("2026-09-21");
  });
  it("Now and Later Today are in clock order; a moved occurrence sits at its moved time", () => {
    const list = [
      item({ time: "11:00" }, "B", "b"),
      item({ time: "08:00", movedTimes: { [WED]: "10:30" } }, "A", "a"),
    ];
    const out = homeSections(list, WED, "07:00");
    expect(out.laterToday.map((x) => x.id + "@" + x.time)).toEqual(["a@10:30", "b@11:00"]);
  });
});
