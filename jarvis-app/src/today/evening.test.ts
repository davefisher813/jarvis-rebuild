import { describe, it, expect } from "vitest";
import { isEvening, eveningStats, eveningSummary, weekRecap, todayPlan, todayPlanLine, EVENING_TASKS_NOTE } from "./evening";
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
  // TODAY-F-09 (2026-09-05): the evening read the same due-date-only count
  // the ring did, so a day that ended with a recurring task closed smaller
  // than it started.
  it("a recurring task completed today counts in both halves of the fraction", () => {
    const daily = ({ id: "dog", data: { text: "Walk the dog", category: "", done: false, due: "2026-07-30", recurrence: "daily", lastDone: TODAY } }) as unknown as TaskItem;
    const s = eveningStats([], [task(false, TODAY), daily], TODAY, "19:00");
    expect(s.doneDue).toBe(1);
    expect(s.dueTotal).toBe(2);
  });

  it("counts wins, attended events, and open tasks honestly", () => {
    const events = [ev("09:00"), ev("20:30")];
    const tasks = [task(true, TODAY), task(true, TODAY), task(false, TODAY), task(false, "2026-07-20")];
    const s = eveningStats(events, tasks, TODAY, "19:00");
    // 2 done + the 9 AM event attended = 3 things
    expect(s).toEqual({ doneDue: 2, dueTotal: 3, eventsLeft: 1, openCount: 2, thingsDone: 3 });
    expect(eveningSummary(s)).toBe("3 Done today · 1 Left tonight") // SPEC MOVED (short copy, 2026-08-15);
  });

  it("Time Sense completions win over the due-today count when larger", () => {
    const s = eveningStats([], [task(true, TODAY)], TODAY, "19:00", 5);
    expect(s.thingsDone).toBe(5);
    expect(eveningSummary(s)).toBe("5 Done today");
  });

  it("leads with the win when the evening is clear", () => {
    const s = eveningStats([], [task(true, TODAY)], TODAY, "19:00");
    expect(eveningSummary(s)).toBe("1 Done today");
  });

  it("a truly clear evening says so, without inventing wins", () => {
    const s = eveningStats([], [], TODAY, "19:00");
    expect(eveningSummary(s)).toBe("A clear evening");
  });

  it("never mentions what did not happen, and uses no em dashes", () => {
    const s = eveningStats([], [task(false, TODAY)], TODAY, "19:00");
    const line = eveningSummary(s);
    expect(line).not.toMatch(/overdue|missed|behind|unfinished/i);
    expect(line + EVENING_TASKS_NOTE).not.toContain("\u2014");
  });
});

