import { describe, it, expect } from "vitest";
import { greetingFor, longDate, shortDate } from "./greeting";
import { tomorrowISO, nowHHMM, daySummary, todaysTasks, isPast } from "./todayData";
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
  it("past detection", () => {
    expect(isPast(ev("x", "09:00"), "13:00")).toBe(true);
    expect(isPast(ev("x", "15:00"), "13:00")).toBe(false);
  });
});

// Bills where the eyes are (2026-08-09).
import { billsLine } from "./todayData";

const bill = (id: string, text: string, due: string, amount?: number, done = false): TaskItem =>
  ({ id, data: { text, done, due, bill: { amount: amount ?? 0 } } }) as TaskItem;
const plain = (id: string, due: string): TaskItem => ({ id, data: { text: id, done: false, due } }) as TaskItem;

describe("billsLine", () => {
  const T = "2026-08-09"; // a Sunday

  it("says nothing when no bill is due within three days", () => {
    expect(billsLine([], T)).toBeNull();
    expect(billsLine([bill("b", "Pay Rent", "2026-08-20", 1850)], T)).toBeNull();
    expect(billsLine([plain("t", T)], T)).toBeNull(); // plain tasks are not bills
  });

  it("names one bill with its amount and a human day", () => {
    expect(billsLine([bill("b", "Pay Rent", "2026-08-10", 1850)], T)).toBe("Rent ($1850) due tomorrow");
    expect(billsLine([bill("b", "Pay Rent", T, 1850)], T)).toBe("Rent ($1850) due today");
    expect(billsLine([bill("b", "Pay Electric", "2026-08-12", 120)], T)).toBe("Electric ($120) due Wednesday");
  });

  it("rolls several into a count, earliest first", () => {
    const out = billsLine([bill("a", "Pay Electric", "2026-08-11", 120), bill("b", "Pay Rent", "2026-08-10", 1850)], T);
    expect(out).toBe("2 bills due soon: Rent, Electric");
  });

  it("ignores a paid bill", () => {
    expect(billsLine([bill("b", "Pay Rent", T, 1850, true)], T)).toBeNull();
  });
});
