import { describe, it, expect } from "vitest";
import { isEvening, eveningStats, eveningSummary, EVENING_TASKS_NOTE } from "./evening";
import { DEFAULT_ROUTINE } from "../routine/types";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";

const r = (patch: Partial<typeof DEFAULT_ROUTINE> = {}) => ({ ...DEFAULT_ROUTINE, ...patch });
const ev = (start: string): EventItem => ({ id: start, data: { title: "e", date: "2026-07-29", start, category: "" } });
const task = (done: boolean, due?: string): TaskItem => ({ id: Math.random().toString(36).slice(2), entityType: "task", data: { text: "t", category: "", done, due } } as unknown as TaskItem);

const TODAY = "2026-07-29";

describe("isEvening", () => {
  it("starts at 6 PM for a standard 9-to-5", () => {
    expect(isEvening(17 * 60 + 59, r())).toBe(false);
    expect(isEvening(18 * 60, r())).toBe(true);
    expect(isEvening(23 * 60, r())).toBe(true);
  });

  it("waits for a late workday to end", () => {
    const late = r({ workEndMin: 19 * 60 });
    expect(isEvening(18 * 60 + 30, late)).toBe(false);
    expect(isEvening(19 * 60, late)).toBe(true);
  });

  it("early finishers still wait until 6 PM", () => {
    const early = r({ workEndMin: 15 * 60 });
    expect(isEvening(15 * 60 + 30, early)).toBe(false);
    expect(isEvening(18 * 60, early)).toBe(true);
  });
});

describe("eveningStats + eveningSummary", () => {
  it("counts wins, remaining events, and open tasks honestly", () => {
    const events = [ev("09:00"), ev("20:30")];
    const tasks = [task(true, TODAY), task(true, TODAY), task(false, TODAY), task(false, "2026-07-20")];
    const s = eveningStats(events, tasks, TODAY, "19:00");
    expect(s).toEqual({ doneDue: 2, dueTotal: 3, eventsLeft: 1, openCount: 2 });
    expect(eveningSummary(s)).toBe("2 tasks done today · 1 thing left tonight");
  });

  it("leads with the win when the evening is clear", () => {
    const s = eveningStats([], [task(true, TODAY)], TODAY, "19:00");
    expect(eveningSummary(s)).toBe("1 task done today");
  });

  it("a truly clear evening says so, without inventing wins", () => {
    const s = eveningStats([ev("09:00")], [], TODAY, "19:00");
    expect(eveningSummary(s)).toBe("A clear evening.");
  });

  it("never mentions what did not happen, and uses no em dashes", () => {
    const s = eveningStats([], [task(false, TODAY)], TODAY, "19:00");
    const line = eveningSummary(s);
    expect(line).not.toMatch(/overdue|missed|behind|unfinished/i);
    expect(line + EVENING_TASKS_NOTE).not.toContain("\u2014");
  });
});
