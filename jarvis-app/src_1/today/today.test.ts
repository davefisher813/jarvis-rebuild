import { describe, it, expect } from "vitest";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, todaysTasks, nowIndex, isPast } from "./todayData";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";

const ev = (id: string, start: string): EventItem => ({
  id,
  data: { title: id, date: "2026-05-20", start, category: "tucci" },
});
const tk = (id: string, due: string | null, done = false): TaskItem => ({
  id,
  data: { text: id, category: "tucci", done, due },
});

describe("greeting", () => {
  it("morning / afternoon / evening by hour", () => {
    expect(greetingFor(new Date(2026, 4, 20, 8))).toBe("Good Morning");
    expect(greetingFor(new Date(2026, 4, 20, 11, 59))).toBe("Good Morning");
    expect(greetingFor(new Date(2026, 4, 20, 12))).toBe("Good Afternoon");
    expect(greetingFor(new Date(2026, 4, 20, 17, 59))).toBe("Good Afternoon");
    expect(greetingFor(new Date(2026, 4, 20, 18))).toBe("Good Evening");
    expect(greetingFor(new Date(2026, 4, 20, 23))).toBe("Good Evening");
  });
  it("formats long + short dates deterministically", () => {
    const d = new Date(2026, 4, 20); // Wed May 20 2026
    expect(longDate(d)).toBe("Wednesday, May 20");
    expect(shortDate(d)).toBe("Wed, May 20");
  });
});

describe("today aggregation", () => {
  it("tomorrow rolls over month and year", () => {
    expect(tomorrowISO("2026-05-20")).toBe("2026-05-21");
    expect(tomorrowISO("2026-05-31")).toBe("2026-06-01");
    expect(tomorrowISO("2026-12-31")).toBe("2027-01-01");
  });
  it("nowHHMM zero-pads", () => {
    expect(nowHHMM(new Date(2026, 4, 20, 9, 5))).toBe("09:05");
  });
  it("summary counts events, due-today, overdue (excludes done)", () => {
    const today = "2026-05-20";
    const events = [ev("a", "09:00"), ev("b", "10:00")];
    const tasks = [tk("t1", today), tk("t2", "2026-05-18"), tk("t3", "2026-05-25"), tk("d", today, true)];
    const s = daySummary(events, tasks, today);
    expect(s.events).toBe(2);
    expect(s.due).toBe(1);
    expect(s.overdue).toBe(1);
  });
  it("today's tasks = overdue then due-today; no done or upcoming", () => {
    const today = "2026-05-20";
    const tasks = [tk("due", today), tk("over", "2026-05-18"), tk("later", "2026-05-25"), tk("done", today, true)];
    expect(todaysTasks(tasks, today).map((t) => t.id)).toEqual(["over", "due"]);
  });
  it("now line index + past detection", () => {
    const events = [ev("a", "09:00"), ev("b", "12:00"), ev("c", "15:00")];
    expect(nowIndex(events, "13:00")).toBe(2);
    expect(nowIndex(events, "08:00")).toBe(0);
    expect(nowIndex(events, "23:00")).toBe(3);
    expect(isPast(ev("x", "09:00"), "13:00")).toBe(true);
    expect(isPast(ev("x", "15:00"), "13:00")).toBe(false);
  });
});