describe("weekRecap", () => {
  // 2026-08-02 is a Sunday; the Monday of that week is 2026-07-27.
  const SUN = "2026-08-02";
  const at = (iso: string, dow: number) => ({ t: new Date(iso + "T12:00:00").getTime(), dow });
  it("speaks only on Sundays", () => {
    expect(weekRecap([at("2026-07-28", 2)], [], "2026-07-31")).toBeNull();
  });
  it("counts the week's completions and events, names the best day", () => {
    const samples = [at("2026-07-28", 2), at("2026-07-28", 2), at("2026-07-30", 4)];
    const events = [
      { id: "a", data: { title: "x", date: "2026-07-29", start: "09:00", category: "" } },
      { id: "b", data: { title: "y", date: "2026-07-20", start: "09:00", category: "" } },
    ];
    const r = weekRecap(samples, events, SUN);
    expect(r).toEqual({ things: 3, events: 1, bestDay: "Tuesday" });
  });
  it("stays silent on an empty week and hedges a one-sample best day", () => {
    expect(weekRecap([], [], SUN)).toBeNull();
    const r = weekRecap([at("2026-07-28", 2)], [], SUN);
    expect(r?.bestDay).toBeNull();
  });

  // TODAY-F-12 (2026-09-05): the Monday boundary was read through
  // toISOString(), the UTC day, which east of Greenwich is the Sunday before,
  // so last Sunday's events counted into this week.
  it("does not count the previous Sunday's events under Asia/Tokyo", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      const events = [
        { id: "a", data: { title: "x", date: "2026-07-27", start: "09:00", category: "" } }, // Monday: in
        { id: "b", data: { title: "y", date: "2026-07-26", start: "09:00", category: "" } }, // last Sunday: out
      ];
      expect(weekRecap([], events, SUN)).toEqual({ things: 0, events: 1, bestDay: null });
    } finally {
      process.env.TZ = prevTz;
    }
  });

  // The week's last hour: the clocks-back Sunday has 25 of them, and a fixed
  // 86,400,000ms end dropped a completion logged at 23:30 that night.
  it("keeps a completion from the last hour of the clocks-back Sunday under America/New_York", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const late = { t: new Date("2026-11-01T23:30:00").getTime(), dow: 0 };
      expect(weekRecap([late], [], "2026-11-01")).toEqual({ things: 1, events: 0, bestDay: null });
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

describe("eveningSummary and what moved (pick 4)", () => {
  const stats = { doneDue: 2, dueTotal: 3, eventsLeft: 0, openCount: 1, thingsDone: 4 };
  it("names the goal the day moved, between the count and the night", () => {
    expect(eveningSummary({ ...stats, eventsLeft: 1 }, "Moved Run a Half"))
      .toBe("4 Done today · Moved Run a Half · 1 Left tonight");
  });
  it("says nothing extra when Time Sense saw nothing move", () => {
    expect(eveningSummary(stats, null)).toBe("4 Done today");
    expect(eveningSummary(stats)).toBe("4 Done today");
  });
  it("still leads with the win on a day that only moved a goal", () => {
    expect(eveningSummary({ ...stats, thingsDone: 0 }, "Moved 2 goals")).toBe("Moved 2 goals");
  });
});

// HOW TODAY WENT (Dave, on the list since 2026-09-07: "'How did I do today'
// never re-evaluated"; built 2026-09-09). The plan he committed in the morning
// was written to storage, scored at midnight into an event log, and read only
// by planCap to size the next plan. He was never shown it.
//
// The property that matters is in the name of the complaint: the answer has to
// change when the day does. These tests hold a pick list still and move the
// TASKS, which is what the card does on every render.
describe("todayPlan: the day is scored against the plan, every time it is asked", () => {
  const pick = (id: string, text: string, done: boolean): TaskItem =>
    ({ id, entityType: "task", data: { text, category: "", done } } as unknown as TaskItem);

  it("joins the committed picks to the tasks as they stand", () => {
    const tasks = [pick("a", "Call the bank", true), pick("b", "Write the brief", false)];
    const p = todayPlan(["a", "b"], tasks)!;
    expect(p.total).toBe(2);
    expect(p.done).toBe(1);
    expect(p.picks.map((x) => x.text)).toEqual(["Call the bank", "Write the brief"]);
  });

  it("keeps the order he picked them in, not the order the tasks arrive in", () => {
    const tasks = [pick("b", "Second", false), pick("a", "First", false)];
    expect(todayPlan(["a", "b"], tasks)!.picks.map((x) => x.text)).toEqual(["First", "Second"]);
  });

  // THE WHOLE POINT. Same picks, a task ticked off between two asks, and the
  // answer moves. Nothing here is cached, stamped, or keyed on a day.
  it("re-evaluates: ticking a pick off changes the answer on the next ask", () => {
    const before = [pick("a", "Call the bank", false), pick("b", "Write the brief", false)];
    expect(todayPlan(["a", "b"], before)!.done).toBe(0);
    const after = [pick("a", "Call the bank", true), pick("b", "Write the brief", false)];
    expect(todayPlan(["a", "b"], after)!.done).toBe(1);
    const all = [pick("a", "Call the bank", true), pick("b", "Write the brief", true)];
    expect(todayPlan(["a", "b"], all)!.done).toBe(2);
  });

  it("says nothing at all when no plan was committed", () => {
    expect(todayPlan([], [pick("a", "Call the bank", false)])).toBeNull();
  });

  // A deleted task is not a miss. The app cannot tell "handled another way"
  // from "abandoned", and guessing punitively is the one reading it must not
  // take: the pick leaves the card rather than counting against him.
  it("drops a pick whose task is gone rather than scoring it as missed", () => {
    const p = todayPlan(["a", "gone"], [pick("a", "Call the bank", true)])!;
    expect(p.total).toBe(1);
    expect(p.done).toBe(1);
    expect(todayPlan(["gone"], [])).toBeNull();
  });

  it("leads with the win, and a finished plan is a sentence rather than a fraction", () => {
    const done = todayPlan(["a"], [pick("a", "One", true)])!;
    expect(todayPlanLine(done)).toBe("The one you picked, done");
    const all = todayPlan(["a", "b"], [pick("a", "One", true), pick("b", "Two", true)])!;
    expect(todayPlanLine(all)).toBe("Everything you picked, done");
    const some = todayPlan(["a", "b"], [pick("a", "One", true), pick("b", "Two", false)])!;
    expect(todayPlanLine(some)).toBe("1 of 2 Done");
    const none = todayPlan(["a", "b"], [pick("a", "One", false), pick("b", "Two", false)])!;
    // Nothing done yet says what was picked, and never counts the misses.
    expect(todayPlanLine(none)).toBe("2 Picked this morning");
    expect(todayPlanLine(none)).not.toMatch(/left|missed|behind|failed/i);
  });
});
